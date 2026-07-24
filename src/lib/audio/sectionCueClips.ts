/**
 * Per-section "lead-in" cue clips for the live performance rig: when a
 * performer launches a section, play a short clip that counts in and lands
 * exactly on the section's downbeat.
 *
 * Two things make it sound like a musician rather than a robot:
 *   1. The section NAME is the "1" — "Verse, two, three, four" — not "one two…".
 *   2. The numbers are synthesized as ONE connected phrase ("two three four")
 *      and sliced onto the beats, so they share a single natural pitch contour
 *      instead of four separately-intoned words with jumpy pitch. If slicing
 *      can't cleanly find the words, it falls back to per-word synthesis.
 *
 * Pure DSP — no Web Audio / network here; both TTS fetch and WAV decode are
 * injected so this is fully unit-testable in Node.
 */
import {
  addClipAtOffset,
  CUE_SAMPLE_RATE,
  resampleMonoSpeedup,
  SPEECH_MIX_GAIN,
  trimLeadingSilence,
} from '$lib/audio/renderCueTrack'
import { NUMBER_WORDS } from '$lib/songmap/cueTracks'

/** Speed count words up slightly so they're punchy, not draggy. Uniform, so it
 *  never reintroduces pitch VARIATION between numbers. */
const COUNT_SPEEDUP = 1.15
/** A count word may occupy at most this fraction of a beat — its tail is
 *  trimmed so a long word can't bleed into the next beat (keeps it tight). */
const COUNT_MAX_SLOT_FRAC = 0.72

export type SectionCueSpec = {
  sectionId: string
  /** Spoken section name, e.g. "Chorus". When present it becomes the count's "1". */
  speechText?: string
  /** How many count-in beats before the downbeat (0/undefined = none). */
  countInBeats?: number
  /** Seconds between count beats (the tempo at that section's start). Must be > 0 when countInBeats > 0. */
  beatDurationSec: number
}

export type SectionCueClipData = {
  sectionId: string
  /** Mono PCM at `sampleRate`. */
  data: Float32Array
  sampleRate: number
  /** Time (sec) within `data` that corresponds to the section downbeat. The
   *  caller schedules the clip to start at (downbeatCtxTime - downbeatOffsetSec). */
  downbeatOffsetSec: number
}

export type SectionCueRenderDeps = {
  /** Text-to-speech: returns a WAV blob or an error. Injected (desktop Piper in prod). */
  fetchTts: (text: string) => Promise<{ ok: true; blob: Blob } | { ok: false; error: string }>
  /** Decode a WAV blob to mono PCM + its sample rate. Injected (AudioContext.decodeAudioData in prod). */
  decodeWav: (blob: Blob) => Promise<{ data: Float32Array; sampleRate: number }>
}

/** Gap between the spoken name's audible end and the downbeat, when there's no count-in. */
const NAME_TO_DOWNBEAT_GAP_SEC = 0.15

type ClipPiece = { data: Float32Array; sampleRate: number }

/** Fetch + decode + trim one TTS phrase. Never throws — returns null on any failure. */
async function fetchTtsPiece(text: string, deps: SectionCueRenderDeps): Promise<ClipPiece | null> {
  const res = await deps.fetchTts(text)
  if (!res.ok) return null
  let decoded: { data: Float32Array; sampleRate: number }
  try {
    decoded = await deps.decodeWav(res.blob)
  } catch {
    return null
  }
  let samples = decoded.data
  if (samples.length > 0) samples = trimLeadingSilence(samples, decoded.sampleRate)
  return { data: samples, sampleRate: decoded.sampleRate }
}

/**
 * Split a spoken phrase into `expectedWords` word clips by energy onsets, so a
 * naturally-intoned "two three four" can be re-placed on the beat grid. Returns
 * null if the number of detected words doesn't match (caller falls back).
 * Syllable dips within a word are bridged by merging runs closer than ~90 ms.
 */
export function sliceWordsByOnset(
  samples: Float32Array,
  sampleRate: number,
  expectedWords: number,
): Float32Array[] | null {
  if (expectedWords <= 1) return expectedWords === 1 ? [samples] : null
  const win = Math.max(1, Math.floor(0.01 * sampleRate)) // 10 ms RMS windows
  const env: number[] = []
  for (let i = 0; i < samples.length; i += win) {
    let sum = 0
    const end = Math.min(i + win, samples.length)
    for (let j = i; j < end; j++) sum += samples[j]! * samples[j]!
    env.push(Math.sqrt(sum / Math.max(1, end - i)))
  }
  let peak = 0
  for (const e of env) if (e > peak) peak = e
  if (peak <= 0) return null
  const thresh = 0.12 * peak

  // Voiced runs (contiguous windows above threshold).
  const runs: { start: number; end: number }[] = []
  let inWord = false
  let startIdx = 0
  for (let k = 0; k < env.length; k++) {
    if (env[k]! > thresh) {
      if (!inWord) {
        inWord = true
        startIdx = k
      }
    } else if (inWord) {
      inWord = false
      runs.push({ start: startIdx, end: k })
    }
  }
  if (inWord) runs.push({ start: startIdx, end: env.length })

  // Bridge intra-word syllable gaps (< ~90 ms).
  const mergeGap = Math.ceil(0.09 / 0.01)
  const words: { start: number; end: number }[] = []
  for (const r of runs) {
    const last = words[words.length - 1]
    if (last && r.start - last.end < mergeGap) last.end = r.end
    else words.push({ ...r })
  }
  if (words.length !== expectedWords) return null

  // Slice: each word from its onset to the midpoint of the gap before the next.
  const clips: Float32Array[] = []
  for (let w = 0; w < words.length; w++) {
    const startSample = words[w]!.start * win
    const endSample =
      w + 1 < words.length
        ? Math.floor(((words[w]!.end + words[w + 1]!.start) / 2) * win)
        : samples.length
    clips.push(samples.slice(startSample, Math.min(endSample, samples.length)))
  }
  return clips
}

/** Offset (sec) from a clip's start to its first LOUD moment — roughly the
 *  vowel/stress, which is the part the ear hears "on the beat". Aligning this
 *  (not the raw start) to the beat is what makes the count feel on-time. */
function loudOnsetSec(samples: Float32Array, sampleRate: number): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]!)
    if (a > peak) peak = a
  }
  if (peak <= 0) return 0
  const thresh = 0.45 * peak
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]!) >= thresh) return i / sampleRate
  }
  return 0
}

/** Punchier + tighter: speed the word up, then trim its tail (with a tiny fade
 *  to avoid a click) so it can't run into the next beat. */
function tightenCountClip(clip: ClipPiece, beatDurationSec: number): ClipPiece {
  let data = clip.data
  if (data.length > 1) data = resampleMonoSpeedup(data, COUNT_SPEEDUP)
  const maxSamples = Math.floor(COUNT_MAX_SLOT_FRAC * beatDurationSec * clip.sampleRate)
  if (maxSamples > 0 && data.length > maxSamples) {
    data = data.slice(0, maxSamples)
    const fade = Math.min(data.length, Math.floor(0.006 * clip.sampleRate))
    for (let k = 0; k < fade; k++) data[data.length - 1 - k]! *= k / fade
  }
  return { data, sampleRate: clip.sampleRate }
}

/**
 * Clips for the numeric beats, in order. Tries one natural phrase sliced by
 * onset (shared pitch contour); falls back to per-word synthesis.
 */
async function renderCountNumbers(
  words: string[],
  deps: SectionCueRenderDeps,
): Promise<(ClipPiece | null)[]> {
  if (words.length === 0) return []
  const phrase = await fetchTtsPiece(words.join(' '), deps)
  if (phrase && phrase.data.length > 0) {
    const sliced = sliceWordsByOnset(phrase.data, phrase.sampleRate, words.length)
    if (sliced) return sliced.map((data) => ({ data, sampleRate: phrase.sampleRate }))
  }
  // Fallback: per-word (reliable, but each word carries its own intonation).
  const out: (ClipPiece | null)[] = []
  for (const w of words) out.push(await fetchTtsPiece(w, deps))
  return out
}

/** Render a lead-in clip per spec. Specs with neither speech nor count are
 *  skipped. TTS failures skip the affected piece; never throws on TTS. */
export async function renderSectionCueClips(
  specs: SectionCueSpec[],
  deps: SectionCueRenderDeps,
): Promise<Map<string, SectionCueClipData>> {
  const out = new Map<string, SectionCueClipData>()

  for (const spec of specs) {
    const name = spec.speechText?.trim() ?? ''
    const hasSpeech = name.length > 0
    const hasCount = !!spec.countInBeats && spec.countInBeats > 0 && spec.beatDurationSec > 0
    if (!hasSpeech && !hasCount) continue

    const beat = spec.beatDurationSec
    const placements: { startRelDownbeat: number; clip: ClipPiece }[] = []

    if (hasCount) {
      const n = spec.countInBeats!
      // Beat 0 is the section name (the musician's "1"); if there's no name,
      // beat 0 is "one". The remaining beats are the numbers, synthesized as
      // one connected phrase so their pitch is consistent.
      const nameOnOne = hasSpeech
      const firstNumberBeat = nameOnOne ? 1 : 0
      const numberTexts: string[] = []
      for (let i = firstNumberBeat; i < n; i++) numberTexts.push(NUMBER_WORDS[i] ?? String(i + 1))

      // One clip per beat, in order (beat 0..n-1).
      const beatClips: (ClipPiece | null)[] = []
      if (nameOnOne) beatClips.push(await fetchTtsPiece(name, deps))
      for (const c of await renderCountNumbers(numberTexts, deps)) beatClips.push(c)

      for (let i = 0; i < beatClips.length; i++) {
        const raw = beatClips[i]
        if (!raw) continue
        const clip = tightenCountClip(raw, beat)
        // Place so the word's STRESS lands on the beat (not its raw start).
        const anchor = loudOnsetSec(clip.data, clip.sampleRate)
        placements.push({ startRelDownbeat: (i - n) * beat - anchor, clip })
      }
    } else {
      // Speech only, no count-in: the name ends just before the downbeat.
      const nameClip = await fetchTtsPiece(name, deps)
      if (nameClip) {
        const dur = nameClip.data.length / nameClip.sampleRate
        placements.push({ startRelDownbeat: -NAME_TO_DOWNBEAT_GAP_SEC - dur, clip: nameClip })
      }
    }

    if (placements.length === 0) continue

    const earliestStart = Math.min(...placements.map((p) => p.startRelDownbeat))
    const downbeatOffsetSec = Math.max(0, -earliestStart)
    const frames = Math.max(1, Math.ceil(downbeatOffsetSec * CUE_SAMPLE_RATE))
    const data = new Float32Array(frames)

    for (const p of placements) {
      const offsetSec = p.startRelDownbeat + downbeatOffsetSec
      addClipAtOffset(data, CUE_SAMPLE_RATE, p.clip.data, p.clip.sampleRate, offsetSec, SPEECH_MIX_GAIN)
    }

    let peak = 0
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]!)
      if (a > peak) peak = a
    }
    if (peak > 0.99) {
      const s = 0.99 / peak
      for (let i = 0; i < data.length; i++) data[i]! *= s
    }

    out.set(spec.sectionId, {
      sectionId: spec.sectionId,
      data,
      sampleRate: CUE_SAMPLE_RATE,
      downbeatOffsetSec,
    })
  }

  return out
}
