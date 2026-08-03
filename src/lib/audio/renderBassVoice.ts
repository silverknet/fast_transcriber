/**
 * The bass machine's voice, rendered through REAL Web Audio nodes.
 *
 * Earlier this was a hand-written DSP reimplementation of `KeysSynth`. It
 * never sounded like the chords-view bass, because reimplementing a synth
 * means reimplementing every detail you didn't think about: a biquad's exact
 * response vs a state-variable filter, exponential vs linear envelope ramps,
 * oscillator levels, where the saturation sits. Each is a small error; stacked,
 * they're a different instrument.
 *
 * So this builds the SAME graph `KeysSynth` does, on an `OfflineAudioContext`:
 *
 *     oscA ┐
 *          ├→ gain → BiquadFilter(lowpass) → gain(ADSR) → bus
 *     oscB ┘
 *     bus → highpass → waveshaper(drive) → out
 *
 * Same node types, same drive curve, same parameter meanings — so the
 * programmed bass and the one you play in the chords view are the same sound.
 *
 * Browser-only: `OfflineAudioContext` doesn't exist in the Node test env, so
 * this is covered by `*.browser.test.ts`.
 */
import type { BassTone } from './bassTone'
import { bassSound } from './bassSounds'
import {
  bassVoiceSetup,
  createBassBus,
  scheduleBassNote,
  type BassVoiceNote,
} from './bassVoiceGraph'

// Re-exported so existing consumers (and tests) keep their import path.
export { BASS_BUS_HIGHPASS_HZ } from './bassVoiceGraph'
export type { BassVoiceNote } from './bassVoiceGraph'






/**
 * Render `notes` to a mono Float32Array of `frames` samples.
 *
 * Each note is its own short-lived voice — no voice stealing, unlike the live
 * synth, because an offline render has no polyphony budget to protect.
 */
/**
 * Fetch and decode a sampled set's roots once. Returns null when the files
 * aren't on this machine (the sets come from the user's Logic library), so the
 * caller can fall back to the synth rather than render silence.
 */
const sampleCache = new Map<string, Promise<Map<number, AudioBuffer> | null>>()

export function clearBassSampleCache(): void {
  sampleCache.clear()
}

export async function loadSampleSet(
  ctx: BaseAudioContext,
  dir: string,
  roots: number[],
): Promise<Map<number, AudioBuffer> | null> {
  const key = `${dir}@${ctx.sampleRate}`
  const cached = sampleCache.get(key)
  if (cached) return cached
  const p = (async () => {
    if (typeof fetch !== 'function') return null
    const out = new Map<number, AudioBuffer>()
    await Promise.all(
      roots.map(async (midi) => {
        try {
          const res = await fetch(`/bass/${dir}/${midi}.wav`)
          if (!res.ok) return
          out.set(midi, await ctx.decodeAudioData(await res.arrayBuffer()))
        } catch {
          /* absent on this machine */
        }
      }),
    )
    return out.size > 0 ? out : null
  })()
  sampleCache.set(key, p)
  return p
}

/**
 * Render ONE window of the track.
 *
 * `windowStartSec` is where this window begins on the song timeline; note times
 * are rebased against it. The graph per note is identical to a single-pass
 * render, so the sound does not depend on how the track is windowed.
 */
async function renderWindow(
  notes: BassVoiceNote[],
  tone: BassTone,
  frames: number,
  sampleRate: number,
  soundId: string | undefined,
  windowStartSec: number,
): Promise<Float32Array<ArrayBuffer>> {
  const Ctor =
    (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
  if (!Ctor) throw new Error('OfflineAudioContext is unavailable (browser-only render)')
  const ctx = new Ctor(1, Math.max(1, frames), sampleRate)

  // Bus + per-note voice come from `bassVoiceGraph`, the SAME construction the
  // live MIDI bass track uses — a second copy would drift, and the difference
  // would show up much later as "the mixer sounds different from the render".
  const bus = createBassBus(ctx, tone, soundId)
  bus.output.connect(ctx.destination)

  const sound = bassSound(soundId)
  const samples =
    sound.kind === 'sample' ? await loadSampleSet(ctx, sound.dir, sound.roots) : null
  const setup = bassVoiceSetup(soundId, samples)

  for (const n of notes) {
    const start = Math.max(0, n.atSec - windowStartSec)
    scheduleBassNote(ctx, bus.input, n, start, tone, setup)
  }

  const rendered = await ctx.startRendering()
  const out = new Float32Array(new ArrayBuffer(frames * Float32Array.BYTES_PER_ELEMENT))
  out.set(rendered.getChannelData(0).subarray(0, frames))
  return out
}

/**
 * Window length, seconds. Rendering cost is (live nodes × context length), and
 * a note's filter/gain chain stays connected for the WHOLE context even after
 * the note has stopped — so one pass over a 4-minute song keeps thousands of
 * finished notes being processed to the last sample.
 *
 * Measured on a 4-minute track with 960 notes: one pass took ~46 s, while the
 * same note density in 10 s windows projected to ~2.4 s. Shorter windows keep
 * winning but the fixed per-context overhead starts to dominate.
 */
const WINDOW_SEC = 10

/**
 * Extra audio rendered BEFORE each window and then discarded. It has to cover
 * the longest note's whole life, so a note that starts before the window but is
 * still ringing inside it sounds exactly as it would in a single pass. Also
 * gives the bus high-pass time to settle, so windows join without a step.
 */
function prerollFor(notes: readonly BassVoiceNote[], tone: BassTone): number {
  let longest = 0
  for (const n of notes) longest = Math.max(longest, n.durationSec)
  return longest + tone.release + 0.25
}

// ── Render cache ────────────────────────────────────────────────────────────
// Re-rendering an unchanged track is pure waste: reopening a song, switching a
// sound back to one already tried, or any mixer reload asks for exactly the same
// audio again. The key is built from everything the render reads — the notes,
// the voice, the layout — so a hit is only possible when the result would be
// identical byte for byte.
//
// Deliberately SMALL: one 4-minute mono render is ~42 MB, so this trades a
// bounded amount of memory for the most recent couple of renders (the ones you
// are actually A/B-ing) rather than trying to remember everything.
const RENDER_CACHE_MAX = 3
const renderCache = new Map<string, Float32Array<ArrayBuffer>>()

export function clearBassVoiceRenderCache(): void {
  renderCache.clear()
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4
}

/** Everything that can change a sample of the output, and nothing that can't. */
export function bassVoiceRenderKey(
  notes: readonly BassVoiceNote[],
  tone: BassTone,
  frames: number,
  sampleRate: number,
  soundId?: string,
): string {
  const raw = JSON.stringify({
    v: 1,
    f: frames,
    sr: sampleRate,
    s: soundId ?? '',
    tone,
    n: notes.map((n) => [round4(n.atSec), round4(n.durationSec), n.midi, round4(n.velocity)]),
  })
  // djb2, same as the other fingerprints in the project.
  let h = 5381
  for (let i = 0; i < raw.length; i++) h = (h * 33) ^ raw.charCodeAt(i)
  return `${(h >>> 0).toString(16).padStart(8, '0')}:${raw.length}`
}

/**
 * Render the programmed bass to a mono buffer.
 *
 * Split into windows (see `WINDOW_SEC`) purely for speed — the per-note graph is
 * identical either way, so the result is the same instrument. Each window
 * re-renders `preroll` seconds of lead-in and throws it away, which is what
 * makes a note straddling a boundary come out whole.
 *
 * Results are cached; an unchanged track is never rendered twice.
 */
export async function renderBassVoice(
  notes: BassVoiceNote[],
  tone: BassTone,
  frames: number,
  sampleRate: number,
  soundId?: string,
): Promise<Float32Array<ArrayBuffer>> {
  const cacheKey = bassVoiceRenderKey(notes, tone, frames, sampleRate, soundId)
  const hit = renderCache.get(cacheKey)
  if (hit) {
    // Re-insert so the most recently used entry is the last to be evicted.
    renderCache.delete(cacheKey)
    renderCache.set(cacheKey, hit)
    // A copy, so a caller mutating its buffer can't poison the cache.
    const copy = new Float32Array(new ArrayBuffer(hit.length * Float32Array.BYTES_PER_ELEMENT))
    copy.set(hit)
    return copy
  }

  const rendered = await renderUncached(notes, tone, frames, sampleRate, soundId)

  const stored = new Float32Array(new ArrayBuffer(rendered.length * Float32Array.BYTES_PER_ELEMENT))
  stored.set(rendered)
  renderCache.set(cacheKey, stored)
  while (renderCache.size > RENDER_CACHE_MAX) {
    const oldest = renderCache.keys().next().value
    if (oldest === undefined) break
    renderCache.delete(oldest)
  }
  return rendered
}

async function renderUncached(
  notes: BassVoiceNote[],
  tone: BassTone,
  frames: number,
  sampleRate: number,
  soundId?: string,
): Promise<Float32Array<ArrayBuffer>> {
  const totalSec = frames / sampleRate
  const preroll = prerollFor(notes, tone)

  // Windowing only pays off when the window is comfortably longer than the
  // lead-in it has to re-render. Very long notes (or a very short song) fall
  // back to a single pass, which is what this always used to do.
  if (totalSec <= WINDOW_SEC || preroll >= WINDOW_SEC / 2) {
    return renderWindow(notes, tone, frames, sampleRate, soundId, 0)
  }

  const out = new Float32Array(new ArrayBuffer(frames * Float32Array.BYTES_PER_ELEMENT))
  const windowFrames = Math.round(WINDOW_SEC * sampleRate)
  const prerollFrames = Math.round(preroll * sampleRate)

  for (let startFrame = 0; startFrame < frames; startFrame += windowFrames) {
    const keepFrames = Math.min(windowFrames, frames - startFrame)
    const windowStartSec = startFrame / sampleRate
    const renderStartSec = Math.max(0, windowStartSec - preroll)
    // The lead-in is shorter at the very start of the song (nothing before 0).
    const leadFrames = startFrame - Math.round(renderStartSec * sampleRate)

    // Anything that has already finished by the window start cannot contribute,
    // so each pass only builds the handful of notes that are actually alive.
    const windowEndSec = windowStartSec + keepFrames / sampleRate
    const live = notes.filter((n) => {
      const endsAt = n.atSec + n.durationSec + tone.release
      return endsAt > renderStartSec && n.atSec < windowEndSec
    })

    const chunk = await renderWindow(
      live,
      tone,
      leadFrames + keepFrames,
      sampleRate,
      soundId,
      renderStartSec,
    )
    out.set(chunk.subarray(leadFrames, leadFrames + keepFrames), startFrame)
  }

  return out
}

/** Exposed for tests: the windowing must not change what the track sounds like. */
export const __renderBassVoiceInternals = { WINDOW_SEC, prerollFor, renderWindow }
