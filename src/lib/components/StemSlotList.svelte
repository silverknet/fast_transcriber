<script lang="ts">
  /**
   * Reusable list of stem-slot assignments for one song's folder.
   *
   * The caller owns the source of truth (`stemRefs` and the loaded
   * `LoadedStem` map) — this component is presentational + emits events.
   * Used by both `/set` (standalone) and the per-song panel in `/project`.
   */
  import { STEM_TRACKS } from '$lib/export/abletonSet'

  /** Audio metadata for a stem already loaded into memory. */
  export type LoadedStemInfo = {
    relativePath: string
    durationSec: number
  }

  let {
    folderHandle,
    folderFiles,
    stemRefs,
    loaded,
    onAssign,
    onRemove,
  } = $props<{
    /** When null, the slot list still renders saved refs but can't bind new ones. */
    folderHandle: FileSystemDirectoryHandle | null
    /** Relative audio paths available in the folder. */
    folderFiles: string[]
    /** Saved stemRefs for this song (keyed by STEM_TRACKS name). */
    stemRefs: Record<string, string> | undefined
    /** In-memory loaded clips (audio decoded + duration). */
    loaded: Map<string, LoadedStemInfo>
    onAssign: (stemName: string, relativePath: string) => void | Promise<void>
    onRemove: (stemName: string) => void
  }>()

  /** Folder-file → stem-slot heuristics, lifted from the original /set page. */
  const STEM_ALIASES: Record<string, string[]> = {
    Drums:  ['drums', 'drum', 'kit', 'percussion', 'perc', 'beat'],
    Bass:   ['bass'],
    Guitar: ['guitar', 'guitars', 'gtr', 'keys', 'piano', 'synth', 'melodics', 'other', 'no_vocals'],
    Vocals: ['vocals', 'vocal', 'vox', 'voice', 'lead', 'lead_vocals'],
    FX:     ['fx', 'effects', 'sfx', 'other', 'extras', 'pads'],
  }

  function autoMatch(stemName: string): string | undefined {
    const aliases = STEM_ALIASES[stemName] ?? [stemName.toLowerCase()]
    return folderFiles.find((f: string) => {
      const base = f.replace(/^.*\//, '').replace(/\.[^.]+$/, '').toLowerCase()
      return aliases.some((a) => base === a || base.startsWith(a + '_') || base.endsWith('_' + a))
    })
  }

  function canonicalName(stemName: string): string {
    return `stems/${(STEM_ALIASES[stemName]?.[0] ?? stemName.toLowerCase())}.wav`
  }

  function fmtDur(sec: number): string {
    const m = Math.floor(sec / 60)
    const s = (sec % 60).toFixed(1)
    return `${m}:${s.padStart(4, '0')}`
  }

  const ready = $derived(folderHandle !== null)
</script>

<ul class="space-y-2">
  {#each STEM_TRACKS as track (track.name)}
    {@const l = loaded.get(track.name)}
    {@const savedRef = stemRefs?.[track.name]}
    {@const suggested = !l && ready ? autoMatch(track.name) : undefined}

    <li class="border-foreground border px-3 py-2">
      <div class="flex items-center gap-3 text-sm">
        <span class="w-16 shrink-0 font-medium">{track.name}</span>

        {#if l}
          <span class="text-foreground/80 min-w-0 flex-1 truncate font-mono text-xs">{l.relativePath}</span>
          <span class="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">{fmtDur(l.durationSec)}</span>
          <button
            type="button"
            class="text-muted-foreground hover:text-destructive shrink-0 text-xs"
            onclick={() => onRemove(track.name)}
            aria-label="Remove {track.name}"
          >✕</button>
        {:else if savedRef && !ready}
          <span class="text-muted-foreground/60 flex-1 font-mono text-xs">{savedRef}</span>
          <span class="shrink-0 text-xs text-amber-500">not found</span>
        {:else if ready}
          <select
            class="border-foreground/30 bg-background text-foreground flex-1 border px-2 py-0.5 font-mono text-xs"
            onchange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value
              if (v) void onAssign(track.name, v)
              ;(e.currentTarget as HTMLSelectElement).value = ''
            }}
            value=""
          >
            <option value="">— assign from folder —</option>
            {#if suggested}
              <option value={suggested}>⚡ {suggested}</option>
            {/if}
            {#each folderFiles as f (f)}
              {#if f !== suggested}
                <option value={f}>{f}</option>
              {/if}
            {/each}
          </select>
        {:else}
          <span class="text-muted-foreground/50 flex-1 font-mono text-xs">{canonicalName(track.name)}</span>
        {/if}
      </div>
    </li>
  {/each}
</ul>
