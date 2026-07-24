/**
 * Browser tests for `LiveCueScheduler`. Runs in a REAL Chromium via `npm
 * run test:browser` — scheduling correctness (exact start times, buffer
 * offsets, cancellation) depends on the real `AudioScheduledSourceNode`
 * start/stop semantics, which the unit project's mocked `AudioContext`
 * cannot verify.
 *
 * All rendering is done with `OfflineAudioContext` for determinism: its
 * `currentTime` reads 0 until `startRendering()` is called, so every
 * `scheduleAt` call below happens at a known, fixed "now" and the
 * rendered output is reproducible sample-for-sample.
 */
import { describe, expect, it } from 'vitest'
import { LiveCueScheduler } from './liveCueScheduler'

const SR = 44100

/** A mono buffer filled with a constant `value` for its whole duration — easy to tell apart from another constant. */
function constantBuffer(ctx: OfflineAudioContext, value: number, durationSec: number): AudioBuffer {
  const len = Math.round(durationSec * SR)
  const buf = ctx.createBuffer(1, len, SR)
  buf.getChannelData(0).fill(value)
  return buf
}

/** A mono full-scale sine-tone buffer across its whole duration. */
function toneBuffer(ctx: OfflineAudioContext, durationSec: number, freq = 440): AudioBuffer {
  const len = Math.round(durationSec * SR)
  const buf = ctx.createBuffer(1, len, SR)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.sin((2 * Math.PI * freq * i) / SR)
  return buf
}

/** Silence for `silentSec`, then a full-scale sine tone for the remainder of `totalSec`. */
function silenceThenToneBuffer(
  ctx: OfflineAudioContext,
  totalSec: number,
  silentSec: number,
  freq = 440,
): AudioBuffer {
  const len = Math.round(totalSec * SR)
  const silentLen = Math.round(silentSec * SR)
  const buf = ctx.createBuffer(1, len, SR)
  const d = buf.getChannelData(0)
  for (let i = silentLen; i < len; i++) {
    d[i] = Math.sin((2 * Math.PI * freq * (i - silentLen)) / SR)
  }
  return buf
}

function peakInRange(buf: AudioBuffer, fromSec: number, toSec: number): number {
  const d = buf.getChannelData(0)
  const a = Math.max(0, Math.floor(fromSec * SR))
  const b = Math.min(d.length, Math.floor(toSec * SR))
  let p = 0
  for (let i = a; i < b; i++) p = Math.max(p, Math.abs(d[i]!))
  return p
}

function meanInRange(buf: AudioBuffer, fromSec: number, toSec: number): number {
  const d = buf.getChannelData(0)
  const a = Math.max(0, Math.floor(fromSec * SR))
  const b = Math.min(d.length, Math.floor(toSec * SR))
  let sum = 0
  for (let i = a; i < b; i++) sum += d[i]!
  return sum / Math.max(1, b - a)
}

describe('LiveCueScheduler (real browser, OfflineAudioContext)', () => {
  it('renders silence before the scheduled time and energy at/after it', async () => {
    const totalSec = 0.3
    const ctx = new OfflineAudioContext(1, Math.round(totalSec * SR), SR)
    const scheduler = new LiveCueScheduler(ctx as unknown as AudioContext, ctx.destination)

    const buf = toneBuffer(ctx, totalSec)
    const atCtxTime = 0.1
    expect(atCtxTime).toBeGreaterThan(ctx.currentTime) // sanity: genuinely scheduling into the future

    scheduler.scheduleAt(buf, atCtxTime)
    const out = await ctx.startRendering()

    expect(peakInRange(out, 0, atCtxTime - 0.005)).toBeLessThan(0.01)
    expect(peakInRange(out, atCtxTime + 0.005, totalSec)).toBeGreaterThan(0.5)
  })

  it('a later scheduleAt cancels an earlier still-pending cue', async () => {
    const totalSec = 0.3
    const ctx = new OfflineAudioContext(1, Math.round(totalSec * SR), SR)
    const scheduler = new LiveCueScheduler(ctx as unknown as AudioContext, ctx.destination)

    const cueA = constantBuffer(ctx, 0.6, 0.05)
    const cueB = constantBuffer(ctx, -0.6, 0.05)

    scheduler.scheduleAt(cueA, 0.05) // pending, not yet due
    scheduler.scheduleAt(cueB, 0.15) // must cancel A before it ever sounds

    const out = await ctx.startRendering()

    // A's slot is silent: it was cancelled before its scheduled start arrived.
    expect(peakInRange(out, 0.05, 0.1)).toBeLessThan(0.01)
    // B's slot played exactly as scheduled.
    expect(meanInRange(out, 0.15, 0.2)).toBeLessThan(-0.5)
  })

  it('starts immediately when atCtxTime is already in the past, time-aligned to skip the missed portion', async () => {
    const totalSec = 0.3
    const silentSec = 0.05
    const ctx = new OfflineAudioContext(1, Math.round(totalSec * SR), SR)
    const scheduler = new LiveCueScheduler(ctx as unknown as AudioContext, ctx.destination)

    // First `silentSec` of the buffer is silent, the rest is tone. If the
    // scheduler correctly offsets by (now - atCtxTime), the *tone* portion
    // is what plays immediately at output t=0 — proving it skipped ahead
    // rather than dragging the whole buffer (including its silent lead)
    // out late.
    const buf = silenceThenToneBuffer(ctx, totalSec, silentSec)
    expect(ctx.currentTime).toBe(0) // sanity: nothing rendered yet, "now" is fixed at 0
    scheduler.scheduleAt(buf, -silentSec) // called "late": now(0) - atCtxTime(-0.05) = 0.05 offset

    const out = await ctx.startRendering()

    expect(peakInRange(out, 0, 0.01)).toBeGreaterThan(0.5)
  })

  it('plays nothing when the whole buffer is already in the past', async () => {
    const totalSec = 0.2
    const ctx = new OfflineAudioContext(1, Math.round(totalSec * SR), SR)
    const scheduler = new LiveCueScheduler(ctx as unknown as AudioContext, ctx.destination)

    const buf = toneBuffer(ctx, 0.05) // 50ms cue
    scheduler.scheduleAt(buf, -1) // "1s late" — the whole 50ms buffer is long gone

    const out = await ctx.startRendering()
    expect(peakInRange(out, 0, totalSec)).toBeLessThan(0.01)
  })

  it('is a no-op for a zero-length buffer', () => {
    const ctx = new OfflineAudioContext(1, SR, SR)
    const scheduler = new LiveCueScheduler(ctx as unknown as AudioContext, ctx.destination)
    const emptyBuffer = { length: 0, duration: 0 } as unknown as AudioBuffer

    expect(() => scheduler.scheduleAt(emptyBuffer, ctx.currentTime + 1)).not.toThrow()
    expect(() => scheduler.cancelPending()).not.toThrow()
  })

  it('cancelPending() and dispose() are safe no-ops when nothing is scheduled', () => {
    const ctx = new OfflineAudioContext(1, SR, SR)
    const scheduler = new LiveCueScheduler(ctx as unknown as AudioContext, ctx.destination)

    expect(() => scheduler.cancelPending()).not.toThrow()
    expect(() => scheduler.dispose()).not.toThrow()
    expect(() => scheduler.cancelPending()).not.toThrow() // still safe after dispose
  })

  it('setVolume scales the audible output of current and future cues', async () => {
    const totalSec = 0.1
    const ctx = new OfflineAudioContext(1, Math.round(totalSec * SR), SR)
    const scheduler = new LiveCueScheduler(ctx as unknown as AudioContext, ctx.destination)
    scheduler.setVolume(0.25)

    const buf = constantBuffer(ctx, 0.8, totalSec)
    scheduler.scheduleAt(buf, 0)

    const out = await ctx.startRendering()
    expect(meanInRange(out, 0, totalSec)).toBeCloseTo(0.2, 2) // 0.8 * 0.25
  })
})
