/**
 * A CUE TRACK MUST SURVIVE BEING SAVED AND RE-OPENED.
 *
 * `parseCueTrack` builds an explicit object literal, which is a whitelist
 * whether or not anyone calls it one: a field absent from it is dropped on
 * load. Serialization writes the whole track, so `performerId` and
 * `spokenCountIn` reached disk perfectly and then evaporated on the next open.
 *
 * That failure mode is the worst kind. It is not "the feature does not work" —
 * it is "the feature works until you close the project", which reads as the app
 * losing your data at random. The identical defect in the desktop sidecar's
 * manifest whitelist silently ate the performer roster over and over.
 *
 * So this test is deliberately written to fail for the NEXT field as well:
 * it walks the keys of a fully-populated track rather than checking a list
 * someone has to remember to extend.
 */
import { describe, expect, it } from 'vitest'
import { parseSongMap } from './parse'
import { serializeSongMap } from './serialize'
import { validateSongMap } from './validate'
import { createEmptySongMap } from './factory'
import type { CueTrack, SongMap } from './types'

/** Every optional field set to something distinctive. */
const FULL_TRACK: CueTrack = {
  id: 'track-1',
  name: "Martin's cues",
  enabled: true,
  voiceId: 'en_US-lessac-medium',
  performerId: 'performer-abc',
  spokenCountIn: true,
  // This performer's monitor mix for this song. Added AFTER the whitelist trap
  // was found, so it is covered from the start rather than after it bites.
  mix: { stems: { drums: 0.6, vocals: 0.2 }, click: 0.5, cue: 1 },
  events: [],
  suppressedGeneratedKeys: ['section:s1:verse:0'],
}

function withTrack(track: CueTrack): SongMap {
  const sm = createEmptySongMap()
  return { ...sm, cueTracks: [track] }
}

/** Save and re-open, exactly as the app does — JSON text out, JSON text in. */
function roundTrip(sm: SongMap): SongMap {
  return parseSongMap(serializeSongMap(sm))
}

describe('a cue track survives save and re-open', () => {
  it('keeps EVERY field it was given — not a remembered subset', () => {
    // Walks the keys rather than asserting a list, so the next field added to
    // `CueTrack` and forgotten in `parseCueTrack` fails here instead of on
    // someone's stage.
    const after = roundTrip(withTrack(FULL_TRACK)).cueTracks[0]!
    for (const key of Object.keys(FULL_TRACK) as (keyof CueTrack)[]) {
      expect(after[key], `cue track lost "${key}" on reload`).toEqual(FULL_TRACK[key])
    }
  })

  it('keeps the performer link — the one that makes a track SOMEBODY’s cues', () => {
    // Without this, generating cue tracks for every performer across a project
    // looks perfect and is empty the next time the project opens.
    expect(roundTrip(withTrack(FULL_TRACK)).cueTracks[0]!.performerId).toBe('performer-abc')
  })

  it('keeps the spoken count-in switch', () => {
    expect(roundTrip(withTrack(FULL_TRACK)).cueTracks[0]!.spokenCountIn).toBe(true)
  })

  it('leaves an unlinked track unlinked rather than inventing a performer', () => {
    const bare: CueTrack = {
      id: 'main',
      name: 'Main cues',
      enabled: true,
      events: [],
      suppressedGeneratedKeys: [],
    }
    const after = roundTrip(withTrack(bare)).cueTracks[0]!
    expect(after.performerId).toBeUndefined()
    expect(after.spokenCountIn).toBeUndefined()
  })

  it('ignores junk in those fields instead of trusting it', () => {
    const raw = JSON.parse(serializeSongMap(withTrack(FULL_TRACK))) as Record<string, unknown>
    const tracks = raw.cueTracks as Record<string, unknown>[]
    tracks[0]!.performerId = 42
    tracks[0]!.spokenCountIn = 'yes'
    const after = parseSongMap(JSON.stringify(raw)).cueTracks[0]!
    expect(after.performerId).toBeUndefined()
    expect(after.spokenCountIn).toBeUndefined()
  })
})

describe('validation knows about them', () => {
  it('accepts a fully-populated track', () => {
    expect(validateSongMap(withTrack(FULL_TRACK)).errors).toEqual([])
  })

  it('rejects a performer link that is not a string', () => {
    const bad = { ...FULL_TRACK, performerId: 7 as unknown as string }
    expect(validateSongMap(withTrack(bad)).errors.join(' ')).toMatch(/performerId invalid/)
  })

  it('rejects a spoken count-in that is not a boolean', () => {
    const bad = { ...FULL_TRACK, spokenCountIn: 'on' as unknown as boolean }
    expect(validateSongMap(withTrack(bad)).errors.join(' ')).toMatch(/spokenCountIn invalid/)
  })
})
