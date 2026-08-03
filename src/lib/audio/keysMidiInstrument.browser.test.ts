/**
 * The chords/arp lane, rendered offline so its output can be inspected.
 *
 * The scheduling rules matter more here than for drums or bass, because this
 * instrument is the first to schedule in a ROLLING WINDOW — and because
 * `KeysSynth.scheduleNote` deliberately keeps its voices out of the voice map,
 * so `panic()` alone cannot stop them.
 */
import { describe, expect, it } from 'vitest'
import { createKeysMidiInstrument, SCHEDULE_WINDOW_SEC } from './keysMidiInstrument'
import { CHORD_PLAYBACK_INSTRUMENTS } from './chordPlayback'
import { ARP_PATCH } from './chordArp'
import type { ChordPart } from './chordMachinePart'

const SR = 44100
const PATCH = CHORD_PLAYBACK_INSTRUMENTS[0]!

const rms = (b: Float32Array, from = 0, to = b.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += b[i]! * b[i]!
  return Math.sqrt(s / Math.max(1, to - from))
}
const at = (b: Float32Array, sec: number, win = 0.25) =>
  rms(b, Math.floor(sec * SR), Math.min(b.length, Math.floor((sec + win) * SR)))

function part(
  notes: { t: number; midi?: number; dur?: number; vel?: number }[],
  durationSec = 4,
): ChordPart {
  return {
    notes: notes.map((n) => ({
      atSec: n.t,
      durationSec: n.dur ?? 0.5,
      midi: n.midi ?? 60,
      velocity: n.vel ?? 100,
    })),
    durationSec,
  }
}

async function render(
  p: ChordPart,
  opts: {
    fromSec?: number
    rate?: number
    seconds?: number
    patch?: typeof PATCH
    /** Positions to feed `tick` after scheduling, simulating the transport. */
    ticks?: number[]
    /** Stop at this context time after scheduling. */
    stopAt?: number | 'now'
  } = {},
): Promise<Float32Array> {
  const seconds = opts.seconds ?? 4
  const ctx = new OfflineAudioContext(1, Math.floor(SR * seconds), SR)
  const inst = createKeysMidiInstrument(ctx, { part: p, patch: opts.patch ?? PATCH, volume: 0.8 })
  inst.output.connect(ctx.destination)
  inst.schedule(opts.fromSec ?? 0, 0, opts.rate ?? 1)
  for (const t of opts.ticks ?? []) inst.tick!(t)
  if (opts.stopAt === 'now') inst.allNotesOff()
  else if (typeof opts.stopAt === 'number') inst.allNotesOff(opts.stopAt)
  return (await ctx.startRendering()).getChannelData(0).slice()
}

describe('keys MIDI instrument', () => {
  it('sounds a chord where the part says', async () => {
    const out = await render(part([{ t: 0.5, midi: 60 }, { t: 0.5, midi: 64 }, { t: 0.5, midi: 67 }]))
    expect(at(out, 0.6, 0.3)).toBeGreaterThan(1e-3)
  })

  it('is silent before the first note', async () => {
    const out = await render(part([{ t: 2 }]))
    expect(rms(out, 0, Math.floor(1.8 * SR))).toBeLessThan(1e-4)
  })

  it('holds a long note for its whole length', async () => {
    const out = await render(part([{ t: 0.2, dur: 2.5 }], 4))
    expect(at(out, 0.5)).toBeGreaterThan(1e-3)
    expect(at(out, 2.2)).toBeGreaterThan(1e-3)
  })

  it('plays the pitch it is asked for', async () => {
    const crossings = (b: Float32Array) => {
      let n = 0
      for (let i = Math.floor(0.6 * SR); i < Math.floor(0.9 * SR); i++) {
        if (b[i - 1]! <= 0 && b[i]! > 0) n++
      }
      return n
    }
    const low = await render(part([{ t: 0.5, midi: 43, dur: 1 }]))
    const high = await render(part([{ t: 0.5, midi: 79, dur: 1 }]))
    expect(crossings(high)).toBeGreaterThan(crossings(low))
  })

  // ── The scheduled-voice bug ─────────────────────────────────────────────
  // `scheduleNote` keeps voices OUT of the synth's voice map (a render has no
  // polyphony budget to protect), so `panic()` cannot see them. Without
  // `stopScheduled`, a seek would leave the whole queued part playing over the
  // new position — silent in a unit test, obvious on stage.

  it('allNotesOff silences notes that were scheduled but had not started', async () => {
    const out = await render(part([{ t: 1.5, dur: 2 }], 4), { stopAt: 'now' })
    expect(rms(out)).toBeLessThan(1e-4)
  })

  it('allNotesOff silences a note that is already sounding', async () => {
    const p = part([{ t: 0, dur: 3.5 }], 4)
    const stopped = await render(p, { stopAt: 'now' })
    const running = await render(p)
    // The VOICE stops; the patch's reverb tail is then free to decay on its own,
    // which is what a reverb is supposed to do. So the test is relative: after
    // the stop the lane must be far quieter than one still playing the note.
    expect(at(stopped, 1.5)).toBeLessThan(at(running, 1.5) / 20)
  })

  it('deferred allNotesOff keeps playing until the given time', async () => {
    // The bar-quantized jump commits ~80 ms early; silencing at `now` would cut
    // the lane off before the boundary it was supposed to reach.
    const out = await render(part([{ t: 0, dur: 3.5 }], 4), { stopAt: 2 })
    expect(at(out, 1.0)).toBeGreaterThan(1e-3)
    expect(at(out, 2.5)).toBeLessThan(at(out, 1.0))
  })

  // ── The rolling window ──────────────────────────────────────────────────

  it('schedules only the window up front, not the whole part', async () => {
    // A note past the window must NOT sound until a tick asks for it.
    const beyond = SCHEDULE_WINDOW_SEC + 2
    const p = part([{ t: 0.2 }, { t: beyond }], beyond + 2)
    const ctx = new OfflineAudioContext(1, Math.floor(SR * (beyond + 2)), SR)
    const inst = createKeysMidiInstrument(ctx, { part: p, patch: PATCH, volume: 0.8 })
    inst.output.connect(ctx.destination)
    inst.schedule(0, 0, 1)
    const out = (await ctx.startRendering()).getChannelData(0)
    expect(at(out, 0.3)).toBeGreaterThan(1e-3)
    expect(at(out, beyond + 0.1)).toBeLessThan(1e-4)
  })

  it('a tick refills the window so the note does sound', async () => {
    const beyond = SCHEDULE_WINDOW_SEC + 2
    const out = await render(part([{ t: 0.2 }, { t: beyond }], beyond + 2), {
      seconds: beyond + 2,
      ticks: [SCHEDULE_WINDOW_SEC - 1],
    })
    expect(at(out, beyond + 0.1)).toBeGreaterThan(1e-3)
  })

  it('a tick that is nowhere near the window edge schedules nothing new', async () => {
    // Cheap and idempotent: it runs every rAF frame.
    const beyond = SCHEDULE_WINDOW_SEC + 2
    const out = await render(part([{ t: 0.2 }, { t: beyond }], beyond + 2), {
      seconds: beyond + 2,
      ticks: [0.1, 0.2, 0.3],
    })
    expect(at(out, beyond + 0.1)).toBeLessThan(1e-4)
  })

  it('does not double-schedule a note when ticked repeatedly', async () => {
    const p = part([{ t: 0.3, dur: 0.4 }], 4)
    const once = await render(p)
    const many = await render(p, { ticks: [0.5, 1, 1.5, 2, 2.5, 3] })
    // A doubled note would be markedly louder.
    expect(Math.abs(at(many, 0.35, 0.3) - at(once, 0.35, 0.3))).toBeLessThan(1e-3)
  })

  // ── Seeking and varispeed ───────────────────────────────────────────────

  it('skips notes that finished before the seek point', async () => {
    const out = await render(part([{ t: 0.2, dur: 0.3 }, { t: 2.5 }]), { fromSec: 2 })
    expect(at(out, 0.05, 0.2)).toBeLessThan(1e-4)
    expect(at(out, 0.5)).toBeGreaterThan(1e-3)
  })

  it('re-attacks a note you seek into the middle of', async () => {
    const out = await render(part([{ t: 1, dur: 3 }], 4), { fromSec: 2, seconds: 2 })
    expect(rms(out, 0, Math.floor(0.4 * SR))).toBeGreaterThan(1e-4)
  })

  it('varispeed compresses the gaps', async () => {
    const p = part([{ t: 0.5, dur: 0.3 }, { t: 2.5, dur: 0.3 }], 4)
    const fast = await render(p, { rate: 2 })
    expect(at(fast, 0.25, 0.2)).toBeGreaterThan(1e-3)
    expect(at(fast, 1.25, 0.2)).toBeGreaterThan(1e-3)
  })

  // ── Plumbing ────────────────────────────────────────────────────────────

  it('lands on its own output, NOT on the speakers', async () => {
    // The whole point of the output seam: a lane must be routable through a
    // fader and an effect send. If the synth still hard-wired ctx.destination,
    // this would sound even with nothing connected.
    const ctx = new OfflineAudioContext(1, SR * 2, SR)
    const inst = createKeysMidiInstrument(ctx, { part: part([{ t: 0.2 }]), patch: PATCH })
    inst.schedule(0, 0, 1) // deliberately NOT connected
    const out = (await ctx.startRendering()).getChannelData(0)
    expect(rms(out)).toBeLessThan(1e-6)
  })

  it('an arp patch sounds too', async () => {
    const out = await render(part([{ t: 0.3, dur: 0.2 }, { t: 0.8, dur: 0.2 }]), { patch: ARP_PATCH })
    expect(at(out, 0.35, 0.3)).toBeGreaterThan(1e-4)
  })

  it('reports its duration and follows setPart', () => {
    const ctx = new OfflineAudioContext(1, SR, SR)
    const inst = createKeysMidiInstrument(ctx, { part: part([{ t: 0 }], 90), patch: PATCH })
    expect(inst.durationSec).toBe(90)
    inst.setPart(part([{ t: 0 }], 30))
    expect(inst.durationSec).toBe(30)
  })

  it('exposes a pitch-mapped pattern for the lane strip', () => {
    const ctx = new OfflineAudioContext(1, SR, SR)
    const inst = createKeysMidiInstrument(ctx, {
      part: part([{ t: 0.5, midi: 48 }, { t: 1, midi: 72 }], 4),
      patch: PATCH,
    })
    const v = inst.visual!()!
    expect(v.rows).toBeGreaterThan(12)
    expect(v.hits[1]!.row).toBeGreaterThan(v.hits[0]!.row)
  })

  it('an empty part renders silence rather than throwing', async () => {
    expect(rms(await render(part([])))).toBeLessThan(1e-6)
  })
})
