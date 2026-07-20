import { describe, expect, it } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from './version'
import { parseSongMap } from './parse'
import { validateSongMap } from './validate'
import {
  activeChordTrackName,
  deleteChordLayer,
  stashActiveChords,
  switchToChordLayer,
} from './chordLayers'
import type { Bar, Beat, HarmonyEvent, SongMap } from './types'

function buildMap(opts?: { harmony?: HarmonyEvent[] }): SongMap {
  const bars: Bar[] = [
    {
      id: 'bar0',
      index: 0,
      startSec: 0,
      endSec: 1,
      meter: { numerator: 4, denominator: 4 },
      beatCount: 4,
      beatIds: ['b0', 'b1', 'b2', 'b3'],
    },
  ]
  const beats: Beat[] = [0, 1, 2, 3].map((j) => ({
    id: `b${j}`,
    barId: 'bar0',
    indexInBar: j,
    timeSec: j / 4,
  }))
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 't',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    timeline: { bars, beats },
    harmony: opts?.harmony ?? [],
    sections: [],
    cueTracks: [],
  } as unknown as SongMap
}

function h(beatId: string, root: string): HarmonyEvent {
  const idx = Number(beatId.slice(1))
  return {
    id: `h-${beatId}-${root}`,
    barId: 'bar0',
    beatId,
    startSec: idx / 4,
    endSec: idx / 4 + 0.25,
    chord: { root: root as HarmonyEvent['chord']['root'], quality: 'major', displayRaw: root },
  }
}

let n = 0
const newId = () => `layer${n++}`

describe('chordLayers helpers', () => {
  it('stashActiveChords snapshots harmony into a layer; no-op when empty', () => {
    const empty = buildMap()
    expect(stashActiveChords(empty, newId)).toBe(empty)

    const map = buildMap({ harmony: [h('b0', 'C'), h('b2', 'G')] })
    const out = stashActiveChords(map, newId, { name: 'My chords' })
    expect(out.chordLayers).toHaveLength(1)
    expect(out.chordLayers![0]!.name).toBe('My chords')
    expect(out.chordLayers![0]!.harmony).toHaveLength(2)
    expect(out.harmony).toHaveLength(2) // active untouched by a stash
  })

  it('stash de-duplicates layer names (for DIFFERENT content)', () => {
    let map = buildMap({ harmony: [h('b0', 'C')] })
    map = stashActiveChords(map, newId, { name: 'My chords' })
    map = { ...map, harmony: [h('b0', 'G')] } // content changed since the stash
    map = stashActiveChords(map, newId, { name: 'My chords' })
    expect(map.chordLayers!.map((l) => l.name)).toEqual(['My chords', 'My chords 2'])
  })

  it('switchToChordLayer swaps and conserves both chord sets', () => {
    let map = buildMap({ harmony: [h('b0', 'C'), h('b2', 'G')] })
    map = stashActiveChords(map, newId, { name: 'My chords' })
    // Pretend a sheet import replaced the active chords.
    map = { ...map, harmony: [h('b0', 'A'), h('b1', 'D')], activeChordLayerName: 'Sheet import' }

    const layerId = map.chordLayers![0]!.id
    const r = switchToChordLayer(map, layerId, newId)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // The old manual chords are active again…
    expect(r.map.harmony.map((x) => x.chord.displayRaw).sort()).toEqual(['C', 'G'])
    expect(activeChordTrackName(r.map)).toBe('My chords')
    // …and the sheet chords are preserved as a layer.
    expect(r.map.chordLayers).toHaveLength(1)
    expect(r.map.chordLayers![0]!.name).toBe('Sheet import')
    expect(r.map.chordLayers![0]!.harmony.map((x) => x.chord.displayRaw).sort()).toEqual(['A', 'D'])

    // Round-trip back.
    const back = switchToChordLayer(r.map, r.map.chordLayers![0]!.id, newId)
    expect(back.ok && back.map.harmony.map((x) => x.chord.displayRaw).sort()).toEqual(['A', 'D'])
  })

  it('stash and switch skip duplicating content-identical layers', () => {
    let map = buildMap({ harmony: [h('b0', 'C')] })
    map = stashActiveChords(map, newId, { name: 'My chords' })
    // Stashing the SAME active content again is a no-op.
    const again = stashActiveChords(map, newId, { name: 'Whatever' })
    expect(again.chordLayers).toHaveLength(1)
    // Switching to a content-identical layer doesn't re-stash the active set
    // — repeated flips must not pile up "Sheet import 2/3…" duplicates.
    const r = switchToChordLayer(map, map.chordLayers![0]!.id, newId)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.map.chordLayers ?? []).toHaveLength(0)
  })

  it('switch to unknown layer refuses; delete removes only the layer', () => {
    let map = buildMap({ harmony: [h('b0', 'C')] })
    map = stashActiveChords(map, newId)
    expect(switchToChordLayer(map, 'nope', newId).ok).toBe(false)
    const cleared = deleteChordLayer(map, map.chordLayers![0]!.id)
    expect(cleared.chordLayers).toBeUndefined()
    expect(cleared.harmony).toHaveLength(1)
  })
})

describe('chordLayers schema (v5)', () => {
  it('survives a parse round-trip and validates', () => {
    let map = buildMap({ harmony: [h('b0', 'C')] })
    map = stashActiveChords(map, newId, { name: 'My chords', source: 'manual' })
    map = { ...map, activeChordLayerName: 'Sheet import' }

    const parsed = parseSongMap(JSON.stringify(map))
    expect(parsed.chordLayers).toHaveLength(1)
    expect(parsed.chordLayers![0]!.name).toBe('My chords')
    expect(parsed.chordLayers![0]!.source).toBe('manual')
    expect(parsed.chordLayers![0]!.harmony).toHaveLength(1)
    expect(parsed.activeChordLayerName).toBe('Sheet import')

    const v = validateSongMap(parsed)
    expect(v.errors).toEqual([])
  })

  it('v4 files (no layers) still load', () => {
    const map = buildMap() as unknown as Record<string, unknown>
    map.formatVersion = 4
    const parsed = parseSongMap(JSON.stringify(map))
    expect(parsed.formatVersion).toBe(SONGMAP_FORMAT_VERSION)
    expect(parsed.chordLayers).toBeUndefined()
  })

  it('rejects duplicate layer ids and layers without names', () => {
    let map = buildMap({ harmony: [h('b0', 'C')] })
    map = stashActiveChords(map, () => 'dup')
    map = { ...map, chordLayers: [...map.chordLayers!, { ...map.chordLayers![0]! }] }
    const v = validateSongMap(map)
    expect(v.errors.some((e) => e.includes('duplicate layer id'))).toBe(true)
  })
})
