/**
 * The live drum instrument, rendered offline so its output can be inspected.
 *
 * These check the things that would be silent failures in the app: hits landing
 * at the wrong moment, a seek punching a hole in a ringing cymbal, a kit swap
 * moving the groove, or a stopped part still ringing.
 */
import { describe, expect, it } from 'vitest'
import { createDrumMidiInstrument } from './drumMidiInstrument'
import { buildSynthKit, type DrumKit } from './drumKits'
import type { DrumPart } from './drumPart'

const SR = 44100

const kit = (): DrumKit => ({ id: 'synth', label: 'Electronic kit', voices: buildSynthKit() })

const rms = (b: Float32Array, from = 0, to = b.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += b[i]! * b[i]!
  return Math.sqrt(s / Math.max(1, to - from))
}
const at = (b: Float32Array, sec: number, win = 0.02) =>
  rms(b, Math.floor(sec * SR), Math.floor((sec + win) * SR))

function part(hits: { t: number; cls?: DrumPart['hits'][0]['cls'] }[], durationSec = 4): DrumPart {
  return {
    hits: hits.map((h) => ({ mixTimeSec: h.t, cls: h.cls ?? 'kick', gain: 1 })),
    durationSec,
  }
}

/** Render an instrument's output for `seconds`, scheduling from `fromSec`. */
async function render(
  p: DrumPart,
  opts: {
    fromSec?: number
    rate?: number
    seconds?: number
    k?: DrumKit
    tickPositions?: number[]
  } = {},
): Promise<Float32Array> {
  const seconds = opts.seconds ?? 4
  const ctx = new OfflineAudioContext(2, Math.floor(SR * seconds), SR)
  const inst = await createDrumMidiInstrument(ctx, { part: p, kit: opts.k ?? kit() })
  inst.output.connect(ctx.destination)
  inst.schedule(opts.fromSec ?? 0, 0, opts.rate ?? 1)
  for (const pos of opts.tickPositions ?? []) inst.tick?.(pos)
  const out = await ctx.startRendering()
  return out.getChannelData(0).slice()
}

describe('drum MIDI instrument', () => {
  it('places hits where the part says', async () => {
    const out = await render(part([{ t: 0.5 }, { t: 1.5 }]))
    expect(at(out, 0.5)).toBeGreaterThan(1e-3)
    expect(at(out, 1.5)).toBeGreaterThan(1e-3)
    expect(at(out, 1.0)).toBeLessThan(at(out, 0.5))
  })

  it('is silent before the first hit', async () => {
    const out = await render(part([{ t: 1.0 }]))
    expect(rms(out, 0, Math.floor(0.9 * SR))).toBeLessThan(1e-4)
  })

  it('skips hits before the scheduling point', async () => {
    // Seeking to 2 s must not replay the whole song from the top.
    const out = await render(part([{ t: 0.2 }, { t: 2.5 }]), { fromSec: 2 })
    expect(at(out, 0.2)).toBeLessThan(1e-4)
    expect(at(out, 0.5)).toBeGreaterThan(1e-3) // 2.5 s, played 0.5 s in
  })

  it('keeps a voice that was already ringing when you seek into it', async () => {
    // The WAV lane played the tail of a cymbal that started before the seek.
    // Dropping it would punch an obvious hole mid-crash.
    const out = await render(part([{ t: 1.9, cls: 'cymbal' }]), { fromSec: 2, seconds: 2 })
    expect(rms(out, 0, Math.floor(0.2 * SR))).toBeGreaterThan(1e-4)
  })

  it('drops a voice that finished long before the seek', async () => {
    const out = await render(part([{ t: 0.1, cls: 'kick' }]), { fromSec: 2, seconds: 2 })
    expect(rms(out)).toBeLessThan(1e-4)
  })

  it('varispeed compresses the gaps between hits', async () => {
    const p = part([{ t: 0.5 }, { t: 1.5 }])
    const fast = await render(p, { rate: 2 })
    // At 2× the second hit lands at 0.5 s of wall time, not 1.5 s.
    expect(at(fast, 0.5)).toBeGreaterThan(1e-3)
    expect(at(fast, 1.5)).toBeLessThan(at(fast, 0.5))
  })

  it('refills long parts in a rolling window instead of scheduling the whole song up front', async () => {
    const p = part([{ t: 8.6 }], 10)

    const noRefill = await render(p, { seconds: 9.4 })
    expect(at(noRefill, 8.6)).toBeLessThan(1e-4)

    const refilled = await render(p, { seconds: 9.4, tickPositions: [5] })
    expect(at(refilled, 8.6)).toBeGreaterThan(1e-4)
  }, 30_000)

  it('reports its duration from the part', async () => {
    const ctx = new OfflineAudioContext(2, SR, SR)
    const inst = await createDrumMidiInstrument(ctx, { part: part([{ t: 0 }], 123), kit: kit() })
    expect(inst.durationSec).toBe(123)
    inst.setPart(part([{ t: 0 }], 45))
    expect(inst.durationSec).toBe(45)
  })

  it('allNotesOff silences everything, including the reverb tail', async () => {
    const ctx = new OfflineAudioContext(2, SR * 2, SR)
    const inst = await createDrumMidiInstrument(ctx, {
      part: part([{ t: 0.05, cls: 'cymbal' }]),
      kit: kit(),
    })
    inst.output.connect(ctx.destination)
    inst.schedule(0, 0, 1)
    inst.allNotesOff()
    const out = (await ctx.startRendering()).getChannelData(0)
    expect(rms(out, Math.floor(0.2 * SR), SR * 2)).toBeLessThan(1e-4)
  })

  it('swapping the kit changes the sound but not the timing', async () => {
    const p = part([{ t: 0.5 }, { t: 1.5 }])
    const a = await render(p)
    const quiet: DrumKit = {
      ...kit(),
      voices: Object.fromEntries(
        Object.entries(kit().voices).map(([k, v]) => [k, v.map((x) => x * 0.25)]),
      ) as DrumKit['voices'],
    }
    const b = await render(p, { k: quiet })
    // Same onsets…
    expect(at(b, 0.5)).toBeGreaterThan(1e-4)
    expect(at(b, 1.5)).toBeGreaterThan(1e-4)
    // …different level.
    expect(rms(b)).toBeLessThan(rms(a))
  })

  it('setKit does not move the hits', async () => {
    const ctx = new OfflineAudioContext(2, SR * 3, SR)
    const p = part([{ t: 0.5 }, { t: 1.5 }])
    const inst = await createDrumMidiInstrument(ctx, { part: p, kit: kit() })
    inst.output.connect(ctx.destination)
    inst.setKit(kit()) // swap before scheduling
    inst.schedule(0, 0, 1)
    const out = (await ctx.startRendering()).getChannelData(0)
    expect(at(out, 0.5)).toBeGreaterThan(1e-3)
    expect(at(out, 1.5)).toBeGreaterThan(1e-3)
  })

  it('exposes its pattern for the lane strip to draw', async () => {
    // A MIDI lane has no waveform; showing the actual grid is what makes the
    // strip useful instead of an empty box.
    const ctx = new OfflineAudioContext(2, SR, SR)
    const inst = await createDrumMidiInstrument(ctx, {
      part: part([{ t: 0.5, cls: 'kick' }, { t: 1, cls: 'ride' }], 4),
      kit: kit(),
    })
    const v = inst.visual!()!
    expect(v.rows).toBe(6)
    expect(v.hits.map((h) => h.timeSec)).toEqual([0.5, 1])
    // Row 0 is the kick and draws at the bottom; the ride sits above it.
    expect(v.hits[0]!.row).toBe(0)
    expect(v.hits[1]!.row).toBeGreaterThan(0)
    for (const h of v.hits) expect(h.gain).toBeGreaterThan(0)
  })

  it('the drawn pattern follows setPart, so edits show immediately', async () => {
    const ctx = new OfflineAudioContext(2, SR, SR)
    const inst = await createDrumMidiInstrument(ctx, { part: part([{ t: 0.5 }], 4), kit: kit() })
    expect(inst.visual!()!.hits.length).toBe(1)
    inst.setPart(part([{ t: 0.5 }, { t: 1 }, { t: 1.5 }], 4))
    expect(inst.visual!()!.hits.length).toBe(3)
  })

  it('an empty part renders silence rather than throwing', async () => {
    const out = await render(part([]))
    expect(rms(out)).toBeLessThan(1e-6)
  })

  it('every class reaches a voice', async () => {
    const classes = ['kick', 'snare', 'hihat', 'tom', 'cymbal', 'ride'] as const
    for (const cls of classes) {
      const out = await render(part([{ t: 0.2, cls }]), { seconds: 2 })
      expect(rms(out), cls).toBeGreaterThan(1e-4)
    }
  })
})
