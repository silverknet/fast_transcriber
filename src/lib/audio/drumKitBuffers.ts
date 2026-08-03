/**
 * Kit voices as playable `AudioBuffer`s.
 *
 * A `DrumKit` stores each voice as a mono `Float32Array` at 44.1 kHz, because
 * the offline renderer sums voices sample-by-sample into a Float32Array
 * (`addClipAtOffset`). A LIVE track can't do that — it needs real buffers to
 * hand to `AudioBufferSourceNode`. This is that adapter, and it's the only
 * place the conversion happens.
 *
 * Two decisions worth knowing:
 *
 *   - Buffers are created at the KIT's rate (44.1 kHz), not the context's
 *     (usually 48 kHz). `AudioBufferSourceNode` resamples on playback, and its
 *     resampler is better than the linear one in `addClipAtOffset`. Creating
 *     the buffer at its native rate is also what keeps pitch and length right;
 *     claiming 44.1 kHz data is 48 kHz would play it sharp and short.
 *   - `VOICE_MIX_GAIN` is ALREADY baked into `kit.voices` by `withMixGains`.
 *     Do not apply it again here.
 */
import { DRUM_KIT_SAMPLE_RATE, type DrumKit } from './drumKits'
import type { DrumClass } from '$lib/songmap/types'

export const DRUM_VOICE_CLASSES: DrumClass[] = [
  'kick',
  'snare',
  'hihat',
  'tom',
  'cymbal',
  'ride',
]

export type DrumKitBuffers = Partial<Record<DrumClass, AudioBuffer>>

/**
 * Cached per (context, kit identity). Keyed by the context object so two
 * contexts never share buffers — an `AudioBuffer` belongs to the context that
 * created it and using it elsewhere throws.
 */
const cache = new WeakMap<BaseAudioContext, Map<string, DrumKitBuffers>>()

/**
 * Kits with the same id can still differ — "Your kit" is built from the user's
 * own files. Fold the voice lengths in so a changed sample set is a cache miss.
 */
function kitCacheKey(kit: DrumKit): string {
  const shape = DRUM_VOICE_CLASSES.map((c) => kit.voices[c]?.length ?? 0).join(',')
  return `${kit.id}:${shape}`
}

export function kitToAudioBuffers(ctx: BaseAudioContext, kit: DrumKit): DrumKitBuffers {
  let perCtx = cache.get(ctx)
  if (!perCtx) {
    perCtx = new Map()
    cache.set(ctx, perCtx)
  }
  const key = kitCacheKey(kit)
  const hit = perCtx.get(key)
  if (hit) return hit

  const out: DrumKitBuffers = {}
  for (const cls of DRUM_VOICE_CLASSES) {
    const voice = kit.voices[cls]
    if (!voice || voice.length === 0) continue
    const buf = ctx.createBuffer(1, voice.length, DRUM_KIT_SAMPLE_RATE)
    const copy = new Float32Array(new ArrayBuffer(voice.length * Float32Array.BYTES_PER_ELEMENT))
    copy.set(voice)
    buf.copyToChannel(copy, 0)
    out[cls] = buf
  }
  perCtx.set(key, out)
  return out
}

/** Forget cached buffers for a context — call when its kit files change. */
export function clearKitBufferCache(ctx?: BaseAudioContext): void {
  if (ctx) cache.delete(ctx)
}
