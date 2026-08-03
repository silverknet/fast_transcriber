/**
 * Per-performer monitor mixes: a project default, overridable per song.
 *
 * The whole value of this is that a performer sets their balance once and it
 * follows them through the set. So the tests care most about the inheritance
 * being real — a song that overrides one level must keep INHERITING the rest,
 * not silently take a copy that stops tracking.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PERFORMER_MIX,
  hasSongOverride,
  laneIsSilent,
  levelForLane,
  parsePerformerMix,
  resolvePerformerMix,
  type PerformerMix,
} from './performerMix'
import { stemNameForKey } from '$lib/audio/liveStemDefaults'

const emma: PerformerMix = {
  stems: { vocals: 0.2, drums: 0.6, bass: 0.9 },
  click: 0.5,
}

const resolved = (base?: PerformerMix, over?: PerformerMix) => resolvePerformerMix(base, over)
const lvl = (mix: ReturnType<typeof resolvePerformerMix>, key: string) =>
  levelForLane(mix, key, stemNameForKey(key))

describe('a performer with no settings at all', () => {
  it('gets sane defaults rather than silence', () => {
    // Silence-by-default would mean a new performer hears nothing and has no
    // way to know why.
    const m = resolved()
    expect(lvl(m, 'stem:drums.wav')).toBe(DEFAULT_PERFORMER_MIX.fallback)
    expect(lvl(m, 'original')).toBe(DEFAULT_PERFORMER_MIX.original)
  })

  it('has the click and the cues ABOVE the music', () => {
    // They are information, not entertainment. A click you strain for is the
    // same as no click.
    const m = resolved()
    expect(m.click).toBeGreaterThan(m.fallback)
    expect(m.cue).toBeGreaterThanOrEqual(m.click)
  })
})

describe('the project default carries across songs', () => {
  it('applies to every lane the performer named', () => {
    const m = resolved(emma)
    expect(lvl(m, 'stem:vocals.wav')).toBe(0.2)
    expect(lvl(m, 'stem:drums.wav')).toBe(0.6)
    expect(lvl(m, 'stem:bass.wav')).toBe(0.9)
    expect(lvl(m, 'click')).toBe(0.5)
  })

  it('matches a stem by NAME, not by filename', () => {
    // Lane keys carry filenames and differ per song; a default keyed on those
    // would apply to some songs and not others for no visible reason.
    for (const key of ['stem:drums.wav', 'stem:Drums_1.wav', 'stem:DRUMS.mp3']) {
      expect(lvl(resolved(emma), key)).toBe(0.6)
    }
  })

  it('an unrecognised lane falls back rather than going silent', () => {
    // Turning something audible into silence because the code did not know the
    // name is the worst available default.
    expect(lvl(resolved(emma), 'stem:tambourine.wav')).toBe(DEFAULT_PERFORMER_MIX.fallback)
    expect(lvl(resolved(emma), 'drum-machine')).toBe(DEFAULT_PERFORMER_MIX.fallback)
  })
})

describe('a song override changes ONLY what it names', () => {
  it('overriding the click keeps the performer’s stem balance', () => {
    // The failure this guards: taking a wholesale copy, so overriding one
    // level silently drops every other preference.
    const m = resolved(emma, { stems: {}, click: 1 })
    expect(m.click).toBe(1)
    expect(lvl(m, 'stem:vocals.wav')).toBe(0.2)
    expect(lvl(m, 'stem:bass.wav')).toBe(0.9)
  })

  it('overriding one stem leaves the others inherited', () => {
    const m = resolved(emma, { stems: { drums: 1 } })
    expect(lvl(m, 'stem:drums.wav')).toBe(1)
    expect(lvl(m, 'stem:vocals.wav')).toBe(0.2)
    expect(m.click).toBe(0.5)
  })

  it('keeps inheriting — changing the default moves the un-overridden song', () => {
    // Inheritance, not a copy. A copy stops tracking silently, and nobody finds
    // out until the gig.
    const override: PerformerMix = { stems: { drums: 1 } }
    expect(resolved(emma, override).click).toBe(0.5)
    expect(resolved({ ...emma, click: 0.1 }, override).click).toBe(0.1)
  })

  it('can silence a lane for one song', () => {
    const m = resolved(emma, { stems: { vocals: 0 } })
    expect(laneIsSilent(m, 'stem:vocals.wav', 'vocals')).toBe(true)
    expect(laneIsSilent(m, 'stem:bass.wav', 'bass')).toBe(false)
  })
})

describe('"following your default" vs "overridden here"', () => {
  it('an EMPTY override is not an override', () => {
    // Otherwise opening the editor quietly detaches the song from the default
    // it was happily inheriting.
    expect(hasSongOverride(undefined)).toBe(false)
    expect(hasSongOverride({ stems: {} })).toBe(false)
  })

  it('any named level counts as an override', () => {
    expect(hasSongOverride({ stems: { drums: 0.5 } })).toBe(true)
    expect(hasSongOverride({ stems: {}, click: 0.5 })).toBe(true)
    expect(hasSongOverride({ stems: {}, cue: 0 })).toBe(true)
  })

  it('a level of ZERO is still an override', () => {
    // "I want no vocals in this song" is a decision, not an absence.
    expect(hasSongOverride({ stems: {}, cue: 0 })).toBe(true)
    expect(resolved(emma, { stems: {}, cue: 0 }).cue).toBe(0)
  })
})

describe('reading a stored mix', () => {
  it('keeps valid levels and clamps out-of-range ones', () => {
    const m = parsePerformerMix({ stems: { drums: 0.5, bass: 2, vocals: -1 }, click: 0.7 })!
    expect(m.stems.drums).toBe(0.5)
    expect(m.stems.bass).toBe(1)
    expect(m.stems.vocals).toBe(0)
    expect(m.click).toBe(0.7)
  })

  it('drops junk instead of trusting it', () => {
    const m = parsePerformerMix({ stems: { drums: 'loud', bass: null }, click: 'yes' })!
    expect(m.stems).toEqual({})
    expect(m.click).toBeUndefined()
  })

  it('returns nothing for a non-object', () => {
    for (const junk of [null, undefined, 7, 'mix', []]) {
      const m = parsePerformerMix(junk)
      if (Array.isArray(junk)) expect(m?.stems).toEqual({})
      else expect(m).toBeUndefined()
    }
  })

  it('survives a save/load round trip', () => {
    const back = parsePerformerMix(JSON.parse(JSON.stringify(emma)))!
    expect(back.stems).toEqual(emma.stems)
    expect(back.click).toBe(emma.click)
  })
})
