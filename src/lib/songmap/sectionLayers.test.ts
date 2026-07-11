import { describe, expect, it } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from './version'
import { parseSongMap } from './parse'
import { validateSongMap } from './validate'
import {
  activeSectionLayoutName,
  deleteSectionLayer,
  stashActiveSections,
  switchToSectionLayer,
} from './sectionLayers'
import type { Bar, Beat, Section, SongMap } from './types'

function buildMap(opts?: { sections?: Section[] }): SongMap {
  const bars: Bar[] = []
  const beats: Beat[] = []
  for (let i = 0; i < 8; i++) {
    bars.push({
      id: `bar${i}`,
      index: i,
      startSec: i,
      endSec: i + 1,
      meter: { numerator: 4, denominator: 4 },
      beatCount: 4,
      beatIds: [0, 1, 2, 3].map((j) => `b${i}_${j}`),
    })
    for (let j = 0; j < 4; j++) {
      beats.push({ id: `b${i}_${j}`, barId: `bar${i}`, indexInBar: j, timeSec: i + j / 4 })
    }
  }
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 't',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    timeline: { bars, beats },
    harmony: [],
    sections: opts?.sections ?? [],
    cueTracks: [],
  } as unknown as SongMap
}

function sec(id: string, kind: Section['kind'], start: number, end: number): Section {
  return { id, kind, label: kind, barRange: { startBarIndex: start, endBarIndex: end } }
}

let n = 0
const newId = () => `slayer${n++}`

describe('sectionLayers helpers', () => {
  it('stash + switch conserve both layouts (round trip)', () => {
    let map = buildMap({ sections: [sec('a', 'verse', 0, 3), sec('b', 'chorus', 4, 7)] })
    map = stashActiveSections(map, newId, { name: 'My sections' })
    map = {
      ...map,
      sections: [sec('c', 'intro', 0, 1), sec('d', 'verse', 2, 7)],
      activeSectionLayerName: 'Sheet import',
    }

    const r = switchToSectionLayer(map, map.sectionLayers![0]!.id, newId)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.map.sections.map((s) => s.id)).toEqual(['a', 'b'])
    expect(activeSectionLayoutName(r.map)).toBe('My sections')
    expect(r.map.sectionLayers).toHaveLength(1)
    expect(r.map.sectionLayers![0]!.name).toBe('Sheet import')

    const back = switchToSectionLayer(r.map, r.map.sectionLayers![0]!.id, newId)
    expect(back.ok && back.map.sections.map((s) => s.id)).toEqual(['c', 'd'])
  })

  it('stash no-ops on empty; delete removes only the layer; names de-dup', () => {
    const empty = buildMap()
    expect(stashActiveSections(empty, newId)).toBe(empty)

    let map = buildMap({ sections: [sec('a', 'verse', 0, 7)] })
    map = stashActiveSections(map, newId, { name: 'X' })
    map = stashActiveSections(map, newId, { name: 'X' })
    expect(map.sectionLayers!.map((l) => l.name)).toEqual(['X', 'X 2'])
    const cleared = deleteSectionLayer(map, map.sectionLayers![0]!.id)
    expect(cleared.sectionLayers).toHaveLength(1)
    expect(cleared.sections).toHaveLength(1)
  })
})

describe('sectionLayers schema (v5)', () => {
  it('survives a parse round-trip and validates', () => {
    let map = buildMap({ sections: [sec('a', 'verse', 0, 7)] })
    map = stashActiveSections(map, newId, { name: 'My sections', source: 'sheet-import' })
    map = { ...map, activeSectionLayerName: 'Sheet import' }

    const parsed = parseSongMap(JSON.stringify(map))
    expect(parsed.sectionLayers).toHaveLength(1)
    expect(parsed.sectionLayers![0]!.name).toBe('My sections')
    expect(parsed.sectionLayers![0]!.sections).toHaveLength(1)
    expect(parsed.activeSectionLayerName).toBe('Sheet import')
    expect(validateSongMap(parsed).errors).toEqual([])
  })
})
