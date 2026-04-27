<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import { chordWithoutBass, rankChordSuggestions, withSlashBass } from '$lib/chords'
  import { diatonicDegreeRomanLabel, diatonicTriadsInKey, songKeyPreferFlats } from '$lib/chords/diatonic'
  import { formatChordSymbol } from '$lib/chords/formatChordSymbol'
  import {
    relatedChordsForDegree,
    type RelatedChordItem,
  } from '$lib/chords/markingMenuTree'
  import { pitchClassToRootAcc } from '$lib/chords/pitchClass'
  import type { Accidental, ChordSymbol, NoteName, SongKey } from '$lib/songmap/types'

  const HOLD_FOR_SLASH_MS = 1000
  const ITEM_RING_RADIUS = 100
  const BASS_RING_RADIUS = 148
  const NODE_SIZE = 46
  const CENTER_SIZE = 78
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

  let stagedChord = $state<ChordSymbol | null>(null)
  let drilledDegreeIndex = $state<number | null>(null)

  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let longPressDidFire = $state(false)

  const preferFlats = $derived(songKeyPreferFlats(songKey))
  const diatonicTriads = $derived(
    diatonicTriadsInKey(songKey, preferFlats).map((ch) => chordWithoutBass(ch, preferFlats)),
  )
  const suggestions = $derived(
    searchQuery.trim().length === 0
      ? []
      : rankChordSuggestions(searchQuery, songKey, { limit: 24 }),
  )
  const drilledRelated = $derived.by(() => {
    if (drilledDegreeIndex == null) return [] as RelatedChordItem[]
    return relatedChordsForDegree(songKey, drilledDegreeIndex)
  })

  type HomeSlot =
    | { kind: 'clear'; label: string; subtitle: string }
    | { kind: 'search'; label: string; subtitle: string }
    | { kind: 'degree'; degreeIndex: number; label: string; subtitle: string; chord: ChordSymbol }

  const homeSlots = $derived.by(() => {
    const slots: HomeSlot[] = [{ kind: 'clear', label: 'No chord', subtitle: 'remove' }]
    for (let i = 0; i < 7; i++) {
      const chord = diatonicTriads[i]
      if (!chord) continue
      slots.push({
        kind: 'degree',
        degreeIndex: i,
        label: formatChordSymbol(chord, { preferFlats }),
        subtitle: diatonicDegreeRomanLabel(songKey, i),
        chord,
      })
    }
    slots.push({ kind: 'search', label: 'Search', subtitle: 'all chords' })
    return slots
  })

  function labelFor(chord: ChordSymbol): string {
    return formatChordSymbol(chord, { preferFlats })
  }

  function bassLabel(root: NoteName, accidental?: Accidental): string {
    return formatChordSymbol(
      { root, accidental, quality: 'major', displayRaw: '' },
      { preferFlats },
    )
  }

  function clearLongPressTimer() {
    if (!longPressTimer) return
    clearTimeout(longPressTimer)
    longPressTimer = null
  }

  onDestroy(() => clearLongPressTimer())

  $effect(() => {
    if (!open) return
    drilledDegreeIndex = null
    stagedChord = null
    searchOpen = false
    searchQuery = ''
    searchHighlightIndex = 0
    longPressDidFire = false
    clearLongPressTimer()
  })

  $effect(() => {
    if (!open || !searchOpen) return
    void tick().then(() => {
      searchInputEl?.focus({ preventScroll: true })
      searchInputEl?.select()
    })
  })

  function closeMenu() {
    open = false
  }

  function goBack() {
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
    if (drilledDegreeIndex != null) {
      drilledDegreeIndex = null
      return
    }
    closeMenu()
  }

  function commitChord(chord: ChordSymbol) {
    onCommit?.(chord)
    closeMenu()
  }

  function openSearch() {
    searchOpen = true
    drilledDegreeIndex = null
    stagedChord = null
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
      drilledDegreeIndex = null
    }, HOLD_FOR_SLASH_MS)
  }

  function onCommitPointerUp(e: PointerEvent, chord: ChordSymbol) {
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    clearLongPressTimer()
    if (longPressDidFire) {
      longPressDidFire = false
      return
    }
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
    if (n > 0 && e.key === 'ArrowDown') {
      e.preventDefault()
      searchHighlightIndex = Math.min(searchHighlightIndex + 1, n - 1)
      return
    }
    if (n > 0 && e.key === 'ArrowUp') {
      e.preventDefault()
      searchHighlightIndex = Math.max(searchHighlightIndex - 1, 0)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const hit = suggestions[searchHighlightIndex]
      if (hit) commitChord(hit.chord)
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
    const x = ITEM_RING_RADIUS + 30
    const y = -SEARCH_PANEL_WIDTH * 0.1
    return `transform: translate(${x}px, ${y}px); width:${SEARCH_PANEL_WIDTH}px;`
  }

  function centerSubtitle(): string {
    if (stagedChord) return `Bass for ${labelFor(stagedChord)}`
    if (searchOpen) return 'Search'
    if (drilledDegreeIndex != null) return diatonicDegreeRomanLabel(songKey, drilledDegreeIndex)
    return 'Clock picker'
  }
</script>

{#if open && selectedBeatId}
  <div
    class="fixed inset-0 z-[9999] bg-foreground/20"
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
      aria-label="Chord clock picker"
    >
      <div
        class="pointer-events-auto absolute left-0 top-0"
        style="transform: translate(-50%, -50%); width: 430px; height: 430px;"
        role="presentation"
        onclick={stop}
        onkeydown={stop}
      >
        <button
          type="button"
          class="brutalist-shadow-sm bg-background text-foreground border-foreground absolute left-1/2 top-1/2 flex cursor-pointer flex-col items-center justify-center border-2 px-2 text-center"
          style="transform: translate(-50%, -50%); width:{CENTER_SIZE}px; height:{CENTER_SIZE}px;"
          onclick={goBack}
          title="Back / close"
        >
          <span class="text-[10px] font-bold leading-none">
            {stagedChord ? 'Bass' : drilledDegreeIndex != null || searchOpen ? 'Back' : 'Close'}
          </span>
          <span class="text-muted-foreground mt-1 max-w-[72px] truncate text-[9px] leading-tight">
            {centerSubtitle()}
          </span>
        </button>

        <p
          class="text-muted-foreground pointer-events-none absolute left-1/2 top-1/2 max-w-[220px] -translate-x-1/2 text-center text-[8px] leading-tight"
          style="transform: translate(-50%, calc(-50% + 52px));"
        >
          Tap chord to commit · hold 1s for slash bass
        </p>

        {#if !stagedChord && !searchOpen && drilledDegreeIndex == null}
          {#each homeSlots as slot, i (`home-${i}`)}
            {#if slot.kind === 'degree'}
              <div
                class="absolute left-1/2 top-1/2"
                style={polarStyle(i, homeSlots.length, ITEM_RING_RADIUS)}
              >
                <button
                  type="button"
                  class="brutalist-shadow-sm bg-background text-foreground border-foreground relative flex h-full w-full cursor-pointer select-none flex-col items-center justify-center border-2 px-1 text-center"
                  onpointerdown={(e) => onCommitPointerDown(e, slot.chord)}
                  onpointerup={(e) => onCommitPointerUp(e, slot.chord)}
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
                  title={`${slot.label} (${slot.subtitle}) — tap commit, hold 1s slash bass`}
                >
                  <span class="max-w-full truncate font-mono text-[10px] font-semibold leading-tight">
                    {slot.label}
                  </span>
                  <span class="text-muted-foreground max-w-full truncate text-[8px] leading-tight">
                    {slot.subtitle}
                  </span>
                </button>
                <button
                  type="button"
                  class="bg-muted text-foreground border-foreground absolute -right-2 -top-2 grid size-4 cursor-pointer place-items-center border text-[10px] leading-none"
                  onclick={() => {
                    drilledDegreeIndex = slot.degreeIndex
                    searchOpen = false
                  }}
                  title="Related chords"
                >
                  +
                </button>
              </div>
            {:else if slot.kind === 'clear'}
              <button
                type="button"
                class="brutalist-shadow-sm bg-background text-foreground border-foreground absolute left-1/2 top-1/2 flex cursor-pointer flex-col items-center justify-center border-2 px-1 text-center"
                style={polarStyle(i, homeSlots.length, ITEM_RING_RADIUS)}
                onclick={() => {
                  onClearChord?.()
                  closeMenu()
                }}
                title={slot.label}
              >
                <span class="text-[10px] font-semibold leading-tight">{slot.label}</span>
                <span class="text-muted-foreground text-[8px] leading-tight">{slot.subtitle}</span>
              </button>
            {:else}
              <button
                type="button"
                class="brutalist-shadow-sm bg-background text-foreground border-foreground absolute left-1/2 top-1/2 flex cursor-pointer flex-col items-center justify-center border-2 px-1 text-center"
                style={polarStyle(i, homeSlots.length, ITEM_RING_RADIUS)}
                onclick={openSearch}
                title={slot.label}
              >
                <span class="text-[10px] font-semibold leading-tight">{slot.label}</span>
                <span class="text-muted-foreground text-[8px] leading-tight">{slot.subtitle}</span>
              </button>
            {/if}
          {/each}
        {/if}

        {#if !stagedChord && !searchOpen && drilledDegreeIndex != null}
          {#each drilledRelated as item, i (`rel-${i}`)}
            <button
              type="button"
              class="brutalist-shadow-sm bg-background text-foreground border-foreground absolute left-1/2 top-1/2 flex cursor-pointer select-none flex-col items-center justify-center border-2 px-1 text-center"
              style={polarStyle(i, drilledRelated.length, ITEM_RING_RADIUS)}
              onpointerdown={(e) => onCommitPointerDown(e, item.chord)}
              onpointerup={(e) => onCommitPointerUp(e, item.chord)}
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
              title={`${item.label} — ${item.sublabel}`}
            >
              <span class="max-w-full truncate font-mono text-[10px] font-semibold leading-tight">
                {item.label}
              </span>
              <span class="text-muted-foreground max-w-full truncate text-[8px] leading-tight">
                {item.sublabel}
              </span>
            </button>
          {/each}
        {/if}

        {#if stagedChord}
          {#each BASS_PITCH_CLASSES as pc, j (pc)}
            {@const br = pitchClassToRootAcc(pc, preferFlats)}
            <button
              type="button"
              class="brutalist-shadow-sm bg-background text-foreground border-foreground absolute left-1/2 top-1/2 flex cursor-pointer items-center justify-center border-2 px-2 text-center"
              style={polarStyle(j, BASS_PITCH_CLASSES.length, BASS_RING_RADIUS, 42)}
              onclick={() => commitBass(pc)}
              title={`/${bassLabel(br.root, br.accidental)}`}
            >
              <span class="truncate font-mono text-[10px]">
                {bassLabel(br.root, br.accidental)}
              </span>
            </button>
          {/each}
        {/if}

        {#if searchOpen}
          <div
            class="brutalist-shadow bg-background text-foreground border-foreground absolute left-1/2 top-1/2 border-2 p-2"
            style={searchPanelStyle()}
          >
            <div class="mb-2 flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="text-[11px] font-bold">Chord search</div>
                <div class="text-muted-foreground text-[9px]">Tap or hold 1s for slash bass</div>
              </div>
              <button
                type="button"
                class="bg-muted border-foreground hover:bg-foreground/15 cursor-pointer border px-2 py-1 text-[10px]"
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
              class="bg-background text-foreground border-foreground placeholder:text-muted-foreground focus-visible:ring-ring mb-2 h-9 w-full border-2 px-2 font-mono text-[12px] outline-none focus-visible:ring-2"
              onkeydown={onSearchKeydown}
            />

            <div class="max-h-72 overflow-y-auto">
              {#if suggestions.length > 0}
                <div class="flex flex-col gap-1">
                  {#each suggestions as s, idx (s.label)}
                    <button
                      type="button"
                      class="bg-background border-foreground hover:bg-foreground/10 flex w-full cursor-pointer select-none items-center justify-between border px-2 py-1.5 text-left font-mono text-[11px] {idx ===
                      searchHighlightIndex
                        ? 'ring-ring ring-2'
                        : ''}"
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
                        class="ml-2 size-2 shrink-0 {s.inKey ? 'bg-emerald-500' : 'bg-orange-500'}"
                        aria-hidden="true"
                      ></span>
                    </button>
                  {/each}
                </div>
              {:else if searchQuery.trim().length > 0}
                <div class="text-muted-foreground border-foreground border border-dashed px-2 py-3 text-[11px]">
                  No matches
                </div>
              {:else}
                <div class="text-muted-foreground border-foreground border border-dashed px-2 py-3 text-[11px]">
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
