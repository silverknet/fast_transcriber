import { describe, expect, it } from 'vitest'
import type { AutoStemName } from '$lib/project/types'
import {
  LEGACY_LIVE_STEMS,
  isStemLaneKey,
  stemNameForKey,
  audibleStemSet,
  isStemLaneAudible,
  hasAudibleStemLane,
} from './liveStemDefaults'

/**
 * The pure decision layer for project-wide "standard stems" in live mode. A
 * wrong answer here is the wrong thing coming out of the PA on stage, so this is
 * locked hard: both lane-key naming schemes, the legacy fallback, ad-hoc stems,
 * and the "never silent" original-mix fallback.
 */
describe('stemNameForKey — both naming schemes', () => {
  it('maps disk keys (stem:drums.wav)', () => {
    expect(stemNameForKey('stem:vocals.wav')).toBe('vocals')
    expect(stemNameForKey('stem:drums.wav')).toBe('drums')
    expect(stemNameForKey('stem:bass.wav')).toBe('bass')
    expect(stemNameForKey('stem:other.wav')).toBe('other')
  })
  it('maps Collab cloud keys (stem:Drums)', () => {
    expect(stemNameForKey('stem:Vocals')).toBe('vocals')
    expect(stemNameForKey('stem:Drums')).toBe('drums')
    expect(stemNameForKey('stem:Bass')).toBe('bass')
    expect(stemNameForKey('stem:Other')).toBe('other')
  })
  it('returns null for non-stem lanes and unknown ad-hoc stems', () => {
    expect(stemNameForKey('original')).toBeNull()
    expect(stemNameForKey('cue')).toBeNull()
    expect(stemNameForKey('click')).toBeNull()
    expect(stemNameForKey('stem:guitar.wav')).toBeNull()
  })
})

describe('isStemLaneKey', () => {
  it('is true only for stem: lanes', () => {
    expect(isStemLaneKey('stem:bass.wav')).toBe(true)
    expect(isStemLaneKey('original')).toBe(false)
    expect(isStemLaneKey('cue')).toBe(false)
  })
})

describe('audibleStemSet — legacy fallback', () => {
  it('falls back to all-except-vocals when unset', () => {
    expect(audibleStemSet(undefined)).toEqual(LEGACY_LIVE_STEMS)
    expect(LEGACY_LIVE_STEMS).toEqual(['drums', 'bass', 'other'])
  })
  it('uses the config verbatim when set (including empty = nothing audible)', () => {
    expect(audibleStemSet(['drums', 'bass'])).toEqual(['drums', 'bass'])
    expect(audibleStemSet([])).toEqual([])
  })
})

describe('isStemLaneAudible', () => {
  const gigNoRhythm: AutoStemName[] = ['drums', 'bass'] // no live drummer/bassist

  it('unmutes exactly the configured stems, mutes the rest', () => {
    expect(isStemLaneAudible('stem:drums.wav', gigNoRhythm)).toBe(true)
    expect(isStemLaneAudible('stem:bass.wav', gigNoRhythm)).toBe(true)
    expect(isStemLaneAudible('stem:vocals.wav', gigNoRhythm)).toBe(false)
    expect(isStemLaneAudible('stem:other.wav', gigNoRhythm)).toBe(false)
  })
  it('works across the cloud naming scheme too', () => {
    expect(isStemLaneAudible('stem:Drums', gigNoRhythm)).toBe(true)
    expect(isStemLaneAudible('stem:Vocals', gigNoRhythm)).toBe(false)
  })
  it('reproduces the legacy default when config is unset (vocals muted, rest audible)', () => {
    expect(isStemLaneAudible('stem:vocals.wav', undefined)).toBe(false)
    expect(isStemLaneAudible('stem:drums.wav', undefined)).toBe(true)
    expect(isStemLaneAudible('stem:bass.wav', undefined)).toBe(true)
    expect(isStemLaneAudible('stem:other.wav', undefined)).toBe(true)
  })
  it('keeps ad-hoc non-Demucs stems audible (unless vocal-ish), never silently dropped', () => {
    expect(isStemLaneAudible('stem:guitar.wav', gigNoRhythm)).toBe(true)
    expect(isStemLaneAudible('stem:keys.wav', [])).toBe(true)
    expect(isStemLaneAudible('stem:backing-vocal.wav', gigNoRhythm)).toBe(false)
  })
  it('empty config silences every recognized stem', () => {
    expect(isStemLaneAudible('stem:drums.wav', [])).toBe(false)
    expect(isStemLaneAudible('stem:bass.wav', [])).toBe(false)
  })
})

describe('hasAudibleStemLane — the "never silent" fallback signal', () => {
  const gigNoRhythm: AutoStemName[] = ['drums', 'bass']

  it('true when the song has a selected stem present', () => {
    expect(hasAudibleStemLane(['original', 'stem:drums.wav', 'stem:vocals.wav'], gigNoRhythm)).toBe(true)
  })
  it('false when the song has stems but NONE are selected → original should stay audible', () => {
    expect(hasAudibleStemLane(['original', 'stem:vocals.wav', 'stem:other.wav'], gigNoRhythm)).toBe(false)
  })
  it('false when the song has no stems at all (only a full mix)', () => {
    expect(hasAudibleStemLane(['original', 'cue', 'click'], gigNoRhythm)).toBe(false)
  })
  it('ignores non-stem lanes when scanning', () => {
    expect(hasAudibleStemLane(['cue', 'click', 'original'], undefined)).toBe(false)
  })
})
