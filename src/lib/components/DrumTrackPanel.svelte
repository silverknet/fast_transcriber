<script lang="ts">
  /**
   * BarBro Drums: detect drum hits from the drums stem, pick a kit and
   * timing feel, and (optionally) save the rendered track into the project.
   * The mixer's "BarBro Drums" lane appears as soon as hits exist — it
   * synthesizes in memory until a saved render is on disk.
   */
  import { get } from 'svelte/store'
  import { Button } from '$lib/components/ui/button'
  import {
    analyzeDrumsViaDesktop,
    getSectionsSetupStatus,
    setupSectionsDeps,
  } from '$lib/client/desktopBridge'
  import { writeProjectSongAsset } from '$lib/client/desktopProjectFs'
  import { DRUM_KITS, type DrumKitId } from '$lib/audio/drumKits'
  import { renderDrumTrackWavBlob } from '$lib/audio/renderDrumTrack'
  import {
    DRUM_ANALYZER_VERSION,
    DRUM_TRACK_REL,
    drumAudioFingerprint,
    drumClassCounts,
    hasFreshDrumMidi,
  } from '$lib/songmap/drumMidi'
  import { fingerprintDrumTrackInputs } from '$lib/songmap/drumTrackFingerprint'
  import { selectBestStemSet } from '$lib/project/commit'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { project as projectStore } from '$lib/stores/project'
  import { patchSongMap, songMap } from '$lib/stores/songMap'
  import type { DrumClass, DrumQuantize } from '$lib/songmap/types'
  import { Drum } from '@lucide/svelte'

  let { onChanged }: { onChanged?: () => void } = $props()

  const QUANTIZE_OPTIONS: { value: DrumQuantize; label: string }[] = [
    { value: 'off', label: 'As played' },
    { value: '1/8', label: 'Tight · 8ths' },
    { value: '1/16', label: 'Tight · 16ths' },
    { value: '1/16T', label: 'Triplet feel' },
  ]

  let busy = $state<'idle' | 'setup' | 'detecting' | 'saving'>('idle')
  let statusMsg = $state('')
  let errorMsg = $state('')

  const dm = $derived($songMap?.drumMidi ?? null)
  const counts = $derived(dm ? drumClassCounts(dm.events) : null)
  const fresh = $derived($songMap ? hasFreshDrumMidi($songMap) : false)
  const renderSaved = $derived(!!dm?.renderExport?.relativePath)

  const drumsStemAbsPath = $derived.by<string | null>(() => {
    const ps = $projectStore
    if (!ps.osPath || !ps.activeSongFolder) return null
    const meta = ps.metadataByFolder[ps.activeSongFolder]
    const best = selectBestStemSet(meta)
    if (!best) return null
    const f = best.files.find((n) => /^drums\.(wav|mp3)$/i.test(n))
    if (!f) return null
    return `${ps.osPath}/${ps.activeSongFolder}/${best.pathPrefix}${f}`
  })

  function countsLine(c: Record<DrumClass, number>): string {
    const parts: string[] = []
    if (c.kick) parts.push(`${c.kick} kicks`)
    if (c.snare) parts.push(`${c.snare} snares`)
    if (c.hihat) parts.push(`${c.hihat} hi-hats`)
    if (c.tom) parts.push(`${c.tom} toms`)
    if (c.cymbal) parts.push(`${c.cymbal} cymbals`)
    return parts.join(', ')
  }

  async function detect() {
    if (busy !== 'idle') return
    errorMsg = ''
    statusMsg = ''
    const sm = get(songMap)
    const stem = drumsStemAbsPath
    if (!sm || !stem) return
    if (!$desktopCompanionStatus.reachable) {
      errorMsg = 'BarBro Desktop must be running.'
      return
    }
    // Same environment as the harmony analysis — set it up if needed.
    const setup = await getSectionsSetupStatus()
    if (!setup) {
      errorMsg = 'Could not check the analysis setup.'
      return
    }
    if (!setup.ready) {
      busy = 'setup'
      statusMsg = 'Preparing analysis (one-time)…'
      const installed = await setupSectionsDeps((ev) => {
        if (ev.type === 'error') errorMsg = ev.msg
      })
      if (!installed.ok) {
        busy = 'idle'
        errorMsg = installed.error
        return
      }
    }
    busy = 'detecting'
    statusMsg = 'Listening to the drums…'
    try {
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

  function setKit(kit: DrumKitId) {
    patchSongMap((m) => (m.drumMidi ? { ...m, drumMidi: { ...m.drumMidi, kit } } : m))
    onChanged?.()
  }

  function setQuantize(q: DrumQuantize) {
    patchSongMap((m) => (m.drumMidi ? { ...m, drumMidi: { ...m.drumMidi, quantize: q } } : m))
    onChanged?.()
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
      const r = await renderDrumTrackWavBlob(sm)
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
</script>

<section
  class="brutalist-shadow border-foreground bg-background w-full border-2 p-3"
  aria-label="BarBro Drums"
>
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
          value={dm.kit === 'acoustic' ? 'acoustic' : 'synth'}
          onchange={(e) => setKit(e.currentTarget.value as DrumKitId)}
        >
          {#each DRUM_KITS as kit (kit.id)}
            <option value={kit.id}>{kit.label}</option>
          {/each}
        </select>
      </label>
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
</section>
