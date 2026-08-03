/**
 * Offline mix of any combination of stems + cue track into a single WAV.
 *
 * Each selected blob is decoded, channel-aligned (mono sources are
 * duplicated to stereo when stereo sources are present), and summed at a
 * common sample rate (44.1 kHz). Result is peak-normalized below clipping
 * and rendered to a 16-bit WAV Blob ready for download.
 *
 * Time alignment: every source starts at t=0 of the output. Stems from
 * Demucs and the BarBro cue track both begin at the original song's t=0
 * frame (the cue track has its own preamble baked in, but stems do not).
 * If a future caller needs trim/prelude alignment, pass an `offsetSec` per
 * source — for v1 we sum at t=0.
 */
import { audioBufferToWavBlob } from '$lib/audio/trimAudio'
import {
  renderBufferThroughMasterChain,
  renderBufferThroughStemChain,
} from '$lib/audio/mastering'
import type { AutoStemName, ProjectMastering } from '$lib/project/types'

export interface BackingMixSource {
  /** Human-readable label for error reporting. */
  label: string
  blob: Blob
  /** Seconds to delay this source on the output timeline (default 0). */
  offsetSec?: number
  /** Per-source gain multiplier (default 1). */
  gain?: number
  /**
   * Mastering stem type — set for musical stems so the project-sound chain is
   * applied. Cue/click sources leave it unset and are never processed.
   */
  stemKind?: AutoStemName | null
}

export interface BackingMixOptions {
  /** Project-sound config; when enabled the export matches the Overview mixer. */
  mastering?: ProjectMastering
}

const TARGET_SAMPLE_RATE = 44100

/** Linear-interpolation resample of a single channel to a new length + rate. */
function linearResample(src: Float32Array, srcRate: number, destRate: number): Float32Array {
  if (srcRate === destRate) return src
  const destLen = Math.max(1, Math.round((src.length / srcRate) * destRate))
  const out = new Float32Array(destLen)
  for (let j = 0; j < destLen; j++) {
    const srcPos = (j / destRate) * srcRate
    const i = Math.floor(srcPos)
    const frac = srcPos - i
    const s0 = src[i] ?? 0
    const s1 = src[Math.min(i + 1, src.length - 1)] ?? 0
    out[j] = (1 - frac) * s0 + frac * s1
  }
  return out
}

/** Number of output channels: 2 if any source is stereo, else 1. */
function deriveChannelCount(bufs: AudioBuffer[]): number {
  return bufs.some((b) => b.numberOfChannels >= 2) ? 2 : 1
}

/** Pull `channelIndex` from a buffer; if mono and channelIndex=1, return ch 0. */
function getChannel(buf: AudioBuffer, channelIndex: number): Float32Array {
  if (buf.numberOfChannels === 0) return new Float32Array(0)
  const ix = Math.min(channelIndex, buf.numberOfChannels - 1)
  return buf.getChannelData(ix)
}

/**
 * Mix the given sources into a single WAV at 44.1 kHz. Returns the encoded
 * blob ready for download. Throws if no sources are provided or none decode.
 */
export async function mixBackingTrack(
  sources: BackingMixSource[],
  opts: BackingMixOptions = {},
): Promise<Blob> {
  if (sources.length === 0) throw new Error('No sources selected')

  const mastering = opts.mastering?.enabled ? opts.mastering : undefined
  // OFFLINE: this decodes and allocates buffers, never plays. It must not
  // hold a hardware AudioContext slot. See `audioDevice.ts`.
  const ac = new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE)
  try {
    type Decoded = { src: BackingMixSource; buf: AudioBuffer }
    const decoded: Decoded[] = []
    const failures: string[] = []
    for (const src of sources) {
      try {
        let buf = await ac.decodeAudioData(await src.blob.arrayBuffer())
        // Project sound: same per-stem chain the Overview mixer plays through.
        if (mastering && src.stemKind) {
          buf = await renderBufferThroughStemChain(buf, src.stemKind, mastering)
        }
        decoded.push({ src, buf })
      } catch (e) {
        failures.push(`${src.label}: ${e instanceof Error ? e.message : 'decode failed'}`)
      }
    }
    if (decoded.length === 0) {
      throw new Error(`Could not decode any source. ${failures.join('; ')}`)
    }

    const channels = deriveChannelCount(decoded.map((d) => d.buf))

    // Determine total output frames: max of (offset + resampled length) across sources.
    let maxFrames = 0
    for (const { src, buf } of decoded) {
      const offset = Math.max(0, Math.round((src.offsetSec ?? 0) * TARGET_SAMPLE_RATE))
      const lenAtTarget = Math.round((buf.length / buf.sampleRate) * TARGET_SAMPLE_RATE)
      maxFrames = Math.max(maxFrames, offset + lenAtTarget)
    }

    const out: Float32Array[] = []
    for (let c = 0; c < channels; c++) out.push(new Float32Array(maxFrames))

    for (const { src, buf } of decoded) {
      const offset = Math.max(0, Math.round((src.offsetSec ?? 0) * TARGET_SAMPLE_RATE))
      const gain = src.gain ?? 1
      for (let c = 0; c < channels; c++) {
        const srcCh = getChannel(buf, c)
        const resampled = linearResample(srcCh, buf.sampleRate, TARGET_SAMPLE_RATE)
        const dst = out[c]!
        const copyLen = Math.min(resampled.length, dst.length - offset)
        for (let i = 0; i < copyLen; i++) {
          dst[offset + i]! += resampled[i]! * gain
        }
      }
    }

    // Project sound: glue + limiter over the summed mix (same as the mixer's
    // master bus). Runs before the peak safety-net below.
    if (mastering?.masterGlue) {
      const summed = ac.createBuffer(channels, maxFrames, TARGET_SAMPLE_RATE)
      for (let c = 0; c < channels; c++) {
        summed.copyToChannel(out[c]! as Float32Array<ArrayBuffer>, c, 0)
      }
      const mastered = await renderBufferThroughMasterChain(summed, mastering)
      for (let c = 0; c < channels; c++) {
        out[c]!.set(mastered.getChannelData(Math.min(c, mastered.numberOfChannels - 1)))
      }
    }

    // Peak-normalize below 0 dBFS to avoid clipping after summing.
    let peak = 0
    for (const ch of out) {
      for (let i = 0; i < ch.length; i++) {
        const a = Math.abs(ch[i]!)
        if (a > peak) peak = a
      }
    }
    if (peak > 0.98) {
      const scale = 0.98 / peak
      for (const ch of out) {
        for (let i = 0; i < ch.length; i++) ch[i]! *= scale
      }
    }

    const outBuf = ac.createBuffer(channels, maxFrames, TARGET_SAMPLE_RATE)
    for (let c = 0; c < channels; c++) {
      outBuf.copyToChannel(out[c]! as Float32Array<ArrayBuffer>, c, 0)
    }

    return audioBufferToWavBlob(outBuf)
  } finally {
    // Nothing to close: an OfflineAudioContext holds no hardware slot.
  }
}
