import { describe, expect, it } from 'vitest'
import {
  renderBassVoice,
  __renderBassVoiceInternals,
  type BassVoiceNote,
} from './renderBassVoice'
import { normalizeBassTone } from './bassTone'

/**
 * The bass track is rendered in WINDOWS purely for speed. The whole bet is that
 * windowing does not change the instrument — so these tests compare a windowed
 * render against a single-pass one of the same notes and require them to match.
 *
 * The interesting case is a note that STRADDLES a window boundary: it has to
 * come out whole, which is what the discarded lead-in buys.
 */

const SR = 44100
const tone = normalizeBassTone(undefined)
const { WINDOW_SEC, prerollFor, renderWindow } = __renderBassVoiceInternals

/** Largest sample-by-sample difference between two renders. */
function maxDiff(a: Float32Array, b: Float32Array): number {
  let m = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!))
  return m
}

function peak(a: Float32Array): number {
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]!))
  return m
}

/** A single-pass render — what the windowed path has to reproduce. */
function renderSinglePass(notes: BassVoiceNote[], frames: number) {
  return renderWindow(notes, tone, frames, SR, undefined, 0)
}

describe('bass voice windowing (real browser)', () => {
  it('matches a single-pass render of the same notes', async () => {
    const seconds = WINDOW_SEC * 3
    const frames = seconds * SR
    const notes: BassVoiceNote[] = []
    for (let i = 0; i < seconds * 4; i++) {
      notes.push({ atSec: i * 0.25, durationSec: 0.22, midi: 40 + (i % 12), velocity: 0.8 })
    }

    const windowed = await renderBassVoice(notes, tone, frames, SR)
    const single = await renderSinglePass(notes, frames)

    expect(peak(single)).toBeGreaterThan(0.01) // the comparison must be meaningful
    // Not bit-identical: each window restarts the bus high-pass, whose state the
    // discarded lead-in re-settles. The residual is far below audibility.
    expect(maxDiff(windowed, single)).toBeLessThan(0.005)
  }, 120_000)

  it('renders a note straddling a window boundary whole', async () => {
    const frames = WINDOW_SEC * 2 * SR
    // Starts just before the first boundary and rings well past it.
    const notes: BassVoiceNote[] = [
      { atSec: WINDOW_SEC - 0.3, durationSec: 1.2, midi: 43, velocity: 0.9 },
    ]
    const windowed = await renderBassVoice(notes, tone, frames, SR)
    const single = await renderSinglePass(notes, frames)

    // Sample the audio AFTER the boundary — the part only the lead-in can get right.
    const from = Math.floor((WINDOW_SEC + 0.05) * SR)
    const to = Math.floor((WINDOW_SEC + 0.8) * SR)
    expect(peak(single.subarray(from, to))).toBeGreaterThan(0.01)
    expect(maxDiff(windowed.subarray(from, to), single.subarray(from, to))).toBeLessThan(0.005)
  }, 120_000)

  it('leaves no gap or click at a window seam', async () => {
    const frames = WINDOW_SEC * 2 * SR
    const notes: BassVoiceNote[] = []
    for (let i = 0; i < WINDOW_SEC * 2 * 4; i++) {
      notes.push({ atSec: i * 0.25, durationSec: 0.24, midi: 45, velocity: 0.8 })
    }
    const out = await renderBassVoice(notes, tone, frames, SR)
    // No sudden jump between neighbouring samples across the seam.
    const seam = WINDOW_SEC * SR
    let biggestStep = 0
    for (let i = seam - 200; i < seam + 200; i++) {
      biggestStep = Math.max(biggestStep, Math.abs(out[i]! - out[i - 1]!))
    }
    expect(biggestStep).toBeLessThan(0.2)
  }, 120_000)

  it('is dramatically faster than a single pass on a long track', async () => {
    const seconds = 120
    const frames = seconds * SR
    const notes: BassVoiceNote[] = []
    for (let i = 0; i < seconds * 4; i++) {
      notes.push({ atSec: i * 0.25, durationSec: 0.22, midi: 40 + (i % 12), velocity: 0.8 })
    }

    const t0 = performance.now()
    await renderBassVoice(notes, tone, frames, SR)
    const windowedMs = performance.now() - t0

    const t1 = performance.now()
    await renderSinglePass(notes, frames)
    const singleMs = performance.now() - t1

    // Measured ~20x on a 4-minute track; 3x is a floor that still catches a
    // regression to single-pass without being flaky on a loaded CI box.
    expect(windowedMs * 3).toBeLessThan(singleMs)
  }, 300_000)

  it('a short song still renders in one pass', async () => {
    const frames = Math.floor(WINDOW_SEC * 0.5 * SR)
    const notes: BassVoiceNote[] = [{ atSec: 0.1, durationSec: 0.5, midi: 40, velocity: 0.8 }]
    const out = await renderBassVoice(notes, tone, frames, SR)
    expect(out.length).toBe(frames)
    expect(peak(out)).toBeGreaterThan(0.001)
  }, 60_000)

  it('preroll covers the longest note, so nothing can be cut off', () => {
    const notes: BassVoiceNote[] = [
      { atSec: 0, durationSec: 0.2, midi: 40, velocity: 1 },
      { atSec: 1, durationSec: 3.5, midi: 40, velocity: 1 },
    ]
    expect(prerollFor(notes, tone)).toBeGreaterThanOrEqual(3.5 + tone.release)
  })
})
