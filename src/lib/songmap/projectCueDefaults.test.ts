/**
 * "IF THE PROJECT SAYS ANNOUNCE, EVERY SONG ANNOUNCES." — as a derivation,
 * not a promise about button presses.
 *
 * The old model materialized the introduction as a generated event per song,
 * written by a bulk pass. That made the guarantee false in the two ways that
 * matter on a stage: a song added AFTER the pass silently did not announce,
 * and a renamed song kept announcing its old title, frozen in the event.
 *
 * Now the project setting is read wherever cues are rendered or played
 * (`announceTitle` through `buildCueSpeechEvents`), and an intro EVENT means
 * only "say these words instead". These tests are that model's contract.
 */
import { describe, expect, it } from 'vitest'
import {
  SPOKEN_INTRO_KEY,
  applyProjectCueDefaults,
  ensurePerformerCueTracks,
  generateCueTrackFromSections,
} from './cueTracks'
import { buildCueSpeechEvents, resolvedSpokenIntroText } from '$lib/audio/cueTrackSpeechSchedule'
import { createEmptySongMap } from './factory'
import type { CueEvent, CueTrack, Section, SongMap } from './types'

const BAND = [
  { id: 'p1', name: 'Martin' },
  { id: 'p2', name: 'Thor' },
  { id: 'p3', name: 'Emma' },
]

function song(title: string): SongMap {
  const barCount = 4
  const barSec = 2
  const bars = Array.from({ length: barCount }, (_, i) => ({
    id: `bar${i}`,
    index: i,
    startSec: i * barSec,
    endSec: (i + 1) * barSec,
    beatCount: 4,
    beatIds: Array.from({ length: 4 }, (_, k) => `b${i}_${k}`),
  }))
  const beats = bars.flatMap((bar, bi) =>
    Array.from({ length: 4 }, (_, k) => ({
      id: `b${bi}_${k}`,
      barId: bar.id,
      indexInBar: k,
      timeSec: bar.startSec + k * (barSec / 4),
    })),
  )
  const sections: Section[] = [
    { id: 's1', kind: 'verse', label: 'Verse', barRange: { startBarIndex: 0, endBarIndex: 1 } },
    { id: 's2', kind: 'chorus', label: 'Chorus', barRange: { startBarIndex: 2, endBarIndex: 3 } },
  ]
  const sm = createEmptySongMap()
  return {
    ...sm,
    metadata: { ...sm.metadata, title },
    audio: { ...sm.audio!, fileName: 'x.wav', trim: { startSec: 0, endSec: barCount * barSec } },
    timeline: { ...sm.timeline, bars, beats },
    sections,
  } as SongMap
}

let n = 0
const ids = () => `id${n++}`
const apply = (sm: SongMap, performers = BAND) =>
  applyProjectCueDefaults(sm, { performers, idFactory: ids })

const titleLine = (sm: SongMap, track: CueTrack | undefined, announceTitle: boolean) =>
  buildCueSpeechEvents(sm, track, { announceTitle }).find((e) => e.kind === 'title')

describe('every performer gets a cue track, in every song', () => {
  it('creates one track per performer, linked by id', () => {
    const out = apply(song('Valerie'))
    expect(out.cueTracks).toHaveLength(3)
    expect(out.cueTracks.map((t) => t.performerId)).toEqual(['p1', 'p2', 'p3'])
    expect(out.cueTracks.map((t) => t.name)).toEqual(['Martin', 'Thor', 'Emma'])
  })

  it('is idempotent — running it twice changes nothing further', () => {
    const once = apply(song('Valerie'))
    const twice = apply(once)
    expect(twice.cueTracks).toHaveLength(3)
    expect(twice.cueTracks.map((t) => t.id)).toEqual(once.cueTracks.map((t) => t.id))
  })

  it('adopts an existing unlinked track instead of orphaning the user’s work', () => {
    const base = song('Valerie')
    const withMain: SongMap = {
      ...base,
      cueTracks: [
        { id: 'main', name: 'Main cues', enabled: true, events: [], suppressedGeneratedKeys: ['keep-me'] },
      ],
    }
    const out = apply(withMain)
    expect(out.cueTracks[0]!.id).toBe('main')
    expect(out.cueTracks[0]!.performerId).toBe('p1')
    expect(out.cueTracks[0]!.suppressedGeneratedKeys).toContain('keep-me')
  })
})

describe('the announcement is DERIVED — the setting alone decides', () => {
  it('a song the bulk pass has NEVER touched announces when the setting is on', () => {
    // The core of the guarantee: no button press required. This is the "song
    // added to the project later" case that broke the old model.
    const fresh = song('Sommartider')
    expect(titleLine(fresh, undefined, true)?.text).toMatch(/Sommartider/)
  })

  it('does not announce when the setting is off — same song, same data', () => {
    const fresh = song('Sommartider')
    expect(titleLine(fresh, undefined, false)).toBeUndefined()
  })

  it('renaming the song changes what is spoken, with nothing regenerated', () => {
    // The frozen-title bug of the old model: the event carried the render-time
    // title forever. Derived means the CURRENT title speaks.
    const before = song('Valerie')
    expect(titleLine(before, undefined, true)?.text).toMatch(/Valerie/)
    const renamed: SongMap = { ...before, metadata: { ...before.metadata, title: 'Valerie (live)' } }
    expect(titleLine(renamed, undefined, true)?.text).toMatch(/Valerie \(live\)/)
  })

  it('an intro EVENT is a text override, never the switch', () => {
    const sm = apply(song('Valerie (Amy Winehouse cover) — live'))
    const withOverride: SongMap = {
      ...sm,
      cueTracks: sm.cueTracks.map((t, i) =>
        i === 0
          ? {
              ...t,
              events: [
                {
                  id: 'x',
                  kind: 'intro',
                  enabled: true,
                  anchor: { kind: 'time', timeSec: 0 },
                  text: 'Winehouse',
                } as CueEvent,
                ...t.events,
              ],
            }
          : t,
      ),
    }
    // Setting ON + override → the override's words.
    expect(titleLine(withOverride, withOverride.cueTracks[0], true)?.text).toMatch(/Winehouse/)
    // Setting OFF → silence, even though the override event exists. The event
    // does not switch anything on.
    expect(titleLine(withOverride, withOverride.cueTracks[0], false)).toBeUndefined()
    // And the resolver agrees.
    expect(resolvedSpokenIntroText(withOverride, withOverride.cueTracks[0])).toBe('Winehouse')
  })
})

describe('migration from the materialized model', () => {
  const generatedIntro = (text: string): CueEvent => ({
    id: 'cue_intro_song',
    kind: 'intro',
    enabled: true,
    anchor: { kind: 'time', timeSec: 0 },
    text,
    generatedKey: SPOKEN_INTRO_KEY,
    source: 'custom',
  })

  it('strips the old generated intro events — they froze the title', () => {
    const base = apply(song('Valerie'))
    const withDebris: SongMap = {
      ...base,
      cueTracks: base.cueTracks.map((t) => ({ ...t, events: [generatedIntro('Valerie'), ...t.events] })),
    }
    const migrated = apply(withDebris)
    for (const track of migrated.cueTracks) {
      expect(track.events.find((e) => e.kind === 'intro')).toBeUndefined()
    }
  })

  it('keeps an EDITED one — that is a real override someone typed', () => {
    const base = apply(song('Valerie'))
    const withEdit: SongMap = {
      ...base,
      cueTracks: base.cueTracks.map((t, i) =>
        i === 0
          ? { ...t, events: [{ ...generatedIntro('Winehouse'), edited: true }, ...t.events] }
          : t,
      ),
    }
    const migrated = apply(withEdit)
    expect(migrated.cueTracks[0]!.events.find((e) => e.kind === 'intro')?.text).toBe('Winehouse')
  })

  it('regenerating sections does not resurrect or disturb any of it', () => {
    const migrated = apply(apply(song('Valerie')))
    const track = migrated.cueTracks[0]!
    const again = generateCueTrackFromSections(migrated, track, { idFactory: ids })
    expect(again.events.find((e) => e.kind === 'intro')).toBeUndefined()
    // Section cues themselves are intact.
    expect(again.events.some((e) => e.kind === 'section')).toBe(true)
  })
})

describe('helpers stay honest', () => {
  it('ensurePerformerCueTracks leaves a linked track untouched', () => {
    const sm = song('Valerie')
    const linked: SongMap = {
      ...sm,
      cueTracks: [
        { id: 'a', name: 'Martin', enabled: true, performerId: 'p1', events: [], suppressedGeneratedKeys: [] },
      ],
    }
    const out = ensurePerformerCueTracks(linked, BAND, { idFactory: ids })
    expect(out.cueTracks).toHaveLength(3)
    expect(out.cueTracks[0]).toEqual(linked.cueTracks[0])
  })
})
