/**
 * The bass machine as a live `MidiInstrument`.
 *
 * Same shape as the drum one: notes are scheduled against the transport rather
 * than rendered to a WAV, so changing the sound or the pattern costs a
 * re-schedule. The voice graph comes from `bassVoiceGraph`, which the offline
 * renderer also uses — one construction, so the mixer and the export can't
 * drift apart.
 *
 * Unlike drums there is no shared bus DSP to reproduce: the bass machine's
 * offline path applies only the patch's own bus (highpass + drive) and then an
 * RMS normalize, so the live version is the same bus plus a static gain.
 */
import {
  bassVoiceSetup,
  createBassBus,
  scheduleBassNote,
  type BassVoiceSetup,
} from './bassVoiceGraph'
import { loadSampleSet } from './renderBassVoice'
import { bassSound } from './bassSounds'
import { normalizeBassTone, type BassTone } from './bassTone'
import type { MidiInstrument, MidiVisual } from './mixerEngine'
import type { BassPart } from './bassPart'

const SCHEDULE_WINDOW_SEC = 8
const REFILL_WHEN_LESS_THAN_SEC = 4
const LATE_START_FUDGE_SEC = 0.004

export type BassMidiInstrument = MidiInstrument & {
  setPart: (part: BassPart) => void
  /** Change the sound (patch or sampled set) without rebuilding the part. */
  setSound: (tone: BassTone, soundId: string | undefined) => Promise<void>
  setNormalizeGain: (g: number) => void
  dispose: () => void
}

/** Lowest/highest MIDI a bass line realistically spans, for the lane strip. */
const VISUAL_LO = 24
const VISUAL_HI = 60

function firstNoteAtOrAfter(part: BassPart, timeSec: number): number {
  let lo = 0
  let hi = part.notes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (part.notes[mid]!.atSec < timeSec) lo = mid + 1
    else hi = mid
  }
  return lo
}

export async function createBassMidiInstrument(
  ctx: BaseAudioContext,
  init: {
    part: BassPart
    tone: BassTone
    soundId?: string
    normalizeGain?: number
  },
): Promise<BassMidiInstrument> {
  let tone = normalizeBassTone(init.tone)
  let soundId = init.soundId

  // The patch's own bus (highpass + drive) lives inside the voice graph; the
  // normalize gain is a stage on top, matching the offline chain's order.
  let bus = createBassBus(ctx, tone, soundId)
  const normalize = ctx.createGain()
  normalize.gain.value = init.normalizeGain ?? 1
  bus.output.connect(normalize)

  let part = init.part
  let setup: BassVoiceSetup = bassVoiceSetup(soundId, null)
  const live = new Set<AudioScheduledSourceNode>()
  let anchor: { fromSec: number; atCtx: number; rate: number } | null = null
  let nextNoteIndex = 0
  let scheduledToSec = -Infinity

  /** Sampled sets need their files decoded before they can play. */
  async function loadSetup(): Promise<void> {
    const sound = bassSound(soundId)
    const samples =
      sound.kind === 'sample' ? await loadSampleSet(ctx, sound.dir, sound.roots) : null
    setup = bassVoiceSetup(soundId, samples)
  }
  await loadSetup()

  function stopAll(atCtxTime?: number): void {
    const deferred = atCtxTime !== undefined && atCtxTime > ctx.currentTime
    for (const src of live) {
      try {
        if (deferred) {
          src.stop(atCtxTime)
          continue
        }
        src.onended = null
        src.stop()
        src.disconnect()
      } catch {
        /* already stopped */
      }
    }
    if (!deferred) live.clear()
  }

  function scheduleOneNote(
    note: BassPart['notes'][number],
    when: number,
    durationSec: number,
    rate: number,
  ): void {
    let startAt = when
    let remaining = durationSec
    const lateBy = ctx.currentTime - startAt
    if (lateBy > 0) {
      remaining -= lateBy * rate
      startAt = ctx.currentTime + LATE_START_FUDGE_SEC
    }
    if (!(remaining > 0.01)) return

    const sources = scheduleBassNote(
      ctx,
      bus.input,
      { ...note, durationSec: remaining },
      startAt,
      tone,
      setup,
      rate,
    )
    for (const src of sources) {
      src.addEventListener?.('ended', () => live.delete(src))
      live.add(src)
    }
  }

  function scheduleTailNotes(fromSec: number): void {
    if (!anchor) return
    const firstTail = firstNoteAtOrAfter(part, fromSec - (maxNoteDurationSec() + tone.release))
    const firstFuture = firstNoteAtOrAfter(part, fromSec)
    for (let i = firstTail; i < firstFuture; i++) {
      const n = part.notes[i]!
      const remaining = n.durationSec + (n.atSec - fromSec)
      scheduleOneNote(n, anchor.atCtx, remaining, anchor.rate)
    }
    nextNoteIndex = firstFuture
  }

  function maxNoteDurationSec(): number {
    let max = 0
    for (const n of part.notes) max = Math.max(max, n.durationSec)
    return max
  }

  function scheduleFutureNotes(untilSec: number): void {
    if (!anchor) return
    const endSec = Math.max(scheduledToSec, untilSec)
    while (nextNoteIndex < part.notes.length) {
      const n = part.notes[nextNoteIndex]!
      if (n.atSec >= endSec) break
      const delta = n.atSec - anchor.fromSec
      scheduleOneNote(n, anchor.atCtx + delta / anchor.rate, n.durationSec, anchor.rate)
      nextNoteIndex++
    }
    scheduledToSec = endSec
  }

  function schedule(fromSec: number, atCtx: number, rate: number): void {
    const r = rate > 0 ? rate : 1
    anchor = { fromSec, atCtx, rate: r }
    scheduledToSec = fromSec
    nextNoteIndex = 0
    // A note that STARTED before the seek may still be sounding; the WAV lane
    // played that tail. Web Audio can't start an oscillator mid-envelope, so
    // the note is re-attacked from the seek point with what's left of it —
    // audibly continuous, which beats a hole.
    scheduleTailNotes(fromSec)
    scheduleFutureNotes(fromSec + SCHEDULE_WINDOW_SEC)
  }

  function tick(positionSec: number): void {
    if (!anchor) return
    if (positionSec + REFILL_WHEN_LESS_THAN_SEC < scheduledToSec) return
    scheduleFutureNotes(positionSec + SCHEDULE_WINDOW_SEC)
  }

  return {
    output: normalize,
    get durationSec() {
      return part.durationSec
    },
    schedule,
    tick,
    visual(): MidiVisual {
      // One row per semitone across a bass's usable span, so the strip shows
      // the actual line — root movement, octave jumps, walking runs.
      const rows = VISUAL_HI - VISUAL_LO + 1
      return {
        rows,
        hits: part.notes.map((n) => ({
          timeSec: n.atSec,
          row: Math.max(0, Math.min(rows - 1, Math.round(n.midi) - VISUAL_LO)),
          gain: n.velocity,
        })),
      }
    },
    allNotesOff(atCtxTime?: number) {
      anchor = null
      nextNoteIndex = 0
      scheduledToSec = -Infinity
      stopAll(atCtxTime)
    },
    setPart(next: BassPart) {
      part = next
    },
    async setSound(nextTone: BassTone, nextSoundId: string | undefined) {
      tone = normalizeBassTone(nextTone)
      soundId = nextSoundId
      await loadSetup()
      // The drive curve is baked into the bus, so a sound change rebuilds it.
      stopAll()
      try {
        bus.output.disconnect()
      } catch {
        /* already gone */
      }
      bus = createBassBus(ctx, tone, soundId)
      bus.output.connect(normalize)
    },
    setNormalizeGain(g: number) {
      normalize.gain.value = Math.max(0, g)
    },
    dispose() {
      stopAll()
      try {
        bus.output.disconnect()
        normalize.disconnect()
      } catch {
        /* already gone */
      }
    },
  }
}
