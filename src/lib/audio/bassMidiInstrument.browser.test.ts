/**
 * The live bass instrument, rendered offline so its output can be inspected.
 *
 * The important property is the same one the drums have: the live track and
 * the WAV render must be the same instrument, because they build their voice
 * from the same `bassVoiceGraph`.
 */
import { describe, expect, it } from 'vitest'
import { createBassMidiInstrument } from './bassMidiInstrument'
import { renderBassVoice } from './renderBassVoice'
import { DEFAULT_BASS_TONE, normalizeBassTone } from './bassTone'
import type { BassPart } from './bassPart'

const SR = 44100

const rms = (b: Float32Array, from = 0, to = b.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += b[i]! * b[i]!
  return Math.sqrt(s / Math.max(1, to - from))
}
const peak = (b: Float32Array) => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const db = (x: number) => 20 * Math.log10(Math.max(1e-12, x))
const at = (b: Float32Array, sec: number, win = 0.05) =>
  rms(b, Math.floor(sec * SR), Math.floor((sec + win) * SR))

function part(
  notes: { t: number; midi?: number; dur?: number; vel?: number }[],
  durationSec = 4,
): BassPart {
  return {
    notes: notes.map((n) => ({
      atSec: n.t,
      durationSec: n.dur ?? 0.4,
      midi: n.midi ?? 40,
      velocity: n.vel ?? 0.8,
    })),
    durationSec,
  }
}

async function render(
  p: BassPart,
  opts: {
    fromSec?: number
    rate?: number
    seconds?: number
    soundId?: string
    tickPositions?: number[]
  } = {},
): Promise<Float32Array> {
  const seconds = opts.seconds ?? 4
  const ctx = new OfflineAudioContext(1, Math.floor(SR * seconds), SR)
  const inst = await createBassMidiInstrument(ctx, {
    part: p,
    tone: DEFAULT_BASS_TONE,
    soundId: opts.soundId,
  })
  inst.output.connect(ctx.destination)
  inst.schedule(opts.fromSec ?? 0, 0, opts.rate ?? 1)
  for (const pos of opts.tickPositions ?? []) inst.tick?.(pos)
  return (await ctx.startRendering()).getChannelData(0).slice()
}

describe('bass MIDI instrument', () => {
  it('plays notes where the part says', async () => {
    const out = await render(part([{ t: 0.5 }, { t: 1.5 }]))
    expect(at(out, 0.5)).toBeGreaterThan(1e-3)
    expect(at(out, 1.5)).toBeGreaterThan(1e-3)
    expect(at(out, 1.05)).toBeLessThan(at(out, 0.5))
  })

  it('is silent before the first note', async () => {
    const out = await render(part([{ t: 1.5 }]))
    expect(rms(out, 0, Math.floor(1.4 * SR))).toBeLessThan(1e-4)
  })

  it('matches the offline renderer — the same voice graph, both paths', async () => {
    // This is the anti-drift check: the mixer and the export must not sound
    // different. Same notes, same tone, same rate.
    const p = part([{ t: 0.2, midi: 38 }, { t: 0.9, midi: 45 }, { t: 1.6, midi: 40 }], 3)
    const live = await render(p, { seconds: 3 })
    const offline = await renderBassVoice(
      p.notes,
      normalizeBassTone(DEFAULT_BASS_TONE),
      Math.floor(SR * 3),
      SR,
      undefined,
    )
    // Level and spectral weight should be effectively identical; the live path
    // adds only a unity normalize gain on top.
    expect(Math.abs(db(rms(live)) - db(rms(offline)))).toBeLessThan(1.5)
    expect(Math.abs(db(peak(live)) - db(peak(offline)))).toBeLessThan(2)
  })

  it('plays the pitch it is asked for', async () => {
    const crossings = (b: Float32Array) => {
      let n = 0
      for (let i = Math.floor(0.55 * SR); i < Math.floor(0.8 * SR); i++) {
        if (b[i - 1]! <= 0 && b[i]! > 0) n++
      }
      return n
    }
    const low = await render(part([{ t: 0.5, midi: 28, dur: 0.5 }]))
    const high = await render(part([{ t: 0.5, midi: 52, dur: 0.5 }]))
    expect(crossings(high)).toBeGreaterThan(crossings(low))
  })

  it('skips notes before the scheduling point', async () => {
    const out = await render(part([{ t: 0.2 }, { t: 2.5 }]), { fromSec: 2 })
    expect(at(out, 0.05)).toBeLessThan(1e-3)
    expect(at(out, 0.5)).toBeGreaterThan(1e-3)
  })

  it('re-attacks a note you seek into the middle of', async () => {
    // Web Audio can't start an oscillator mid-envelope, so a long note that
    // was already sounding is re-attacked with what remains — audibly
    // continuous, which beats a hole.
    const out = await render(part([{ t: 1.5, dur: 2 }]), { fromSec: 2, seconds: 2 })
    expect(rms(out, 0, Math.floor(0.3 * SR))).toBeGreaterThan(1e-4)
  })

  it('varispeed compresses the gaps', async () => {
    const p = part([{ t: 0.5 }, { t: 1.5 }])
    const fast = await render(p, { rate: 2 })
    expect(at(fast, 0.25)).toBeGreaterThan(1e-3)
    expect(at(fast, 1.5)).toBeLessThan(at(fast, 0.25))
  })

  it('refills long parts in a rolling window instead of scheduling the whole song up front', async () => {
    const p = part([{ t: 8.6, dur: 0.5 }], 10)

    const noRefill = await render(p, { seconds: 9.4 })
    expect(at(noRefill, 8.6)).toBeLessThan(1e-4)

    const refilled = await render(p, { seconds: 9.4, tickPositions: [5] })
    expect(at(refilled, 8.6)).toBeGreaterThan(1e-4)
  }, 30_000)

  it('allNotesOff silences it', async () => {
    const ctx = new OfflineAudioContext(1, SR * 2, SR)
    const inst = await createBassMidiInstrument(ctx, {
      part: part([{ t: 0.05, dur: 1.5 }]),
      tone: DEFAULT_BASS_TONE,
    })
    inst.output.connect(ctx.destination)
    inst.schedule(0, 0, 1)
    inst.allNotesOff()
    const out = (await ctx.startRendering()).getChannelData(0)
    expect(rms(out, Math.floor(0.3 * SR), SR * 2)).toBeLessThan(1e-3)
  })

  it('reports its duration, and follows setPart', async () => {
    const ctx = new OfflineAudioContext(1, SR, SR)
    const inst = await createBassMidiInstrument(ctx, {
      part: part([{ t: 0 }], 90),
      tone: DEFAULT_BASS_TONE,
    })
    expect(inst.durationSec).toBe(90)
    inst.setPart(part([{ t: 0 }], 30))
    expect(inst.durationSec).toBe(30)
  })

  it('exposes a pitch-mapped pattern for the lane strip', async () => {
    const ctx = new OfflineAudioContext(1, SR, SR)
    const inst = await createBassMidiInstrument(ctx, {
      part: part([{ t: 0.5, midi: 28 }, { t: 1, midi: 40 }], 4),
      tone: DEFAULT_BASS_TONE,
    })
    const v = inst.visual!()!
    expect(v.rows).toBeGreaterThan(12)
    // Higher note draws on a higher row.
    expect(v.hits[1]!.row).toBeGreaterThan(v.hits[0]!.row)
  })

  it('an empty part renders silence rather than throwing', async () => {
    const out = await render(part([]))
    expect(rms(out)).toBeLessThan(1e-6)
  })

  it('a missing sampled set falls back to the synth rather than silence', async () => {
    // The Logic-derived sets only exist on a machine that has Logic.
    const out = await render(part([{ t: 0.5 }]), { soundId: 'upright' })
    expect(peak(out)).toBeGreaterThan(1e-4)
  })
})
