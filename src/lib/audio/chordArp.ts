/**
 * An ARPEGGIATOR voice for chord playback (chords view). Steps through the
 * current chord's (voiced) notes one at a time on a rhythmic grid — up, down,
 * up-down, or random — through its own {@link KeysSynth}, so it has its own
 * plucky patch + FX independent of the pad and bass.
 *
 * The step GRID is a pure function ({@link buildArpHits}); the caller watches the
 * transport playhead and fires each hit via {@link playArpNote}. Its
 * `AudioContext` is created lazily on the first {@link resumeArp} (SSR-safe).
 */
import { KeysSynth, structuredClonePatch, type SynthPatch } from './keysSynth'

export type ArpDirection = 'up' | 'down' | 'updown' | 'random'
export const ARP_DIRECTIONS: ArpDirection[] = ['up', 'down', 'updown', 'random']
export const ARP_DIRECTION_LABELS: Record<ArpDirection, string> = {
  up: 'Up',
  down: 'Down',
  updown: 'Up-Down',
  random: 'Random',
}

export type ArpRate = '1/4' | '1/8' | '1/16'
export const ARP_RATES: ArpRate[] = ['1/4', '1/8', '1/16']
export function arpSubsPerBeat(rate: ArpRate): number {
  return rate === '1/8' ? 2 : rate === '1/16' ? 4 : 1
}

/** A bright, plucky arp — short decay, delay + shimmer for sparkle. */
export const ARP_PATCH: SynthPatch = {
  name: 'Arp',
  oscA: { type: 'sawtooth', level: 0.9, detune: -6 },
  oscB: { type: 'square', level: 0.35, detune: 6 },
  filter: { cutoffHz: 2600, resonance: 1.6, velToCutoff: 0.7 },
  lfo: { rateHz: 0.4, depth: 0 },
  env: { attack: 0.003, decay: 0.16, sustain: 0.12, release: 0.14 }, // plucky
  gain: 0.42,
  fx: {
    chorus: 0.2,
    delayMix: 0.3,
    delayTime: 0.19,
    delayFeedback: 0.34,
    reverbMix: 0.2,
    reverbSize: 1.8,
    highpassHz: 180,
    reverbPredelay: 0.02,
    reverbDamp: 6500,
    drive: 0.12,
    shimmer: 0.28, // sparkle
    analog: 0.4,
    phaser: 0.18, // a little psychedelic movement out of the box
  },
}

/** Pick the note for step `s` given the chord `notes` (ascending) + direction. */
export function arpNoteAt(notes: readonly number[], s: number, dir: ArpDirection, rnd = Math.random): number {
  const n = notes.length
  if (n === 1) return notes[0]!
  if (dir === 'random') return notes[Math.floor(rnd() * n) % n]!
  if (dir === 'up') return notes[s % n]!
  if (dir === 'down') return notes[n - 1 - (s % n)]!
  // updown: 0,1,…,n-1,n-2,…,1 then repeat (endpoints not doubled)
  const period = 2 * n - 2
  const pos = s % period
  return notes[pos < n ? pos : period - pos]!
}

/** Extend a chord's notes across `octaves` (1-4) so the arp climbs higher. */
function octavePool(notes: readonly number[], octaves: number): number[] {
  const n = Math.max(1, Math.min(4, Math.round(octaves)))
  if (n === 1) return [...notes]
  const out: number[] = []
  for (let o = 0; o < n; o++) for (const m of notes) out.push(m + 12 * o)
  return out
}

/**
 * The arpeggio hit grid. `beats` are in time order; each carries the VOICED
 * chord notes sounding on it (`[]` = no chord → the arp rests + resets). The step
 * counter advances per hit and resets whenever the chord (note pool) changes, so
 * every chord starts its figure fresh. Subdivisions interpolate to the next beat.
 *
 * `octaves` widens the note pool so the figure spans several octaves; `swing`
 * (0-1) delays the off-beat sub-steps toward a shuffle for groove.
 */
export function buildArpHits(
  beats: readonly { timeSec: number; notes: number[] }[],
  subsPerBeat: number,
  direction: ArpDirection,
  octaves = 1,
  swing = 0,
  rnd = Math.random,
): { timeSec: number; midi: number }[] {
  const hits: { timeSec: number; midi: number }[] = []
  let step = 0
  let prevKey = ''
  const sw = Math.max(0, Math.min(1, swing))

  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!
    if (b.notes.length === 0) {
      prevKey = ''
      continue
    }
    const pool = octavePool(b.notes, octaves)
    const next = beats[i + 1]
    const interval = next
      ? next.timeSec - b.timeSec
      : i > 0
        ? b.timeSec - beats[i - 1]!.timeSec
        : 0.5
    const subInterval = interval / subsPerBeat
    for (let k = 0; k < subsPerBeat; k++) {
      const key = pool.join(',')
      if (key !== prevKey) {
        step = 0
        prevKey = key
      }
      // Swing: push the off-beats (odd sub-steps) later, up to ~a triplet feel.
      const swingShift = k % 2 === 1 ? sw * subInterval * 0.34 : 0
      hits.push({
        timeSec: b.timeSec + subInterval * k + swingShift,
        midi: arpNoteAt(pool, step, direction, rnd),
      })
      step++
    }
  }
  return hits
}

// ── Live engine ────────────────────────────────────────────────────────────
let synth: KeysSynth | null = null
let sounding: number | null = null
let volume = 0.5
let currentPatch: SynthPatch = ARP_PATCH

function ensureSynth(): KeysSynth {
  if (!synth) {
    synth = new KeysSynth()
    synth.setPatch(currentPatch)
    synth.setVolume(volume)
  }
  return synth
}

export async function resumeArp(): Promise<void> {
  try {
    await ensureSynth().resume()
  } catch {
    /* audio unavailable — arp is optional */
  }
}

export function setArpVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v))
  synth?.setVolume(volume)
}

export function setArpPatch(patch: SynthPatch): void {
  currentPatch = structuredClonePatch(patch)
  synth?.setPatch(currentPatch)
}

/** Play one arp note (monophonic — releases the previous step first). */
export function playArpNote(midi: number): void {
  const s = ensureSynth()
  if (sounding != null) s.noteOff(sounding)
  sounding = midi
  s.noteOn(midi, 100)
}

export function stopArp(): void {
  if (!synth || sounding == null) return
  synth.noteOff(sounding)
  sounding = null
}
