/**
 * Property-based proof for the Phase 2 `Y.Doc` representation.
 *
 * `ydoc.test.ts` pins specific songs; this generates hundreds of SongMap
 * shapes and asserts the invariants that make the representation safe to build
 * Phases 3–6 on:
 *
 *   - seed → derive is the identity on canonically-ordered collaborative content;
 *   - seeding is a PURE function of that content — same bytes every time,
 *     regardless of array order, object key order, or local-only fields (§8);
 *   - two devices that seed independently converge on one song.
 *
 * A failure prints the minimised counter-example, which drops straight into
 * `ydoc.test.ts` as an example test.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import * as Y from 'yjs'
import { collabContentFingerprint, toCollabSongMap } from './collab'
import type { Bar, Beat, HarmonyEvent, Section, SongMap } from './types'
import {
  canonicalSongMapOrder,
  hydrateSongDoc,
  roundTripThroughYDoc,
  songMapSeedUpdate,
  songMapToYDoc,
  yDocToSongMap,
} from './ydoc'
import { SONGMAP_FORMAT_VERSION } from './version'

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const time = (max = 600) => fc.double({ min: 0, max, noNaN: true, noDefaultInfinity: true })
const maybe = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: undefined })

const noteName = fc.constantFrom('C', 'D', 'E', 'F', 'G', 'A', 'B' as const)
const accidental = fc.constantFrom('sharp', 'flat', 'natural' as const)
const sectionKind = fc.constantFrom(
  'intro',
  'verse',
  'preChorus',
  'chorus',
  'bridge',
  'solo',
  'riff',
  'break',
  'outro',
  'custom' as const,
)

const chordArb = fc.record(
  {
    root: noteName,
    accidental: maybe(accidental),
    quality: maybe(fc.constantFrom('major', 'minor', 'dim', 'aug', '7', 'maj7', 'min7', 'sus4')),
    extensions: maybe(fc.array(fc.constantFrom('9', '11', '13'), { maxLength: 3 })),
    // v6 colour tones — these MUST survive, they were previously lost to display-only storage.
    alterations: maybe(fc.array(fc.constantFrom('b5', '#5', 'b9', '#9', '#11', 'b13', '6', '5'), { maxLength: 3 })),
    bass: maybe(noteName),
    bassAccidental: maybe(accidental),
    displayRaw: fc.string({ maxLength: 12 }),
  },
  { requiredKeys: ['root', 'displayRaw'] },
)

/**
 * Build a structurally coherent song: bars own their beats, harmony points at
 * real bars/beats, sections span real bar indices. Ids are index-derived so
 * they are unique — an id-keyed document collapses duplicates by construction,
 * which is a different property from the ones under test here.
 */
const songMapArb = fc
  .record({
    barCount: fc.integer({ min: 0, max: 6 }),
    beatsPerBar: fc.integer({ min: 1, max: 5 }),
    beatDur: fc.double({ min: 0.1, max: 2, noNaN: true, noDefaultInfinity: true }),
    harmonyCount: fc.integer({ min: 0, max: 8 }),
    sectionCount: fc.integer({ min: 0, max: 4 }),
    draftCount: fc.integer({ min: 0, max: 3 }),
    cueTrackCount: fc.integer({ min: 0, max: 3 }),
    cueEventCount: fc.integer({ min: 0, max: 5 }),
    chords: fc.array(chordArb, { minLength: 1, maxLength: 8 }),
    sectionKinds: fc.array(sectionKind, { minLength: 1, maxLength: 4 }),
    labels: fc.array(fc.string({ maxLength: 10 }), { minLength: 1, maxLength: 4 }),
    draftNames: fc.array(fc.string({ maxLength: 10 }), { minLength: 1, maxLength: 3 }),
    title: fc.string({ maxLength: 20 }),
    bpm: maybe(fc.double({ min: 20, max: 300, noNaN: true, noDefaultInfinity: true })),
    countInBeats: maybe(fc.integer({ min: 0, max: 8 })),
    transpose: maybe(fc.integer({ min: -12, max: 12 })),
    hasAudio: fc.boolean(),
    hasLyrics: fc.boolean(),
    hasOriginalSnapshot: fc.boolean(),
    startBeatIndex: maybe(fc.integer({ min: 0, max: 20 })),
    trimStart: time(10),
    trimEnd: time(600),
    // Local-only fields — present or not, they must never reach the document.
    hasLocalOnly: fc.boolean(),
  })
  .map((o): SongMap => {
    const bars: Bar[] = []
    const beats: Beat[] = []
    for (let b = 0; b < o.barCount; b++) {
      const barId = `bar-${b}`
      const barStart = b * o.beatsPerBar * o.beatDur
      const beatIds: string[] = []
      for (let i = 0; i < o.beatsPerBar; i++) {
        const id = `beat-${b}-${i}`
        beatIds.push(id)
        beats.push({ id, barId, indexInBar: i, timeSec: barStart + i * o.beatDur })
      }
      bars.push({
        id: barId,
        index: b,
        startSec: barStart,
        endSec: barStart + o.beatsPerBar * o.beatDur,
        meter: { numerator: o.beatsPerBar, denominator: 4 },
        beatCount: o.beatsPerBar,
        beatIds,
      })
    }

    const makeHarmony = (prefix: string, count: number): HarmonyEvent[] =>
      bars.length === 0
        ? []
        : Array.from({ length: count }, (_, i) => {
            const bar = bars[i % bars.length]!
            return {
              id: `${prefix}-h-${i}`,
              barId: bar.id,
              beatId: bar.beatIds[0],
              startSec: bar.startSec,
              endSec: bar.endSec,
              chord: o.chords[i % o.chords.length]!,
            }
          })

    const makeSections = (prefix: string, count: number): Section[] =>
      bars.length === 0
        ? []
        : Array.from({ length: count }, (_, i) => ({
            id: `${prefix}-s-${i}`,
            kind: o.sectionKinds[i % o.sectionKinds.length]!,
            label: o.labels[i % o.labels.length]!,
            barRange: {
              startBarIndex: i % bars.length,
              endBarIndex: Math.min(bars.length - 1, (i % bars.length) + 1),
            },
          }))

    const sm: SongMap = {
      formatVersion: SONGMAP_FORMAT_VERSION,
      app: { name: 'BarBro', appVersion: '9.9.9' },
      metadata: {
        title: o.title,
        bpm: o.bpm,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        analyzed: bars.length > 0,
      },
      timeline: { bars, beats },
      sections: makeSections('root', o.sectionCount),
      harmony: makeHarmony('root', o.harmonyCount),
      cueTracks: Array.from({ length: o.cueTrackCount }, (_, t) => ({
        id: `cue-${t}`,
        name: `Cue ${t}`,
        enabled: t === 0,
        events: Array.from({ length: o.cueEventCount }, (_, e) => ({
          id: `cue-${t}-ev-${e}`,
          kind: 'section' as const,
          enabled: e % 2 === 0,
          anchor:
            beats.length > 0 && e % 2 === 0
              ? ({ kind: 'beat', beatId: beats[e % beats.length]!.id } as const)
              : ({ kind: 'time', timeSec: e } as const),
          text: `cue ${e}`,
        })),
        suppressedGeneratedKeys: [`suppressed-${t}`],
      })),
      activeDraftId: 'draft-migrated-active',
      activeDraftName: 'My draft',
    }

    if (o.transpose !== undefined) sm.transpose = { baseSemitones: o.transpose }
    if (o.countInBeats !== undefined) sm.countInBeats = o.countInBeats
    if (o.startBeatIndex !== undefined && beats.length > 0) {
      sm.startBeatId = beats[o.startBeatIndex % beats.length]!.id
    }
    if (o.hasAudio) {
      sm.audio = {
        fileName: 'song.wav',
        durationSec: o.trimEnd,
        trim: { startSec: o.trimStart, endSec: Math.max(o.trimStart, o.trimEnd) },
        source: 'upload',
        originalPath: 'audio/song.wav', // local-only
      }
    }
    if (o.hasLyrics) {
      sm.lyrics = {
        words: beats.slice(0, 4).map((b, i) => ({
          text: `w${i}`,
          startSec: b.timeSec,
          endSec: b.timeSec + 0.2,
          line: i % 2,
        })),
        sourceText: 'line one\nline two',
      }
    }
    if (o.hasOriginalSnapshot) sm.timeline.original = { bars, beats }
    if (o.draftCount > 0) {
      sm.drafts = Array.from({ length: o.draftCount }, (_, d) => ({
        id: `draft-${d}`,
        name: o.draftNames[d % o.draftNames.length]!,
        source: 'manual' as const,
        sections: makeSections(`d${d}`, o.sectionCount),
        harmony: makeHarmony(`d${d}`, o.harmonyCount),
      }))
    }
    if (o.hasLocalOnly) {
      sm.projectFolder = 'LocalFolder'
      sm.stemRefs = { Drums: 'local/drums.wav' }
      sm.mixState = { tracks: [{ key: 'original', volume: 0.5 }], master: 1 }
      sm.chordHints = {
        beatChroma: [[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
        detectedKey: null,
        audioFingerprint: 'fp',
        generatedAt: '2026-01-01T00:00:00.000Z',
        analyzerVersion: 1,
      }
    }
    return sm
  })

/** Deterministic shuffle so the counter-example replays exactly. */
function rotate<T>(items: readonly T[], by: number): T[] {
  if (items.length === 0) return []
  const n = ((by % items.length) + items.length) % items.length
  return [...items.slice(n), ...items.slice(0, n)]
}

function shuffleCollections(sm: SongMap): SongMap {
  const out: SongMap = {
    ...sm,
    timeline: {
      ...sm.timeline,
      bars: rotate(sm.timeline.bars, 1),
      beats: [...sm.timeline.beats].reverse(),
    },
    sections: [...sm.sections].reverse(),
    harmony: rotate(sm.harmony, 2),
    cueTracks: rotate(sm.cueTracks, 1).map((t) => ({ ...t, events: [...t.events].reverse() })),
  }
  if (sm.drafts) {
    out.drafts = rotate(sm.drafts, 1).map((d) => ({
      ...d,
      sections: [...d.sections].reverse(),
      harmony: rotate(d.harmony, 1),
    }))
  }
  return out
}

function deepReverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepReverseKeys)
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).reverse()) out[key] = deepReverseKeys(source[key])
    return out
  }
  return value
}

const RUNS = { numRuns: 200 } as const

describe('Y.Doc round trip (property)', () => {
  it('derive(seed(sm)) equals the canonical collaborative projection of sm', () => {
    fc.assert(
      fc.property(songMapArb, (sm) => {
        expect(roundTripThroughYDoc(sm)).toEqual(canonicalSongMapOrder(toCollabSongMap(sm)))
      }),
      RUNS,
    )
  })

  it('preserves the collaborative fingerprint', () => {
    fc.assert(
      fc.property(songMapArb, (sm) => {
        const canonical = canonicalSongMapOrder(sm)
        expect(collabContentFingerprint(roundTripThroughYDoc(canonical))).toBe(
          collabContentFingerprint(canonical),
        )
      }),
      RUNS,
    )
  })

  it('is a fixed point after the first round trip', () => {
    fc.assert(
      fc.property(songMapArb, (sm) => {
        const once = roundTripThroughYDoc(sm)
        expect(roundTripThroughYDoc(once)).toEqual(once)
      }),
      RUNS,
    )
  })
})

describe('seed determinism (property, architecture doc §8)', () => {
  it('seeding twice yields byte-identical updates', () => {
    fc.assert(
      fc.property(songMapArb, (sm) => {
        expect(digest(songMapSeedUpdate(sm))).toBe(digest(songMapSeedUpdate(sm)))
      }),
      RUNS,
    )
  })

  it('is invariant to the order of the input arrays', () => {
    fc.assert(
      fc.property(songMapArb, (sm) => {
        expect(digest(songMapSeedUpdate(shuffleCollections(sm)))).toBe(
          digest(songMapSeedUpdate(sm)),
        )
      }),
      RUNS,
    )
  })

  it('is invariant to object key order (file order vs JSONB order)', () => {
    fc.assert(
      fc.property(songMapArb, (sm) => {
        const reversed = deepReverseKeys(JSON.parse(JSON.stringify(sm))) as SongMap
        expect(digest(songMapSeedUpdate(reversed))).toBe(digest(songMapSeedUpdate(sm)))
      }),
      RUNS,
    )
  })

  it('is invariant to local-only fields', () => {
    fc.assert(
      fc.property(songMapArb, (sm) => {
        const stripped = { ...sm }
        delete stripped.projectFolder
        delete stripped.stemRefs
        delete stripped.mixState
        delete stripped.chordHints
        delete stripped.sectionBorderHints
        if (stripped.audio) stripped.audio = { ...stripped.audio, originalPath: undefined }
        expect(digest(songMapSeedUpdate(stripped))).toBe(digest(songMapSeedUpdate(sm)))
      }),
      RUNS,
    )
  })

  it('two devices seeding the same song converge on one song', () => {
    fc.assert(
      fc.property(songMapArb, (raw) => {
        const sm = canonicalSongMapOrder(raw)
        const a = hydrateSongDoc(songMapSeedUpdate(sm))
        const b = hydrateSongDoc(songMapSeedUpdate(sm))
        Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
        Y.applyUpdate(b, Y.encodeStateAsUpdate(a))

        const fingerprint = collabContentFingerprint(sm)
        expect(collabContentFingerprint(yDocToSongMap(a))).toBe(fingerprint)
        expect(collabContentFingerprint(yDocToSongMap(b))).toBe(fingerprint)
        // Nothing duplicated: the merged timeline is the size it started at.
        expect(yDocToSongMap(a).timeline.bars).toHaveLength(sm.timeline.bars.length)
        expect(yDocToSongMap(a).harmony).toHaveLength(sm.harmony.length)
      }),
      RUNS,
    )
  })

  it('never encodes a local-only value into the document bytes', () => {
    fc.assert(
      fc.property(songMapArb, (sm) => {
        const encoded = new TextDecoder('utf-8', { fatal: false }).decode(songMapToYDocBytes(sm))
        expect(encoded).not.toContain('LocalFolder')
        expect(encoded).not.toContain('local/drums.wav')
        expect(encoded).not.toContain('audio/song.wav')
      }),
      RUNS,
    )
  })
})

function songMapToYDocBytes(sm: SongMap): Uint8Array {
  return Y.encodeStateAsUpdate(songMapToYDoc(sm))
}
