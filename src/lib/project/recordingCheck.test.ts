import { describe, expect, it } from 'vitest'
import { checkRecordingMatchesShared, formatDurationShort } from './recordingCheck'
import type { AudioFingerprint } from '$lib/audio/audioFingerprint'
import type { SongMap } from '$lib/songmap/types'

function fingerprint(durationSec: number, shape: number[]): AudioFingerprint {
  return {
    version: 1,
    durationSec,
    envelope: Array.from({ length: 64 }, (_, i) => shape[Math.floor((i / 64) * shape.length)]!),
  }
}

const MASTER = fingerprint(222, [10, 120, 240, 120, 240, 60, 255, 30])
/** Same master, re-encoded — jitter in the buckets, same shape. */
const TRANSCODE = fingerprint(222.03, [12, 118, 238, 122, 242, 58, 255, 32])
const OTHER_MIX = fingerprint(222, [240, 30, 60, 255, 10, 200, 90, 150])
const LONGER_CUT = fingerprint(251, [10, 120, 240, 120, 240, 60, 255, 30])

function song(local?: AudioFingerprint, shared?: AudioFingerprint): SongMap {
  return {
    audio: local ? { fingerprint: local } : undefined,
    expectedAudio: shared ? { fileName: 'shared.wav', fingerprint: shared } : undefined,
  } as unknown as SongMap
}

describe('checkRecordingMatchesShared', () => {
  it('accepts a different encoding of the same master', () => {
    // The everyday collaboration case: my WAV vs their MP3. Must be silent.
    expect(checkRecordingMatchesShared(song(MASTER, TRANSCODE))).toEqual({ status: 'ok' })
  })

  it('flags a different mix of the same length as a CONTENT difference', () => {
    const r = checkRecordingMatchesShared(song(MASTER, OTHER_MIX))
    expect(r.status).toBe('different')
    if (r.status !== 'different') return
    expect(r.reason).toBe('content')
  })

  it('flags a longer cut as a LENGTH difference, with both durations', () => {
    const r = checkRecordingMatchesShared(song(MASTER, LONGER_CUT))
    expect(r.status).toBe('different')
    if (r.status !== 'different') return
    expect(r.reason).toBe('length')
    expect(r.localDurationSec).toBe(222)
    expect(r.sharedDurationSec).toBe(251)
  })

  it('stays quiet when the song is not shared', () => {
    expect(checkRecordingMatchesShared(song(MASTER, undefined))).toEqual({ status: 'unknown' })
  })

  it('stays quiet when either side predates recording identity', () => {
    expect(checkRecordingMatchesShared(song(undefined, MASTER))).toEqual({ status: 'unknown' })
    expect(checkRecordingMatchesShared(song(undefined, undefined))).toEqual({ status: 'unknown' })
  })

  it('stays quiet on a null song rather than throwing', () => {
    expect(checkRecordingMatchesShared(null)).toEqual({ status: 'unknown' })
    expect(checkRecordingMatchesShared(undefined)).toEqual({ status: 'unknown' })
  })

  it('treats a flat (silent) fingerprint as unknown, not as a mismatch', () => {
    const flat = fingerprint(222, [0])
    expect(checkRecordingMatchesShared(song(flat, flat))).toEqual({ status: 'unknown' })
  })
})

describe('formatDurationShort', () => {
  it('formats minutes and seconds', () => {
    expect(formatDurationShort(222)).toBe('3:42')
    expect(formatDurationShort(251)).toBe('4:11')
    expect(formatDurationShort(9)).toBe('0:09')
    expect(formatDurationShort(0)).toBe('0:00')
  })

  it('degrades gracefully on missing or nonsense input', () => {
    expect(formatDurationShort(undefined)).toBe('—')
    expect(formatDurationShort(Number.NaN)).toBe('—')
    expect(formatDurationShort(-5)).toBe('—')
  })
})
