import { describe, it, expect } from 'vitest'
import { validateSongMap } from './validate'
import { SONGMAP_FORMAT_VERSION } from './version'
import type { SongMap } from './types'

/**
 * The validator is the data-integrity gate for the `.smap` root-of-truth. These
 * tests lock every invariant: a known-valid map passes clean, and each targeted
 * corruption produces the specific error (or warning) it should.
 */

/** A fresh, deeply-independent, KNOWN-VALID SongMap. 1 bar, 4 beats. */
function valid(): SongMap {
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: { title: 'Song', createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-02T00:00:00Z' },
    timeline: {
      bars: [
        {
          id: 'bar1',
          index: 0,
          startSec: 0,
          endSec: 2,
          meter: { numerator: 4, denominator: 4 },
          beatCount: 4,
          beatIds: ['b0', 'b1', 'b2', 'b3'],
        },
      ],
      beats: [
        { id: 'b0', barId: 'bar1', indexInBar: 0, timeSec: 0 },
        { id: 'b1', barId: 'bar1', indexInBar: 1, timeSec: 0.5 },
        { id: 'b2', barId: 'bar1', indexInBar: 2, timeSec: 1 },
        { id: 'b3', barId: 'bar1', indexInBar: 3, timeSec: 1.5 },
      ],
    },
    sections: [],
    harmony: [],
    cueTracks: [],
  } as unknown as SongMap
}

const errs = (m: SongMap) => validateSongMap(m).errors
const hasErr = (m: SongMap, re: RegExp) => errs(m).some((e) => re.test(e))

describe('validateSongMap — valid baseline', () => {
  it('accepts a well-formed map with no errors or warnings', () => {
    const r = validateSongMap(valid())
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
  })
})

describe('top-level', () => {
  it('rejects a wrong formatVersion', () => {
    const m = valid()
    ;(m as { formatVersion: number }).formatVersion = 999
    expect(hasErr(m, /formatVersion/)).toBe(true)
  })
})

describe('metadata', () => {
  it('requires a non-empty title', () => {
    const m = valid()
    m.metadata.title = '   '
    expect(hasErr(m, /metadata\.title required/)).toBe(true)
  })
  it('requires ISO created/updated strings', () => {
    const m = valid()
    ;(m.metadata as { createdAt: unknown }).createdAt = 123
    expect(hasErr(m, /createdAt must be ISO/)).toBe(true)
  })
  it('validates keyDetail root/mode', () => {
    const m = valid()
    m.metadata.keyDetail = { root: 'H', mode: 'lydian' } as never
    expect(hasErr(m, /keyDetail\.root invalid/)).toBe(true)
    expect(hasErr(m, /keyDetail\.mode invalid/)).toBe(true)
  })
})

describe('transpose', () => {
  it('accepts an in-range integer, undefined', () => {
    const m = valid()
    m.transpose = { baseSemitones: -12 }
    expect(validateSongMap(m).ok).toBe(true)
  })
  it('rejects non-integer and out-of-range', () => {
    const m = valid()
    m.transpose = { baseSemitones: 1.5 }
    expect(hasErr(m, /baseSemitones must be an integer/)).toBe(true)
    m.transpose = { baseSemitones: 13 }
    expect(hasErr(m, /between -12 and 12/)).toBe(true)
  })
})

describe('lyrics', () => {
  it('validates word times, order and line', () => {
    const m = valid()
    m.lyrics = {
      sourceText: 'hi',
      words: [
        { text: 'hi', startSec: 1, endSec: 0.5, line: 0 }, // endSec <= startSec
        { text: '', startSec: -1, endSec: 2, line: -3 }, // empty text, neg start, neg line
      ],
    }
    const e = errs(m)
    expect(e.some((x) => /words\[0\]\.endSec must be > startSec/.test(x))).toBe(true)
    expect(e.some((x) => /words\[1\]\.text required/.test(x))).toBe(true)
    expect(e.some((x) => /words\[1\]\.startSec invalid/.test(x))).toBe(true)
    expect(e.some((x) => /words\[1\]\.line invalid/.test(x))).toBe(true)
  })
})

describe('timeline bars', () => {
  it('rejects a bar whose endSec <= startSec (half-open invariant)', () => {
    const m = valid()
    m.timeline.bars[0]!.endSec = 0
    expect(hasErr(m, /endSec must be > startSec/)).toBe(true)
  })
  it('requires meter numerator/denominator >= 1', () => {
    const m = valid()
    m.timeline.bars[0]!.meter = { numerator: 0, denominator: 0 }
    expect(hasErr(m, /meter\.numerator invalid/)).toBe(true)
    expect(hasErr(m, /meter\.denominator invalid/)).toBe(true)
  })
  it('requires beatIds.length === beatCount', () => {
    const m = valid()
    m.timeline.bars[0]!.beatCount = 3 // now mismatches 4 beatIds AND the 4 beats
    expect(hasErr(m, /beatIds length must equal beatCount/)).toBe(true)
  })
  it('rejects duplicate bar ids', () => {
    const m = valid()
    m.timeline.bars.push({ ...m.timeline.bars[0]!, beatIds: [] as string[], beatCount: 0 })
    expect(hasErr(m, /duplicate bar id/)).toBe(true)
  })
})

describe('timeline beats + cross-references', () => {
  it('rejects a beat referencing an unknown bar', () => {
    const m = valid()
    m.timeline.beats[0]!.barId = 'nope'
    expect(hasErr(m, /unknown barId/)).toBe(true)
  })
  it('rejects a beat whose timeSec falls outside its bar', () => {
    const m = valid()
    m.timeline.beats[3]!.timeSec = 5 // bar is [0,2)
    expect(hasErr(m, /timeSec must fall within bar/)).toBe(true)
  })
  it('rejects indexInBar >= bar.beatCount', () => {
    const m = valid()
    m.timeline.beats[0]!.indexInBar = 9
    expect(hasErr(m, /indexInBar out of range/)).toBe(true)
  })
  it('rejects duplicate beat ids', () => {
    const m = valid()
    m.timeline.beats[1]!.id = 'b0'
    expect(hasErr(m, /duplicate beat id/)).toBe(true)
  })
  it('rejects when a bar references a beatId that is missing / in the wrong bar', () => {
    const m = valid()
    m.timeline.bars[0]!.beatIds = ['b0', 'b1', 'b2', 'ghost']
    expect(hasErr(m, /beatId ghost missing or wrong bar/)).toBe(true)
  })
})

describe('sections', () => {
  it('rejects an invalid kind and inverted barRange', () => {
    const m = valid()
    m.sections = [
      { id: 's1', kind: 'nope' as never, label: 'X', barRange: { startBarIndex: 3, endBarIndex: 1 } },
    ]
    expect(hasErr(m, /kind invalid/)).toBe(true)
    expect(hasErr(m, /barRange end must be >= start/)).toBe(true)
  })
  it('warns (not errors) when a section extends past the last bar', () => {
    const m = valid()
    m.sections = [{ id: 's1', kind: 'verse', label: 'V', barRange: { startBarIndex: 0, endBarIndex: 9 } }]
    const r = validateSongMap(m)
    expect(r.ok).toBe(true)
    expect(r.warnings.some((w) => /extends past last bar/.test(w))).toBe(true)
  })
})

describe('harmony', () => {
  const chord = { root: 'C', displayRaw: 'C', quality: 'maj' }
  it('accepts a valid beat-anchored chord', () => {
    const m = valid()
    m.harmony = [{ id: 'h1', barId: 'bar1', beatId: 'b0', startSec: 0, endSec: 1, chord } as never]
    expect(validateSongMap(m).ok).toBe(true)
  })
  it('rejects a chord with an invalid root/bass and missing displayRaw', () => {
    const m = valid()
    m.harmony = [{ id: 'h1', barId: 'bar1', startSec: 0, endSec: 1, chord: { root: 'H', bass: 'Q' } } as never]
    expect(hasErr(m, /chord\.root invalid/)).toBe(true)
    expect(hasErr(m, /chord\.bass invalid/)).toBe(true)
    expect(hasErr(m, /chord\.displayRaw required/)).toBe(true)
  })
  it('rejects duplicate beatId and a barId that mismatches the beat', () => {
    const m = valid()
    m.harmony = [
      { id: 'h1', barId: 'bar1', beatId: 'b0', startSec: 0, endSec: 1, chord } as never,
      { id: 'h2', barId: 'WRONG', beatId: 'b0', startSec: 0.5, endSec: 1, chord } as never,
    ]
    expect(hasErr(m, /duplicate beatId/)).toBe(true)
    expect(hasErr(m, /barId does not match/)).toBe(true)
  })
})

describe('drafts', () => {
  it('rejects the active draft being duplicated inside drafts[]', () => {
    const m = valid()
    m.activeDraftId = 'd1'
    m.drafts = [{ id: 'd1', name: 'X', harmony: [], sections: [] } as never]
    expect(hasErr(m, /active draft must not be stored in drafts/)).toBe(true)
  })
  it('rejects duplicate draft ids', () => {
    const m = valid()
    m.drafts = [
      { id: 'd1', name: 'A', harmony: [], sections: [] } as never,
      { id: 'd1', name: 'B', harmony: [], sections: [] } as never,
    ]
    expect(hasErr(m, /duplicate draft id/)).toBe(true)
  })
})

describe('cue tracks', () => {
  it('validates event kind, anchor and rendered-export shape', () => {
    const m = valid()
    m.cueTracks = [
      {
        id: 't1',
        name: 'Cue',
        enabled: true,
        events: [{ id: 'e1', kind: 'bogus' as never, enabled: true, anchor: { kind: 'beat', beatId: '' } }],
        suppressedGeneratedKeys: [],
      } as never,
    ]
    expect(hasErr(m, /events\[0\]\.kind invalid/)).toBe(true)
    expect(hasErr(m, /anchor\.beatId required/)).toBe(true)
  })
  it('rejects a malformed clickExport', () => {
    const m = valid()
    ;(m as { clickExport: unknown }).clickExport = { fingerprint: '', durationSec: -1, sampleRate: 0, generatedAt: '', preludeOffsetSec: -1 }
    expect(hasErr(m, /clickExport\.fingerprint invalid/)).toBe(true)
    expect(hasErr(m, /clickExport\.durationSec invalid/)).toBe(true)
    expect(hasErr(m, /clickExport\.preludeOffsetSec invalid/)).toBe(true)
  })
})

describe('drum/bass MIDI', () => {
  it('bounds drum velocity to [0,1] and time >= 0', () => {
    const m = valid()
    ;(m as { drumMidi: unknown }).drumMidi = { events: [{ timeSec: -1, velocity: 2 }] }
    expect(hasErr(m, /drumMidi\.events\[0\]\.timeSec/)).toBe(true)
    expect(hasErr(m, /drumMidi\.events\[0\]\.velocity/)).toBe(true)
  })
  it('bounds bass midi note to [0,127] and duration > 0', () => {
    const m = valid()
    ;(m as { bassMidi: unknown }).bassMidi = { events: [{ timeSec: 0, durationSec: 0, midi: 200, velocity: 0.5 }] }
    expect(hasErr(m, /bassMidi\.events\[0\]\.durationSec/)).toBe(true)
    expect(hasErr(m, /bassMidi\.events\[0\]\.midi/)).toBe(true)
  })
})

describe('startBeatId + mixState + stemRefs', () => {
  it('warns when startBeatId references a missing beat', () => {
    const m = valid()
    m.startBeatId = 'ghost'
    const r = validateSongMap(m)
    expect(r.ok).toBe(true) // soft-fail: warning, not error
    expect(r.warnings.some((w) => /references missing beat/.test(w))).toBe(true)
  })
  it('accepts a startBeatId that exists', () => {
    const m = valid()
    m.startBeatId = 'b2'
    expect(validateSongMap(m).warnings.some((w) => /startBeatId/.test(w))).toBe(false)
  })
  it('rejects a negative mix volume and non-string stemRef', () => {
    const m = valid()
    m.mixState = { tracks: [{ key: 'original', volume: -1 }] }
    ;(m as { stemRefs: unknown }).stemRefs = { Drums: 42 }
    expect(hasErr(m, /mixState\.tracks\[0\]\.volume invalid/)).toBe(true)
    expect(hasErr(m, /stemRefs\.Drums must be a string/)).toBe(true)
  })
})

describe('array-shape guards', () => {
  it('errors when required arrays are missing', () => {
    const m = valid()
    ;(m as { sections: unknown }).sections = 'nope'
    ;(m as { harmony: unknown }).harmony = null
    ;(m as { cueTracks: unknown }).cueTracks = undefined
    const e = errs(m)
    expect(e).toContain('sections must be array')
    expect(e).toContain('harmony must be array')
    expect(e).toContain('cueTracks must be array')
  })
})

describe('duplicate ids in id-keyed lists', () => {
  // These lists are merged by id on the next sync (`mergeByIdList`), so a
  // duplicate id silently collapses two distinct items into one — data loss the
  // validator must catch BEFORE it is persisted.
  const harmony = (id: string) => ({
    id,
    barId: 'bar1',
    startSec: 0,
    endSec: 1,
    chord: { root: 'C', displayRaw: 'C' },
  })
  const section = (id: string) => ({
    id,
    kind: 'verse',
    label: 'Verse',
    barRange: { startBarIndex: 0, endBarIndex: 0 },
  })
  const cueTrack = (id: string) => ({
    id,
    name: 'Cues',
    enabled: true,
    events: [],
    suppressedGeneratedKeys: [],
  })
  const cueEvent = (id: string) => ({
    id,
    kind: 'custom-text',
    enabled: true,
    anchor: { kind: 'time', timeSec: 0 },
    text: 'x',
  })

  it('flags two harmony events sharing an id', () => {
    const m = valid()
    ;(m as { harmony: unknown }).harmony = [harmony('h1'), harmony('h1')]
    expect(hasErr(m, /harmony\[1\]: duplicate id h1/)).toBe(true)
  })

  it('accepts distinct harmony ids', () => {
    const m = valid()
    ;(m as { harmony: unknown }).harmony = [harmony('h1'), harmony('h2')]
    expect(hasErr(m, /duplicate id/)).toBe(false)
  })

  it('flags two sections sharing an id', () => {
    const m = valid()
    ;(m as { sections: unknown }).sections = [section('s1'), section('s1')]
    expect(hasErr(m, /sections\[1\]: duplicate id s1/)).toBe(true)
  })

  it('flags two cue tracks sharing an id', () => {
    const m = valid()
    ;(m as { cueTracks: unknown }).cueTracks = [cueTrack('c1'), cueTrack('c1')]
    expect(hasErr(m, /cueTracks\[1\]: duplicate id c1/)).toBe(true)
  })

  it('flags duplicate cue-event ids within a track', () => {
    const m = valid()
    const track = { ...cueTrack('c1'), events: [cueEvent('e1'), cueEvent('e1')] }
    ;(m as { cueTracks: unknown }).cueTracks = [track]
    expect(hasErr(m, /cueTracks\[0\]\.events\[1\]: duplicate id e1/)).toBe(true)
  })
})
