/**
 * Browser tests for the buffer-based `PlaybackController`. Runs in a
 * REAL Chromium via `npm run test:browser`, exercising real Web Audio
 * scheduling, real `AudioBufferSourceNode`, and the real `$effect`
 * graph. The unit tests in `playbackController.test.ts` cover the
 * algebra; these cover the things mocks structurally can't.
 *
 * Fixtures: a small silent WAV is decoded once via a real
 * `AudioContext`, then handed to the controller as the `audioBuffer`.
 * Headless Chromium is launched with `--autoplay-policy=no-user-
 * gesture-required` so the context resumes without an artificial
 * click prelude (see `vite.config.js`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PlaybackController } from '$lib/audio/playbackController.svelte'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import type { SongMap } from '$lib/songmap/types'

// ── Fixtures ─────────────────────────────────────────────────────────

function makeSilentWavArrayBuffer(durationSec = 5, sampleRate = 8000): ArrayBuffer {
  const numFrames = Math.floor(durationSec * sampleRate)
  const dataSize = numFrames * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  view.setUint32(0, 0x52494646, false) // "RIFF"
  view.setUint32(4, 36 + dataSize, true)
  view.setUint32(8, 0x57415645, false) // "WAVE"
  view.setUint32(12, 0x666d7420, false) // "fmt "
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  view.setUint32(36, 0x64617461, false) // "data"
  view.setUint32(40, dataSize, true)
  return buffer
}

async function decodeSilentBuffer(durationSec = 5): Promise<AudioBuffer> {
  const ac = new AudioContext()
  try {
    return await ac.decodeAudioData(makeSilentWavArrayBuffer(durationSec))
  } finally {
    await ac.close().catch(() => {})
  }
}

function makeSong(opts: {
  barCount?: number
  beatsPerBar?: number
  beatDurationSec?: number
  trimStartSec?: number
  trimEndSec?: number
  countInBeats?: number
}): SongMap {
  const barCount = opts.barCount ?? 2
  const beatsPerBar = opts.beatsPerBar ?? 4
  const bd = opts.beatDurationSec ?? 0.5
  const trimStartSec = opts.trimStartSec ?? 0
  const trimEndSec = opts.trimEndSec ?? barCount * beatsPerBar * bd
  const beats: SongMap['timeline']['beats'] = []
  const bars: SongMap['timeline']['bars'] = []
  for (let bar = 0; bar < barCount; bar++) {
    const barId = `bar${bar}`
    const barStart = bar * beatsPerBar * bd
    const barEnd = barStart + beatsPerBar * bd
    const beatIds: string[] = []
    for (let i = 0; i < beatsPerBar; i++) {
      const id = `b${bar}_${i}`
      beatIds.push(id)
      beats.push({ id, barId, indexInBar: i, timeSec: barStart + i * bd })
    }
    bars.push({
      id: barId,
      index: bar,
      startSec: barStart,
      endSec: barEnd,
      meter: { numerator: beatsPerBar, denominator: 4 },
      beatCount: beatsPerBar,
      beatIds,
    })
  }
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'T',
      bpm: 60 / bd,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    audio: {
      fileName: 'silent.wav',
      trim: { startSec: trimStartSec, endSec: trimEndSec },
      source: 'upload',
    },
    timeline: { bars, beats },
    sections: [],
    harmony: [],
    cueTracks: [],
    ...(opts.countInBeats !== undefined ? { countInBeats: opts.countInBeats } : {}),
  } as SongMap
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Poll `predicate` until it holds, or throw after `timeoutMs`.
 *
 * **Why every timing assertion here polls instead of sleeping.** The
 * controller derives position as `playStartPositionSec + (ctx.currentTime
 * − playStartCtxTime)`, so it advances on the *AudioContext* clock — and
 * that clock does not start when `new AudioContext()` returns. It starts
 * when the audio thread renders its first quantum, which costs anywhere
 * from ~5 ms to (measured, on a cold page) ~2.6 s. It also only ticks in
 * 128-frame quanta (~5.8 ms at 22.05 kHz), and `currentTime` is mirrored
 * into `$state` on rAF, adding up to another frame of staleness.
 *
 * A fixed `sleep(n)` therefore buys an unknown amount of *context* time.
 * The old assertions budgeted 30–60 ms of headroom against a lag source
 * with no upper bound — that was the flake. Polling removes wall-clock
 * from the pass condition entirely.
 */
async function waitUntil(
  predicate: () => boolean,
  label: string,
  timeoutMs = 6000,
): Promise<void> {
  const start = performance.now()
  for (;;) {
    if (predicate()) return
    if (performance.now() - start >= timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${label}`)
    }
    await sleep(5)
  }
}

const cleanups: Array<() => void | Promise<void>> = []

/**
 * Count `createOscillator` calls on the shared prototype. Each
 * `playMetronomeClick` creates exactly one oscillator, so the array
 * length is a click count and each entry is the `ctx.currentTime` at
 * which that click was *created*.
 */
function spyOnOscillators(): number[] {
  const orig = AudioContext.prototype.createOscillator
  const calls: number[] = []
  AudioContext.prototype.createOscillator = function (this: AudioContext) {
    calls.push(this.currentTime)
    return orig.call(this)
  }
  cleanups.push(() => {
    AudioContext.prototype.createOscillator = orig
  })
  return calls
}

/**
 * Record the times nodes are *scheduled to start at* — `osc.start(when)`
 * for clicks and `src.start(when, offset)` for the song — rather than the
 * times they were created at.
 *
 * `spyOnOscillators` above answers "how many clicks, created when"; that
 * is blind to a click that is *created* early but *scheduled* correctly,
 * and equally blind to the reverse. Scheduled start times are the actual
 * contract with the audio hardware, and because both arrays are stamped
 * on the same `AudioContext` clock as `songStart`, differences between
 * them contain no wall-clock at all.
 *
 * Patched per-instance (on the node returned by the factory) rather than
 * on the prototype, so it doesn't matter which class in the
 * `AudioScheduledSourceNode` chain actually owns `start`.
 */
function spyOnScheduledStarts(): { clickStarts: number[]; songStarts: number[] } {
  const clickStarts: number[] = []
  const songStarts: number[] = []
  const origOsc = AudioContext.prototype.createOscillator
  const origSrc = AudioContext.prototype.createBufferSource

  AudioContext.prototype.createOscillator = function (this: AudioContext) {
    const node = origOsc.call(this)
    const start = node.start.bind(node)
    node.start = (when?: number) => {
      clickStarts.push(when ?? this.currentTime)
      start(when)
    }
    return node
  }
  AudioContext.prototype.createBufferSource = function (this: AudioContext) {
    const node = origSrc.call(this)
    const start = node.start.bind(node)
    node.start = (when?: number, offset?: number, duration?: number) => {
      // Hybrid clicks layer a reusable 120 ms noise buffer under their tonal
      // oscillator. Only long buffers are the actual song source here.
      if (!node.buffer || node.buffer.duration > 0.2) {
        songStarts.push(when ?? this.currentTime)
      }
      start(when, offset, duration)
    }
    return node
  }

  cleanups.push(() => {
    AudioContext.prototype.createOscillator = origOsc
    AudioContext.prototype.createBufferSource = origSrc
  })
  return { clickStarts, songStarts }
}

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()!
    await fn()
  }
})

// ── Tests ────────────────────────────────────────────────────────────

describe('PlaybackController (real browser, buffer-based)', () => {
  it('play() flips isPlaying true and schedules a BufferSource', async () => {
    const c = new PlaybackController()
    const buf = await decodeSilentBuffer(2)
    cleanups.push(() => c.destroy())

    c.setSongMap(makeSong({ barCount: 1 }))
    c.setAudioBuffer(buf)
    c.rangeEnd = buf.duration

    expect(c.isPlaying).toBe(false)
    c.play()
    expect(c.isPlaying).toBe(true)

    // The source really produces a moving playhead — poll rather than
    // assume the context clock has caught up within a fixed sleep.
    await waitUntil(() => c.currentTime > 0, 'the playhead to leave 0')
    // ...and it keeps moving. A one-shot `> 0` could in principle be
    // satisfied by a single stale read; monotonic advance cannot.
    const t1 = c.currentTime
    await waitUntil(() => c.currentTime > t1, `the playhead to advance past ${t1}`)
    expect(c.isPlaying).toBe(true)
  })

  it('pause() flips isPlaying false and freezes currentTime', async () => {
    const c = new PlaybackController()
    const buf = await decodeSilentBuffer(3)
    cleanups.push(() => c.destroy())

    c.setSongMap(makeSong({ barCount: 1 }))
    c.setAudioBuffer(buf)
    c.rangeEnd = buf.duration
    c.play()
    // Non-vacuous: the playhead must genuinely be moving before we pause,
    // otherwise "frozen" proves nothing.
    await waitUntil(() => c.currentTime > 0.05, 'playback to get underway')

    c.pause()
    const frozen = c.currentTime
    expect(c.isPlaying).toBe(false)

    // Exactly frozen, across many frames. `pause()` writes the computed
    // position and cancels the rAF; a leaked transport tick or a source
    // that kept running would move this. Strict equality is the real
    // contract here — the old `< 0.1` tolerance would have let ~3 frames
    // of drift through unnoticed.
    for (let i = 0; i < 20; i++) {
      await sleep(15)
      expect(c.currentTime).toBe(frozen)
    }
  })

  /**
   * Live grid regression: the click loop must fire exactly one
   * oscillator per beat, metered out at the song tempo. Each
   * `playMetronomeClick` creates one `OscillatorNode`, so spying on
   * `createOscillator` gives both a count and a per-click timestamp.
   *
   * The old form asserted `3 ≤ n ≤ 5` after a fixed 2.3 s sleep, which
   * both raced the context clock (a slow start dropped the count to 3
   * or below) and was blind to *when* the clicks happened — the
   * past-click-drop bug (all pending clicks dumped into one tick) would
   * still have produced a count of 4.
   */
  it('click loop creates oscillators when playWithClick is on', async () => {
    const c = new PlaybackController()
    const buf = await decodeSilentBuffer(3)
    cleanups.push(() => c.destroy())

    const oscillatorCalls = spyOnOscillators()

    const beatDurationSec = 0.5
    c.setSongMap(makeSong({ barCount: 1, beatsPerBar: 4, beatDurationSec }))
    c.setAudioBuffer(buf)
    c.rangeEnd = buf.duration
    c.playWithClick = true

    // Pin the expectation to the plan rather than a hard-coded number:
    // 1 bar × 4 beats, no count-in → 4 song clicks at 0/0.5/1.0/1.5.
    const clickPoints = c.plan!.clickPoints
    expect(clickPoints.map((p) => p.timeSec)).toEqual([0, 0.5, 1, 1.5])
    expect(clickPoints.some((p) => p.isCountIn)).toBe(false)

    c.play()
    await waitUntil(
      () => oscillatorCalls.length >= clickPoints.length,
      `all ${clickPoints.length} beat clicks to be scheduled`,
      8000,
    )
    // Let the loop run well past the last beat: it must not emit extras.
    await sleep(300)
    c.pause()

    expect(oscillatorCalls.length).toBe(clickPoints.length)

    // Spacing is the load-bearing part. Timestamps are context-clock, so
    // measure each click against the first — that cancels the unknown
    // context start-up lag while still pinning the *intervals*. A dump
    // into a single tick would read 0/0/0 here instead of 0.5/1.0/1.5.
    const first = oscillatorCalls[0]!
    for (let i = 1; i < oscillatorCalls.length; i++) {
      const offsetFromFirst = oscillatorCalls[i]! - first
      expect(Math.abs(offsetFromFirst - i * beatDurationSec)).toBeLessThan(0.1)
    }
  })

  /**
   * Tight-trim count-in: when `prependSec > 0`, the source is started
   * AFTER the pre-roll.
   *
   * Two independent guards, neither of which budgets wall-clock slack:
   *
   *  1. The count-in oscillators are pre-scheduled *synchronously*
   *     inside `play()`, before any rAF can run — so counting them
   *     immediately after `play()` returns is timing-free.
   *  2. The playhead is pinned to the start offset for the whole
   *     pre-roll, then must move. Because the context clock can only
   *     lag wall-clock and never lead it, the measured wall delay
   *     until it moves is a hard lower bound on the pre-roll applied.
   */
  it('count-in pre-roll delays audio start by ~prependSec', async () => {
    const c = new PlaybackController()
    const buf = await decodeSilentBuffer(5)
    cleanups.push(() => c.destroy())

    const oscillatorCalls = spyOnOscillators()

    c.setSongMap(makeSong({ barCount: 4, countInBeats: 4 }))
    c.setAudioBuffer(buf)
    c.rangeEnd = buf.duration
    c.playWithClick = true

    const plan = c.plan!
    const countInClicks = plan.clickPoints.filter((p) => p.isCountIn)
    // 4 count-in beats × 0.5 s, all landing before the audio starts.
    expect(plan.prependSec).toBeCloseTo(2, 6)
    expect(countInClicks.length).toBe(4)
    expect(countInClicks.every((p) => p.timeSec < 0)).toBe(true)

    const startedAt = performance.now()
    c.play()

    // (1) Pre-roll fired: every count-in click was scheduled up front.
    expect(oscillatorCalls.length).toBe(countInClicks.length)

    // (2a) The playhead does NOT move during the pre-roll. Exactly 0,
    // not "less than 0.5" — `#computeCurrentPosition` pins it to
    // `playStartPositionSec` until `ctxStart`, so any movement here
    // means the source was started without the pre-roll offset.
    for (let i = 0; i < 10; i++) {
      await sleep(60)
      expect(c.currentTime).toBe(0)
    }

    // (2b) It then starts, no sooner than the pre-roll allows. Reaching
    // 0.05 requires `prependSec + PLAY_START_LOOKAHEAD + 0.05` of
    // context time, and wall-clock ≥ context time, so this bound holds
    // structurally rather than by tuning.
    await waitUntil(() => c.currentTime > 0.05, 'audio to start after the pre-roll', 8000)
    expect(performance.now() - startedAt).toBeGreaterThan(plan.prependSec * 1000)
  })

  /**
   * THE DOWNBEAT. With a count-in running, bar 1 beat 1 must be clicked
   * exactly when the song's first sample plays, and nothing beyond the
   * count-in beats themselves may sound during the pre-roll.
   *
   * Regression guarded: the click loop used to read a plan-time that was
   * PINNED to the song-start value for the whole pre-roll (the transport's
   * position clamp leaking into scheduling). Beat 1 sits at `timeSec === 0`,
   * so `0 <= planTime + CLICK_LOOKAHEAD_SEC` was already true on the very
   * first rAF: the downbeat's click was emitted ~2 s early, in the middle
   * of the count-in, and `#nextClickIdx` had stepped past it by the time
   * the downbeat actually arrived. Measured before the fix (relative to
   * song start): `-2.000 -1.500 -1.000 -0.500 -2.038 +0.500` — an extra
   * tick in the count-in, and silence on the most important beat in a
   * live set.
   *
   * Everything below is asserted on SCHEDULED start times relative to the
   * song source's OWN scheduled start. Both come off the same
   * `AudioContext` clock, so the pass condition contains no wall-clock and
   * no context start-up lag; only the polling deadline does.
   */
  it('clicks bar 1 beat 1 on the downbeat and adds nothing to the count-in', async () => {
    const c = new PlaybackController()
    const buf = await decodeSilentBuffer(5)
    cleanups.push(() => c.destroy())

    const { clickStarts, songStarts } = spyOnScheduledStarts()

    c.setSongMap(makeSong({ barCount: 4, countInBeats: 4 }))
    c.setAudioBuffer(buf)
    c.rangeEnd = buf.duration
    c.playWithClick = true

    // Pin expectations to the plan, not to hard-coded numbers. 4 count-in
    // beats at -2/-1.5/-1/-0.5, then the song from 0. `mediaTimeOffsetSec`
    // stays 0 because the fixture's trim starts at 0, so plan-time and
    // buffer position coincide.
    const plan = c.plan!
    const expected = plan.clickPoints.slice(0, 6).map((p) => p.timeSec)
    expect(expected).toEqual([-2, -1.5, -1, -0.5, 0, 0.5])
    expect(c.mediaTimeOffsetSec).toBe(0)

    c.play()

    // `play()` schedules the source synchronously, so song start is known
    // before any rAF has had a chance to run.
    expect(songStarts.length).toBe(1)
    const songStart = songStarts[0]!

    await waitUntil(
      () => clickStarts.length >= expected.length,
      `${expected.length} clicks to be scheduled`,
      10000,
    )
    c.pause()

    const rel = clickStarts.slice(0, expected.length).map((t) => t - songStart)

    // (1) A click lands ON the downbeat. Scheduling is exact by
    // construction — `ctxNow + (0 − planTime)` collapses to the source's
    // own `ctxStart` — so this tolerance only absorbs the
    // `CLICK_SCHEDULE_LEAD_SEC` floor, not clock jitter.
    const onDownbeat = rel.filter((t) => Math.abs(t) < 0.005)
    expect(onDownbeat.length).toBe(1)

    // (2) Nothing extra sounds during the pre-roll: every click scheduled
    // before the downbeat must be one of the count-in beats. The old
    // behaviour put a stray tick at −2.038, which matches no count-in time.
    const countInTimes = expected.filter((t) => t < 0)
    const strays = rel.filter(
      (t) => t < -0.005 && !countInTimes.some((ct) => Math.abs(ct - t) < 0.005),
    )
    expect(strays).toEqual([])

    // (3) The whole opening sequence, in order — count-in, downbeat, beat 2.
    for (let i = 0; i < expected.length; i++) {
      expect(Math.abs(rel[i]! - expected[i]!)).toBeLessThan(0.005)
    }
  })

  /**
   * Range-end auto-stop. Playback pauses + currentTime snaps back to
   * rangeStart when the playhead crosses rangeEnd.
   */
  it('auto-stops at rangeEnd and seeks back to rangeStart', async () => {
    const c = new PlaybackController()
    const buf = await decodeSilentBuffer(5)
    cleanups.push(() => c.destroy())

    c.setSongMap(makeSong({ barCount: 4 }))
    c.setAudioBuffer(buf)
    c.rangeStart = 0.3
    c.rangeEnd = 1.0
    c.seek(0.3)

    const startedAt = performance.now()
    c.play()
    expect(c.isPlaying).toBe(true)

    // 700 ms of play range — wait for the auto-stop with margin.
    await waitUntil(() => !c.isPlaying, 'playback to auto-stop at rangeEnd', 5000)

    // Non-vacuous: it must have played the range, not bailed instantly.
    // Both auto-stop paths (the setTimeout and the rAF belt-and-braces
    // check) are gated on the range duration, so this is a real lower
    // bound and not a wall-clock guess.
    expect(performance.now() - startedAt).toBeGreaterThan(
      (c.rangeEnd - c.rangeStart) * 1000 - 100,
    )
    // The playhead snaps exactly back to rangeStart — both stop paths
    // assign `this.rangeStart` verbatim, so this is exact, not fuzzy.
    expect(c.currentTime).toBe(0.3)
  })

  /**
   * Mid-song-play guard. If `currentTime > firstDownbeatOriginalSec`,
   * no count-in pre-roll fires — `play()` starts the buffer at
   * `ctxStart + 0`, not `ctxStart + prependSec`.
   *
   * This was the flakiest assertion in the file: `sleep(150)` then
   * `currentTime > 1.05` left only ~30–55 ms of measured headroom
   * (ideal value 1.11) against unbounded context start-up lag. The
   * observed failure read 1.0355 — i.e. ~75 ms of the 150 ms window was
   * eaten before the context clock started.
   *
   * It's replaced by the mirror image of the count-in test: a
   * timing-free count of the synchronously pre-scheduled oscillators
   * (must be zero), plus a wall-clock *upper* bound that a pre-roll
   * could not possibly satisfy.
   */
  it('skips count-in when currentTime is past the song start', async () => {
    const c = new PlaybackController()
    const buf = await decodeSilentBuffer(3)
    cleanups.push(() => c.destroy())

    const oscillatorCalls = spyOnOscillators()

    c.setSongMap(makeSong({ barCount: 4, countInBeats: 4 }))
    c.setAudioBuffer(buf)
    c.rangeEnd = buf.duration
    c.playWithClick = true

    // Same song as the count-in test, so the pre-roll it is declining is
    // real and non-zero.
    const plan = c.plan!
    expect(plan.prependSec).toBeCloseTo(2, 6)
    expect(plan.clickPoints.filter((p) => p.isCountIn).length).toBe(4)

    c.seek(1.0) // past firstDownbeatOriginalSec = 0
    const startedAt = performance.now()
    c.play()

    // `play()` pre-schedules count-in oscillators synchronously when it
    // takes the count-in path. Starting mid-song must schedule none.
    expect(oscillatorCalls.length).toBe(0)

    // And the playhead moves off the seek point promptly instead of
    // sitting at 1.0 for a pre-roll's worth of time.
    await waitUntil(() => c.currentTime > 1.05, 'the playhead to advance past the seek point')
    expect(performance.now() - startedAt).toBeLessThan(plan.prependSec * 1000)
  })
})
