/**
 * A `KeysSynth` as a live mixer `MidiInstrument` — the host for both the chords
 * lane and the arp lane.
 *
 * The synth itself is untouched: same patch, same voice, same FX bus as the
 * Chords tab. Two things differ from the tab's live playback:
 *
 *   1. It runs on the MIXER's context, not its own private one. That is the
 *      whole point — one clock, so the chords cannot drift against the click,
 *      and the output lands on a track gain so it gets a fader and sends.
 *   2. Notes are SCHEDULED ahead via `scheduleNote` rather than fired per
 *      frame, so they are sample-accurate and follow varispeed.
 */
import { KeysSynth, structuredClonePatch, type SynthPatch } from './keysSynth'
import type { MidiInstrument, MidiVisual } from './mixerEngine'
import type { ChordPart } from './chordMachinePart'

export type KeysMidiInstrument = MidiInstrument & {
  setPart: (part: ChordPart) => void
  setPatch: (patch: SynthPatch) => void
  setVolume: (v: number) => void
  dispose: () => void
}

/** The span the lane strip draws across — a comfortable keyboard range. */
const VISUAL_LO = 36
const VISUAL_HI = 96

/**
 * Scheduling every note of a 5-minute song up front is thousands of oscillator
 * nodes. Notes are instead scheduled in a rolling window, refilled as the
 * transport advances.
 */
export const SCHEDULE_WINDOW_SEC = 8
const REFILL_AT_SEC = 4

export function createKeysMidiInstrument(
  ctx: BaseAudioContext,
  init: { part: ChordPart; patch: SynthPatch; volume?: number },
): KeysMidiInstrument {
  const input = ctx.createGain()
  input.gain.value = 1

  const synth = new KeysSynth()
  synth.setPatch(structuredClonePatch(init.patch))
  synth.setVolume(init.volume ?? 0.5)
  synth.attachContext(ctx, { destination: input })

  let part = init.part
  /** Where the last schedule pass reached, in PART time. */
  let scheduledTo = -Infinity
  /** The transport anchor of the current pass, for refills. */
  let anchor: { fromSec: number; atCtx: number; rate: number } | null = null
  let nextIndex = 0

  /** Schedule everything from `nextIndex` up to `untilPartSec`. */
  function fill(untilPartSec: number): void {
    if (!anchor) return
    const { fromSec, atCtx, rate } = anchor
    while (nextIndex < part.notes.length) {
      const n = part.notes[nextIndex]!
      if (n.atSec >= untilPartSec) break
      nextIndex++
      const delta = n.atSec - fromSec
      // A note already finished by the seek point never sounds. One still
      // sounding is re-attacked with what remains — the synth cannot start a
      // voice mid-envelope, and a hole is worse than a re-attack.
      if (delta + n.durationSec <= 0) continue
      const remaining = delta >= 0 ? n.durationSec : n.durationSec + delta
      if (!(remaining > 0.01)) continue
      const when = delta >= 0 ? atCtx + delta / rate : atCtx
      synth.scheduleNote(n.midi, n.velocity, when, remaining / rate)
    }
    scheduledTo = untilPartSec
  }

  function schedule(fromSec: number, atCtx: number, rate: number): void {
    const r = rate > 0 ? rate : 1
    anchor = { fromSec, atCtx, rate: r }
    nextIndex = 0
    // Skip past everything that ended before the seek point without touching
    // the synth — a 5-minute song seeked to its last chorus should not walk
    // thousands of notes through `scheduleNote`.
    while (
      nextIndex < part.notes.length &&
      part.notes[nextIndex]!.atSec + part.notes[nextIndex]!.durationSec <= fromSec
    ) {
      nextIndex++
    }
    fill(fromSec + SCHEDULE_WINDOW_SEC)
  }

  return {
    output: input,
    get durationSec() {
      return part.durationSec
    },
    schedule,
    /**
     * Called by the engine as the transport advances, to top the window up.
     * Cheap and idempotent: it returns immediately unless the playhead has got
     * within `REFILL_AT_SEC` of the end of what is already scheduled.
     */
    tick(positionSec: number): void {
      if (!anchor) return
      if (positionSec + REFILL_AT_SEC < scheduledTo) return
      fill(positionSec + SCHEDULE_WINDOW_SEC)
    },
    visual(): MidiVisual {
      const rows = VISUAL_HI - VISUAL_LO + 1
      return {
        rows,
        hits: part.notes.map((n) => ({
          timeSec: n.atSec,
          row: Math.max(0, Math.min(rows - 1, Math.round(n.midi) - VISUAL_LO)),
          gain: n.velocity / 127,
        })),
      }
    },
    allNotesOff(atCtxTime?: number) {
      // Scheduled voices are not in the synth's voice map, so `panic` alone
      // would leave the whole queued part playing over the new position.
      synth.stopScheduled(atCtxTime)
      synth.panic()
      anchor = null
      scheduledTo = -Infinity
      nextIndex = 0
    },
    setPart(next: ChordPart) {
      part = next
    },
    setPatch(patch: SynthPatch) {
      synth.setPatch(structuredClonePatch(patch))
    },
    setVolume(v: number) {
      synth.setVolume(v)
    },
    dispose() {
      synth.panic()
      try {
        input.disconnect()
      } catch {
        /* already gone */
      }
    },
  }
}
