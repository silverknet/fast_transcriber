<script lang="ts">
  /**
   * BarBro Band: detect what the drums and bass are playing on their stems,
   * shape the feel, and (optionally) save the rendered tracks into the
   * project. The mixer's "BarBro Drums" / "BarBro Bass" lanes appear as soon
   * as detected events exist — they synthesize in memory until a saved
   * render is on disk.
   */
  import { get } from 'svelte/store'
  import { Button } from '$lib/components/ui/button'
  import {
    analyzeBassViaDesktop,
    analyzeDrumsViaDesktop,
    getSectionsSetupStatus,
    setupSectionsDeps,
  } from '$lib/client/desktopBridge'
  import { writeProjectSongAsset } from '$lib/client/desktopProjectFs'
  import {
    loadProjectDrumKit,
    PROJECT_DRUM_KIT_DIR,
    type ProjectDrumKit,
  } from '$lib/client/projectDrumKit'
  import { DRUM_KITS, DRUM_KIT_SAMPLE_RATE, loadDrumKit, type DrumKit, type DrumKitId } from '$lib/audio/drumKits'
  import { renderDrumTrackWavBlob } from '$lib/audio/renderDrumTrack'
  import { synthBassNote, renderBassTrackWavBlob } from '$lib/audio/renderBassTrack'
  import { DEFAULT_BASS_SOUND_ID, bassSoundGroups } from '$lib/audio/bassSounds'
  import {
    DRUM_ANALYZER_VERSION,
    DRUM_TRACK_REL,
    drumAudioFingerprint,
    drumClassCounts,
    hasFreshDrumMidi,
  } from '$lib/songmap/drumMidi'
  import { BASS_ANALYZER_VERSION, BASS_TRACK_REL, hasFreshBassMidi } from '$lib/songmap/bassMidi'
  import { fingerprintDrumTrackInputs } from '$lib/songmap/drumTrackFingerprint'
  import { fingerprintBassTrackInputs } from '$lib/songmap/bassTrackFingerprint'
  import { selectBestStemSet } from '$lib/project/commit'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { project as projectStore } from '$lib/stores/project'
  import { patchSongMap, songMap } from '$lib/stores/songMap'
  import type { DrumClass, DrumQuantize } from '$lib/songmap/types'
  import { Drum, Guitar } from '@lucide/svelte'

  let {
    onChanged,
    show = 'both',
  }: {
    onChanged?: () => void
    /** Which generator to render — the mixer opens them one at a time. */
    show?: 'both' | 'drums' | 'bass'
  } = $props()

  const QUANTIZE_OPTIONS: { value: DrumQuantize; label: string }[] = [
    { value: 'off', label: 'As played' },
    { value: '1/8', label: 'Tight · 8ths' },
    { value: '1/16', label: 'Tight · 16ths' },
    { value: '1/16T', label: 'Triplet feel' },
  ]

  let busy = $state<'idle' | 'setup' | 'detecting' | 'saving'>('idle')
  let statusMsg = $state('')
  let errorMsg = $state('')
  let bassBusy = $state<'idle' | 'setup' | 'detecting' | 'saving'>('idle')
  let bassStatusMsg = $state('')
  let bassErrorMsg = $state('')

  const dm = $derived($songMap?.drumMidi ?? null)
  const counts = $derived(dm ? drumClassCounts(dm.events) : null)
  const fresh = $derived($songMap ? hasFreshDrumMidi($songMap) : false)
  const renderSaved = $derived(!!dm?.renderExport?.relativePath)
  const kitId = $derived<DrumKitId>(
    DRUM_KITS.some((k) => k.id === dm?.kit) ? (dm!.kit as DrumKitId) : 'synth',
  )

  // "Your kit" status — loaded from the project folder when selected.
  let customKitInfo = $state<ProjectDrumKit | null>(null)
  let customKitChecked = $state(false)
  $effect(() => {
    const osPath = $projectStore.osPath
    if (kitId !== 'custom' || !osPath) return
    let cancelled = false
    void loadProjectDrumKit(osPath).then((info) => {
      if (cancelled) return
      customKitInfo = info
      customKitChecked = true
    })
    return () => {
      cancelled = true
    }
  })

  async function reloadCustomKit() {
    const osPath = $projectStore.osPath
    if (!osPath) return
    customKitChecked = false
    customKitInfo = await loadProjectDrumKit(osPath, { fresh: true })
    customKitChecked = true
    onChanged?.()
  }

  const CLASS_LABELS: Record<DrumClass, string> = {
    kick: 'kick',
    snare: 'snare',
    hihat: 'hi-hat',
    tom: 'tom',
    cymbal: 'crash',
    ride: 'ride',
  }
  const customKitLine = $derived.by(() => {
    if (kitId !== 'custom' || !customKitChecked) return ''
    if (!customKitInfo) {
      return `No sounds found yet. Add WAV files named kick.wav, snare.wav, hihat.wav, tom.wav and cymbal.wav to ${PROJECT_DRUM_KIT_DIR} inside your project folder, then press Reload sounds.`
    }
    const found = customKitInfo.found.map((c) => CLASS_LABELS[c])
    const missing = (Object.keys(CLASS_LABELS) as DrumClass[])
      .filter((c) => !customKitInfo!.found.includes(c))
      .map((c) => CLASS_LABELS[c])
    return (
      `Using your sounds: ${found.join(', ')}.` +
      (missing.length ? ` Missing ${missing.join(', ')} — built-in sounds fill in.` : '')
    )
  })

  const bm = $derived($songMap?.bassMidi ?? null)
  const bassFresh = $derived($songMap ? hasFreshBassMidi($songMap) : false)
  const bassRenderSaved = $derived(!!bm?.renderExport?.relativePath)

  function stemAbsPath(pattern: RegExp): string | null {
    const ps = $projectStore
    if (!ps.osPath || !ps.activeSongFolder) return null
    const meta = ps.metadataByFolder[ps.activeSongFolder]
    const best = selectBestStemSet(meta)
    if (!best) return null
    const f = best.files.find((n) => pattern.test(n))
    if (!f) return null
    return `${ps.osPath}/${ps.activeSongFolder}/${best.pathPrefix}${f}`
  }
  const drumsStemAbsPath = $derived.by(() => stemAbsPath(/^drums\.(wav|mp3)$/i))
  const bassStemAbsPath = $derived.by(() => stemAbsPath(/^bass\.(wav|mp3)$/i))

  function countsLine(c: Record<DrumClass, number>): string {
    const parts: string[] = []
    if (c.kick) parts.push(`${c.kick} kicks`)
    if (c.snare) parts.push(`${c.snare} snares`)
    if (c.hihat) parts.push(`${c.hihat} hi-hats`)
    if (c.tom) parts.push(`${c.tom} toms`)
    if (c.cymbal) parts.push(`${c.cymbal} cymbals`)
    return parts.join(', ')
  }

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  function midiName(midi: number): string {
    return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
  }
  const bassRangeLine = $derived.by(() => {
    if (!bm || bm.events.length === 0) return ''
    let lo = 127
    let hi = 0
    for (const e of bm.events) {
      lo = Math.min(lo, e.midi)
      hi = Math.max(hi, e.midi)
    }
    return `${bm.events.length} bass notes (${midiName(lo)}–${midiName(hi)})`
  })

  /** Shared gate: desktop reachable + analysis environment installed. */
  async function ensureAnalysisReady(setError: (msg: string) => void): Promise<boolean> {
    if (!$desktopCompanionStatus.reachable) {
      setError('BarBro Desktop must be running.')
      return false
    }
    const setup = await getSectionsSetupStatus()
    if (!setup) {
      setError('Could not check the analysis setup.')
      return false
    }
    if (setup.ready) return true
    const installed = await setupSectionsDeps((ev) => {
      if (ev.type === 'error') setError(ev.msg)
    })
    if (!installed.ok) {
      setError(installed.error)
      return false
    }
    return true
  }

  async function detect() {
    if (busy !== 'idle') return
    errorMsg = ''
    statusMsg = ''
    const sm = get(songMap)
    const stem = drumsStemAbsPath
    if (!sm || !stem) return
    busy = 'setup'
    statusMsg = 'Preparing analysis…'
    try {
      if (!(await ensureAnalysisReady((m) => (errorMsg = m)))) return
      busy = 'detecting'
      statusMsg = 'Listening to the drums…'
      const r = await analyzeDrumsViaDesktop(stem)
      if (!r.ok) {
        errorMsg = r.error
        return
      }
      const relStem = stem.split('/').slice(-3).join('/')
      const p = patchSongMap((m) => ({
        ...m,
        drumMidi: {
          events: r.events.map((e) => ({
            timeSec: e.timeSec,
            cls: e.cls as DrumClass,
            velocity: e.velocity,
          })),
          analyzedAt: new Date().toISOString(),
          analyzerVersion: r.analyzerVersion || DRUM_ANALYZER_VERSION,
          sourceStem: relStem,
          audioFingerprint: drumAudioFingerprint(m),
          // Keep the user's previous sound choices across re-detects.
          kit: m.drumMidi?.kit,
          quantize: m.drumMidi?.quantize,
          style: m.drumMidi?.style,
        },
      }))
      if (!p.ok) {
        errorMsg = p.errors.join('; ')
        return
      }
      statusMsg = r.note ?? ''
      onChanged?.()
    } finally {
      busy = 'idle'
    }
  }

  async function detectBass() {
    if (bassBusy !== 'idle') return
    bassErrorMsg = ''
    bassStatusMsg = ''
    const sm = get(songMap)
    const stem = bassStemAbsPath
    if (!sm || !stem) return
    bassBusy = 'setup'
    bassStatusMsg = 'Preparing analysis…'
    try {
      if (!(await ensureAnalysisReady((m) => (bassErrorMsg = m)))) return
      bassBusy = 'detecting'
      bassStatusMsg = 'Listening to the bass…'
      const r = await analyzeBassViaDesktop(stem)
      if (!r.ok) {
        bassErrorMsg = r.error
        return
      }
      const relStem = stem.split('/').slice(-3).join('/')
      const p = patchSongMap((m) => ({
        ...m,
        bassMidi: {
          events: r.notes.map((e) => ({
            timeSec: e.timeSec,
            durationSec: e.durationSec,
            midi: e.midi,
            velocity: e.velocity,
          })),
          analyzedAt: new Date().toISOString(),
          analyzerVersion: r.analyzerVersion || BASS_ANALYZER_VERSION,
          sourceStem: relStem,
          audioFingerprint: drumAudioFingerprint(m),
          quantize: m.bassMidi?.quantize,
          style: m.bassMidi?.style,
        },
      }))
      if (!p.ok) {
        bassErrorMsg = p.errors.join('; ')
        return
      }
      bassStatusMsg = r.note ?? ''
      onChanged?.()
    } finally {
      bassBusy = 'idle'
    }
  }

  function setKit(kit: DrumKitId) {
    patchSongMap((m) => (m.drumMidi ? { ...m, drumMidi: { ...m.drumMidi, kit } } : m))
    onChanged?.()
  }

  function setQuantize(q: DrumQuantize) {
    patchSongMap((m) => (m.drumMidi ? { ...m, drumMidi: { ...m.drumMidi, quantize: q } } : m))
    onChanged?.()
  }

  function setStyle(style: 'steady' | 'detected') {
    patchSongMap((m) => (m.drumMidi ? { ...m, drumMidi: { ...m.drumMidi, style } } : m))
    onChanged?.()
  }

  function setBassQuantize(q: DrumQuantize) {
    patchSongMap((m) => (m.bassMidi ? { ...m, bassMidi: { ...m.bassMidi, quantize: q } } : m))
    onChanged?.()
  }

  function setBassStyle(style: 'steady' | 'detected') {
    patchSongMap((m) => (m.bassMidi ? { ...m, bassMidi: { ...m.bassMidi, style } } : m))
    onChanged?.()
  }

  /** The detected bass's voice — same instrument list as the bass machine. */
  function setBassSound(sound: string) {
    patchSongMap((m) => (m.bassMidi ? { ...m, bassMidi: { ...m.bassMidi, sound } } : m))
    onChanged?.()
  }

  // ── Pads: audition the kit voices + the bass voice ─────────────────────
  let padCtx: AudioContext | null = null
  const PAD_VOICES: { cls: DrumClass; label: string }[] = [
    { cls: 'kick', label: 'Kick' },
    { cls: 'snare', label: 'Snare' },
    { cls: 'hihat', label: 'Hat' },
    { cls: 'tom', label: 'Tom' },
    { cls: 'cymbal', label: 'Crash' },
  ]

  async function padContext(): Promise<AudioContext> {
    padCtx ??= new AudioContext({ sampleRate: DRUM_KIT_SAMPLE_RATE })
    if (padCtx.state === 'suspended') await padCtx.resume()
    return padCtx
  }

  /** The kit the current selection actually plays (project sounds included). */
  async function resolveKit(): Promise<DrumKit> {
    if (kitId === 'custom') {
      const osPath = get(projectStore).osPath
      const info = osPath ? await loadProjectDrumKit(osPath) : null
      if (info) return info.kit
    }
    return loadDrumKit(kitId)
  }

  async function playPad(cls: DrumClass) {
    try {
      const kit = await resolveKit()
      const voice = kit.voices[cls]
      if (!voice || voice.length === 0) return
      const ctx = await padContext()
      const buf = ctx.createBuffer(1, voice.length, DRUM_KIT_SAMPLE_RATE)
      buf.copyToChannel(new Float32Array(voice), 0)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.start()
    } catch {
      /* audition is best-effort */
    }
  }

  async function playBassPad() {
    try {
      const ctx = await padContext()
      const durSec = 0.7
      const data = new Float32Array(Math.ceil((durSec + 0.05) * DRUM_KIT_SAMPLE_RATE))
      synthBassNote(data, DRUM_KIT_SAMPLE_RATE, 0, durSec, 33, 1) // A1
      const buf = ctx.createBuffer(1, data.length, DRUM_KIT_SAMPLE_RATE)
      buf.copyToChannel(data, 0)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.start()
    } catch {
      /* audition is best-effort */
    }
  }

  async function saveRender() {
    if (busy !== 'idle') return
    errorMsg = ''
    const sm = get(songMap)
    const ps = get(projectStore)
    if (!sm?.drumMidi) return
    busy = 'saving'
    statusMsg = 'Rendering the drum track…'
    try {
      const r = await renderDrumTrackWavBlob(
        sm,
        kitId === 'custom' ? { customKit: await resolveKit() } : {},
      )
      if (ps.osPath && ps.activeSongFolder) {
        const bytes = new Uint8Array(await r.blob.arrayBuffer())
        const w = await writeProjectSongAsset(ps.osPath, ps.activeSongFolder, DRUM_TRACK_REL, bytes)
        if (!w.ok) {
          errorMsg = w.error
          return
        }
        const p = patchSongMap((m) =>
          m.drumMidi
            ? {
                ...m,
                drumMidi: {
                  ...m.drumMidi,
                  renderExport: {
                    fingerprint: fingerprintDrumTrackInputs(m),
                    durationSec: r.durationSec,
                    sampleRate: r.sampleRate,
                    generatedAt: new Date().toISOString(),
                    preludeOffsetSec: r.preludeOffsetSec,
                    relativePath: DRUM_TRACK_REL,
                  },
                },
              }
            : m,
        )
        if (!p.ok) {
          errorMsg = p.errors.join('; ')
          return
        }
        statusMsg = 'Drum track saved into the project.'
      } else {
        // No project on disk — offer the WAV as a download instead.
        const url = URL.createObjectURL(r.blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'barbro-drums.wav'
        a.click()
        URL.revokeObjectURL(url)
        statusMsg = 'Drum track downloaded.'
      }
      onChanged?.()
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e)
    } finally {
      busy = 'idle'
    }
  }

  async function saveBassRender() {
    if (bassBusy !== 'idle') return
    bassErrorMsg = ''
    const sm = get(songMap)
    const ps = get(projectStore)
    if (!sm?.bassMidi) return
    bassBusy = 'saving'
    bassStatusMsg = 'Rendering the bass track…'
    try {
      const r = await renderBassTrackWavBlob(sm)
      if (ps.osPath && ps.activeSongFolder) {
        const bytes = new Uint8Array(await r.blob.arrayBuffer())
        const w = await writeProjectSongAsset(ps.osPath, ps.activeSongFolder, BASS_TRACK_REL, bytes)
        if (!w.ok) {
          bassErrorMsg = w.error
          return
        }
        const p = patchSongMap((m) =>
          m.bassMidi
            ? {
                ...m,
                bassMidi: {
                  ...m.bassMidi,
                  renderExport: {
                    fingerprint: fingerprintBassTrackInputs(m),
                    durationSec: r.durationSec,
                    sampleRate: r.sampleRate,
                    generatedAt: new Date().toISOString(),
                    preludeOffsetSec: r.preludeOffsetSec,
                    relativePath: BASS_TRACK_REL,
                  },
                },
              }
            : m,
        )
        if (!p.ok) {
          bassErrorMsg = p.errors.join('; ')
          return
        }
        bassStatusMsg = 'Bass track saved into the project.'
      } else {
        const url = URL.createObjectURL(r.blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'barbro-bass.wav'
        a.click()
        URL.revokeObjectURL(url)
        bassStatusMsg = 'Bass track downloaded.'
      }
      onChanged?.()
    } catch (e) {
      bassErrorMsg = e instanceof Error ? e.message : String(e)
    } finally {
      bassBusy = 'idle'
    }
  }
</script>

<section
  class="brutalist-shadow border-foreground bg-background w-full border-2 p-3"
  aria-label="BarBro Band"
>
  {#if show !== 'bass'}
  <!-- ── Drums row ─────────────────────────────────────────────────────── -->
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
    <span class="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider">
      <Drum class="size-3.5" aria-hidden="true" />
      BarBro Drums
    </span>

    {#if !drumsStemAbsPath}
      <span class="text-muted-foreground">Split stems first — drum detection listens to the drums stem.</span>
    {:else}
      <Button
        variant={dm ? 'outline' : 'default'}
        size="sm"
        class="h-7 border-2 px-2 text-xs font-bold"
        onclick={() => void detect()}
        disabled={busy !== 'idle' || !$desktopCompanionStatus.reachable}
        title={!$desktopCompanionStatus.reachable
          ? 'BarBro Desktop must be running.'
          : 'Listen to the drums stem and detect every hit'}
      >
        {busy === 'detecting' || busy === 'setup'
          ? 'Detecting…'
          : dm
            ? 'Detect again'
            : 'Detect drums'}
      </Button>
    {/if}

    {#if dm}
      <label class="inline-flex items-center gap-1.5">
        <span class="text-muted-foreground">Kit</span>
        <select
          class="border-input bg-background text-foreground border-2 px-1.5 py-0.5 text-xs"
          value={kitId}
          onchange={(e) => setKit(e.currentTarget.value as DrumKitId)}
        >
          {#each DRUM_KITS as kit (kit.id)}
            <option value={kit.id}>{kit.label}</option>
          {/each}
        </select>
      </label>
      {#if kitId === 'custom'}
        <Button
          variant="outline"
          size="sm"
          class="h-7 border-2 px-2 text-xs font-bold"
          onclick={() => void reloadCustomKit()}
          title="Re-read your sound files from the project folder"
        >
          Reload sounds
        </Button>
      {/if}
      <label class="inline-flex items-center gap-1.5">
        <span class="text-muted-foreground">Feel</span>
        <select
          class="border-input bg-background text-foreground border-2 px-1.5 py-0.5 text-xs"
          value={dm.style ?? 'steady'}
          onchange={(e) => setStyle(e.currentTarget.value as 'steady' | 'detected')}
          title="Steady groove plays the pattern BarBro hears, locked to the grid — misses filled, flukes dropped. As detected plays every raw hit."
        >
          <option value="steady">Steady groove</option>
          <option value="detected">As detected</option>
        </select>
      </label>
      {#if (dm.style ?? 'steady') === 'detected'}
        <label class="inline-flex items-center gap-1.5">
          <span class="text-muted-foreground">Timing</span>
          <select
            class="border-input bg-background text-foreground border-2 px-1.5 py-0.5 text-xs"
            value={dm.quantize ?? 'off'}
            onchange={(e) => setQuantize(e.currentTarget.value as DrumQuantize)}
          >
            {#each QUANTIZE_OPTIONS as q (q.value)}
              <option value={q.value}>{q.label}</option>
            {/each}
          </select>
        </label>
      {/if}
      <Button
        variant="outline"
        size="sm"
        class="h-7 border-2 px-2 text-xs font-bold"
        onclick={() => void saveRender()}
        disabled={busy !== 'idle'}
        title="Render with the chosen kit and save it into the project (the mixer works without saving)"
      >
        {busy === 'saving' ? 'Saving…' : renderSaved ? 'Save again' : 'Save drum track'}
      </Button>
    {/if}
  </div>

  <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
    <span class="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">Try the kit</span>
    {#each PAD_VOICES as v (v.cls)}
      <button
        type="button"
        class="border-foreground hover:bg-foreground hover:text-background active:translate-y-px border-2 px-2 py-0.5 text-xs font-bold"
        onclick={() => void playPad(v.cls)}
        title={`Play the ${v.label.toLowerCase()} of the selected kit`}
      >
        {v.label}
      </button>
    {/each}
    <button
      type="button"
      class="border-foreground hover:bg-foreground hover:text-background active:translate-y-px border-2 px-2 py-0.5 text-xs font-bold"
      onclick={() => void playBassPad()}
      title="Play the bass voice (A1)"
    >
      Bass
    </button>
  </div>

  {#if dm && kitId === 'custom' && customKitLine}
    <p class="text-muted-foreground mt-1.5 text-xs" role="status">{customKitLine}</p>
  {/if}

  {#if dm && counts}
    <p class="text-muted-foreground mt-1.5 text-xs" role="status">
      Found {countsLine(counts)} — solo “BarBro Drums” in the mixer against the original drums and judge the feel.
      {#if counts.kick === 0 || counts.snare === 0}
        <span class="text-amber-600">No {counts.kick === 0 ? 'kicks' : 'snares'} detected — that usually means detection struggled with this recording.</span>
      {/if}
      {#if !fresh}
        <span class="text-amber-600">The song audio changed — detect again.</span>
      {/if}
    </p>
  {/if}
  {#if statusMsg && !errorMsg}
    <p class="text-muted-foreground mt-1 text-xs" role="status">{statusMsg}</p>
  {/if}
  {#if errorMsg}
    <p class="text-destructive mt-1 text-xs">{errorMsg}</p>
  {/if}

  {/if}
  {#if show !== 'drums'}
  <!-- ── Bass row ──────────────────────────────────────────────────────── -->
  <div class="border-foreground/20 mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t-2 pt-2.5 text-xs">
    <span class="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider">
      <Guitar class="size-3.5" aria-hidden="true" />
      BarBro Bass
    </span>

    {#if !bassStemAbsPath}
      <span class="text-muted-foreground">Split stems first — bass detection listens to the bass stem.</span>
    {:else}
      <Button
        variant={bm ? 'outline' : 'default'}
        size="sm"
        class="h-7 border-2 px-2 text-xs font-bold"
        onclick={() => void detectBass()}
        disabled={bassBusy !== 'idle' || !$desktopCompanionStatus.reachable}
        title={!$desktopCompanionStatus.reachable
          ? 'BarBro Desktop must be running.'
          : 'Listen to the bass stem and detect every note'}
      >
        {bassBusy === 'detecting' || bassBusy === 'setup'
          ? 'Detecting…'
          : bm
            ? 'Detect again'
            : 'Detect bass'}
      </Button>
    {/if}

    {#if bm}
      <label class="inline-flex items-center gap-1.5">
        <span class="text-muted-foreground">Feel</span>
        <select
          class="border-input bg-background text-foreground border-2 px-1.5 py-0.5 text-xs"
          value={bm.style ?? 'steady'}
          onchange={(e) => setBassStyle(e.currentTarget.value as 'steady' | 'detected')}
          title="Steady groove plays the line like a confident bassist — locked to the grid, even dynamics, legato phrasing. As detected plays every raw note."
        >
          <option value="steady">Steady groove</option>
          <option value="detected">As detected</option>
        </select>
      </label>
      {#if (bm.style ?? 'steady') === 'detected'}
        <label class="inline-flex items-center gap-1.5">
          <span class="text-muted-foreground">Timing</span>
          <select
            class="border-input bg-background text-foreground border-2 px-1.5 py-0.5 text-xs"
            value={bm.quantize ?? 'off'}
            onchange={(e) => setBassQuantize(e.currentTarget.value as DrumQuantize)}
          >
            {#each QUANTIZE_OPTIONS as q (q.value)}
              <option value={q.value}>{q.label}</option>
            {/each}
          </select>
        </label>
      {/if}
      <!-- The VOICE — the same picker the bass machine has. The renderer always
           supported a chosen sound; only the detected path never passed one. -->
      <label class="inline-flex items-center gap-1.5">
        <span class="text-muted-foreground">Sound</span>
        <select
          class="border-input bg-background text-foreground border-2 px-1.5 py-0.5 text-xs"
          value={bm.sound ?? DEFAULT_BASS_SOUND_ID}
          onchange={(e) => setBassSound(e.currentTarget.value)}
          aria-label="BarBro bass sound"
          title="Which bass this plays. Same instruments the bass machine uses."
        >
          {#each bassSoundGroups() as g (g.group)}
            <optgroup label={g.group}>
              {#each g.sounds as snd (snd.id)}
                <option value={snd.id}>{snd.label}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
      </label>
      <Button
        variant="outline"
        size="sm"
        class="h-7 border-2 px-2 text-xs font-bold"
        onclick={() => void saveBassRender()}
        disabled={bassBusy !== 'idle'}
        title="Render the bass track and save it into the project (the mixer works without saving)"
      >
        {bassBusy === 'saving' ? 'Saving…' : bassRenderSaved ? 'Save again' : 'Save bass track'}
      </Button>
    {/if}
  </div>

  {#if bm && bassRangeLine}
    <p class="text-muted-foreground mt-1.5 text-xs" role="status">
      Found {bassRangeLine} — solo “BarBro Bass” in the mixer against the original bass and judge the feel.
      {#if !bassFresh}
        <span class="text-amber-600">The song audio changed — detect again.</span>
      {/if}
    </p>
  {/if}
  {#if bassStatusMsg && !bassErrorMsg}
    <p class="text-muted-foreground mt-1 text-xs" role="status">{bassStatusMsg}</p>
  {/if}
  {#if bassErrorMsg}
    <p class="text-destructive mt-1 text-xs">{bassErrorMsg}</p>
  {/if}
  {/if}
</section>
