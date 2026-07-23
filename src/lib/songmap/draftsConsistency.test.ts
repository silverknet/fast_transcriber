/**
 * Drafts (v6) × the editor↔Ableton lockstep invariants.
 *
 * `switchToDraft()` swaps `sections` + `harmony` + `lyrics` at the SongMap
 * root. This suite pins down what that swap is and is NOT allowed to move:
 *
 *  1. **Timing is draft-independent.** `songPlaybackPlan(sm)` reads the
 *     timeline, trim, BPM, count-in and start anchor — never `sm.sections`.
 *     A draft switch therefore cannot change a single click position, and
 *     `songTimings(sm)` (the Ableton projection) moves with it or not at all.
 *     This is CLAUDE.md invariants 3 and 4 seen from the drafts angle.
 *
 *  2. **Cue tracks are NOT part of a draft.** They live beside `drafts[]` and
 *     survive a switch untouched — including cues that were GENERATED from the
 *     outgoing draft's sections. See the "known bug" block at the bottom.
 *
 *  3. **Ableton locators follow the active draft**, and locators are the only
 *     thing in the .als a draft switch is allowed to move.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { addDraftAndActivate, ensureActiveDraftIdentity, switchToDraft } from './drafts'
import { createDefaultCueTrack, generateCueTrackFromSections } from './cueTracks'
import { songPlaybackPlan } from './playbackPlan'
import { songTimings } from '../export/setlist/timings'
import { generateAbletonSetXml } from '../export/abletonSet'
import { buildCueSpeechEvents } from '$lib/audio/cueTrackSpeechSchedule'
import { validateSongMap } from './validate'
import { SONGMAP_FORMAT_VERSION } from './version'
import type { Section, SongMap } from './types'

let idCounter = 0
const newId = (): string => `id${++idCounter}`

/**
 * Structurally valid `SongMap` with a real timeline — cue generation and the
 * Ableton exporter both need bars/beats, so the sparse fixtures in
 * `drafts.test.ts` aren't enough here. Mirrors the generator in
 * `playbackPlan.property.test.ts` so the two suites explore the same space.
 */
function makeSong(opts: {
  barCount: number
  beatsPerBar: number
  beatDurationSec: number
  trimStartSec: number
  trimEndOffset: number
  countInBeats: number
  startBarIndex: number | null
  sections?: Section[]
}): SongMap {
  const { barCount, beatsPerBar, beatDurationSec: bd, trimStartSec } = opts
  // Keep the trim window non-empty even when a generated `trimStartSec` lands
  // past a very short song — an invalid trim makes the plan null, which is a
  // different property (already covered in `playbackPlan.property.test.ts`).
  const trimEndSec = Math.max(barCount * beatsPerBar * bd + opts.trimEndOffset, trimStartSec + 0.5)

  const beats: SongMap['timeline']['beats'] = []
  const bars: SongMap['timeline']['bars'] = []
  for (let bar = 0; bar < barCount; bar++) {
    const barId = `bar${bar}`
    const barStart = bar * beatsPerBar * bd
    const beatIds: string[] = []
    for (let i = 0; i < beatsPerBar; i++) {
      const id = `b${bar}_${i}`
      beatIds.push(id)
      beats.push({ id, barId, indexInBar: i, timeSec: barStart + i * bd })
    }
    bars.push({
      id: barId,
      index: bar,
      startSec: barStart,
      endSec: barStart + beatsPerBar * bd,
      meter: { numerator: beatsPerBar, denominator: 4 },
      beatCount: beatsPerBar,
      beatIds,
    })
  }

  const startBeatId =
    opts.startBarIndex !== null && opts.startBarIndex >= 0 && opts.startBarIndex < barCount
      ? `b${opts.startBarIndex}_0`
      : undefined

  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'T',
      bpm: 60 / bd,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    audio: {
      fileName: 'x.wav',
      trim: { startSec: trimStartSec, endSec: trimEndSec },
      source: 'upload',
    },
    timeline: { bars, beats },
    sections: opts.sections ?? [],
    harmony: [],
    cueTracks: [],
    activeDraftId: 'draft-a',
    activeDraftName: 'Draft A',
    ...(opts.countInBeats > 0 ? { countInBeats: opts.countInBeats } : {}),
    ...(startBeatId !== undefined ? { startBeatId } : {}),
  } as SongMap
}

function section(id: string, start: number, end: number, label: string): Section {
  return { id, kind: 'verse', label, barRange: { startBarIndex: start, endBarIndex: end } }
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Timing is draft-independent
// ───────────────────────────────────────────────────────────────────────────

describe('drafts × playback plan — a draft switch never moves a click', () => {
  const songArb = fc.record({
    barCount: fc.integer({ min: 2, max: 12 }),
    beatsPerBar: fc.integer({ min: 1, max: 8 }),
    beatDurationSec: fc.double({ min: 0.25, max: 1.0, noNaN: true, noDefaultInfinity: true }),
    trimStartSec: fc.double({ min: 0, max: 4, noNaN: true, noDefaultInfinity: true }),
    trimEndOffset: fc.double({ min: 0, max: 2, noNaN: true, noDefaultInfinity: true }),
    countInBeats: fc.integer({ min: 0, max: 8 }),
    startBarIndex: fc.oneof(fc.constant(null as number | null), fc.integer({ min: 0, max: 11 })),
  })

  /** Arbitrary section layout inside a song of `barCount` bars. */
  const sectionsArb = (barCount: number) =>
    fc
      .array(
        fc.record({
          start: fc.integer({ min: 0, max: Math.max(0, barCount - 1) }),
          len: fc.integer({ min: 0, max: 3 }),
          label: fc.constantFrom('Intro', 'Verse', 'Chorus', 'Bridge', 'Outro'),
        }),
        { maxLength: 5 },
      )
      .map((rows) =>
        rows.map((r, i) =>
          section(
            `sec-${i}`,
            r.start,
            Math.min(barCount - 1, r.start + r.len),
            `${r.label} ${i}`,
          ),
        ),
      )

  it('the plan is byte-identical before and after switching drafts', () => {
    fc.assert(
      fc.property(
        songArb,
        fc.nat(),
        (params, seed) => {
          idCounter = seed
          const sectionsA = fc.sample(sectionsArb(params.barCount), { numRuns: 1, seed })[0]!
          const sectionsB = fc.sample(sectionsArb(params.barCount), { numRuns: 1, seed: seed + 1 })[0]!

          const onA = ensureActiveDraftIdentity(
            makeSong({ ...params, sections: sectionsA }),
            newId,
          )
          const planA = songPlaybackPlan(onA)

          const onB = addDraftAndActivate(
            onA,
            { sections: sectionsB, harmony: [], lyrics: undefined },
            'Draft B',
            newId,
          )
          const planB = songPlaybackPlan(onB)

          // The whole point: different sections, identical plan.
          expect(planB).toEqual(planA)

          // ...and switching back is equally inert. (An outgoing draft with no
          // sections, chords or lyrics is deliberately dropped rather than
          // stored as an empty shell, so there is nothing to switch back TO.)
          const back = switchToDraft(onB, onA.activeDraftId!, newId)
          if (!back.ok) {
            expect(sectionsA).toEqual([])
            return
          }
          expect(songPlaybackPlan(back.map)).toEqual(planA)
        },
      ),
      { numRuns: 120 },
    )
  })

  it('songTimings — the Ableton projection — is equally draft-independent', () => {
    fc.assert(
      fc.property(songArb, fc.nat(), (params, seed) => {
        idCounter = seed
        const sectionsA = fc.sample(sectionsArb(params.barCount), { numRuns: 1, seed })[0]!
        const sectionsB = fc.sample(sectionsArb(params.barCount), { numRuns: 1, seed: seed + 1 })[0]!

        const onA = ensureActiveDraftIdentity(makeSong({ ...params, sections: sectionsA }), newId)
        const onB = addDraftAndActivate(
          onA,
          { sections: sectionsB, harmony: [], lyrics: undefined },
          'Draft B',
          newId,
        )
        expect(songTimings(onB)).toEqual(songTimings(onA))
      }),
      { numRuns: 120 },
    )
  })

  it('a draft with no sections at all still plays identically', () => {
    idCounter = 0
    const onA = ensureActiveDraftIdentity(
      makeSong({
        barCount: 8,
        beatsPerBar: 4,
        beatDurationSec: 0.5,
        trimStartSec: 1,
        trimEndOffset: 0.5,
        countInBeats: 4,
        startBarIndex: null,
        sections: [section('a1', 0, 3, 'Intro'), section('a2', 4, 7, 'Chorus')],
      }),
      newId,
    )
    const empty = addDraftAndActivate(
      onA,
      { sections: [], harmony: [], lyrics: undefined },
      'New draft',
      newId,
    )
    expect(empty.sections).toEqual([])
    expect(songPlaybackPlan(empty)).toEqual(songPlaybackPlan(onA))
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 2. Ableton export per draft
// ───────────────────────────────────────────────────────────────────────────

function locatorNames(xml: string): string[] {
  const block = xml.match(/<Locators>\s*<Locators>([\s\S]*?)<\/Locators>\s*<\/Locators>/)
  if (!block) return []
  return [...block[1]!.matchAll(/<Name Value="([^"]*)" \/>/g)].map((m) => m[1]!)
}

/**
 * The .als with everything a draft is allowed to move stripped out: the
 * locator block, and `NextPointeeId` (a running counter that shifts purely
 * because a different number of locators consumed IDs before it).
 */
function alsWithoutLocators(xml: string): string {
  return xml
    .replace(/<Locators>[\s\S]*?<\/Locators>\s*<\/Locators>/, '<Locators/>')
    .replace(/<NextPointeeId Value="\d+" \/>/, '<NextPointeeId/>')
}

describe('drafts × Ableton export', () => {
  function twoDraftSong() {
    idCounter = 0
    const onA = ensureActiveDraftIdentity(
      makeSong({
        barCount: 8,
        beatsPerBar: 4,
        beatDurationSec: 0.5,
        trimStartSec: 1,
        trimEndOffset: 0.5,
        countInBeats: 4,
        startBarIndex: null,
        sections: [section('a1', 0, 3, 'Intro A'), section('a2', 4, 7, 'Chorus A')],
      }),
      newId,
    )
    const onB = addDraftAndActivate(
      onA,
      {
        sections: [
          section('b1', 0, 1, 'Riff B'),
          section('b2', 2, 5, 'Verse B'),
          section('b3', 6, 7, 'Outro B'),
        ],
        harmony: [],
        lyrics: undefined,
      },
      'Draft B',
      newId,
    )
    return { onA, onB }
  }

  it('locators come from the ACTIVE draft only — stored drafts contribute none', () => {
    const { onA, onB } = twoDraftSong()
    expect(locatorNames(generateAbletonSetXml(onA, { title: 'T' }))).toEqual([
      'Intro A',
      'Chorus A',
    ])
    // Draft A is now stored, not active: none of its labels may leak in.
    expect(locatorNames(generateAbletonSetXml(onB, { title: 'T' }))).toEqual([
      'Riff B',
      'Verse B',
      'Outro B',
    ])
  })

  it('locators are the ONLY thing a draft switch changes in the .als', () => {
    const { onA, onB } = twoDraftSong()
    const a = generateAbletonSetXml(onA, { title: 'T' })
    const b = generateAbletonSetXml(onB, { title: 'T' })
    expect(a).not.toEqual(b)
    // Tempo, time signature, the MIDI click track and every clip play-range
    // are identical — the band hears the same thing on either draft.
    expect(alsWithoutLocators(b)).toEqual(alsWithoutLocators(a))
  })

  it('each draft round-trips: switching back restores its exact locator set', () => {
    const { onA, onB } = twoDraftSong()
    const before = generateAbletonSetXml(onA, { title: 'T' })
    const back = switchToDraft(onB, onA.activeDraftId!, newId)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(locatorNames(generateAbletonSetXml(back.map, { title: 'T' }))).toEqual(
      locatorNames(before),
    )
  })

  it('a section pointing past the last bar is skipped, not emitted as a bad locator', () => {
    idCounter = 0
    const sm = makeSong({
      barCount: 4,
      beatsPerBar: 4,
      beatDurationSec: 0.5,
      trimStartSec: 0,
      trimEndOffset: 0,
      countInBeats: 0,
      startBarIndex: null,
      sections: [section('ok', 0, 1, 'Intro'), section('ghost', 99, 100, 'Ghost')],
    })
    expect(locatorNames(generateAbletonSetXml(sm, { title: 'T' }))).toEqual(['Intro'])
  })

})

// ───────────────────────────────────────────────────────────────────────────
// 3. Cue tracks across a draft switch
// ───────────────────────────────────────────────────────────────────────────

describe('drafts × cue tracks', () => {
  /** Song on draft A with a cue track generated from draft A's sections. */
  function songWithGeneratedCues() {
    idCounter = 0
    const base = ensureActiveDraftIdentity(
      makeSong({
        barCount: 8,
        beatsPerBar: 4,
        beatDurationSec: 0.5,
        trimStartSec: 0,
        trimEndOffset: 0.5,
        countInBeats: 0,
        startBarIndex: null,
        sections: [section('a1', 0, 3, 'Intro A'), section('a2', 4, 7, 'Chorus A')],
      }),
      newId,
    )
    const track = generateCueTrackFromSections(base, createDefaultCueTrack())
    return { ...base, cueTracks: [track] }
  }

  const sectionCueTexts = (sm: SongMap) =>
    sm.cueTracks[0]!.events.filter((e) => e.kind === 'section').map((e) => e.text)

  it('cue tracks are shared, not part of a draft — a switch leaves them untouched', () => {
    const onA = songWithGeneratedCues()
    expect(sectionCueTexts(onA)).toEqual(['Intro A', 'Chorus A'])

    const onB = addDraftAndActivate(
      onA,
      { sections: [section('b1', 2, 5, 'Verse B')], harmony: [], lyrics: undefined },
      'Draft B',
      newId,
    )
    // Cue tracks are not snapshotted into the stored draft...
    expect(onB.drafts?.[0]).not.toHaveProperty('cueTracks')
    // ...and the live track is the same object graph as before the switch.
    expect(onB.cueTracks).toEqual(onA.cueTracks)
  })

  /**
   * A cue generated from a section carries that section's id. Cue tracks are
   * shared by every draft, so after a switch those ids can reference sections
   * the active draft does not have — and the speech renderer used to announce
   * the OUTGOING draft's section names, at the outgoing draft's bar positions,
   * over the incoming draft's grid. The stale names reached the rendered cue
   * WAV, not just the data model.
   *
   * Fixed by filtering at READ time (`isCueEventLiveForSections`) rather than
   * pruning on switch: nothing the user edited is destroyed, and switching back
   * makes the cues live again with no bookkeeping.
   */
  it('a cue whose section is not in the active draft is not spoken', () => {
    const onA = songWithGeneratedCues()
    const onB = addDraftAndActivate(
      onA,
      { sections: [section('b1', 2, 5, 'Verse B')], harmony: [], lyrics: undefined },
      'Draft B',
      newId,
    )

    // The events are still THERE — this is a read-time filter, not a delete.
    expect(sectionCueTexts(onB)).toEqual(['Intro A', 'Chorus A'])
    const liveIds = new Set(onB.sections.map((s) => s.id))
    const orphans = onB.cueTracks[0]!.events.filter(
      (e) => e.generatedSource && !liveIds.has(e.generatedSource.sectionId),
    )
    expect(orphans.length).toBeGreaterThan(0)
    expect(validateSongMap(onB).ok).toBe(true)

    // ...but none of them reaches the spoken output.
    const spoken = buildCueSpeechEvents(onB).map((e) => e.text).join(' ')
    expect(spoken).not.toContain('Intro A')
    expect(spoken).not.toContain('Chorus A')
  })

  it('switching back makes the original draft\'s cues audible again', () => {
    // The point of filtering rather than pruning: nothing had to be restored.
    const onA = songWithGeneratedCues()
    const onB = addDraftAndActivate(
      onA,
      { sections: [section('b1', 2, 5, 'Verse B')], harmony: [], lyrics: undefined },
      'Draft B',
      newId,
    )
    expect(buildCueSpeechEvents(onB).map((e) => e.text).join(' ')).not.toContain('Intro A')

    const back = switchToDraft(onB, onA.activeDraftId!, newId)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(buildCueSpeechEvents(back.map).map((e) => e.text).join(' ')).toContain('Intro A')
  })

  it('manual cues are never filtered — they are anchored to bars, not sections', () => {
    const onA = songWithGeneratedCues()
    const withManual: SongMap = {
      ...onA,
      cueTracks: [
        {
          ...onA.cueTracks[0]!,
          events: [
            ...onA.cueTracks[0]!.events,
            {
              id: 'manual-1',
              kind: 'section',
              enabled: true,
              text: 'HIT IT',
              anchor: onA.cueTracks[0]!.events[0]!.anchor,
            },
          ],
        },
      ],
    }
    const onB = addDraftAndActivate(
      withManual,
      { sections: [section('b1', 2, 5, 'Verse B')], harmony: [], lyrics: undefined },
      'Draft B',
      newId,
    )
    expect(buildCueSpeechEvents(onB).map((e) => e.text).join(' ')).toContain('HIT IT')
  })

  /**
   * KNOWN BUG (second half) — regenerating on the new draft does not clean up.
   *
   * `generateCueTrackFromSections` retains any generated event marked
   * `edited` or disabled regardless of whether its `generatedKey` still
   * corresponds to a live section (`cueTracks.ts:187-197`). A cue the user
   * tweaked on draft A therefore becomes a permanent orphan on draft B —
   * duplicated alongside draft B's own cues at draft A's bar position.
   *
   * When fixed, INVERT. Do not delete.
   */
  it('KNOWN BUG: regenerating on a new draft keeps edited cues from the old one', () => {
    const onA = songWithGeneratedCues()
    // The user renames draft A's chorus cue in the cue editor.
    const edited: SongMap = {
      ...onA,
      cueTracks: [
        {
          ...onA.cueTracks[0]!,
          events: onA.cueTracks[0]!.events.map((e) =>
            e.kind === 'section' && e.text === 'Chorus A'
              ? { ...e, text: 'BIG CHORUS', edited: true }
              : e,
          ),
        },
      ],
    }

    const onB = addDraftAndActivate(
      edited,
      { sections: [section('b1', 2, 5, 'Verse B')], harmony: [], lyrics: undefined },
      'Draft B',
      newId,
    )
    // The user hits "generate cues from sections" on draft B.
    const regenerated = generateCueTrackFromSections(onB, onB.cueTracks[0]!)

    const texts = regenerated.events.filter((e) => e.kind === 'section').map((e) => e.text)
    // Draft B's own cue is there...
    expect(texts).toContain('Verse B')
    // ...but so is draft A's edited orphan, anchored at draft A's bar 4.
    expect(texts).toContain('BIG CHORUS')
    // Un-edited generated cues from draft A ARE dropped — hence the
    // inconsistency: the same switch prunes some stale cues and keeps others.
    expect(texts).not.toContain('Intro A')
  })

  it('suppressed generated keys are draft-scoped, so suppression does not leak', () => {
    // Section ids are part of the generated key, so a key suppressed on one
    // draft can never accidentally silence a different draft's cue. This is
    // the one part of the interaction that is already correct.
    const onA = songWithGeneratedCues()
    const suppressedKey = onA.cueTracks[0]!.events.find((e) => e.kind === 'section')!.generatedKey!
    expect(suppressedKey).toContain('a1')

    const withSuppression: SongMap = {
      ...onA,
      cueTracks: [{ ...onA.cueTracks[0]!, suppressedGeneratedKeys: [suppressedKey] }],
    }
    const onB = addDraftAndActivate(
      withSuppression,
      { sections: [section('b1', 0, 3, 'Intro A')], harmony: [], lyrics: undefined },
      'Draft B',
      newId,
    )
    const regenerated = generateCueTrackFromSections(onB, onB.cueTracks[0]!)
    // Same label, different section id → NOT suppressed.
    expect(regenerated.events.filter((e) => e.kind === 'section').map((e) => e.text)).toContain(
      'Intro A',
    )
  })
})
