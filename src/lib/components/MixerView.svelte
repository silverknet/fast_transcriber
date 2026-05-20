<script lang="ts">
  /**
   * Multi-track mixer view — in-browser "parallel-track DAW" for one song.
   *
   * Lifecycle:
   *  1. On mount, decode the song's audio chunk + every stem WAV + cue track
   *     (whichever are present on disk). All decode work happens on a single
   *     AudioContext owned by [`MixerEngine`](../audio/mixerEngine.ts).
   *  2. Each track is registered with the engine. Time alignment: tracks
   *     whose natural t=0 is *before* the cue track's t=0 (stems, original
   *     mix) get silence prepended so every track starts at t=0 of the mix
   *     timeline. This matches how the eventual Ableton export will lay
   *     clips out — each track starts at the same musical zero.
   *  3. Volume / mute / solo are persisted into `songMap.mixState` (debounced
   *     1 s); the project autosave then ships it to disk.
   *  4. On unmount, dispose the engine (releases buffers + closes context).
   */
  import { onDestroy, onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { Button } from '$lib/components/ui/button'
  import MixerTrackLane from '$lib/components/MixerTrackLane.svelte'
  import { Pause, Play, Square } from '@lucide/svelte'
  import { titleCuePreludeSec } from '$lib/audio/cueTrackSpeechSchedule'
  import { computeCountIn } from '$lib/audio/computeCountIn'
  import {
    bufferWithPrepend,
    MixerEngine,
    type MixerSnapshot,
    type MixerTrack,
  } from '$lib/audio/mixerEngine'
  import { readProjectSongAsset } from '$lib/client/desktopProjectFs'
  import { refreshProjectInfo, selectBestStemSet } from '$lib/project/commit'
  import { renderCueTrackWavBlob } from '$lib/audio/renderCueTrack'
  import { audioSession } from '$lib/stores/audioSession'
  import { project as projectStore } from '$lib/stores/project'
  import { patchSongMap, songMap } from '$lib/stores/songMap'
  import type { MixState, MixTrackState } from '$lib/songmap/types'
  import { RefreshCw } from '@lucide/svelte'

  /** Lane palette — distinct hues so tracks are easy to tell apart. */
  const LANE_COLORS = [
    '#0ea5e9', // sky (original)
    '#f43f5e', // rose (vocals)
    '#a855f7', // purple (drums)
    '#22c55e', // emerald (bass)
    '#eab308', // yellow (other / guitar)
    '#06b6d4', // cyan (fx / extra stems)
    '#f97316', // orange (cue)
  ]

  /** What we hand to MixerTrackLane for rendering. */
  interface LaneView {
    key: string
    label: string
    color: string
    buffer: AudioBuffer | null
    volume: number
    muted: boolean
    soloed: boolean
  }

  let loading = $state(true)
  let loadingMsg = $state('Loading tracks…')
  let loadError = $state<string | null>(null)

  let engine: MixerEngine | null = null
  let snapshot = $state<MixerSnapshot>({ state: 'stopped', positionSec: 0, durationSec: 0 })
  let lanes = $state<LaneView[]>([])

  /** Pull the current saved state for one track-key from songMap. */
  function savedFor(key: string): MixTrackState | undefined {
    return $songMap?.mixState?.tracks.find((t) => t.key === key)
  }

  function nextColor(): string {
    return LANE_COLORS[lanes.length % LANE_COLORS.length]!
  }

  function syncLanesFromEngine() {
    if (!engine) return
    lanes = engine.listTracks().map((t, i) => ({
      key: t.key,
      label: t.label,
      color: LANE_COLORS[i % LANE_COLORS.length]!,
      buffer: t.buffer,
      volume: t.volume,
      muted: t.muted,
      soloed: t.soloed,
    }))
  }

  /** Compute the silence-prepend each source needs so all tracks share t=0. */
  function computePrepend(forKey: string): number {
    const sm = get(songMap)
    if (!sm) return 0
    // Cue + click tracks already contain the preamble silence inside their
    // buffers — same render, just speech vs no-speech — so they play at t=0
    // of their own buffer. Stems + original get the same preamble of silence
    // prepended so musical time aligns: the cue's "beat 1" sits at the same
    // mix-timeline second as each stem's `trim.startSec` sample.
    if (forKey === 'cue' || forKey === 'click') return 0
    const preludeSec = titleCuePreludeSec(sm)
    let prependSec = 0
    if (sm.cues.mode === 'countIn' && sm.cues.countInBeats > 0) {
      const ci = computeCountIn(sm, sm.cues.countInBeats)
      if (ci) prependSec = ci.prependSec
    }
    const trimStart = sm.audio?.trim?.startSec ?? 0
    // Offset: cue's beat-1 moment = preludeSec + prependSec. That should
    // line up with stem time = trimStart. So stem needs to start
    // `(preludeSec + prependSec) - trimStart` seconds after t=0.
    const offset = preludeSec + prependSec - trimStart
    return Math.max(0, offset)
  }

  /** Pretty label for a stem filename — Vocals/Drums/Bass/Other/etc. */
  function labelForStem(filename: string): string {
    const m: Record<string, string> = {
      'vocals.wav': 'Vocals',
      'drums.wav': 'Drums',
      'bass.wav': 'Bass',
      'other.wav': 'Other',
      'guitar.wav': 'Guitar',
      'fx.wav': 'FX',
    }
    return m[filename.toLowerCase()] ?? filename.replace(/\.[^.]+$/, '')
  }

  async function decodeBlob(eng: MixerEngine, blob: Blob): Promise<AudioBuffer> {
    return await eng.ac.decodeAudioData(await blob.arrayBuffer())
  }

  async function loadAndRegisterTracks() {
    if (!engine) return
    const sm = get(songMap)
    const ps = get(projectStore)
    const sess = get(audioSession)

    type Plan = { key: string; label: string; loader: () => Promise<Blob | null> }
    const plan: Plan[] = []

    // Original audio — from the live audioSession (already decoded once into editor).
    if (sess.file) {
      plan.push({
        key: 'original',
        label: 'Original',
        loader: async () => sess.file,
      })
    }

    // Stems on disk. Multiple renderings can exist tagged by quality
    // preset (`best`/`balanced`/`preview`); pick the highest-quality set
    // available for this song. Lower-quality copies are ignored — they
    // stay on disk but never load into the mixer.
    const folderMeta = ps.osPath && ps.activeSongFolder
      ? ps.metadataByFolder[ps.activeSongFolder]
      : undefined
    const bestStems = selectBestStemSet(folderMeta)
    if (bestStems) {
      for (const filename of bestStems.files) {
        const key = `stem:${filename}`
        const baseLabel = labelForStem(filename)
        const label = `${baseLabel} · ${bestStems.preset}`
        const subpath = `${bestStems.pathPrefix}${filename}`
        plan.push({
          key,
          label,
          loader: async () => {
            if (!ps.osPath || !ps.activeSongFolder) return null
            const r = await readProjectSongAsset(ps.osPath, ps.activeSongFolder, subpath)
            return r.ok ? r.blob : null
          },
        })
      }
    }

    // Cue track (clicks + speech).
    if (folderMeta?.hasCueTrack) {
      plan.push({
        key: 'cue',
        label: 'Cue',
        loader: async () => {
          if (!ps.osPath || !ps.activeSongFolder) return null
          const r = await readProjectSongAsset(ps.osPath, ps.activeSongFolder, 'cue/cue-track.wav')
          return r.ok ? r.blob : null
        },
      })
    }

    // Click track (clicks only). Always present for a song with beats —
    // either fetched from disk if generated, or synthesized client-side
    // from the SongMap on the fly. The user never needs to "render" it.
    if (sm && sm.timeline.beats.length > 0) {
      plan.push({
        key: 'click',
        label: 'Click',
        loader: async () => {
          if (folderMeta?.hasClickTrack && ps.osPath && ps.activeSongFolder) {
            const r = await readProjectSongAsset(ps.osPath, ps.activeSongFolder, 'cue/click-track.wav')
            if (r.ok) return r.blob
          }
          // No file on disk — synthesize from beats. This is pure DSP (no
          // TTS needed), so it works offline and is fast.
          try {
            const r = await renderCueTrackWavBlob(sm, { includeSpeech: false, includeClicks: true })
            return r.blob
          } catch {
            return null
          }
        },
      })
    }

    if (plan.length === 0) {
      loadError = 'No audio tracks found. Render stems or a cue track first.'
      loading = false
      return
    }

    let done = 0
    for (const p of plan) {
      loadingMsg = `Loading ${p.label}… (${done + 1} / ${plan.length})`
      try {
        const blob = await p.loader()
        if (!blob) continue
        let buf = await decodeBlob(engine, blob)
        const pre = computePrepend(p.key)
        if (pre > 0) buf = bufferWithPrepend(engine.ac, buf, pre)
        const saved = savedFor(p.key)
        const track: MixerTrack = {
          key: p.key,
          label: p.label,
          buffer: buf,
          volume: saved?.volume ?? 1,
          muted: !!saved?.muted,
          soloed: !!saved?.soloed,
        }
        engine.setTrack(track)
        syncLanesFromEngine()
      } catch (e) {
        console.warn('Failed to load', p.key, e)
      }
      done++
    }
    loading = false
  }

  /** Persist current track state into songMap.mixState (debounced). */
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      if (!engine) return
      const tracks: MixTrackState[] = engine.listTracks().map((t) => {
        const entry: MixTrackState = { key: t.key, volume: t.volume }
        if (t.muted) entry.muted = true
        if (t.soloed) entry.soloed = true
        return entry
      })
      const next: MixState = { tracks }
      patchSongMap((m) => ({ ...m, mixState: next }))
    }, 800)
  }

  function onVolume(key: string, v: number) {
    if (!engine) return
    engine.setVolume(key, v)
    syncLanesFromEngine()
    schedulePersist()
  }

  function onToggleMuted(key: string) {
    if (!engine) return
    const t = engine.listTracks().find((x) => x.key === key)
    if (!t) return
    engine.setMuted(key, !t.muted)
    syncLanesFromEngine()
    schedulePersist()
  }

  function onToggleSoloed(key: string) {
    if (!engine) return
    const t = engine.listTracks().find((x) => x.key === key)
    if (!t) return
    engine.setSoloed(key, !t.soloed)
    syncLanesFromEngine()
    schedulePersist()
  }

  function onSeekFraction(frac: number) {
    if (!engine) return
    engine.seek(frac * snapshot.durationSec)
  }

  function onPlayPause() {
    if (!engine) return
    if (snapshot.state === 'playing') engine.pause()
    else void engine.play()
  }

  function onStop() {
    if (!engine) return
    engine.stop()
  }

  function fmtTime(sec: number): string {
    const safe = Math.max(0, sec)
    const m = Math.floor(safe / 60)
    const s = Math.floor(safe - m * 60)
    const ms = Math.floor((safe - Math.floor(safe)) * 10)
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`
  }

  /**
   * Re-fetch the sidecar's on-disk view before deciding which lanes to load.
   * This is the difference between the mixer reflecting whatever happened to
   * be cached when the user last visited /project and what's actually on
   * disk right now. Without this, generating a cue track in the Cue tab and
   * then switching to Mix would show no cue lane until the user navigated
   * back through /project to trigger a refresh.
   */
  async function syncAndLoad() {
    loading = true
    loadError = null
    loadingMsg = 'Scanning project…'
    try {
      await refreshProjectInfo()
    } catch {
      /* sidecar offline — fall through with whatever's cached */
    }
    await loadAndRegisterTracks()
  }

  async function reload() {
    if (!engine) return
    // Wipe existing tracks + buffers so re-loading is a clean slate.
    for (const t of engine.listTracks()) engine.removeTrack(t.key)
    syncLanesFromEngine()
    await syncAndLoad()
  }

  onMount(() => {
    engine = new MixerEngine()
    engine.onUpdate((s) => {
      snapshot = s
    })
    void syncAndLoad()
  })

  onDestroy(() => {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    void engine?.dispose()
    engine = null
  })
</script>

<div class="border-foreground bg-background border-2 px-3 py-3 space-y-3">
  <!-- Transport bar -->
  <div class="border-foreground/30 flex flex-wrap items-center gap-2 border-b-2 pb-2">
    <Button
      variant="default"
      size="sm"
      class="h-9 w-9 p-0"
      onclick={onPlayPause}
      disabled={loading || lanes.length === 0}
      aria-label={snapshot.state === 'playing' ? 'Pause' : 'Play'}
    >
      {#if snapshot.state === 'playing'}
        <Pause class="size-4" aria-hidden="true" />
      {:else}
        <Play class="size-4" aria-hidden="true" />
      {/if}
    </Button>
    <Button
      variant="outline"
      size="sm"
      class="h-9 w-9 p-0"
      onclick={onStop}
      disabled={loading || lanes.length === 0}
      aria-label="Stop"
    >
      <Square class="size-3.5" aria-hidden="true" />
    </Button>
    <div class="font-mono text-sm tabular-nums">
      {fmtTime(snapshot.positionSec)} / {fmtTime(snapshot.durationSec)}
    </div>
    <div class="text-muted-foreground ml-auto text-xs">
      {lanes.length} track{lanes.length === 1 ? '' : 's'}
    </div>
    <Button
      variant="outline"
      size="sm"
      class="h-8 gap-1 px-2"
      onclick={() => void reload()}
      disabled={loading}
      title="Re-scan disk and reload all tracks"
    >
      <RefreshCw class="size-3.5 {loading ? 'animate-spin' : ''}" aria-hidden="true" />
      Reload
    </Button>
  </div>

  {#if loadError}
    <p class="text-destructive text-sm" role="status">{loadError}</p>
  {:else if loading}
    <p class="text-muted-foreground text-sm">{loadingMsg}</p>
  {/if}

  {#if lanes.length > 0}
    <div class="flex flex-col gap-1.5">
      {#each lanes as lane (lane.key)}
        <MixerTrackLane
          label={lane.label}
          buffer={lane.buffer}
          volume={lane.volume}
          muted={lane.muted}
          soloed={lane.soloed}
          color={lane.color}
          positionSec={snapshot.positionSec}
          durationSec={snapshot.durationSec}
          onVolumeChange={(v) => onVolume(lane.key, v)}
          onToggleMuted={() => onToggleMuted(lane.key)}
          onToggleSoloed={() => onToggleSoloed(lane.key)}
          onSeekFraction={onSeekFraction}
        />
      {/each}
    </div>
  {/if}
</div>
