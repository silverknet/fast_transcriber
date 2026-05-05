<script lang="ts">
  import { browser } from '$app/environment'
  import { get } from 'svelte/store'
  import { Button } from '$lib/components/ui/button'
  import { generateAbletonSetXml, STEM_TRACKS, type StemClip } from '$lib/export/abletonSet'
  import { gzipString } from '$lib/export/gzip'
  import { downloadBlob, safeExportBasename } from '$lib/songmap/persist'
  import { songMap } from '$lib/stores/songMap'

  let status = $state<'idle' | 'generating' | 'done' | 'error'>('idle')
  let statusMsg = $state('')
  let lastXml = $state<string | null>(null)
  let showXml = $state(false)

  // Stem files: name → { file, clip }
  let stems = $state<Map<string, { file: File; clip: StemClip }>>(new Map())
  let stemsFolder = $state('')

  function absolutePath(fileName: string): string {
    const folder = stemsFolder.trim().replace(/[\\/]+$/, '')
    return folder ? `${folder}/${fileName}` : fileName
  }

  async function onStemFile(stemName: string, e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0]
    if (!file) return
    const ctx = new AudioContext()
    try {
      const buf = await ctx.decodeAudioData(await file.arrayBuffer())
      const clip: StemClip = {
        fileName: file.name,
        absolutePath: absolutePath(file.name),
        durationSec: buf.duration,
        sampleRate: buf.sampleRate,
      }
      stems = new Map(stems).set(stemName, { file, clip })
    } catch {
      statusMsg = `Could not decode ${file.name}`
      status = 'error'
    } finally {
      await ctx.close().catch(() => {})
    }
  }

  // Re-derive absolute paths when folder changes
  $effect(() => {
    if (stems.size === 0) return
    const next = new Map<string, { file: File; clip: StemClip }>()
    for (const [name, s] of stems) {
      next.set(name, {
        ...s,
        clip: { ...s.clip, absolutePath: absolutePath(s.clip.fileName) },
      })
    }
    stems = next
  })

  function removeStem(stemName: string) {
    const next = new Map(stems)
    next.delete(stemName)
    stems = next
  }

  async function exportAbletonSet() {
    if (!browser) return
    const sm = get(songMap)
    if (!sm) {
      statusMsg = 'No song loaded — open a project in the editor first.'
      status = 'error'
      return
    }
    status = 'generating'
    statusMsg = 'Building .als XML…'
    try {
      const stemClips = new Map<string, StemClip>()
      for (const [name, s] of stems) stemClips.set(name, s.clip)
      const xml = generateAbletonSetXml(sm, { title: sm.metadata.title, stems: stemClips })
      lastXml = xml
      statusMsg = 'Compressing (gzip)…'
      const blob = await gzipString(xml)
      const name = `${safeExportBasename(sm.metadata.title)}.als`
      downloadBlob(blob, name)
      status = 'done'
      statusMsg = `Exported ${name} — place it in the same folder as your stem files.`
    } catch (e) {
      status = 'error'
      statusMsg = e instanceof Error ? e.message : 'Export failed'
    }
  }

  const smSnap = $derived($songMap)
  const bpm = $derived.by(() => {
    const sm = $songMap
    if (!sm) return null
    if (sm.metadata.bpm && sm.metadata.bpm > 0) return sm.metadata.bpm
    const bar = sm.timeline.bars[0]
    if (!bar || bar.beatCount <= 0) return null
    const dur = bar.endSec - bar.startSec
    if (dur <= 0) return null
    return Math.round(((bar.beatCount / dur) * 60) * 100) / 100
  })

  function fmtDur(sec: number) {
    const m = Math.floor(sec / 60)
    const s = (sec % 60).toFixed(1)
    return `${m}:${s.padStart(4, '0')}`
  }
</script>

<main class="relative z-10 flex min-h-dvh w-full flex-col gap-6 px-4 py-16 sm:px-6 md:px-8 md:py-20">
  <div class="mx-auto w-full max-w-2xl space-y-6">

    <div class="border-foreground border-b-2 pb-4">
      <h1 class="text-2xl font-bold tracking-tight">Set Editor</h1>
      <p class="text-muted-foreground mt-1 text-sm">
        Generate an Ableton Live 12 set from a BarBro song map. Upload stems, export .als, place everything in the same folder.
      </p>
    </div>

    {#if !smSnap}
      <div class="border-foreground bg-muted border-2 p-4">
        <p class="text-sm">No song loaded. Open a project in the <a href="/edit" class="underline underline-offset-2">editor</a> first.</p>
      </div>
    {:else}
      <!-- Song summary -->
      <section class="border-foreground border-2 p-4 space-y-2">
        <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Song</h2>
        <dl class="text-sm space-y-1 font-mono">
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Title</dt>
            <dd>{smSnap.metadata.title}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">BPM</dt>
            <dd>{bpm != null ? bpm.toFixed(2) : '—'}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Bars / Sections</dt>
            <dd>{smSnap.timeline.bars.length} bars · {smSnap.sections.length} sections</dd>
          </div>
        </dl>
      </section>

      <!-- Stem upload slots -->
      <section class="border-foreground border-2 p-4 space-y-3">
        <div>
          <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Stems</h2>
          <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
            Upload your stem files. The .als will reference them by filename — save the .als in the same folder as the stems.
          </p>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-muted-foreground" for="stems-folder">Stems folder (absolute path)</label>
          <input
            id="stems-folder"
            type="text"
            placeholder="/Users/you/Projects/MySong/Stems"
            bind:value={stemsFolder}
            class="border-foreground bg-background text-foreground border px-2 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-foreground"
          />
          {#if stemsFolder.trim()}
            <p class="font-mono text-[10px] text-muted-foreground/70 truncate">→ {absolutePath('file.wav')}</p>
          {/if}
        </div>

        <ul class="space-y-2">
          {#each STEM_TRACKS as track (track.name)}
            {@const loaded = stems.get(track.name)}
            <li class="flex items-center gap-3 border-foreground border px-3 py-2 text-sm">
              <span class="w-16 shrink-0 font-medium">{track.name}</span>

              {#if loaded}
                <span class="text-foreground/80 min-w-0 flex-1 truncate font-mono text-xs">
                  {loaded.clip.fileName}
                </span>
                <span class="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                  {fmtDur(loaded.clip.durationSec)}
                </span>
                <button
                  type="button"
                  class="text-muted-foreground hover:text-destructive shrink-0 text-xs transition-colors"
                  onclick={() => removeStem(track.name)}
                  aria-label="Remove {track.name} stem"
                >✕</button>
              {:else}
                <label class="flex-1 cursor-pointer">
                  <span class="text-muted-foreground text-xs">Click to upload…</span>
                  <input
                    type="file"
                    accept="audio/*,.wav,.mp3,.aiff,.flac"
                    class="sr-only"
                    onchange={(e) => void onStemFile(track.name, e)}
                  />
                </label>
              {/if}
            </li>
          {/each}
        </ul>

        {#if stems.size > 0}
          <p class="text-muted-foreground text-xs">
            {stems.size} of {STEM_TRACKS.length} stems loaded
          </p>
        {/if}
      </section>

      <!-- Sections -->
      {#if smSnap.sections.length > 0}
        <section class="border-foreground border-2 p-4 space-y-2">
          <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sections → Locators</h2>
          <ul class="text-sm space-y-1 font-mono">
            {#each smSnap.sections as s (s.id)}
              <li class="flex gap-3">
                <span class="text-muted-foreground w-24 shrink-0">bar {s.barRange.startBarIndex}–{s.barRange.endBarIndex}</span>
                <span>{s.label}</span>
                <span class="text-muted-foreground ml-auto text-xs">{s.kind}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- Export -->
      <section class="border-foreground border-2 p-4 space-y-3">
        <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Export</h2>
        <div class="flex flex-wrap gap-3 items-center">
          <Button
            type="button"
            onclick={() => void exportAbletonSet()}
            disabled={status === 'generating'}
          >
            {status === 'generating' ? 'Generating…' : 'Export Ableton Set (.als)'}
          </Button>
          {#if lastXml}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onclick={() => (showXml = !showXml)}
            >
              {showXml ? 'Hide XML' : 'Inspect XML'}
            </Button>
          {/if}
        </div>

        {#if statusMsg}
          <p
            class="text-xs {status === 'error' ? 'text-destructive' : status === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}"
            role="status"
          >
            {statusMsg}
          </p>
        {/if}
      </section>

      {#if showXml && lastXml}
        <section class="border-foreground border-2 p-4 space-y-2">
          <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            XML ({(lastXml.length / 1024).toFixed(1)} KB)
          </h2>
          <pre class="border-foreground/10 bg-muted/20 text-foreground/90 max-h-[40vh] overflow-auto rounded border p-3 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-words">{lastXml}</pre>
        </section>
      {/if}
    {/if}

    <p class="text-muted-foreground/50 text-xs">
      ⚗ Experimental — Ableton Live 12 format.
    </p>
  </div>
</main>
