/**
 * The bass machine editor in real Chromium — store wiring and the shared
 * section strip's inherit/override behaviour.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { get } from 'svelte/store'
import BassMachinePanel from './BassMachinePanel.svelte'
import { songMap } from '$lib/stores/songMap'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { Section, SongMap } from '$lib/songmap/types'

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
    [0, 1, 2, 3].map((j) => ({ id: `b${i}_${j}`, barId: b.id, indexInBar: j, timeSec: i + j / 4 })),
  )
  return { ...sm, timeline: { bars, beats } }
}

function section(id: string, kind: Section['kind'], label: string, s: number, e: number): Section {
  return { id, kind, label, barRange: { startBarIndex: s, endBarIndex: e } }
}

const base: SongMap = {
  ...withBars(createEmptySongMap()),
  sections: [
    section('v1', 'verse', 'Verse 1', 0, 3),
    section('c1', 'chorus', 'Chorus 1', 4, 7),
  ],
}

const withTrack: SongMap = { ...base, bassMachine: { enabled: true, style: 'roots' } }

beforeEach(() => {
  songMap.set(structuredClone(base))
})

describe('BassMachinePanel', () => {
  it('renders nothing to edit when the song has no bass machine track', async () => {
    const screen = render(BassMachinePanel, {})
    await expect.element(screen.getByText(/no bass machine track/i)).toBeInTheDocument()
  })

  it('selecting a style writes it song-wide', async () => {
    songMap.set(structuredClone(withTrack))
    const screen = render(BassMachinePanel, {})
    await screen.getByRole('radio', { name: 'Walking' }).click()
    expect(get(songMap)!.bassMachine!.style).toBe('walking')
    expect(get(songMap)!.bassMachine!.perSection).toBeUndefined()
  })

  it('editing while a section is scoped writes an override, not the song value', async () => {
    songMap.set(structuredClone(withTrack))
    const screen = render(BassMachinePanel, {})
    await screen.getByRole('tab', { name: /Chorus 1/ }).click()
    await screen.getByRole('radio', { name: 'Octaves' }).click()

    const m = get(songMap)!.bassMachine!
    expect(m.style).toBe('roots')
    expect(m.perSection?.c1?.style).toBe('octaves')
    expect(m.perSection?.v1).toBeUndefined()
  })

  it('shifts the line by whole octaves', async () => {
    songMap.set(structuredClone(withTrack))
    const screen = render(BassMachinePanel, {})
    await screen.getByRole('radio', { name: '+1' }).click()
    expect(get(songMap)!.bassMachine!.octave).toBe(1)
  })

  it('"Follow song" clears a section override', async () => {
    songMap.set({
      ...base,
      bassMachine: { enabled: true, style: 'roots', perSection: { c1: { style: 'pedal' } } },
    })
    const screen = render(BassMachinePanel, {})
    await screen.getByRole('tab', { name: /Chorus 1/ }).click()
    await screen.getByRole('button', { name: /follow song/i }).click()
    expect(get(songMap)!.bassMachine!.perSection).toBeUndefined()
  })

  it('shows each section what it plays, marking only the edited one', async () => {
    songMap.set({
      ...base,
      bassMachine: { enabled: true, style: 'roots', perSection: { c1: { style: 'octaves' } } },
    })
    const screen = render(BassMachinePanel, {})
    await expect.element(screen.getByRole('tab', { name: /Chorus 1/ })).toHaveTextContent('Octaves')
    await expect.element(screen.getByRole('tab', { name: /Verse 1/ })).toHaveTextContent('Roots')
    const chorus = (await screen.getByRole('tab', { name: /Chorus 1/ }).element()) as HTMLElement
    const verse = (await screen.getByRole('tab', { name: /Verse 1/ }).element()) as HTMLElement
    expect(chorus.querySelector('[aria-label="edited"]')).not.toBeNull()
    expect(verse.querySelector('[aria-label="edited"]')).toBeNull()
  })

  it('says so when there are no chords to play from', async () => {
    songMap.set(structuredClone(withTrack))
    const screen = render(BassMachinePanel, {})
    await expect.element(screen.getByText(/no chords yet/i)).toBeInTheDocument()
  })

  it('starts on the default sound with nothing stored', async () => {
    songMap.set(structuredClone(withTrack))
    const screen = render(BassMachinePanel, {})
    await expect
      .element(screen.getByRole('combobox', { name: /bass sound/i }))
      .toHaveValue('finger')
    expect(get(songMap)!.bassMachine!.sound).toBeUndefined()
  })

  it('offers both synth and sampled sounds in one picker', async () => {
    songMap.set(structuredClone(withTrack))
    const screen = render(BassMachinePanel, {})
    const select = (await screen
      .getByRole('combobox', { name: /bass sound/i })
      .element()) as HTMLSelectElement
    const groups = [...select.querySelectorAll('optgroup')].map((g) => g.label)
    expect(groups).toContain('BarBro synth')
    expect(groups).toContain('Sampled')
    const ids = [...select.options].map((o) => o.value)
    expect(ids).toContain('moog')
    expect(ids).toContain('upright')
  })

  it('choosing a sound stores just the id, not a whole patch', async () => {
    songMap.set(structuredClone(withTrack))
    const screen = render(BassMachinePanel, {})
    await screen.getByRole('combobox', { name: /bass sound/i }).selectOptions('growl')
    expect(get(songMap)!.bassMachine!.sound).toBe('growl')
    // The sound IS the patch — no need to copy its knobs into the song.
    expect(get(songMap)!.bassMachine!.tone).toBeUndefined()
  })

  it('the sound is song-wide — one bass player, one bass', async () => {
    songMap.set(structuredClone(withTrack))
    const screen = render(BassMachinePanel, {})
    await screen.getByRole('tab', { name: /Chorus 1/ }).click()
    await screen.getByRole('combobox', { name: /bass sound/i }).selectOptions('sub')

    const m = get(songMap)!.bassMachine!
    expect(m.sound).toBe('sub')
    expect(m.perSection?.c1).toBeUndefined()
  })

  it('knob tweaks layer on the chosen sound, and reset clears them', async () => {
    songMap.set({ ...base, bassMachine: { enabled: true, style: 'roots', sound: 'moog' } })
    const screen = render(BassMachinePanel, {})
    const tone = screen.getByRole('slider', { name: /filter cutoff/i })
    await expect.element(tone).toBeInTheDocument()

    const el = (await tone.element()) as HTMLInputElement
    el.value = '1200'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    expect(get(songMap)!.bassMachine!.tone?.cutoffHz).toBe(1200)
    expect(get(songMap)!.bassMachine!.sound).toBe('moog') // sound unchanged

    await screen.getByTitle(/back to this sound/i).click()
    expect(get(songMap)!.bassMachine!.tone).toBeUndefined()
  })

  it('removing the track drops the field entirely', async () => {
    songMap.set(structuredClone(withTrack))
    const screen = render(BassMachinePanel, {})
    await screen.getByTitle(/delete the bass machine track/i).click()
    expect(get(songMap)?.bassMachine).toBeUndefined()
  })
})
