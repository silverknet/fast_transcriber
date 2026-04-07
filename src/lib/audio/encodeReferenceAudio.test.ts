import { describe, expect, it } from 'vitest'
import { createSongMapFromAudioSession } from '$lib/songmap/factory'
import {
  applyReferenceClipToSongMap,
  maxAbsSampleInAudioBuffer,
  padInt16ToMp3FrameSamples,
  REFERENCE_DECODE_MIN_PEAK,
} from './encodeReferenceAudio'

function mockAudioBuffer(
  channels: Float32Array[],
): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    getChannelData: (c: number) => channels[c]!,
  } as AudioBuffer
}

describe('maxAbsSampleInAudioBuffer', () => {
  it('returns max absolute sample across channels', () => {
    const buf = mockAudioBuffer([
      new Float32Array([0.1, -0.4]),
      new Float32Array([0.2, 0.05]),
    ])
    expect(maxAbsSampleInAudioBuffer(buf)).toBeCloseTo(0.4, 5)
  })

  it('treats near-zero buffers as below audible threshold', () => {
    const buf = mockAudioBuffer([new Float32Array([1e-6, -1e-6])])
    expect(maxAbsSampleInAudioBuffer(buf) > REFERENCE_DECODE_MIN_PEAK).toBe(false)
  })
})

describe('padInt16ToMp3FrameSamples', () => {
  it('zero-pads short arrays to frame length', () => {
    const src = new Int16Array([100, 200])
    const out = padInt16ToMp3FrameSamples(src, 1152)
    expect(out.length).toBe(1152)
    expect(out[0]).toBe(100)
    expect(out[1]).toBe(200)
    expect(out[2]).toBe(0)
  })

  it('returns same reference when already full length', () => {
    const src = new Int16Array(1152)
    src[0] = 42
    const out = padInt16ToMp3FrameSamples(src, 1152)
    expect(out).toBe(src)
    expect(out[0]).toBe(42)
  })
})

describe('applyReferenceClipToSongMap', () => {
  it('updates audio metadata to match reference file', () => {
    const map = createSongMapFromAudioSession({
      file: new File([], 'old.wav', { type: 'audio/wav' }),
      name: 'old.wav',
      startSec: 0,
      endSec: 10,
    })
    const ref = new File([new Uint8Array([1])], 'reference.mp3', { type: 'audio/mpeg' })
    const next = applyReferenceClipToSongMap(map, ref)
    expect(next.audio?.fileName).toBe('reference.mp3')
    expect(next.audio?.mimeType).toBe('audio/mpeg')
    expect(next.audio?.sha256).toBeUndefined()
  })
})

/**
 * Full WAV → lame MP3 → decodeAudioData → peak check needs `AudioContext` and `/vendor/lame.min.js`
 * (browser). Run manual QA after changing the encoder; Node CI covers PCM/peek helpers above.
 */
describe.skip('encodeReferenceAudioFromWav round-trip (browser + lame)', () => {
  it('placeholder — enable when Vitest runs in a browser environment with lame loaded', () => {
    expect(true).toBe(true)
  })
})
