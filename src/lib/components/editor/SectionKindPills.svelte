<script lang="ts">
  /**
   * Compact, one-click section-type switcher for the Sections tab.
   *
   * Replaces the old dropdown + "Tag selection" flow: the section kinds are a
   * row of colour-swatched pills. Clicking one applies that kind to the current
   * bar selection in a single motion — whether that's re-tagging an existing
   * section (its whole range is selected) or creating a new one from a fresh
   * range. Custom labels stay available but secondary, behind the "Custom" pill
   * and a "Rename" affordance.
   *
   * Purely presentational: it holds no song state, only a transient label draft.
   * All mutations happen in the parent via `onPick`, which routes to the same
   * `setSectionForBarRange` helper the old flow used.
   */
  import { SECTION_KIND_OPTIONS } from '$lib/songmap/sectionEdit'
  import { sectionKindColor } from '$lib/songmap/sectionColors'
  import type { SectionKind } from '$lib/songmap/types'

  let {
    /** Kind of the section the selection currently covers, or null when the
     *  selection is a fresh range (→ "create" mode). Highlights the active pill. */
    selectedKind = null,
    /** Whether any bars are selected — pills are inert without a selection. */
    hasSelection = false,
    /** Current label of the selected section, prefilled into the rename field. */
    currentLabel = '',
    /** Display name of the selected section, shown in the heading. */
    sectionName = '',
    onPick,
  }: {
    selectedKind?: SectionKind | null
    hasSelection?: boolean
    currentLabel?: string
    sectionName?: string
    onPick: (kind: SectionKind, customLabel?: string) => void
  } = $props()

  const retag = $derived(selectedKind !== null)

  // ── Secondary custom-label field ──────────────────────────────────────────
  // `labelKind` is the kind the typed label applies to:
  //   - opened via the Custom pill → 'custom'
  //   - opened via Rename          → the selected section's current kind
  let labelOpen = $state(false)
  let labelKind = $state<SectionKind>('custom')
  let labelText = $state('')
  let labelInput = $state<HTMLInputElement | null>(null)

  function openCustom() {
    labelKind = 'custom'
    labelText = selectedKind === 'custom' ? currentLabel : ''
    labelOpen = true
    queueMicrotask(() => labelInput?.focus())
  }

  function openRename() {
    if (selectedKind === null) return
    labelKind = selectedKind
    labelText = currentLabel
    labelOpen = true
    queueMicrotask(() => labelInput?.select())
  }

  function commitLabel() {
    const t = labelText.trim()
    if (labelKind === 'custom' && t.length === 0) return
    onPick(labelKind, t.length > 0 ? t : undefined)
    labelOpen = false
  }

  function pick(kind: SectionKind) {
    if (!hasSelection) return
    // Custom needs a label — route it through the secondary field.
    if (kind === 'custom') {
      openCustom()
      return
    }
    onPick(kind)
  }
</script>

<div class="border-foreground/10 bg-muted/20 flex flex-col gap-1.5 border-b px-2 py-1.5">
  <div class="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Section type">
    <span class="text-muted-foreground mr-0.5 text-[11px] font-bold uppercase tracking-wide">
      {#if !hasSelection}
        Select bars to tag
      {:else if retag}
        {sectionName || 'Section'}
      {:else}
        Tag as
      {/if}
    </span>

    {#each SECTION_KIND_OPTIONS as opt (opt.kind)}
      {@const active = selectedKind === opt.kind}
      <button
        type="button"
        class="inline-flex items-center gap-1.5 border px-2 py-1 text-xs font-bold leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 {active
          ? 'border-foreground'
          : 'border-foreground/25 hover:border-foreground'}"
        style={active
          ? `background-color: ${sectionKindColor(opt.kind)}26; box-shadow: inset 0 0 0 1.5px var(--studio-orange);`
          : ''}
        disabled={!hasSelection}
        aria-pressed={active}
        onclick={() => pick(opt.kind)}
        title={opt.kind === 'custom'
          ? 'Custom label…'
          : retag
            ? `Change type to ${opt.label}`
            : `Tag as ${opt.label}`}
      >
        <span
          class="size-2.5 shrink-0 rounded-[2px]"
          style:background-color={sectionKindColor(opt.kind)}
          aria-hidden="true"
        ></span>
        {opt.label}
      </button>
    {/each}

    {#if retag && selectedKind !== 'custom'}
      <button
        type="button"
        class="border-foreground/25 hover:border-foreground text-muted-foreground hover:text-foreground border px-2 py-1 text-xs font-bold leading-none"
        onclick={openRename}
        title="Rename this section (keeps its type)"
      >
        Rename
      </button>
    {/if}
  </div>

  {#if labelOpen}
    <div class="flex flex-wrap items-center gap-1.5">
      <input
        bind:this={labelInput}
        type="text"
        bind:value={labelText}
        placeholder={labelKind === 'custom' ? 'Label (e.g. Drop, Hook)' : 'Section name'}
        class="border-foreground bg-background focus-visible:ring-ring w-44 border px-2 py-1 text-xs focus-visible:ring-2 focus-visible:outline-none"
        maxlength="40"
        aria-label="Section label"
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitLabel()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            labelOpen = false
          }
        }}
      />
      <button
        type="button"
        class="border-foreground hover:bg-foreground hover:text-background border px-2 py-1 text-xs font-bold leading-none disabled:opacity-40"
        disabled={labelKind === 'custom' && labelText.trim().length === 0}
        onclick={commitLabel}
      >
        {labelKind === 'custom' ? (retag ? 'Set custom' : 'Add custom') : 'Rename'}
      </button>
      <button
        type="button"
        class="border-foreground/25 hover:border-foreground text-muted-foreground border px-2 py-1 text-xs leading-none"
        onclick={() => (labelOpen = false)}
      >
        Cancel
      </button>
    </div>
  {/if}
</div>
