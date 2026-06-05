import { describe, expect, it } from 'vitest'
import {
  identityMatchesStrict,
  identityMatchesLoose,
  identityMatches,
  identityFromAudioRef,
} from './audioIdentity'

describe('audioIdentity · identityMatchesStrict (cross-kind)', () => {
  it('returns true when sha256 matches sha256', () => {
    expect(
      identityMatchesStrict({ sha256: 'aaa' }, { sha256: 'aaa' }),
    ).toBe(true)
  })

  it('returns true when originalSha256 matches originalSha256', () => {
    expect(
      identityMatchesStrict({ originalSha256: 'bbb' }, { originalSha256: 'bbb' }),
    ).toBe(true)
  })

  it('returns true on cross-kind match (local sha256 == expected originalSha256)', () => {
    // This is the load-bearing case fixed in Phase 5: scanned files
    // know one sha; the SongMap may carry it under either field.
    expect(
      identityMatchesStrict({ sha256: 'xxx' }, { originalSha256: 'xxx' }),
    ).toBe(true)
  })

  it('returns true on cross-kind match (local originalSha256 == expected sha256)', () => {
    expect(
      identityMatchesStrict({ originalSha256: 'yyy' }, { sha256: 'yyy' }),
    ).toBe(true)
  })

  it('returns false when both sides have shas but none coincide', () => {
    expect(
      identityMatchesStrict(
        { sha256: 'aaa', originalSha256: 'bbb' },
        { sha256: 'ccc', originalSha256: 'ddd' },
      ),
    ).toBe(false)
  })

  it('returns null when local has no shas', () => {
    expect(identityMatchesStrict({}, { sha256: 'aaa' })).toBeNull()
  })

  it('returns null when expected has no shas', () => {
    expect(identityMatchesStrict({ sha256: 'aaa' }, {})).toBeNull()
  })

  it('ignores empty-string shas', () => {
    expect(identityMatchesStrict({ sha256: '' }, { sha256: '' })).toBeNull()
  })
})

describe('audioIdentity · identityMatchesLoose', () => {
  it('matches when every comparable field agrees', () => {
    expect(
      identityMatchesLoose(
        { durationSec: 100, sampleRate: 44100, channels: 2, fileSize: 12345 },
        { durationSec: 100.05, sampleRate: 44100, channels: 2, fileSize: 12345 },
      ),
    ).toBe(true)
  })

  it('rejects mismatched sample rate', () => {
    expect(
      identityMatchesLoose(
        { durationSec: 100, sampleRate: 44100 },
        { durationSec: 100, sampleRate: 48000 },
      ),
    ).toBe(false)
  })

  it('tolerates duration drift within 0.1s', () => {
    expect(
      identityMatchesLoose({ durationSec: 100 }, { durationSec: 100.09 }),
    ).toBe(true)
  })

  it('rejects duration drift beyond tolerance', () => {
    expect(
      identityMatchesLoose({ durationSec: 100 }, { durationSec: 100.2 }),
    ).toBe(false)
  })

  it('returns false when nothing is comparable', () => {
    expect(identityMatchesLoose({}, {})).toBe(false)
  })

  it('a missing field on one side is not a deal-breaker', () => {
    expect(
      identityMatchesLoose(
        { durationSec: 100, sampleRate: 44100 },
        { durationSec: 100 },
      ),
    ).toBe(true)
  })
})

describe('audioIdentity · identityMatches (combined)', () => {
  it('strict match wins outright', () => {
    expect(
      identityMatches({ sha256: 'aaa', durationSec: 0 }, { sha256: 'aaa', durationSec: 999 }),
    ).toBe('strict')
  })

  it('falls back to loose when strict is undecided', () => {
    expect(
      identityMatches(
        { durationSec: 100, sampleRate: 44100 },
        { durationSec: 100, sampleRate: 44100 },
      ),
    ).toBe('loose')
  })

  it('returns "mismatch" when strict says no', () => {
    expect(
      identityMatches({ sha256: 'aaa' }, { sha256: 'bbb', durationSec: 0 }),
    ).toBe('mismatch')
  })

  it('returns "undecided" when neither path resolves', () => {
    expect(identityMatches({}, {})).toBe('undecided')
  })
})

describe('audioIdentity · identityFromAudioRef', () => {
  it('projects the relevant fields and tolerates nulls', () => {
    expect(identityFromAudioRef(null)).toEqual({})
    expect(identityFromAudioRef(undefined)).toEqual({})
    const projected = identityFromAudioRef({
      fileName: 'a.wav',
      durationSec: 234.5,
      sampleRate: 44100,
      channels: 2,
      fileSize: 100,
      sha256: 'abc',
      originalSha256: 'def',
      trim: { startSec: 0, endSec: 234.5 },
      source: 'upload',
    })
    expect(projected.fileName).toBe('a.wav')
    expect(projected.sha256).toBe('abc')
    expect(projected.originalSha256).toBe('def')
  })
})
