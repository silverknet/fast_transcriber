/**
 * The project health check — written against REAL damage found in a real
 * project, not hypotheticals: "Love Never Felt So Good" carried a saved-muted
 * click and cue tracks whose performer links had evaporated (the parser
 * whitelist class, from before the round-trip fix).
 */
import { describe, expect, it } from 'vitest'
import { checkSongMapHealth } from './projectHealth'
import { createEmptySongMap } from '$lib/songmap/factory'
import { serializeSongMap } from '$lib/songmap/serialize'
import type { SongMap } from '$lib/songmap/types'

function analysedSong(): SongMap {
  const bars = Array.from({ length: 4 }, (_, i) => ({
    id: `bar${i}`,
    index: i,
    startSec: i * 2,
    endSec: (i + 1) * 2,
    meter: { numerator: 4, denominator: 4 },
    beatCount: 4,
    beatIds: Array.from({ length: 4 }, (_, k) => `b${i}_${k}`),
  }))
  const beats = bars.flatMap((bar, bi) =>
    Array.from({ length: 4 }, (_, k) => ({
      id: `b${bi}_${k}`,
      barId: bar.id,
      indexInBar: k,
      timeSec: bar.startSec + k * 0.5,
    })),
  )
  const sm = createEmptySongMap()
  return {
    ...sm,
    metadata: { ...sm.metadata, title: 'T' },
    audio: { ...sm.audio, fileName: 'x.wav', source: 'upload', trim: { startSec: 0, endSec: 8 } },
    timeline: { ...sm.timeline, bars, beats },
  } as SongMap
}

const asJson = (sm: SongMap) => serializeSongMap(sm)

describe('a healthy song reports nothing', () => {
  it('clean analysed song → zero findings', () => {
    expect(checkSongMapHealth(asJson(analysedSong()))).toEqual([])
  })

  it('a stub song (no audio, no grid) is not "broken" — it is just new', () => {
    const sm = createEmptySongMap()
    const findings = checkSongMapHealth(asJson(sm))
    expect(findings.filter((f) => f.severity === 'broken')).toEqual([])
  })
})

describe('the whitelist class — data a load would silently lose', () => {
  it('flags an unknown top-level key as LOSSY, in plain words', () => {
    const raw = JSON.parse(asJson(analysedSong())) as Record<string, unknown>
    raw.futureFeatureBlock = { important: true }
    const findings = checkSongMapHealth(JSON.stringify(raw))
    const lossy = findings.find((f) => f.code === 'lossy-load')
    expect(lossy, 'a key the parser drops must be reported').toBeDefined()
    expect(lossy!.severity).toBe('broken')
    expect(lossy!.message).toMatch(/futureFeatureBlock/)
    expect(lossy!.message).toMatch(/silently delete/)
  })

  it('flags a cue-track field a load would drop', () => {
    const sm = analysedSong()
    const withTrack: SongMap = {
      ...sm,
      cueTracks: [{ id: 't1', name: 'T', enabled: true, events: [], suppressedGeneratedKeys: [] }],
    }
    const raw = JSON.parse(asJson(withTrack)) as { cueTracks: Record<string, unknown>[] }
    raw.cueTracks[0]!.someFutureField = 'value'
    const findings = checkSongMapHealth(JSON.stringify(raw))
    expect(findings.some((f) => f.code === 'lossy-load' && /someFutureField/.test(f.message))).toBe(true)
  })

  it('does NOT cry wolf on keys serialization legitimately rewrites', () => {
    // `cues` (legacy, migrated on read) and `formatVersion` are expected drops.
    const raw = JSON.parse(asJson(analysedSong())) as Record<string, unknown>
    raw.cues = { mode: 'off', countInBeats: 0, useSectionLabels: false }
    const findings = checkSongMapHealth(JSON.stringify(raw))
    expect(findings.filter((f) => f.code === 'lossy-load')).toEqual([])
  })
})

describe('structural damage — the stale-barId class', () => {
  it('reports chords anchored to bars that do not exist', () => {
    const sm = analysedSong()
    const broken: SongMap = {
      ...sm,
      harmony: [
        {
          id: 'h1',
          barId: 'bar-from-an-old-analysis',
          beatId: 'b0_0',
          startSec: 0,
          endSec: 0.5,
          chord: { root: 'C', quality: 'maj', displayRaw: 'C' },
        } as SongMap['harmony'][number],
      ],
    }
    const findings = checkSongMapHealth(asJson(broken))
    expect(findings.some((f) => f.code === 'invalid' && f.severity === 'broken')).toBe(true)
  })

  it('caps the flood — 87 identical errors do not become 87 rows', () => {
    const sm = analysedSong()
    const many: SongMap = {
      ...sm,
      harmony: Array.from({ length: 40 }, (_, i) => ({
        id: `h${i}`,
        barId: 'nope',
        beatId: `b0_${i % 4}`,
        startSec: i,
        endSec: i + 0.5,
        chord: { root: 'C', quality: 'maj', displayRaw: 'C' },
      })) as SongMap['harmony'],
    }
    const findings = checkSongMapHealth(asJson(many))
    expect(findings.filter((f) => f.code === 'invalid').length).toBeLessThanOrEqual(6)
  })
})

describe('the start-anchor class — "no clicks" that passed every structural check', () => {
  // The real incident: Love Never Felt So Good, anchor at beat 332/470 (70%,
  // 2:51 in) → click track silent for the first three minutes, structure
  // perfectly valid, health check said "clean". Never again.
  it('flags a song start deep in the song, saying where the clicks begin', () => {
    const sm = analysedSong()
    const deep = { ...sm, startBeatId: sm.timeline.beats[13]!.id } // 13/16 ≈ 81%
    const findings = checkSongMapHealth(asJson(deep))
    const f = findings.find((x) => x.code === 'suspect-start-anchor')
    expect(f, 'a deep anchor must be reported').toBeDefined()
    expect(f!.message).toMatch(/count-in and every click begin THERE/)
  })

  it('flags an anchor pointing at a beat that no longer exists', () => {
    const sm = analysedSong()
    const broken = { ...sm, startBeatId: 'beat-from-an-old-analysis' }
    const findings = checkSongMapHealth(asJson(broken))
    expect(findings.some((x) => x.code === 'suspect-start-anchor' && x.severity === 'broken')).toBe(true)
  })

  it('a normal anchor near the top is not a finding', () => {
    const sm = analysedSong()
    const normal = { ...sm, startBeatId: sm.timeline.beats[1]!.id }
    expect(checkSongMapHealth(asJson(normal)).filter((x) => x.code === 'suspect-start-anchor')).toEqual([])
  })
})

describe('cue → performer links', () => {
  it('flags a link to a performer who is gone', () => {
    const sm = analysedSong()
    const withTrack: SongMap = {
      ...sm,
      cueTracks: [
        {
          id: 't1',
          name: 'Old Member',
          enabled: true,
          performerId: 'left-the-band',
          events: [],
          suppressedGeneratedKeys: [],
        },
      ],
    }
    const findings = checkSongMapHealth(asJson(withTrack), {
      performers: [{ id: 'p1', name: 'Martin' }],
    })
    const orphan = findings.find((f) => f.code === 'orphan-performer-link')
    expect(orphan).toBeDefined()
    expect(orphan!.message).toMatch(/no longer in the project/)
  })

  it('an unlinked track with no roster is fine — legacy songs are not damage', () => {
    const sm = analysedSong()
    const withTrack: SongMap = {
      ...sm,
      cueTracks: [{ id: 'main', name: 'Main cues', enabled: true, events: [], suppressedGeneratedKeys: [] }],
    }
    expect(checkSongMapHealth(asJson(withTrack), { performers: [] })).toEqual([])
  })
})

describe('the duplicated-grid class — two analyses stacked in one file', () => {
  it('flags a bar-index restart as BROKEN, in words that say what happens', () => {
    const sm = analysedSong()
    // Append a copy of the grid, exactly like the real incident: indices
    // restart at 0, times restart near the top of the song.
    const copyBars = sm.timeline.bars.map((b, i) => ({
      ...b,
      id: `dup-${b.id}`,
      index: i,
      beatIds: b.beatIds.map((x) => `dup-${x}`),
    }))
    const copyBeats = sm.timeline.beats.map((bt) => ({
      ...bt,
      id: `dup-${bt.id}`,
      barId: `dup-${bt.barId}`,
    }))
    const doubled = {
      ...sm,
      timeline: {
        ...sm.timeline,
        bars: [...sm.timeline.bars, ...copyBars],
        beats: [...sm.timeline.beats, ...copyBeats],
      },
    }
    const findings = checkSongMapHealth(asJson(doubled))
    const dup = findings.find((f) => f.severity === 'broken' && /clicks twice/.test(f.message))
    expect(dup, 'a stacked grid must be a BROKEN finding').toBeDefined()
  })

  it('a healthy single grid stays clean', () => {
    expect(
      checkSongMapHealth(asJson(analysedSong())).filter((f) => /clicks twice/.test(f.message)),
    ).toEqual([])
  })
})
