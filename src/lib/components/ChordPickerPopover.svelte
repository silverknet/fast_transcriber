<script lang="ts">
  /**
   * Chord editor popover: diatonic column + type row; horizontal drawers. `songKey` is for spelling and
   * suggestions only—stored harmony is absolute (see types `ChordSymbol`).
   */

  import { tick } from 'svelte'
  import * as Popover from '$lib/components/ui/popover'
  import {
    chordWithoutBass,
    dominantSeventhOfChordRoot,
    rankChordSuggestions,
    tritoneSubOfDominantSeventh,
    withSlashBass,
  } from '$lib/chords'
  import { pitchClassToRootAcc } from '$lib/chords/pitchClass'
  import {
    diatonicChordVariationsForDegree,
    diatonicDegreeRomanLabel,
    diatonicTriadsInKey,
    songKeyPreferFlats,
  } from '$lib/chords/diatonic'
  import { formatChordSymbol } from '$lib/chords/formatChordSymbol'
  import type { Accidental, ChordSymbol, NoteName, SongKey } from '$lib/songmap/types'

  const BASS_PITCH_CLASSES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const

  let {
    open = $bindable(false),
    anchorX = 0,
    anchorY = 0,
    songKey,
    selectedBeatId = null as string | null,
    query = $bindable(''),
    highlightIndex = $bindable(0),
    onCommit,
    onClearChord,
  }: {
    open?: boolean
    anchorX?: number
    anchorY?: number
    songKey: SongKey
    selectedBeatId?: string | null
    query?: string
    highlightIndex?: number
    onCommit?: (chord: ChordSymbol) => void
    /** Remove harmony on this beat (no chord). */
    onClearChord?: () => void
  } = $props()

  let inputEl = $state<HTMLInputElement | undefined>()
  let popoverSurfaceEl = $state<HTMLDivElement | undefined>()

  /** When on: chord taps stage; pick a bass note (or type e.g. C/G) to commit slash chord. */
  let slashMode = $state(false)
  let stagedChord = $state<ChordSymbol | null>(null)
  let pendingBass = $state<{ root: NoteName; accidental?: Accidental } | null>(null)

  const HOVER_CLOSE_MS = 320
  let hoverCloseTimer: ReturnType<typeof setTimeout> | null = null

  let preferFlats = $derived(songKeyPreferFlats(songKey))
  let triads = $derived(diatonicTriadsInKey(songKey, preferFlats))
  /** Empty query would list every diatonic chord — only rank after the user types. */
  let suggestions = $derived(
    query.trim().length === 0 ? [] : rankChordSuggestions(query, songKey, { limit: 32 }),
  )
  let showCustomSuggestions = $derived(query.trim().length > 0)

  function labelFor(chord: ChordSymbol): string {
    return formatChordSymbol(chord, { preferFlats })
  }

  function noteLabel(root: NoteName, accidental?: Accidental): string {
    return formatChordSymbol(
      { root, accidental, quality: 'major', displayRaw: '' },
      { preferFlats },
    )
  }

  function variationsFor(degreeIndex: number): ChordSymbol[] {
    return diatonicChordVariationsForDegree(songKey, degreeIndex, preferFlats)
  }

  function clearSlashStaging() {
    stagedChord = null
    pendingBass = null
  }

  function pick(chord: ChordSymbol) {
    if (chord.bass) {
      onCommit?.(chord)
      clearSlashStaging()
      return
    }
    if (!slashMode) {
      onCommit?.(chord)
      return
    }
    if (pendingBass) {
      onCommit?.(
        withSlashBass(
          chordWithoutBass(chord, preferFlats),
          pendingBass.root,
          pendingBass.accidental,
          preferFlats,
        ),
      )
      clearSlashStaging()
      return
    }
    stagedChord = chordWithoutBass(chord, preferFlats)
  }

  function pickBass(pc: number) {
    const { root, accidental } = pitchClassToRootAcc(pc, preferFlats)
    if (stagedChord) {
      onCommit?.(withSlashBass(stagedChord, root, accidental, preferFlats))
      clearSlashStaging()
      return
    }
    pendingBass = { root, accidental }
  }

  function applyStagedPlain() {
    if (!stagedChord) return
    onCommit?.(stagedChord)
    clearSlashStaging()
  }

  function clearChord() {
    clearSlashStaging()
    onClearChord?.()
  }

  $effect(() => {
    if (!slashMode) clearSlashStaging()
  })

  function clearHoverCloseTimer() {
    if (hoverCloseTimer !== null) {
      clearTimeout(hoverCloseTimer)
      hoverCloseTimer = null
    }
  }

  /** Beat strip clicks are “outside” the popover but must not dismiss — otherwise the next beat can’t reopen. */
  function chordInteractOutside(e: PointerEvent) {
    const t = e.target
    if (t instanceof Element && t.closest('[data-chord-beat-strip]')) {
      e.preventDefault()
    }
  }

  function onPopoverPointerLeave(e: PointerEvent) {
    const to = e.relatedTarget
    if (to instanceof Node && popoverSurfaceEl?.contains(to)) return
    if (to instanceof Element && to.closest('[data-chord-beat-strip]')) return
    clearHoverCloseTimer()
    hoverCloseTimer = setTimeout(() => {
      hoverCloseTimer = null
      open = false
    }, HOVER_CLOSE_MS)
  }

  function onPopoverPointerEnter() {
    clearHoverCloseTimer()
  }

  $effect(() => {
    if (!open) clearHoverCloseTimer()
  })

  $effect(() => {
    return () => clearHoverCloseTimer()
  })

  $effect(() => {
    if (!open) return
    void tick().then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          inputEl?.focus({ preventScroll: true })
          inputEl?.select()
        })
      })
    })
  })

  $effect(() => {
    if (suggestions.length === 0) {
      highlightIndex = 0
      return
    }
    if (highlightIndex >= suggestions.length) {
      highlightIndex = suggestions.length - 1
    }
    if (highlightIndex < 0) {
      highlightIndex = 0
    }
  })

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      return
    }

    const n = suggestions.length
    if (n > 0) {
      const next = (delta: number) => {
        e.preventDefault()
        e.stopPropagation()
        highlightIndex = Math.min(Math.max(highlightIndex + delta, 0), n - 1)
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        next(1)
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        next(-1)
        return
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const hit = suggestions[highlightIndex]
      if (hit) pick(hit.chord)
    }
  }
</script>

<Popover.Root
  bind:open
  onOpenChange={(v) => {
    if (!v) {
      clearHoverCloseTimer()
      query = ''
      highlightIndex = 0
      slashMode = false
      clearSlashStaging()
    }
  }}
>
  <Popover.Trigger
    class="pointer-events-none fixed z-0 h-px w-px opacity-0"
    style="left: {anchorX}px; top: {anchorY}px;"
    aria-hidden="true"
  />

  <Popover.Content
    portalProps={{}}
    side="bottom"
    align="start"
    sideOffset={8}
    onInteractOutside={chordInteractOutside}
    class="border-input bg-popover text-popover-foreground z-[100] w-max max-w-[min(20rem,calc(100vw-2rem))] gap-0 overflow-visible rounded-lg border p-1.5 shadow-md ring-1 ring-foreground/10"
  >
    {#if selectedBeatId}
      <div
        bind:this={popoverSurfaceEl}
        class="-m-1.5 flex min-h-0 flex-col p-1.5"
        role="presentation"
        onpointerenter={onPopoverPointerEnter}
        onpointerleave={onPopoverPointerLeave}
      >
        <div data-chord-picker-root class="relative w-11 min-w-11 overflow-visible">
        <div
          class="bg-popover border-input text-popover-foreground flex w-full min-w-11 flex-col overflow-visible rounded-md border shadow-sm"
          role="group"
          aria-label="Chord picker"
        >
          <p
            class="text-muted-foreground mb-px w-full truncate text-center text-[7px] font-medium tracking-tight uppercase"
          >
            Key
          </p>

          <div class="border-foreground/10 mb-1 flex flex-col gap-0.5 border-b border-dashed pb-1">
            <label
              class="text-muted-foreground flex cursor-pointer items-center justify-center gap-1.5 text-[7px] tracking-tight uppercase"
            >
              <input
                type="checkbox"
                class="border-input accent-foreground h-2.5 w-2.5 rounded"
                bind:checked={slashMode}
              />
              Slash bass
            </label>
            {#if slashMode}
              <div class="text-muted-foreground flex min-h-3 flex-wrap items-center justify-center gap-x-1 gap-y-0 text-center text-[6px] leading-tight">
                {#if stagedChord}
                  <span class="text-foreground font-mono text-[7px]">{labelFor(stagedChord)}</span>
                  <button
                    type="button"
                    class="text-foreground underline decoration-dotted underline-offset-2"
                    onclick={applyStagedPlain}
                  >
                    apply
                  </button>
                {/if}
                {#if pendingBass}
                  <span class="text-foreground font-mono text-[7px]"
                    >/{noteLabel(pendingBass.root, pendingBass.accidental)}</span
                  >
                  <button
                    type="button"
                    class="text-[6px] underline decoration-dotted underline-offset-2"
                    onclick={() => (pendingBass = null)}
                  >
                    clear
                  </button>
                {/if}
              </div>
              <div class="grid w-full grid-cols-6 gap-px" aria-label="Bass note">
                {#each BASS_PITCH_CLASSES as pc (pc)}
                  {@const br = pitchClassToRootAcc(pc, preferFlats)}
                  <button
                    type="button"
                    class="border-input bg-muted/40 text-foreground hover:bg-muted max-w-full truncate rounded border px-0 py-0.5 font-mono text-[8px] leading-none"
                    onclick={() => pickBass(pc)}
                    title="Bass {noteLabel(br.root, br.accidental)}"
                  >
                    {noteLabel(br.root, br.accidental)}
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          {#each triads as triad, d (d)}
            {@const roman = diatonicDegreeRomanLabel(songKey, d)}
            {@const vars = variationsFor(d)}
            {@const extra = vars.slice(1)}
            {@const secDom = dominantSeventhOfChordRoot(triad, preferFlats)}
            {@const subDom = tritoneSubOfDominantSeventh(secDom, preferFlats)}

            <div class="group/row relative h-7 min-h-7 shrink-0 overflow-visible">
              <div
                class="border-input bg-popover text-popover-foreground pointer-events-none absolute top-0 right-full z-[79] mr-1 flex h-7 min-h-7 min-w-max items-stretch gap-1 rounded-md border px-1 opacity-0 shadow-md ring-1 ring-foreground/10 transition-[opacity,transform] duration-150 ease-out group-hover/row:pointer-events-auto group-hover/row:translate-x-0 group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:translate-x-0 group-focus-within/row:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:translate-x-0 [@media(hover:none)]:opacity-100"
                style="transform: translateX(6px);"
                aria-label="Secondary dominant and tritone sub for {roman}"
              >
                <button
                  type="button"
                  class="border-input bg-background text-foreground hover:bg-muted focus-visible:ring-ring flex h-full max-w-[4.5rem] shrink-0 cursor-pointer flex-col items-center justify-center rounded border px-1 py-0 font-mono text-[8px] leading-tight focus-visible:ring-2 focus-visible:outline-none"
                  onclick={() => pick(secDom)}
                  title="V⁷ of {labelFor(triad)} → {labelFor(secDom)}"
                >
                  <span class="text-muted-foreground text-[6px]">V⁷</span>
                  <span class="block max-w-full truncate">{labelFor(secDom)}</span>
                </button>
                <button
                  type="button"
                  class="border-input bg-background text-foreground hover:bg-muted focus-visible:ring-ring flex h-full max-w-[4.5rem] shrink-0 cursor-pointer flex-col items-center justify-center rounded border px-1 py-0 font-mono text-[8px] leading-tight focus-visible:ring-2 focus-visible:outline-none"
                  onclick={() => pick(subDom)}
                  title="Tritone sub of {labelFor(secDom)} → {labelFor(subDom)}"
                >
                  <span class="text-muted-foreground text-[6px]">sub</span>
                  <span class="block max-w-full truncate">{labelFor(subDom)}</span>
                </button>
              </div>

              <button
                type="button"
                class="border-input bg-secondary text-secondary-foreground hover:bg-secondary/90 focus-visible:ring-ring box-border flex h-full w-full cursor-pointer flex-col items-center justify-center overflow-hidden border-b p-0 font-mono leading-none last:border-b-0 focus-visible:ring-2 focus-visible:outline-none"
                onclick={() => pick(triad)}
                title="Set {labelFor(triad)} ({roman})"
              >
                <span class="max-w-full truncate px-0.5 text-[9px] leading-none">{labelFor(triad)}</span>
                <span class="text-muted-foreground max-w-full truncate px-0.5 text-[6px] leading-none">
                  {roman}
                </span>
              </button>

              {#if extra.length > 0}
                <div
                  class="border-input bg-popover text-popover-foreground pointer-events-none absolute top-0 left-full z-[80] ml-1 flex h-7 min-h-7 min-w-max items-stretch gap-1 rounded-md border px-1 opacity-0 shadow-md ring-1 ring-foreground/10 transition-[opacity,transform] duration-150 ease-out group-hover/row:pointer-events-auto group-hover/row:translate-x-0 group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:translate-x-0 group-focus-within/row:opacity-100"
                  style="transform: translateX(-6px);"
                  aria-label="Alternates for {roman}"
                >
                  {#each extra as v, vi (`${d}-${vi}`)}
                    <button
                      type="button"
                      class="border-input bg-background text-foreground hover:bg-muted focus-visible:ring-ring h-full max-w-[5.5rem] shrink-0 cursor-pointer rounded border px-2 font-mono text-[11px] leading-none focus-visible:ring-2 focus-visible:outline-none"
                      onclick={() => pick(v)}
                      title={labelFor(v)}
                    >
                      <span class="block truncate">{labelFor(v)}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}

          <div class="group/type relative h-7 min-h-7 shrink-0 overflow-visible border-t">
            <input
              id="chord-query-input"
              bind:this={inputEl}
              bind:value={query}
              data-chord-query
              type="text"
              autocomplete="off"
              spellcheck={false}
              placeholder="Type"
              onkeydown={onInputKeydown}
              class="bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring h-full w-full rounded-none border-0 px-1.5 py-0 font-mono text-[10px] outline-none focus-visible:ring-2"
              aria-label="Type custom chord"
            />

            {#if showCustomSuggestions}
              <div
                class="border-input bg-popover text-popover-foreground pointer-events-none absolute top-0 left-full z-[90] ml-1 flex h-7 min-h-7 max-w-[min(20rem,calc(100vw-4rem))] min-w-0 flex-nowrap items-stretch gap-1 overflow-x-auto overflow-y-hidden rounded-md border px-1 opacity-0 shadow-md ring-1 ring-foreground/10 transition-[opacity,transform] duration-150 ease-out group-hover/type:pointer-events-auto group-hover/type:translate-x-0 group-hover/type:opacity-100 group-focus-within/type:pointer-events-auto group-focus-within/type:translate-x-0 group-focus-within/type:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:translate-x-0 [@media(hover:none)]:opacity-100"
                style="transform: translateX(-6px);"
                role="listbox"
                aria-label="Typed chord suggestions"
              >
                {#if suggestions.length > 0}
                  {#each suggestions as s, i (s.label)}
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === highlightIndex}
                      class="border-input bg-background text-foreground hover:bg-muted focus-visible:ring-ring flex h-full max-w-[6.5rem] shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded border px-1.5 py-0 font-mono text-[10px] leading-tight focus-visible:ring-2 focus-visible:outline-none {i ===
                      highlightIndex
                        ? 'bg-muted ring-ring ring-1'
                        : ''}"
                      onclick={() => pick(s.chord)}
                      title={`${s.inKey ? 'In key' : 'Outside key'} · ${s.label}`}
                    >
                      <span class="max-w-full truncate">{s.label}</span>
                      <span
                        class="size-1.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/20 {s.inKey
                          ? 'bg-emerald-500'
                          : 'bg-orange-500'}"
                        aria-hidden="true"
                      ></span>
                    </button>
                  {/each}
                {:else}
                  <div
                    class="text-muted-foreground flex h-full min-w-[8rem] items-center px-2 text-[10px] whitespace-nowrap"
                    role="status"
                  >
                    No matches
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          {#if onClearChord}
            <button
              type="button"
              class="text-muted-foreground hover:bg-destructive/15 hover:text-destructive border-input mt-px flex h-6 w-full cursor-pointer items-center justify-center border-t border-dashed font-mono text-[9px] leading-none"
              onclick={clearChord}
            >
              No chord
            </button>
          {/if}
        </div>
        </div>
      </div>
    {:else}
      <div class="bg-popover text-muted-foreground border-input rounded-md border px-3 py-2 text-xs shadow-md">
        Select a beat on the strip first.
      </div>
    {/if}
  </Popover.Content>
</Popover.Root>