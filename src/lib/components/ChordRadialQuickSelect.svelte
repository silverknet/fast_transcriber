<script lang="ts">
  /**
   * Radial chord picker: home ring = common chords (one tap) + categories (hover/click to drill) + Search/Clear.
   * Long-press (~1s) a chord for slash bass. Mount outside `backdrop-filter` ancestors (edit/+page.svelte).
   */

  import { onDestroy, tick, untrack } from 'svelte'
  import {
    chordWithoutBass,
    rankChordSuggestions,
    withSlashBass,
  } from '$lib/chords'
  import { pitchClassToRootAcc } from '$lib/chords/pitchClass'
  import { formatChordSymbol } from '$lib/chords/formatChordSymbol'
  import { songKeyPreferFlats } from '$lib/chords/diatonic'
  import type { Accidental, ChordSymbol, NoteName, SongKey } from '$lib/songmap/types'
  import {
    RADIAL_HOVER_DRILL_MS,
    buildChordMarkingTree,
    radialRingNodes,
    type RadialMenuNode,
  } from '$lib/chords/markingMenuTree'

  const LONG_PRESS_MS = 1000
  const ITEM_RING_RADIUS = 88
  const BASS_RING_RADIUS = 142
  const NODE_SIZE = 52
  const CENTER_SIZE = 72
  const SEARCH_PANEL_WIDTH = 280
  const BASS_PITCH_CLASSES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const

  let {
    open = $bindable(false),
    anchorX = 0,
    anchorY = 0,
    songKey,
    selectedBeatId = null as string | null,
    onCommit,
    onClearChord,
  }: {
    open?: boolean
    anchorX?: number
    anchorY?: number
    songKey: SongKey
    selectedBeatId?: string | null
    onCommit?: (chord: ChordSymbol) => void
    onClearChord?: () => void
  } = $props()

  let searchInputEl = $state<HTMLInputElement | undefined>()

  let searchOpen = $state(false)
  let searchQuery = $state('')
  let searchHighlightIndex = $state(0)

  /** `null` = home ring (quick picks + categories); else showing that category’s chord list. */
  let drilledCategory = $state<RadialMenuNode | null>(null)
  let stagedChord = $state<ChordSymbol | null>(null)

  let hoverDrillTimer: ReturnType<typeof setTimeout> | null = null
  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let longPressDidFire = $state(false)

  const preferFlats = $derived(songKeyPreferFlats(songKey))
  const tree = $derived(buildChordMarkingTree(songKey))
  const ringNodes = $derived(radialRingNodes(tree, preferFlats, drilledCategory))

  const suggestions = $derived(
    searchQuery.trim().length === 0
      ? []
      : rankChordSuggestions(searchQuery, songKey, { limit: 24 }),
  )

  function labelFor(chord: ChordSymbol): string {
    return formatChordSymbol(chord, { preferFlats })
  }

  function bassLabel(root: NoteName, accidental?: Accidental): string {
    return formatChordSymbol(
      { root, accidental, quality: 'major', displayRaw: '' },
      { preferFlats },
    )
  }

  function closeMenu() {
    open = false
  }

  function clearHoverDrill() {
    if (hoverDrillTimer) {
      clearTimeout(hoverDrillTimer)
      hoverDrillTimer = null
    }
  }

  function clearLongPressTimer() {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }

  onDestroy(() => {
    clearHoverDrill()
    clearLongPressTimer()
  })

  $effect(() => {
    if (!open) return
    const t = tree
    untrack(() => {
      drilledCategory = null
      stagedChord = null
      searchOpen = false
      searchQuery = ''
      searchHighlightIndex = 0
      longPressDidFire = false
      clearHoverDrill()
      clearLongPressTimer()
    })
  })

  $effect(() => {
    if (!open) return
    if (!searchOpen) return
    void tick().then(() => {
      searchInputEl?.focus({ preventScroll: true })
      searchInputEl?.select()
    })
  })

  function commitChord(chord: ChordSymbol) {
    onCommit?.(chord)
    closeMenu()
  }

  function commitBass(pc: number) {
    if (!stagedChord) return
    const { root, accidental } = pitchClassToRootAcc(pc, preferFlats)
    const slashChord = withSlashBass(
      chordWithoutBass(stagedChord, preferFlats),
      root,
      accidental,
      preferFlats,
    )
    onCommit?.(slashChord)
    closeMenu()
  }

  function openSearch() {
    searchOpen = true
    stagedChord = null
    clearHoverDrill()
  }

  function drillIntoCategory(node: RadialMenuNode) {
    clearHoverDrill()
    if (node.action !== 'branch' || !node.children?.length) return
    drilledCategory = node
    searchOpen = false
  }

  function goBack() {
    clearHoverDrill()
    clearLongPressTimer()

    if (searchOpen) {
      searchOpen = false
      searchQuery = ''
      searchHighlightIndex = 0
      return
    }

    if (stagedChord) {
      stagedChord = null
      longPressDidFire = false
      return
    }

    if (drilledCategory) {
      drilledCategory = null
      return
    }

    closeMenu()
  }

  function onCategoryPointerEnter(node: RadialMenuNode) {
    clearHoverDrill()
    if (node.action !== 'branch' || !node.children?.length) return
    hoverDrillTimer = setTimeout(() => {
      hoverDrillTimer = null
      drillIntoCategory(node)
    }, RADIAL_HOVER_DRILL_MS)
  }

  function onCategoryPointerLeave() {
    clearHoverDrill()
  }

  function onCommitPointerDown(e: PointerEvent, chord: ChordSymbol) {
    if (e.button !== 0) return
    clearLongPressTimer()
    longPressDidFire = false
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      longPressDidFire = true
      stagedChord = chordWithoutBass(chord, preferFlats)
      searchOpen = false
    }, LONG_PRESS_MS)
  }

  function onCommitPointerUp(e: PointerEvent, chord: ChordSymbol) {
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    clearLongPressTimer()
    const skipCommit = longPressDidFire
    longPressDidFire = false
    if (skipCommit) return
    commitChord(chord)
  }

  function onCommitPointerLeave() {
    clearLongPressTimer()
  }

  function onSearchResultPointerDown(e: PointerEvent, chord: ChordSymbol) {
    onCommitPointerDown(e, chord)
  }

  function onSearchResultPointerUp(e: PointerEvent, chord: ChordSymbol) {
    onCommitPointerUp(e, chord)
  }

  function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      goBack()
      return
    }

    const n = suggestions.length

    if (n > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        searchHighlightIndex = Math.min(searchHighlightIndex + 1, n - 1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        searchHighlightIndex = Math.max(searchHighlightIndex - 1, 0)
        return
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      const hit = suggestions[searchHighlightIndex]
      if (!hit) return
      commitChord(hit.chord)
    }
  }

  function stop(e: Event) {
    e.stopPropagation()
  }

  function polarStyle(index: number, total: number, radius: number, size = NODE_SIZE) {
    const angleDeg = -90 + (360 / Math.max(total, 1)) * index
    const angleRad = (angleDeg * Math.PI) / 180
    const x = Math.cos(angleRad) * radius
    const y = Math.sin(angleRad) * radius

    return `transform: translate(calc(-50% + ${x}px), calc(-50% + ${y}px)); width:${size}px; height:${size}px;`
  }

  function searchPanelStyle() {
    const x = ITEM_RING_RADIUS + 28
    const y = -SEARCH_PANEL_WIDTH * 0.12
    return `transform: translate(${x}px, ${y}px); width:${SEARCH_PANEL_WIDTH}px;`
  }

  function chordPreview(): string {
    if (!stagedChord) return 'Pick chord'
    return `Bass for ${labelFor(stagedChord)}`
  }

  function centerSubtitle(): string {
    if (stagedChord) return chordPreview()
    if (searchOpen) return 'Search'
    if (drilledCategory) return drilledCategory.label
    return 'Quick picks'
  }

  function isCategoryNode(node: RadialMenuNode): boolean {
    return node.action === 'branch' && (node.children?.length ?? 0) > 0
  }

  function nodeSubtitle(node: RadialMenuNode): string {
    if (node.action === 'branch') {
      if (drilledCategory) return `${node.children?.length ?? 0} items`
      return 'Hover · more'
    }
    if (node.action === 'clear') return 'remove'
    if (node.action === 'search') return 'all chords'
    if (node.shortLabel) return node.shortLabel
    return 'Hold = /bass'
  }
</script>

{#if open && selectedBeatId}
  <div
    class="fixed inset-0 z-[9999] bg-black/30"
    role="presentation"
    tabindex="-1"
    onclick={closeMenu}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        goBack()
      }
    }}
  >
    <div
      class="pointer-events-none fixed h-0 w-0 overflow-visible"
      style:left="{anchorX}px"
      style:top="{anchorY}px"
      role="dialog"
      aria-label="Radial chord quick select"
    >
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="pointer-events-auto absolute left-0 top-0"
        style="transform: translate(-50%, -50%); width: 420px; height: 420px;"
        role="presentation"
        onclick={stop}
        onkeydown={stop}
      >
        <div
          class="bg-popover text-popover-foreground border-input absolute left-1/2 top-1/2 flex flex-col items-center justify-center rounded-full border text-center shadow-xl ring-1 ring-foreground/10"
          style="transform: translate(-50%, -50%); width:{CENTER_SIZE}px; height:{CENTER_SIZE}px;"
        >
          <button
            type="button"
            class="flex h-full w-full cursor-pointer flex-col items-center justify-center rounded-full px-2"
            onclick={goBack}
            title="Back / close"
          >
            <span class="text-[10px] font-semibold leading-none">
              {stagedChord ? 'Bass' : drilledCategory || searchOpen ? 'Back' : 'Close'}
            </span>
            <span class="text-muted-foreground mt-1 max-w-[64px] truncate text-[9px] leading-tight">
              {centerSubtitle()}
            </span>
          </button>
        </div>

        <p
          class="text-muted-foreground pointer-events-none absolute left-1/2 top-1/2 max-w-[200px] -translate-x-1/2 text-center text-[8px] leading-tight"
          style="transform: translate(-50%, calc(-50% + 46px));"
        >
          Tap chord to commit · hold 1s for slash bass
        </p>

        {#if !stagedChord && !searchOpen}
          {#each ringNodes as node, i (node.id)}
            {#if isCategoryNode(node)}
              <button
                type="button"
                class="bg-popover text-popover-foreground border-input hover:bg-muted absolute left-1/2 top-1/2 flex cursor-pointer flex-col items-center justify-center rounded-full border border-amber-500/35 px-2 text-center shadow-md ring-1 ring-amber-400/25 transition-transform duration-100 hover:scale-[1.04]"
                style={polarStyle(i, ringNodes.length, ITEM_RING_RADIUS)}
                onclick={() => drillIntoCategory(node)}
                onpointerenter={() => onCategoryPointerEnter(node)}
                onpointerleave={onCategoryPointerLeave}
                title={`${node.label} — hover or click for more chords`}
              >
                <span class="max-w-full truncate text-[10px] font-semibold leading-tight">
                  {node.shortLabel ?? node.label}
                </span>
                <span class="text-muted-foreground mt-0.5 max-w-full truncate text-[8px] leading-tight">
                  {nodeSubtitle(node)}
                </span>
              </button>
            {:else if node.action === 'search'}
              <button
                type="button"
                class="bg-popover text-popover-foreground border-input hover:bg-muted absolute left-1/2 top-1/2 flex cursor-pointer flex-col items-center justify-center rounded-full border px-2 text-center shadow-md transition-transform duration-100 hover:scale-[1.04]"
                style={polarStyle(i, ringNodes.length, ITEM_RING_RADIUS)}
                onclick={() => openSearch()}
                title={node.label}
              >
                <span class="max-w-full truncate text-[10px] font-semibold leading-tight">{node.label}</span>
                <span class="text-muted-foreground mt-0.5 max-w-full truncate text-[8px] leading-tight">
                  {nodeSubtitle(node)}
                </span>
              </button>
            {:else if node.action === 'clear'}
              <button
                type="button"
                class="bg-popover text-popover-foreground border-input hover:bg-muted absolute left-1/2 top-1/2 flex cursor-pointer flex-col items-center justify-center rounded-full border px-2 text-center shadow-md transition-transform duration-100 hover:scale-[1.04]"
                style={polarStyle(i, ringNodes.length, ITEM_RING_RADIUS)}
                onclick={() => {
                  onClearChord?.()
                  closeMenu()
                }}
                title={node.label}
              >
                <span class="max-w-full truncate text-[10px] font-semibold leading-tight">{node.label}</span>
                <span class="text-muted-foreground mt-0.5 max-w-full truncate text-[8px] leading-tight">
                  {nodeSubtitle(node)}
                </span>
              </button>
            {:else if node.action === 'commit' && node.chord}
              <button
                type="button"
                class="bg-popover text-popover-foreground border-input hover:bg-muted absolute left-1/2 top-1/2 flex cursor-pointer select-none flex-col items-center justify-center rounded-full border px-2 text-center shadow-md transition-transform duration-100 hover:scale-[1.04]"
                style={polarStyle(i, ringNodes.length, ITEM_RING_RADIUS)}
                onpointerdown={(e) => onCommitPointerDown(e, node.chord!)}
                onpointerup={(e) => onCommitPointerUp(e, node.chord!)}
                onpointerleave={onCommitPointerLeave}
                onpointercancel={(e) => {
                  try {
                    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
                  } catch {
                    /* ignore */
                  }
                  onCommitPointerLeave()
                  longPressDidFire = false
                }}
                oncontextmenu={(e) => e.preventDefault()}
                title={`${labelFor(node.chord)} — tap = commit, hold 1s = slash bass`}
              >
                <span class="max-w-full truncate text-[10px] font-semibold leading-tight">
                  {node.label}
                </span>
                <span class="text-muted-foreground mt-0.5 max-w-full truncate text-[8px] leading-tight">
                  {nodeSubtitle(node)}
                </span>
              </button>
            {/if}
          {/each}
        {/if}

        {#if stagedChord}
          {#each BASS_PITCH_CLASSES as pc, j (pc)}
            {@const br = pitchClassToRootAcc(pc, preferFlats)}
            <button
              type="button"
              class="bg-popover text-popover-foreground border-input hover:bg-muted absolute left-1/2 top-1/2 flex cursor-pointer items-center justify-center rounded-full border px-2 text-center shadow-md transition-transform duration-100 hover:scale-[1.04]"
              style={polarStyle(j, BASS_PITCH_CLASSES.length, BASS_RING_RADIUS, 44)}
              onclick={() => commitBass(pc)}
              title={`/${bassLabel(br.root, br.accidental)}`}
            >
              <span class="truncate font-mono text-[10px]">
                {bassLabel(br.root, br.accidental)}
              </span>
            </button>
          {/each}

          <div
            class="bg-popover text-popover-foreground border-input absolute left-1/2 top-1/2 rounded-full border px-3 py-1 shadow-md"
            style="transform: translate(-50%, calc(-50% - 58px));"
          >
            <span class="text-[10px] font-medium">{labelFor(stagedChord)}</span>
          </div>
        {/if}

        {#if searchOpen}
          <div
            class="bg-popover text-popover-foreground border-input absolute left-1/2 top-1/2 rounded-xl border p-2 shadow-xl ring-1 ring-foreground/10"
            style={searchPanelStyle()}
          >
            <div class="mb-2 flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="text-[11px] font-semibold">Chord search</div>
                <div class="text-muted-foreground text-[9px]">Tap or hold 1s for slash bass</div>
              </div>
              <button
                type="button"
                class="hover:bg-muted rounded px-2 py-1 text-[10px]"
                onclick={() => {
                  searchOpen = false
                  searchQuery = ''
                  searchHighlightIndex = 0
                }}
              >
                Close
              </button>
            </div>

            <input
              bind:this={searchInputEl}
              bind:value={searchQuery}
              type="text"
              autocomplete="off"
              spellcheck={false}
              placeholder="Type chord, e.g. Cmaj7, F#m7b5, Bb/D"
              class="bg-background text-foreground border-input placeholder:text-muted-foreground focus-visible:ring-ring mb-2 h-9 w-full rounded-md border px-2 font-mono text-[12px] outline-none focus-visible:ring-2"
              onkeydown={onSearchKeydown}
            />

            <div class="max-h-72 overflow-y-auto">
              {#if suggestions.length > 0}
                <div class="flex flex-col gap-1">
                  {#each suggestions as s, idx (s.label)}
                    <button
                      type="button"
                      class="border-input hover:bg-muted flex w-full cursor-pointer select-none items-center justify-between rounded-md border px-2 py-1.5 text-left font-mono text-[11px] {idx ===
                      searchHighlightIndex
                        ? 'bg-muted ring-ring ring-1'
                        : 'bg-background'}"
                      onpointerdown={(e) => onSearchResultPointerDown(e, s.chord)}
                      onpointerup={(e) => onSearchResultPointerUp(e, s.chord)}
                      onpointerleave={onCommitPointerLeave}
                      onpointercancel={(e) => {
                        try {
                          ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
                        } catch {
                          /* ignore */
                        }
                        onCommitPointerLeave()
                        longPressDidFire = false
                      }}
                      oncontextmenu={(e) => e.preventDefault()}
                      title={s.label}
                    >
                      <span class="truncate">{s.label}</span>
                      <span
                        class="ml-2 size-2 shrink-0 rounded-full {s.inKey
                          ? 'bg-emerald-500'
                          : 'bg-orange-500'}"
                        aria-hidden="true"
                      ></span>
                    </button>
                  {/each}
                </div>
              {:else if searchQuery.trim().length > 0}
                <div class="text-muted-foreground rounded-md border border-dashed px-2 py-3 text-[11px]">
                  No matches
                </div>
              {:else}
                <div class="text-muted-foreground rounded-md border border-dashed px-2 py-3 text-[11px]">
                  Start typing to search all chords
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
