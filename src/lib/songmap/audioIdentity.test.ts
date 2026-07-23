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

describe('audioIdentity · recording identity (fingerprint)', () => {
  const envelope = (shape: number[]): number[] =>
    Array.from({ length: 64 }, (_, i) => shape[Math.floor((i / 64) * shape.length)]!)
  const fp = (durationSec: number, shape: number[]) => ({
    version: 1 as const,
    durationSec,
    envelope: envelope(shape),
  })

  const MASTER = fp(180, [10, 120, 240, 120, 240, 60, 255, 30])
  /** Same recording, re-encoded: quantisation jitter, same shape. */
  const TRANSCODE = fp(180.02, [12, 118, 238, 122, 242, 58, 255, 32])
  const OTHER = fp(180, [240, 30, 60, 255, 10, 200, 90, 150])

  it('rescues a sha disagreement when the recording is the same', () => {
    // THE collaboration case: I have the WAV, my bandmate has the MP3.
    // Different bytes, different size — but the grid fits both.
    expect(
      identityMatches(
        { sha256: 'wav-hash', fileSize: 52_000_000, fingerprint: MASTER },
        { sha256: 'mp3-hash', fileSize: 8_000_000, fingerprint: TRANSCODE },
      ),
    ).toBe('equivalent')
  })

  it('vetoes a metadata agreement when the recording differs', () => {
    // Two different masters can agree on every cheap field. The fingerprint
    // is the only thing that can tell them apart.
    expect(
      identityMatches(
        { durationSec: 180, sampleRate: 44100, channels: 2, fileSize: 1000, fingerprint: MASTER },
        { durationSec: 180, sampleRate: 44100, channels: 2, fileSize: 1000, fingerprint: OTHER },
      ),
    ).toBe('mismatch')
  })

  it('a byte-identical file is still reported as strict', () => {
    expect(
      identityMatches({ sha256: 'same', fingerprint: MASTER }, { sha256: 'same', fingerprint: MASTER }),
    ).toBe('strict')
  })

  it('falls back to the old behaviour when one side has no fingerprint', () => {
    expect(identityMatches({ sha256: 'a', fingerprint: MASTER }, { sha256: 'b' })).toBe('mismatch')
    expect(
      identityMatches({ durationSec: 180, fingerprint: MASTER }, { durationSec: 180 }),
    ).toBe('loose')
  })

  it('a different cut is caught on duration even with a similar shape', () => {
    expect(
      identityMatches({ fingerprint: MASTER }, { fingerprint: fp(212, [10, 120, 240, 120, 240, 60, 255, 30]) }),
    ).toBe('mismatch')
  })
})
