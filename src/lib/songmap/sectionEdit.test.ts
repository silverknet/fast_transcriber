import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import { resizeSectionBoundary, resizeSectionRange, setSectionForBarRange } from './sectionEdit'
import type { Bar, SongMap } from './types'

function bar(index: number): Bar {
  return {
    id: `bar${index}`,
    index,
    startSec: index,
    endSec: index + 1,
    meter: { numerator: 4, denominator: 4 },
    beatCount: 4,
    beatIds: [],
  }
}

function mapWithBars(count: number): SongMap {
  const base = createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' })
  const bars: Bar[] = []
  for (let i = 0; i < count; i++) bars.push(bar(i))
  return { ...base, timeline: { bars, beats: [] } }
}

let idCounter = 0
const id = (): string => `s${++idCounter}`

describe('setSectionForBarRange — merge same-kind neighbors', () => {
  it('adjacent same-kind sections merge into a single union', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 3, 'chorus', id) as { map: SongMap }).map
    map = (setSectionForBarRange(map, 4, 7, 'chorus', id) as { map: SongMap }).map
    expect(map.sections).toHaveLength(1)
    expect(map.sections[0].kind).toBe('chorus')
    expect(map.sections[0].barRange).toEqual({ startBarIndex: 0, endBarIndex: 7 })
  })

  it('tagging an engulfing range over an existing same-kind section is a no-op for range', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 7, 'chorus', id) as { map: SongMap }).map
    map = (setSectionForBarRange(map, 2, 5, 'chorus', id) as { map: SongMap }).map
    expect(map.sections).toHaveLength(1)
    expect(map.sections[0].barRange).toEqual({ startBarIndex: 0, endBarIndex: 7 })
  })

  it('tagging beyond an existing same-kind section extends it', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 4, 7, 'chorus', id) as { map: SongMap }).map
    map = (setSectionForBarRange(map, 0, 5, 'chorus', id) as { map: SongMap }).map
    expect(map.sections).toHaveLength(1)
    expect(map.sections[0].barRange).toEqual({ startBarIndex: 0, endBarIndex: 7 })
  })

  it('different-kind adjacent sections stay separate', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 3, 'verse', id) as { map: SongMap }).map
    map = (setSectionForBarRange(map, 4, 7, 'chorus', id) as { map: SongMap }).map
    expect(map.sections).toHaveLength(2)
    const sorted = [...map.sections].sort(
      (a, b) => a.barRange.startBarIndex - b.barRange.startBarIndex,
    )
    expect(sorted[0].kind).toBe('verse')
    expect(sorted[0].barRange).toEqual({ startBarIndex: 0, endBarIndex: 3 })
    expect(sorted[1].kind).toBe('chorus')
    expect(sorted[1].barRange).toEqual({ startBarIndex: 4, endBarIndex: 7 })
  })

  it('different-kind overlap still drops the existing section (regression check)', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 7, 'chorus', id) as { map: SongMap }).map
    map = (setSectionForBarRange(map, 4, 5, 'verse', id) as { map: SongMap }).map
    expect(map.sections).toHaveLength(1)
    expect(map.sections[0].kind).toBe('verse')
    expect(map.sections[0].barRange).toEqual({ startBarIndex: 4, endBarIndex: 5 })
  })

  it('merging two same-kind sections with a same-kind section in the middle folds all three', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 1, 'chorus', id) as { map: SongMap }).map
    map = (setSectionForBarRange(map, 4, 5, 'chorus', id) as { map: SongMap }).map
    // Now tag a chorus 2-3 which borders both — should fold all three.
    map = (setSectionForBarRange(map, 2, 3, 'chorus', id) as { map: SongMap }).map
    expect(map.sections).toHaveLength(1)
    expect(map.sections[0].barRange).toEqual({ startBarIndex: 0, endBarIndex: 5 })
  })

  it('merged section inherits a custom label from a neighbor when no override is given', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 3, 'custom', id, 'Drop') as { map: SongMap }).map
    map = (setSectionForBarRange(map, 4, 7, 'custom', id) as { map: SongMap }).map
    expect(map.sections).toHaveLength(1)
    expect(map.sections[0].label).toBe('Drop')
    expect(map.sections[0].barRange).toEqual({ startBarIndex: 0, endBarIndex: 7 })
  })

  it('explicit label override wins over inherited neighbor label', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 3, 'custom', id, 'Drop') as { map: SongMap }).map
    map = (setSectionForBarRange(map, 4, 7, 'custom', id, 'Build') as { map: SongMap }).map
    expect(map.sections).toHaveLength(1)
    expect(map.sections[0].label).toBe('Build')
  })

  it('rejects invalid ranges', () => {
    const map = mapWithBars(0)
    const out = setSectionForBarRange(map, 0, 0, 'verse', id)
    expect(out.ok).toBe(false)
  })
})

describe('resizeSectionRange', () => {
  it('shrinks a section without nuking it', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 7, 'chorus', id) as { map: SongMap }).map
    const sectionId = map.sections[0].id
    map = (resizeSectionRange(map, sectionId, 0, 3) as { map: SongMap }).map
    expect(map.sections).toHaveLength(1)
    expect(map.sections[0].id).toBe(sectionId)
    expect(map.sections[0].barRange).toEqual({ startBarIndex: 0, endBarIndex: 3 })
  })

  it('extends a section to a new range', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 3, 'chorus', id) as { map: SongMap }).map
    const sectionId = map.sections[0].id
    map = (resizeSectionRange(map, sectionId, 0, 7) as { map: SongMap }).map
    expect(map.sections).toHaveLength(1)
    expect(map.sections[0].id).toBe(sectionId)
    expect(map.sections[0].barRange).toEqual({ startBarIndex: 0, endBarIndex: 7 })
  })

  it('preserves a custom label when resizing', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 3, 'custom', id, 'Drop') as { map: SongMap }).map
    const sectionId = map.sections[0].id
    map = (resizeSectionRange(map, sectionId, 0, 5) as { map: SongMap }).map
    expect(map.sections[0].label).toBe('Drop')
    expect(map.sections[0].barRange).toEqual({ startBarIndex: 0, endBarIndex: 5 })
  })

  it('drops different-kind overlap on extend', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 3, 'chorus', id) as { map: SongMap }).map
    map = (setSectionForBarRange(map, 8, 11, 'verse', id) as { map: SongMap }).map
    const chorusId = map.sections.find((s) => s.kind === 'chorus')!.id
    map = (resizeSectionRange(map, chorusId, 0, 9) as { map: SongMap }).map
    expect(map.sections).toHaveLength(1)
    expect(map.sections[0].kind).toBe('chorus')
    expect(map.sections[0].barRange).toEqual({ startBarIndex: 0, endBarIndex: 9 })
  })

  it('folds in a same-kind neighbor when extending across it', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 3, 'chorus', id) as { map: SongMap }).map
    map = (setSectionForBarRange(map, 8, 11, 'chorus', id) as { map: SongMap }).map
    const firstChorusId = map.sections.find((s) => s.barRange.startBarIndex === 0)!.id
    map = (resizeSectionRange(map, firstChorusId, 0, 9) as { map: SongMap }).map
    expect(map.sections).toHaveLength(1)
    expect(map.sections[0].id).toBe(firstChorusId)
    expect(map.sections[0].barRange).toEqual({ startBarIndex: 0, endBarIndex: 11 })
  })

  it('returns error for unknown section id', () => {
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 3, 'chorus', id) as { map: SongMap }).map
    const out = resizeSectionRange(map, 'nonexistent', 0, 5)
    expect(out.ok).toBe(false)
  })
})

describe('resizeSectionBoundary', () => {
  it('moves the boundary right: left grows, right shrinks', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 3, 'verse', id) as { map: SongMap }).map
    map = (setSectionForBarRange(map, 4, 7, 'chorus', id) as { map: SongMap }).map
    const verseId = map.sections.find((s) => s.kind === 'verse')!.id
    const chorusId = map.sections.find((s) => s.kind === 'chorus')!.id
    map = (resizeSectionBoundary(map, verseId, chorusId, 6) as { map: SongMap }).map
    expect(map.sections).toHaveLength(2)
    const verse = map.sections.find((s) => s.id === verseId)!
    const chorus = map.sections.find((s) => s.id === chorusId)!
    expect(verse.barRange).toEqual({ startBarIndex: 0, endBarIndex: 5 })
    expect(chorus.barRange).toEqual({ startBarIndex: 6, endBarIndex: 7 })
  })

  it('moves the boundary left: left shrinks, right grows', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 3, 'verse', id) as { map: SongMap }).map
    map = (setSectionForBarRange(map, 4, 7, 'chorus', id) as { map: SongMap }).map
    const verseId = map.sections.find((s) => s.kind === 'verse')!.id
    const chorusId = map.sections.find((s) => s.kind === 'chorus')!.id
    map = (resizeSectionBoundary(map, verseId, chorusId, 2) as { map: SongMap }).map
    const verse = map.sections.find((s) => s.id === verseId)!
    const chorus = map.sections.find((s) => s.id === chorusId)!
    expect(verse.barRange).toEqual({ startBarIndex: 0, endBarIndex: 1 })
    expect(chorus.barRange).toEqual({ startBarIndex: 2, endBarIndex: 7 })
  })

  it('clamps so left section stays at least 1 bar wide', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 3, 'verse', id) as { map: SongMap }).map
    map = (setSectionForBarRange(map, 4, 7, 'chorus', id) as { map: SongMap }).map
    const verseId = map.sections.find((s) => s.kind === 'verse')!.id
    const chorusId = map.sections.find((s) => s.kind === 'chorus')!.id
    // boundary at 0 would make verse 0 bars wide — clamp to 1.
    map = (resizeSectionBoundary(map, verseId, chorusId, 0) as { map: SongMap }).map
    const verse = map.sections.find((s) => s.id === verseId)!
    expect(verse.barRange).toEqual({ startBarIndex: 0, endBarIndex: 0 })
  })

  it('clamps so right section stays at least 1 bar wide', () => {
    idCounter = 0
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 3, 'verse', id) as { map: SongMap }).map
    map = (setSectionForBarRange(map, 4, 7, 'chorus', id) as { map: SongMap }).map
    const verseId = map.sections.find((s) => s.kind === 'verse')!.id
    const chorusId = map.sections.find((s) => s.kind === 'chorus')!.id
    // boundary at 8 would make chorus 0 bars wide — clamp to 7.
    map = (resizeSectionBoundary(map, verseId, chorusId, 8) as { map: SongMap }).map
    const chorus = map.sections.find((s) => s.id === chorusId)!
    expect(chorus.barRange).toEqual({ startBarIndex: 7, endBarIndex: 7 })
  })

  it('returns error when either section id is unknown', () => {
    let map = mapWithBars(16)
    map = (setSectionForBarRange(map, 0, 3, 'verse', id) as { map: SongMap }).map
    const out = resizeSectionBoundary(map, 'missing', 'alsoMissing', 2)
    expect(out.ok).toBe(false)
  })
})

