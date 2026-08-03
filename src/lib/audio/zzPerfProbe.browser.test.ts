/** TEMPORARY perf probe — delete after measurement. */
import { describe, expect, it } from 'vitest'
import { createDrumMidiInstrument } from './drumMidiInstrument'
import { buildSynthKit, type DrumKit } from './drumKits'
import type { DrumPart } from './drumPart'

const kit = (): DrumKit => ({ id: 'synth', label: 'Electronic kit', voices: buildSynthKit() })

function densePart(n: number, durationSec: number): DrumPart {
  const classes = ['kick', 'snare', 'hihat', 'cymbal'] as const
  const hits: DrumPart['hits'] = []
  for (let i = 0; i < n; i++) {
    hits.push({
      mixTimeSec: (i / n) * durationSec,
      cls: classes[i % classes.length]!,
      gain: 0.8,
    })
  }
  return { hits, durationSec }
}

describe('perf probe', () => {
  it('main-thread schedule() cost', async () => {
    const ctx = new AudioContext()
    await ctx.resume().catch(() => {})
    const results: string[] = []
    for (const n of [500, 1300, 2500, 5000]) {
      const inst = await createDrumMidiInstrument(ctx, { part: densePart(n, 240), kit: kit() })
      const sink = ctx.createGain()
      sink.gain.value = 0
      inst.output.connect(sink)
      sink.connect(ctx.destination)
      const t0 = performance.now()
      inst.schedule(0, ctx.currentTime + 0.05, 1)
      const t1 = performance.now()
      const t2 = performance.now()
      inst.allNotesOff()
      const t3 = performance.now()
      results.push(
        `n=${n} schedule=${(t1 - t0).toFixed(1)}ms stopAll=${(t3 - t2).toFixed(1)}ms`,
      )
      inst.dispose()
    }
    // eslint-disable-next-line no-console
    console.log('DRUM_MAIN ' + results.join(' | '))
    expect(results.length).toBe(4)
    await ctx.close()
  }, 60000)

  it('audio-thread per-quantum cost of PENDING sources', async () => {
    // Render 20 s offline with N sources scheduled to start at 200 s — i.e.
    // they never sound; all we measure is graph-traversal overhead per quantum.
    const results: string[] = []
    for (const n of [0, 1300, 2500, 5000]) {
      const SECS = 20
      const ctx = new OfflineAudioContext(2, 48000 * SECS, 48000)
      const inst = await createDrumMidiInstrument(ctx, { part: densePart(Math.max(n, 1), 240), kit: kit() })
      inst.output.connect(ctx.destination)
      if (n > 0) {
        // fromSec = -200 pushes every hit 200 s into the future: all pending.
        inst.schedule(-200, 0, 1)
      }
      const t0 = performance.now()
      await ctx.startRendering()
      const t1 = performance.now()
      const ms = t1 - t0
      results.push(`n=${n} render20s=${ms.toFixed(0)}ms load=${((ms / (SECS * 1000)) * 100).toFixed(2)}%`)
    }
    // eslint-disable-next-line no-console
    console.log('DRUM_AUDIO_PENDING ' + results.join(' | '))
    expect(results.length).toBe(4)
  }, 120000)

  it('audio-thread cost of ACTIVELY SOUNDING dense hits', async () => {
    // Same but the hits actually play inside the rendered window.
    const results: string[] = []
    for (const n of [0, 200, 600]) {
      const SECS = 20
      const ctx = new OfflineAudioContext(2, 48000 * SECS, 48000)
      const inst = await createDrumMidiInstrument(ctx, { part: densePart(Math.max(n, 1), SECS), kit: kit() })
      inst.output.connect(ctx.destination)
      if (n > 0) inst.schedule(0, 0, 1)
      const t0 = performance.now()
      await ctx.startRendering()
      const t1 = performance.now()
      const ms = t1 - t0
      results.push(`n=${n} render20s=${ms.toFixed(0)}ms load=${((ms / (SECS * 1000)) * 100).toFixed(2)}%`)
    }
    // eslint-disable-next-line no-console
    console.log('DRUM_AUDIO_SOUNDING ' + results.join(' | '))
    expect(results.length).toBe(3)
  }, 120000)
})
