<script lang="ts">
  /**
   * The arrangement as a row of clickable tabs — shared by the drum and bass
   * machine editors.
   *
   * Sections are sized by bar count and split exactly the way the generators
   * block a song, so what you click is what plays. Bars outside any section
   * render inert: they sound (using the song settings) but have no
   * `Section.id` to hang an override on, so they're shown rather than hidden.
   *
   * The caller supplies the per-section display state, because "what does this
   * section play" means something different for drums than for bass.
   */
  import { buildSectionBlocks } from '$lib/songmap/sectionBlocks'
  import type { Section } from '$lib/songmap/types'

  type Props = {
    sections: Section[]
    totalBars: number
    /** 'song' or a Section.id. */
    activeScope: string
    onSelect: (scope: string) => void
    /** Short line under the label — the style in effect, "silent", etc. */
    subtitleFor: (s: Section) => string
    /** True when the section carries its own settings rather than inheriting. */
    overriddenFor: (s: Section) => boolean
    mutedFor: (s: Section) => boolean
    ariaLabel?: string
  }

  let {
    sections,
    totalBars,
    activeScope,
    onSelect,
    subtitleFor,
    overriddenFor,
    mutedFor,
    ariaLabel = 'Sections',
  }: Props = $props()

  type StripBlock = { bars: number; section: Section | null }

  const strip = $derived.by<StripBlock[]>(() => {
    if (totalBars <= 0) return []
    return buildSectionBlocks(sections, totalBars).map((block) => ({
      bars: block.end - block.start + 1,
      section: block.section,
    }))
  })

  /** Left/right through the tabs, so the arrangement is keyboard-navigable. */
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const ids = strip.filter((b) => b.section).map((b) => b.section!.id)
    if (ids.length === 0) return
    const at = ids.indexOf(activeScope)
    const next =
      e.key === 'ArrowRight'
        ? ids[Math.min(ids.length - 1, at + 1)]
        : at <= 0
          ? 'song'
          : ids[at - 1]
    onSelect(next ?? 'song')
    e.preventDefault()
  }
</script>

<div class="flex items-stretch gap-1" role="tablist" aria-label={ariaLabel}>
  <button
    type="button"
    role="tab"
    aria-selected={activeScope === 'song'}
    class="shrink-0 rounded-[var(--radius)] border-2 px-2 py-1 text-left text-[11px] font-bold transition-colors {activeScope ===
    'song'
      ? 'border-foreground bg-foreground text-background'
      : 'border-foreground/25 bg-background hover:border-foreground/50'}"
    onclick={() => onSelect('song')}
    onkeydown={onKeyDown}
    title="Set the defaults every section inherits"
  >
    Whole song
  </button>
  {#if strip.length > 0}
    <div class="flex min-w-0 grow items-stretch gap-0.5">
      {#each strip as block, i (block.section ? `${block.section.id}:${i}` : `gap${i}`)}
        {#if block.section}
          {@const s = block.section}
          <button
            type="button"
            role="tab"
            aria-selected={activeScope === s.id}
            style="flex: {block.bars} 1 0%"
            class="min-w-0 overflow-hidden rounded-[var(--radius)] border-2 px-1.5 py-1 text-left transition-colors {activeScope ===
            s.id
              ? 'border-foreground bg-foreground text-background'
              : 'border-foreground/25 bg-background hover:border-foreground/50'} {mutedFor(s)
              ? 'opacity-45'
              : ''}"
            onclick={() => onSelect(s.id)}
            onkeydown={onKeyDown}
            title="{s.label} · {block.bars} bar{block.bars === 1 ? '' : 's'} · {subtitleFor(s)}"
          >
            <span class="flex items-center gap-1">
              <span class="truncate text-[11px] font-bold">{s.label}</span>
              {#if overriddenFor(s)}
                <span
                  class="size-1.5 shrink-0 rounded-full {activeScope === s.id
                    ? 'bg-background'
                    : 'bg-foreground/60'}"
                  aria-label="edited"
                ></span>
              {/if}
            </span>
            <span class="block truncate text-[10px] opacity-70">{subtitleFor(s)}</span>
          </button>
        {:else}
          <div
            style="flex: {block.bars} 1 0%"
            class="border-foreground/15 bg-foreground/5 min-w-0 rounded-[var(--radius)] border-2 border-dashed"
            title="{block.bars} bar{block.bars === 1
              ? ''
              : 's'} outside any section — plays the song settings"
          ></div>
        {/if}
      {/each}
    </div>
  {/if}
</div>
