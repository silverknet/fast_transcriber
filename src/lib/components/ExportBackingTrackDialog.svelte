<script lang="ts">
  /**
   * "Export backing track" dialog: pick which audio assets to mix and
   * download as a single WAV. Sources come from the project's per-song
   * metadata cache (stems on disk, cue track presence).
   *
   * The mix runs client-side via [`mixBackingTrack`](../audio/mixBackingTrack.ts).
   * Bytes are fetched from the desktop sidecar's `/native/project/song/asset/read`
   * endpoint — no audio bytes are shipped from the web side.
   */
  import { Button } from '$lib/components/ui/button'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import { mixBackingTrack, type BackingMixSource } from '$lib/audio/mixBackingTrack'
  import { readProjectSongAsset } from '$lib/client/desktopProjectFs'
  import { renderCueTrackWavBlob } from '$lib/audio/renderCueTrack'
  import { selectBestStemSet } from '$lib/project/commit'
  import { downloadBlob, safeExportBasename } from '$lib/songmap/persist'
  import type { SongMap } from '$lib/songmap'
  import type { ProjectSongMetadataLite } from '$lib/stores/project'

  let {
    open = $bindable(false),
    projectPath,
    songFolder,
    songTitle,
    metadata,
    songMap,
  } = $props<{
    open: boolean
    projectPath: string | null
    songFolder: string | null
    songTitle: string
    metadata: ProjectSongMetadataLite | undefined
    /** Current SongMap — required to derive click track if no file exists. */
    songMap: SongMap | null
  }>()

  /**
   * Stem slot name → disk filename. Filenames come from `stemsOnDisk`
   * (basenames of WAVs in `<song>/stems/`). We map a known set of stem
   * filenames to display labels — anything else shows under "Other files".
   */
  const KNOWN_STEMS: Record<string, string> = {
    'vocals.wav': 'Vocals',
    'drums.wav': 'Drums',
    'bass.wav': 'Bass',
    'other.wav': 'Other',
    'guitar.wav': 'Guitar',
    'fx.wav': 'FX',
  }

  type SourceOpt = {
    /** Stable key for the checkbox + state. */
    key: string
    /** Human label. */
    label: string
    /** Short description (under the label). */
    hint: string
    /** Returns the audio blob, fetching from disk or rendering on-the-fly. */
    fetch: () => Promise<Blob | null>
  }

  function fetchFromDisk(subpath: string): () => Promise<Blob | null> {
    return async () => {
      if (!projectPath || !songFolder) return null
      const r = await readProjectSongAsset(projectPath, songFolder, subpath)
      return r.ok ? r.blob : null
    }
  }

  let stemOpts = $derived.by<SourceOpt[]>(() => {
    const list: SourceOpt[] = []
    const best = selectBestStemSet(metadata)
    if (!best) return list
    for (const f of best.files) {
      const label = KNOWN_STEMS[f.toLowerCase()] ?? f.replace(/\.[^.]+$/, '')
      const subpath = `${best.pathPrefix}${f}`
      list.push({
        key: `stem:${f}`,
        label: `${label} · ${best.preset}`,
        hint: subpath,
        fetch: fetchFromDisk(subpath),
      })
    }
    return list
  })

  let cueOpt = $derived<SourceOpt | null>(
    metadata?.hasCueTrack
      ? {
          key: 'cue',
          label: 'Cue track',
          hint: 'cue/cue-track.wav · spoken count-in + section labels',
          fetch: fetchFromDisk('cue/cue-track.wav'),
        }
      : null,
  )

  /**
   * Click track is always available for a song with beats — synthesised
   * from `songMap.timeline.beats` if the user hasn't generated a disk file.
   */
  let clickOpt = $derived.by<SourceOpt | null>(() => {
    if (!songMap || songMap.timeline.beats.length === 0) return null
    if (metadata?.hasClickTrack) {
      return {
        key: 'click',
        label: 'Click track',
        hint: 'cue/click-track.wav · clicks only',
        fetch: fetchFromDisk('cue/click-track.wav'),
      }
    }
    return {
      key: 'click',
      label: 'Click track',
      hint: 'synthesised from beats',
      fetch: async () => {
        try {
          const r = await renderCueTrackWavBlob(songMap, { includeSpeech: false, includeClicks: true })
          return r.blob
        } catch {
          return null
        }
      },
    }
  })

  let allOpts = $derived<SourceOpt[]>([
    ...stemOpts,
    ...(cueOpt ? [cueOpt] : []),
    ...(clickOpt ? [clickOpt] : []),
  ])

  /** Checked set; reset to "all" each time the dialog opens. */
  let checked = $state<Record<string, boolean>>({})

  $effect(() => {
    if (open) {
      const next: Record<string, boolean> = {}
      for (const o of allOpts) next[o.key] = true
      // Cue is now speech-only and click is clicks-only — they're orthogonal,
      // so both can be checked by default. No duplicate-click stacking.
      checked = next
      status = 'idle'
      statusMsg = ''
    }
  })

  let status = $state<'idle' | 'mixing' | 'done' | 'error'>('idle')
  let statusMsg = $state('')

  let selectedCount = $derived(allOpts.filter((o) => checked[o.key]).length)
  let canExport = $derived(
    selectedCount > 0 && projectPath !== null && songFolder !== null && status !== 'mixing',
  )

  function cancel() {
    if (status === 'mixing') return
    open = false
  }

  async function runExport() {
    if (!projectPath || !songFolder) return
    const picked = allOpts.filter((o) => checked[o.key])
    if (picked.length === 0) return

    status = 'mixing'
    statusMsg = `Fetching ${picked.length} source${picked.length === 1 ? '' : 's'}…`

    try {
      const sources: BackingMixSource[] = []
      const failed: string[] = []
      for (const opt of picked) {
        const blob = await opt.fetch()
        if (!blob) {
          failed.push(opt.label)
          continue
        }
        sources.push({ label: opt.label, blob })
      }
      if (sources.length === 0) {
        status = 'error'
        statusMsg = `Could not fetch any source. ${failed.join('; ')}`
        return
      }

      statusMsg = 'Mixing…'
      const blob = await mixBackingTrack(sources)
      const labelParts = picked.map((o) => o.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')).join('+')
      const filename = `${safeExportBasename(songTitle)}-${labelParts || 'backing'}.wav`
      downloadBlob(blob, filename)

      status = 'done'
      statusMsg = failed.length > 0
        ? `Downloaded ${filename}. ${failed.length} source(s) skipped.`
        : `Downloaded ${filename}`
      open = false
    } catch (e) {
      status = 'error'
      statusMsg = e instanceof Error ? e.message : 'Export failed'
    }
  }
</script>

<Dialog bind:open>
  <DialogContent class="max-w-md">
    <DialogHeader>
      <DialogTitle>Export backing track</DialogTitle>
      <DialogDescription>
        Mix selected audio for <span class="font-medium">{songTitle}</span> into a single WAV download.
      </DialogDescription>
    </DialogHeader>

    {#if allOpts.length === 0}
      <p class="text-muted-foreground py-4 text-sm">
        No audio assets available yet. Run the stem splitter or render a cue track in Edit, then try again.
      </p>
    {:else}
      <ul class="mt-2 flex flex-col gap-1">
        {#each allOpts as opt (opt.key)}
          <li>
            <label class="border-foreground/20 hover:border-foreground/50 flex cursor-pointer items-center gap-2 border-2 px-3 py-2 text-sm">
              <input type="checkbox" class="size-4" bind:checked={checked[opt.key]} />
              <span class="flex-1">{opt.label}</span>
              <span class="text-muted-foreground font-mono text-[11px]">{opt.hint}</span>
            </label>
          </li>
        {/each}
      </ul>
      <p class="text-muted-foreground mt-1 text-xs">
        {selectedCount} selected · output is 44.1 kHz, peak-normalized.
      </p>
    {/if}

    {#if statusMsg}
      <p
        class="text-xs {status === 'error' ? 'text-destructive' : status === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}"
        role="status"
      >
        {statusMsg}
      </p>
    {/if}

    <DialogFooter class="">
      <Button class="" variant="outline" onclick={cancel} disabled={status === 'mixing'}>Cancel</Button>
      <Button class="" onclick={() => void runExport()} disabled={!canExport}>
        {status === 'mixing' ? 'Mixing…' : `Download (${selectedCount})`}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
