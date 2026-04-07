<!--
  Experimental radial “marking menu” chord picker (mouse-first).

  Coordinate rule: `anchorX` / `anchorY` and pointer events use viewport space (`clientX` / `clientY`).
  Do not render this inside an ancestor with `backdrop-filter` / `filter` / `transform` on the chain to
  the root — those create a containing block for `position: fixed` and the menu will not align with the cursor.

  Flow:
  1. Pointer down on dimmed overlay → drag from the small dot at the click.
  2. Past family threshold → wedge highlights; past item threshold → chord in that family highlights.
  3. Pointer up on a chord → commit (or, if Slash is on, enter bass step instead of closing).
  4. Bass step: pointer down again, drag past bass threshold for a note, pointer up → slash chord; release near dot → plain chord.

  Legacy list+search picker: `ChordPickerPopover.svelte` (unchanged).

  Implementation note: any `$effect` that calls `refreshHighlight()` must not track `ptrX`/`ptrY` (use `untrack`),
  or pointer moves re-run the effect and snap the cursor back to the anchor.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { formatChordSymbol } from '$lib/chords/formatChordSymbol'
  import { chordWithoutBass, withSlashBass } from '$lib/chords'
  import {
    bassNoteAngleRad,
    closestBassPc,
    closestItemIndex,
    distance,
    familyCenterRad,
    familySectorIndex6,
    itemAnglesRadial,
    normalizeAngleRad,
  } from '$lib/chords/markingMenuGeometry'
  import { buildMarkingMenuFamilies, type MarkingMenuItem } from '$lib/chords/markingMenuFamilies'
  import { pitchClassToRootAcc } from '$lib/chords/pitchClass'
  import { formatSongKeyLabel, songKeyPreferFlats } from '$lib/chords/diatonic'
  import type { ChordSymbol, SongKey } from '$lib/songmap/types'

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

  /** Min drag (px) from anchor before a family wedge is considered (pointer is synced to anchor only when the menu opens). */
  const TH_FAMILY = 16
  const TH_ITEM = 52
  const TH_BASS = 62
  const R_FAMILY = 48
  const R_ITEM = 82
  const R_BASS = 108
  const HUB_OFFSET_Y = Math.max(R_ITEM, R_BASS) + 36

  let preferFlats = $derived(songKeyPreferFlats(songKey))
  let families = $derived(buildMarkingMenuFamilies(songKey))

  let overlayPointerDown = $state(false)
  let ptrX = $state(0)
  let ptrY = $state(0)

  let bassStage = $state(false)
  let stagedChord = $state<ChordSymbol | null>(null)
  let slashToggle = $state(false)

  let hoverSector = $state<number | null>(null)
  let hoverItemIndex = $state<number | null>(null)
  let hoverBassPc = $state<number | null>(null)

  /** Pointer relative to anchor; angles match ring layout (y grows downward). */
  function pointerInAnchorSpace() {
    const dx = ptrX - anchorX
    const dy = ptrY - anchorY
    return {
      dx,
      dy,
      dist: distance(dx, dy),
      angleRad: normalizeAngleRad(Math.atan2(dy, dx)),
    }
  }

  function setPtrFromEvent(e: PointerEvent) {
    ptrX = e.clientX
    ptrY = e.clientY
  }

  /** Updates hoverSector / hoverItemIndex / hoverBassPc from `ptrX`/`ptrY`. */
  function refreshHighlight() {
    const { dx, dy, dist, angleRad } = pointerInAnchorSpace()

    if (bassStage && stagedChord) {
      hoverSector = null
      hoverItemIndex = null
      hoverBassPc = dist >= TH_BASS ? closestBassPc(angleRad) : null
      return
    }

    hoverBassPc = null
    if (dist < TH_FAMILY) {
      hoverSector = null
      hoverItemIndex = null
      return
    }

    const sec = familySectorIndex6(dx, dy)
    hoverSector = sec
    const fam = families[sec]
    if (!fam || dist < TH_ITEM) {
      hoverItemIndex = null
      return
    }

    const center = familyCenterRad(sec)
    const angles = itemAnglesRadial(center, fam.items.length, 0.38)
    hoverItemIndex = closestItemIndex(angleRad, angles)
  }

  function resetTransientState() {
    bassStage = false
    stagedChord = null
    hoverSector = null
    hoverItemIndex = null
    hoverBassPc = null
    overlayPointerDown = false
  }

  function closeMenu() {
    resetTransientState()
    open = false
  }

  function applyChordItemChoice(item: MarkingMenuItem) {
    if (item.action === 'clear') {
      onClearChord?.()
      closeMenu()
      return
    }
    if (item.action === 'search') {
      closeMenu()
      return
    }
    if (!item.chord) return

    if (slashToggle) {
      stagedChord = chordWithoutBass(item.chord, preferFlats)
      bassStage = true
      hoverItemIndex = null
      return
    }
    onCommit?.(item.chord)
    closeMenu()
  }

  function commitBassOrPlainFromRelease() {
    const { dist } = pointerInAnchorSpace()
    if (!stagedChord) return
    if (dist >= TH_BASS && hoverBassPc !== null) {
      const { root, accidental } = pitchClassToRootAcc(hoverBassPc, preferFlats)
      onCommit?.(withSlashBass(stagedChord, root, accidental, preferFlats))
    } else {
      onCommit?.(stagedChord)
    }
    closeMenu()
  }

  function onOverlayPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-marking-hub]')) return
    overlayPointerDown = true
    setPtrFromEvent(e)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    refreshHighlight()
  }

  function onOverlayPointerMove(e: PointerEvent) {
    setPtrFromEvent(e)
    refreshHighlight()
  }

  function onOverlayPointerUp(e: PointerEvent) {
    setPtrFromEvent(e)
    refreshHighlight()

    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }

    const hadOverlayDown = overlayPointerDown
    overlayPointerDown = false

    if (bassStage && stagedChord) {
      if (!hadOverlayDown) return
      commitBassOrPlainFromRelease()
      return
    }

    if (!hadOverlayDown) return

    const { dist } = pointerInAnchorSpace()
    if (dist < TH_FAMILY) return

    const { dx, dy } = pointerInAnchorSpace()
    const sec = familySectorIndex6(dx, dy)
    const fam = families[sec]
    if (!fam || dist < TH_ITEM || hoverItemIndex === null) return

    const item = fam.items[hoverItemIndex]
    if (item) applyChordItemChoice(item)
  }

  function hubClear(e: MouseEvent) {
    e.stopPropagation()
    onClearChord?.()
    closeMenu()
  }

  function hubSlashToggle(e: MouseEvent) {
    e.stopPropagation()
    slashToggle = !slashToggle
    if (!slashToggle) {
      bassStage = false
      stagedChord = null
    }
  }

  /**
   * Snap pointer to anchor when the menu opens or the anchor moves — but do NOT subscribe to `ptrX`/`ptrY` here.
   * If `refreshHighlight()` ran tracked, every `pointermove` would re-run this effect and reset ptr to the anchor,
   * so highlights and commits would never update.
   */
  $effect(() => {
    if (!open) {
      resetTransientState()
      return
    }
    if (!selectedBeatId) return
    const ax = anchorX
    const ay = anchorY
    untrack(() => {
      ptrX = ax
      ptrY = ay
      refreshHighlight()
    })
  })

  function familyNodeStyle(sector: number): string {
    const r = familyCenterRad(sector)
    const x = Math.cos(r) * R_FAMILY
    const y = Math.sin(r) * R_FAMILY
    return `transform: translate(calc(-50% + ${x}px), calc(-50% + ${y}px));`
  }

  function itemNodeStyle(sector: number, itemIndex: number, total: number): string {
    const center = familyCenterRad(sector)
    const angles = itemAnglesRadial(center, total, 0.38)
    const r = angles[itemIndex] ?? center
    const x = Math.cos(r) * R_ITEM
    const y = Math.sin(r) * R_ITEM
    return `transform: translate(calc(-50% + ${x}px), calc(-50% + ${y}px));`
  }

  function bassNodeStyle(pc: number): string {
    const r = bassNoteAngleRad(pc)
    const x = Math.cos(r) * R_BASS
    const y = Math.sin(r) * R_BASS
    return `transform: translate(calc(-50% + ${x}px), calc(-50% + ${y}px));`
  }

  function labelChord(c: ChordSymbol): string {
    return formatChordSymbol(c, { preferFlats })
  }

  function noteLabelPc(pc: number): string {
    const { root, accidental } = pitchClassToRootAcc(pc, preferFlats)
    return formatChordSymbol({ root, accidental, quality: 'major', displayRaw: '' }, { preferFlats })
  }

  function itemDisplayLabel(item: MarkingMenuItem): string {
    return item.chord ? labelChord(item.chord) : item.label
  }

  let activeFamilyForRing = $derived(
    bassStage ? null : hoverSector !== null ? (families[hoverSector!] ?? null) : null,
  )
</script>

<svelte:window
  onkeydown={(e) => {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu()
    }
  }}
/>

{#if open && selectedBeatId}
  <div
    class="bg-black/40 fixed inset-0 z-[9999] cursor-crosshair touch-none"
    onpointerdown={onOverlayPointerDown}
    onpointermove={onOverlayPointerMove}
    onpointerup={onOverlayPointerUp}
    onpointercancel={onOverlayPointerUp}
    role="application"
    aria-label="Chord marking menu"
  >
    <div
      class="pointer-events-none absolute overflow-visible"
      style:left="{anchorX}px"
      style:top="{anchorY}px"
      style:width="0"
      style:height="0"
    >
      <div
        class="pointer-events-none absolute top-0 left-0 z-[1] size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-400/80 bg-amber-500/30 shadow-[0_0_12px_rgba(251,191,36,0.45)]"
        aria-hidden="true"
      ></div>

      <div
        data-marking-hub
        class="pointer-events-auto absolute top-0 left-0 z-30 flex flex-col items-center gap-1"
        style="transform: translate(-50%, {HUB_OFFSET_Y}px);"
      >
        <div
          class="border-input bg-popover text-popover-foreground flex flex-nowrap items-center gap-1.5 rounded-lg border px-2 py-1 shadow-md ring-1 ring-foreground/10"
        >
          <span
            class="text-muted-foreground max-w-[3.5rem] shrink-0 truncate text-center text-[9px] font-medium tracking-wide uppercase"
            title={formatSongKeyLabel(songKey)}>{formatSongKeyLabel(songKey)}</span
          >
          <button
            type="button"
            class="border-input bg-secondary text-secondary-foreground hover:bg-secondary/90 shrink-0 rounded border px-1.5 py-0.5 text-[9px]"
            onclick={hubClear}
          >
            Clear
          </button>
          <button
            type="button"
            class="border-input shrink-0 rounded border px-1.5 py-0.5 text-[9px] {slashToggle
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground'}"
            onclick={hubSlashToggle}
            title={slashToggle
              ? 'Slash on: after you choose a chord, click the overlay again and drag to a bass note (or release on the dot for no bass).'
              : 'Slash off: one gesture commits the chord.'}
          >
            Slash
          </button>
        </div>
        {#if bassStage && stagedChord}
          <p
            class="text-popover-foreground bg-popover/95 max-w-[12rem] rounded border border-amber-500/40 px-2 py-0.5 text-center text-[9px] shadow-sm"
          >
            <span class="font-medium">{labelChord(stagedChord)}</span>
            <span class="text-muted-foreground">
              — click overlay, drag to bass (or release on dot = no slash)</span
            >
          </p>
        {/if}
      </div>

      {#each families as fam, s (fam.id)}
        {@const active = !bassStage && hoverSector === s}
        <div
          class="border-input bg-popover text-popover-foreground pointer-events-none absolute top-0 left-0 flex h-10 min-w-[2.5rem] max-w-[4.5rem] items-center justify-center rounded-full border px-1.5 text-center shadow-lg ring-2 transition-[box-shadow,transform] duration-75 {active
            ? 'border-primary ring-primary z-10 scale-110'
            : 'ring-foreground/20 z-[5]'}"
          style={familyNodeStyle(s)}
        >
          <span class="text-[9px] font-semibold leading-tight">{fam.label}</span>
        </div>
      {/each}

      {#if activeFamilyForRing && !bassStage}
        {#each activeFamilyForRing.items as item, i (item.id)}
          {@const active = hoverSector !== null && hoverItemIndex === i}
          <div
            class="pointer-events-none absolute top-0 left-0 flex min-h-[2rem] min-w-[2.25rem] max-w-[5.5rem] items-center justify-center rounded-md border-2 px-1.5 py-1 text-center shadow-lg transition-[box-shadow,transform] duration-75 {active
              ? 'border-primary bg-primary text-primary-foreground z-[15] scale-105 ring-2 ring-primary/50'
              : 'border-input bg-popover text-popover-foreground z-[12] ring-2 ring-foreground/15'}"
            style={itemNodeStyle(hoverSector!, i, activeFamilyForRing.items.length)}
          >
            <span class="text-[10px] font-mono font-semibold leading-tight">{itemDisplayLabel(item)}</span>
          </div>
        {/each}
      {/if}

      {#if bassStage && stagedChord}
        {#each Array.from({ length: 12 }, (_, pc) => pc) as pc (pc)}
          {@const active = hoverBassPc === pc}
          <div
            class="pointer-events-none absolute top-0 left-0 flex h-8 w-8 items-center justify-center rounded-full border text-[9px] shadow-md transition-[box-shadow,transform] duration-75 {active
              ? 'border-primary bg-primary text-primary-foreground z-[18] scale-110 ring-2 ring-primary/50'
              : 'border-input bg-muted/80 text-foreground z-[14] ring-1 ring-foreground/10'}"
            style={bassNodeStyle(pc)}
          >
            {noteLabelPc(pc)}
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}
