/**
 * The Drummer-style editor, in real Chromium — the store wiring, the section
 * strip's inherit/override behaviour, and the XY pad's pointer handling are
 * all things a mocked DOM would not catch. The strip's proportional layout in
 * particular needs real box metrics.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { get } from 'svelte/store'
import DrumMachinePanel from './DrumMachinePanel.svelte'
import { songMap } from '$lib/stores/songMap'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { Section, SongMap } from '$lib/songmap/types'

function section(id: string, kind: Section['kind'], label: string): Section {
  return { id, kind, label, barRange: { startBarIndex: 0, endBarIndex: 3 } }
}

/** 8 bars, so the strip has real widths to lay sections out against. */
function withBars(sm: SongMap, barCount = 8): SongMap {
  const bars = Array.from({ length: barCount }, (_, i) => ({
    id: `bar${i}`,
    index: i,
    startSec: i,
    endSec: i + 1,
    meter: { numerator: 4, denominator: 4 },
    beatCount: 4,
    beatIds: [0, 1, 2, 3].map((j) => `b${i}_${j}`),
  }))
  const beats = bars.flatMap((b, i) =>
    [0, 1, 2, 3].map((j) => ({
      id: `b${i}_${j}`,
      barId: b.id,
      indexInBar: j,
      timeSec: i + j / 4,
    })),
  )
  return { ...sm, timeline: { bars, beats } }
}

const withSections: SongMap = {
  ...withBars(createEmptySongMap()),
  sections: [
    { ...section('v1', 'verse', 'Verse 1'), barRange: { startBarIndex: 0, endBarIndex: 3 } },
    { ...section('c1', 'chorus', 'Chorus 1'), barRange: { startBarIndex: 4, endBarIndex: 7 } },
  ],
}

beforeEach(() => {
  songMap.set(structuredClone(withSections))
})

describe('DrumMachinePanel', () => {
  it('renders nothing to edit when the song has no drum machine track', async () => {
    const screen = render(DrumMachinePanel, {})
    await expect.element(screen.getByText(/no drum machine track/i)).toBeInTheDocument()
  })

  it('selecting a style writes it song-wide', async () => {
    songMap.set({
      ...structuredClone(withSections),
      drumMachine: { enabled: true, style: 'rock' },
    })
    const screen = render(DrumMachinePanel, {})

    await screen.getByRole('radio', { name: 'Funk' }).click()
    expect(get(songMap)?.drumMachine?.style).toBe('funk')
    // Song-wide edits must not silently create per-section overrides.
    expect(get(songMap)?.drumMachine?.perSection).toBeUndefined()
  })

  it('editing while a section is scoped writes an override, not the song value', async () => {
    songMap.set({
      ...structuredClone(withSections),
      drumMachine: { enabled: true, style: 'rock' },
    })
    const screen = render(DrumMachinePanel, {})

    await screen.getByRole('tab', { name: /Chorus 1/ }).click()
    await screen.getByRole('radio', { name: 'Ballad' }).click()

    const machine = get(songMap)!.drumMachine!
    expect(machine.style).toBe('rock') // song untouched
    expect(machine.perSection?.c1?.style).toBe('ballad')
    expect(machine.perSection?.v1).toBeUndefined() // sibling untouched
  })

  it('"Follow song" clears the override and is only offered when one exists', async () => {
    songMap.set({
      ...structuredClone(withSections),
      drumMachine: { enabled: true, style: 'rock', perSection: { c1: { style: 'disco' } } },
    })
    const screen = render(DrumMachinePanel, {})
    await screen.getByRole('tab', { name: /Chorus 1/ }).click()

    const follow = screen.getByRole('button', { name: /follow song/i })
    await expect.element(follow).toBeInTheDocument()
    await follow.click()

    expect(get(songMap)!.drumMachine!.perSection).toBeUndefined()
    // With nothing overridden, the affordance goes away.
    await expect.element(screen.getByRole('button', { name: /follow song/i })).not.toBeInTheDocument()
  })

  it('the XY pad writes complexity and loudness from a real pointer drag', async () => {
    songMap.set({
      ...structuredClone(withSections),
      drumMachine: { enabled: true, style: 'rock', complexity: 0.5, loudness: 0.5 },
    })
    const screen = render(DrumMachinePanel, {})
    const pad = screen.getByRole('slider', { name: /complexity and loudness/i })
    await expect.element(pad).toBeInTheDocument()

    const el = (await pad.element()) as HTMLElement
    el.setPointerCapture = () => {}
    el.releasePointerCapture = () => {}
    const r = el.getBoundingClientRect()
    const press = (clientX: number, clientY: number) => {
      const opts = { bubbles: true, clientX, clientY, pointerId: 1 }
      el.dispatchEvent(new PointerEvent('pointerdown', opts))
      el.dispatchEvent(new PointerEvent('pointerup', opts))
    }

    // Top-right corner = fully complex, fully loud.
    press(r.right, r.top)
    expect(get(songMap)!.drumMachine!.complexity).toBe(1)
    expect(get(songMap)!.drumMachine!.loudness).toBe(1)

    // Bottom-left = simplest and softest, proving both axes really move.
    press(r.left, r.bottom)
    expect(get(songMap)!.drumMachine!.complexity).toBe(0)
    expect(get(songMap)!.drumMachine!.loudness).toBe(0)
  })

  it('the pad is keyboard-operable, not mouse-only', async () => {
    songMap.set({
      ...structuredClone(withSections),
      drumMachine: { enabled: true, style: 'rock', complexity: 0.5, loudness: 0.5 },
    })
    const screen = render(DrumMachinePanel, {})
    const el = (await screen
      .getByRole('slider', { name: /complexity and loudness/i })
      .element()) as HTMLElement

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(get(songMap)!.drumMachine!.complexity!).toBeGreaterThan(0.5)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(get(songMap)!.drumMachine!.loudness!).toBeLessThan(0.5)
  })

  it('lays every section out as a clickable tab, plus a whole-song tab', async () => {
    songMap.set({
      ...structuredClone(withSections),
      drumMachine: { enabled: true, style: 'rock' },
    })
    const screen = render(DrumMachinePanel, {})
    await expect.element(screen.getByRole('tab', { name: /Whole song/ })).toBeInTheDocument()
    await expect.element(screen.getByRole('tab', { name: /Verse 1/ })).toBeInTheDocument()
    await expect.element(screen.getByRole('tab', { name: /Chorus 1/ })).toBeInTheDocument()
  })

  it('sizes each section by its bar count, so the strip reads as the arrangement', async () => {
    // Verse = 2 bars, chorus = 6 → the chorus tab must be visibly wider.
    songMap.set({
      ...withBars(createEmptySongMap()),
      sections: [
        { ...section('v1', 'verse', 'Verse 1'), barRange: { startBarIndex: 0, endBarIndex: 1 } },
        { ...section('c1', 'chorus', 'Chorus 1'), barRange: { startBarIndex: 2, endBarIndex: 7 } },
      ],
      drumMachine: { enabled: true, style: 'rock' },
    })
    const screen = render(DrumMachinePanel, {})
    const verse = (await screen.getByRole('tab', { name: /Verse 1/ }).element()) as HTMLElement
    const chorus = (await screen.getByRole('tab', { name: /Chorus 1/ }).element()) as HTMLElement
    expect(chorus.getBoundingClientRect().width).toBeGreaterThan(
      verse.getBoundingClientRect().width,
    )
  })

  it('shows what each section plays, and marks only the edited one', async () => {
    songMap.set({
      ...structuredClone(withSections),
      drumMachine: { enabled: true, style: 'rock', perSection: { c1: { style: 'disco' } } },
    })
    const screen = render(DrumMachinePanel, {})
    // The chorus shows its own style; the verse shows the inherited one.
    await expect.element(screen.getByRole('tab', { name: /Chorus 1/ })).toHaveTextContent(
      'Four on the floor',
    )
    await expect.element(screen.getByRole('tab', { name: /Verse 1/ })).toHaveTextContent('Rock')
    // Only the overridden section carries the edited dot.
    const chorus = (await screen.getByRole('tab', { name: /Chorus 1/ }).element()) as HTMLElement
    const verse = (await screen.getByRole('tab', { name: /Verse 1/ }).element()) as HTMLElement
    expect(chorus.querySelector('[aria-label="edited"]')).not.toBeNull()
    expect(verse.querySelector('[aria-label="edited"]')).toBeNull()
  })

  it('marks a muted section as silent in the strip', async () => {
    songMap.set({
      ...structuredClone(withSections),
      drumMachine: { enabled: true, style: 'rock', perSection: { v1: { muted: true } } },
    })
    const screen = render(DrumMachinePanel, {})
    await expect.element(screen.getByRole('tab', { name: /Verse 1/ })).toHaveTextContent('silent')
  })

  it('selecting a section marks it as the selected tab', async () => {
    songMap.set({
      ...structuredClone(withSections),
      drumMachine: { enabled: true, style: 'rock' },
    })
    const screen = render(DrumMachinePanel, {})
    await screen.getByRole('tab', { name: /Chorus 1/ }).click()
    await expect
      .element(screen.getByRole('tab', { name: /Chorus 1/ }))
      .toHaveAttribute('aria-selected', 'true')
    await expect
      .element(screen.getByRole('tab', { name: /Whole song/ }))
      .toHaveAttribute('aria-selected', 'false')
  })

  it('switches the groove between hi-hat and ride', async () => {
    songMap.set({
      ...structuredClone(withSections),
      drumMachine: { enabled: true, style: 'rock' },
    })
    const screen = render(DrumMachinePanel, {})
    await screen.getByRole('radio', { name: 'Ride' }).click()
    expect(get(songMap)!.drumMachine!.pulse).toBe('ride')
    await screen.getByRole('radio', { name: 'None' }).click()
    expect(get(songMap)!.drumMachine!.pulse).toBe('none')
  })

  it('scopes the pulse choice to a section when one is selected', async () => {
    songMap.set({
      ...structuredClone(withSections),
      drumMachine: { enabled: true, style: 'rock', pulse: 'hihat' },
    })
    const screen = render(DrumMachinePanel, {})
    await screen.getByRole('tab', { name: /Chorus 1/ }).click()
    await screen.getByRole('radio', { name: 'Ride' }).click()

    const m = get(songMap)!.drumMachine!
    expect(m.pulse).toBe('hihat') // song untouched
    expect(m.perSection?.c1?.pulse).toBe('ride')
  })

  it('toggles kit pieces off and back on', async () => {
    songMap.set({
      ...structuredClone(withSections),
      drumMachine: { enabled: true, style: 'rock' },
    })
    const screen = render(DrumMachinePanel, {})
    const crash = screen.getByRole('button', { name: 'Crash' })
    await expect.element(crash).toHaveAttribute('aria-pressed', 'true')

    await crash.click()
    expect(get(songMap)!.drumMachine!.voices?.cymbal).toBe(false)
    await expect.element(crash).toHaveAttribute('aria-pressed', 'false')

    await crash.click()
    expect(get(songMap)!.drumMachine!.voices?.cymbal).toBe(true)
  })

  it('toggling one kit piece does not disturb the others', async () => {
    songMap.set({
      ...structuredClone(withSections),
      drumMachine: { enabled: true, style: 'rock', voices: { tom: false } },
    })
    const screen = render(DrumMachinePanel, {})
    await screen.getByRole('button', { name: 'Snare' }).click()

    const voices = get(songMap)!.drumMachine!.voices!
    expect(voices.snare).toBe(false)
    expect(voices.tom).toBe(false) // still off
  })

  it('removing the track drops the field entirely', async () => {
    songMap.set({
      ...structuredClone(withSections),
      drumMachine: { enabled: true, style: 'rock' },
    })
    const screen = render(DrumMachinePanel, {})
    await screen.getByTitle(/delete the drum machine track/i).click()

    expect(get(songMap)?.drumMachine).toBeUndefined()
    await expect.element(screen.getByText(/no drum machine track/i)).toBeInTheDocument()
  })
})
