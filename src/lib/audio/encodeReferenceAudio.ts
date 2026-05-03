/**
 * After analysis on full-quality WAV, re-encode to a small **reference** MP3 for storage and playback.
 * Uses lamejs `Mp3Encoder` (loaded from `/vendor/lame.min.js` — see `lamejsLoader.ts`).
 *
 * Analysis stays on WAV upstream; this replaces the in-memory clip so `.smap` exports stay small.
 */

import type { SongMap } from '$lib/songmap/types'
import { ensureLamejsLoaded } from './lamejsLoader'

/** MP3 bitrate (kbps) for reference files (~64 → ~2 MB for 4 min). */
export const REFERENCE_MP3_KBPS = 64

/** @deprecated Use {@link REFERENCE_MP3_KBPS} (kbps); kept for any external string refs. */
export const REFERENCE_AUDIO_BITS_PER_SECOND = REFERENCE_MP3_KBPS * 1000

const LOG = '[reference-audio]'

const MP3_FRAME_SAMPLES = 1152

/** Reject decoded PCM that is effectively silence or near-silent (lamejs produces ~0.0002 max on some systems). */
export const REFERENCE_DECODE_MIN_PEAK = 0.01

/**
 * Max absolute sample across all channels (same scale as `decodeAudioData` float PCM).
 * Exported for unit tests with a mock {@link AudioBuffer}.
 */
export function maxAbsSampleInAudioBuffer(buf: AudioBuffer): number {
  let m = 0
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]!)
      if (a > m) m = a
    }
  }
  return m
}

/**
 * True if the browser's Web Audio API can decode this file (same `decodeAudioData` path as the waveform).
 * Lamejs MP3 or odd MIME types may encode successfully but fail here on some engines.
 */
export async function referenceFileDecodesInWebAudio(file: File): Promise<boolean> {
  const ctx = new AudioContext()
  try {
    const raw = await file.arrayBuffer()
    const buf = await ctx.decodeAudioData(raw.slice(0))
    return Number.isFinite(buf.duration) && buf.duration > 0
  } catch {
    return false
  } finally {
    await ctx.close().catch(() => {})
  }
}

/**
 * True if the file decodes with positive duration **and** non-silent PCM (audible reference).
 * Use this before swapping the session to an encoded MP3 so we never ship silent blobs.
 */
export async function referenceEncodedFileOkForSession(file: File): Promise<boolean> {
  const ctx = new AudioContext()
  try {
    const raw = await file.arrayBuffer()
    const buf = await ctx.decodeAudioData(raw.slice(0))
    if (!Number.isFinite(buf.duration) || buf.duration <= 0) return false
    return maxAbsSampleInAudioBuffer(buf) > REFERENCE_DECODE_MIN_PEAK
  } catch {
    return false
  } finally {
    await ctx.close().catch(() => {})
  }
}

/** Yield so the main thread can paint between MP3 chunks (long songs). */
const YIELD_EVERY_CHUNKS = 64

function float32ToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length)
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]!))
    out[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0
  }
  return out
}

/**
 * lamejs expects full MP3 frames; short chunks must be zero-padded to `MP3_FRAME_SAMPLES`.
 * Exported for unit tests.
 */
export function padInt16ToMp3FrameSamples(src: Int16Array, frameLen: number): Int16Array {
  if (src.length === frameLen) return src
  const out = new Int16Array(frameLen)
  out.set(src)
  return out
}

/**
 * Update `songMap.audio` so metadata matches the reference file (names, MIME; drop stale digest).
 */
export function applyReferenceClipToSongMap(map: SongMap, file: File): SongMap {
  if (!map.audio) return map
  return {
    ...map,
    audio: {
      ...map.audio,
      fileName: file.name,
      mimeType: file.type || map.audio.mimeType,
      sha256: undefined,
    },
  }
}

/**
 * Encode any audio file to a compact 64 kbps MP3 reference for `.smap` storage.
 * Accepts any format `decodeAudioData` can handle (MP3, WAV, etc.).
 * The full file is encoded — trimming is applied at runtime from `audio.trim` metadata.
 */
export async function encodeReferenceAudio(audioFile: File): Promise<File> {
  return encodeReferenceAudioFromWav(audioFile)
}

/**
 * Re-encode audio blob to a compact MP3 reference `File` for session + `.smap` export.
 * @deprecated Prefer {@link encodeReferenceAudio} for clarity.
 */
export async function encodeReferenceAudioFromWav(wavBlob: Blob): Promise<File> {
  console.debug(`${LOG} start encode, wav size bytes =`, wavBlob.size)

  const lamejs = await ensureLamejsLoaded()
  const Mp3Encoder = lamejs.Mp3Encoder

  const ctx = new AudioContext()
  try {
    console.debug(`${LOG} decoding WAV to AudioBuffer…`)
    const raw = await wavBlob.arrayBuffer()
    const buf = await ctx.decodeAudioData(raw.slice(0))
    const channels = Math.min(2, buf.numberOfChannels)
    const sampleRate = buf.sampleRate
    const frames = buf.length

    console.debug(`${LOG} decoded: channels=%s sampleRate=%s frames=%s`, channels, sampleRate, frames)

    if (frames === 0) {
      throw new Error('Reference encode: empty audio buffer.')
    }

    const leftF = buf.getChannelData(0)
    const rightF = channels > 1 ? buf.getChannelData(1) : leftF

    console.debug(`${LOG} MP3 encode ${REFERENCE_MP3_KBPS} kbps, frame=${MP3_FRAME_SAMPLES}…`)
    const enc = new Mp3Encoder(channels, sampleRate, REFERENCE_MP3_KBPS)
    const out: Uint8Array[] = []
    let chunkIndex = 0

    for (let i = 0; i < frames; i += MP3_FRAME_SAMPLES) {
      const n = Math.min(MP3_FRAME_SAMPLES, frames - i)
      const lRaw = float32ToInt16(leftF.subarray(i, i + n))
      const rRaw =
        channels > 1 ? float32ToInt16(rightF.subarray(i, i + n)) : lRaw
      const l = padInt16ToMp3FrameSamples(lRaw, MP3_FRAME_SAMPLES)
      const r = channels > 1 ? padInt16ToMp3FrameSamples(rRaw, MP3_FRAME_SAMPLES) : l
      const mp3 = enc.encodeBuffer(l, r)
      if (mp3.length > 0) out.push(new Uint8Array(mp3.buffer, mp3.byteOffset, mp3.byteLength))
      chunkIndex++
      if (chunkIndex % YIELD_EVERY_CHUNKS === 0) {
        await new Promise<void>((r) => setTimeout(r, 0))
      }
    }

    const flush = enc.flush()
    if (flush.length > 0) out.push(new Uint8Array(flush.buffer, flush.byteOffset, flush.byteLength))

    const blob = new Blob(
      out.map((u) => new Uint8Array(u)),
      { type: 'audio/mpeg' },
    )
    console.debug(`${LOG} MP3 blob size bytes =`, blob.size)

    if (blob.size === 0) {
      throw new Error('Reference MP3 encoder produced an empty file.')
    }

    return new File([blob], 'reference.mp3', {
      type: 'audio/mpeg',
      lastModified: Date.now(),
    })
  } finally {
    await ctx.close()
    console.debug(`${LOG} AudioContext closed`)
  }
}
