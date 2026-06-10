/**
 * Browser tests for `PlaybackController`. These run in a REAL Chromium
 * via vitest-browser + Playwright (`npm run test:browser`), so:
 *   - `<audio>` events fire on real timing.
 *   - `AudioContext` is the real one (with user-gesture gating).
 *   - Svelte 5 `$effect`s actually run; effect-graph ordering is the
 *     real browser ordering, not a node mock.
 *   - The audio element's `play()` returns a Promise that resolves on
 *     actual playback start (with real lifecycle).
 *
 * The unit tests in `playbackController.test.ts` already cover the
 * algebra (sync math, clamp ranges, derivations). These tests cover
 * the things mocks structurally can't:
 *   1. The `isPlaying × playWithClick × clickPoints.length` $effect
 *      actually fires in a real browser.
 *   2. The 'play' event listener attaches and re-fires `#startClickLoop`.
 *   3. `pause()` during a count-in pre-roll cancels the deferred play
 *      against a real audio element.
 *   4. The click loop creates OscillatorNodes (one per click) so we
 *      can count them as a proxy for "clicks actually fired".
 *
 * Test-audio strategy: a 5-second silent WAV blob URL drives the
 * `<audio>` element. Silent so headless Chromium doesn't gate playback
 * on user-gesture (it still needs ONE user gesture to start, but
 * a programmatic .play() call from inside the test counts since
 * `vitest-browser` runs in a real interaction context).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackController } from '$lib/audio/playbackController.svelte'
import { defaultCueSettings } from '$lib/songmap/defaults'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import type { SongMap } from '$lib/songmap/types'

// ── Test fixtures ────────────────────────────────────────────────────

/**
 * Make a tiny silent WAV blob. 5 seconds is plenty for the play/pause
 * tests; we don't care about the actual audio content, just that the
 * `<audio>` element accepts the source and fires real play/pause/ended
 * events.
 */
function makeSilentWavBlob(durationSec = 5, sampleRate = 8000): Blob {
  const numFrames = Math.floor(durationSec * sampleRate)
  const dataSize = numFrames * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  // RIFF chunk descriptor
  view.setUint32(0, 0x52494646, false) // "RIFF"
  view.setUint32(4, 36 + dataSize, true)
  view.setUint32(8, 0x57415645, false) // "WAVE"
  // fmt sub-chunk
  view.setUint32(12, 0x666d7420, false) // "fmt "
  view.setUint32(16, 16, true) // fmt size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  // data sub-chunk
  view.setUint32(36, 0x64617461, false) // "data"
  view.setUint32(40, dataSize, true)
  // Samples are already zero from ArrayBuffer init — silent.
  return new Blob([buffer], { type: 'audio/wav' })
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
    cues: { ...defaultCueSettings(), mode: 'off', countInBeats: 0 },
    ...(opts.countInBeats !== undefined ? { countInBeats: opts.countInBeats } : {}),
  } as SongMap
}

/**
 * Spin up a real `<audio>` element with the silent WAV source. Caller
 * gets the element and a cleanup function that revokes the blob URL.
 * The element is appended to `document.body` so play() works without
 * "element not connected" complaints in some browsers.
 */
function makeAudio(durationSec = 5): { audio: HTMLAudioElement; cleanup: () => void } {
  const blob = makeSilentWavBlob(durationSec)
  const url = URL.createObjectURL(blob)
  const audio = document.createElement('audio')
  audio.preload = 'auto'
  audio.src = url
  document.body.appendChild(audio)
  return {
    audio,
    cleanup: () => {
      audio.pause()
      audio.remove()
      URL.revokeObjectURL(url)
    },
  }
}

/** Sleep `ms` real milliseconds — used for letting browser timing settle. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Lifecycle ────────────────────────────────────────────────────────

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

// ── Tests ────────────────────────────────────────────────────────────

describe('PlaybackController (real browser)', () => {
  it('play() flips isPlaying true after the real audio element starts', async () => {
    const c = new PlaybackController()
    const { audio, cleanup } = makeAudio()
    cleanups.push(() => c.destroy(), cleanup)

    c.setAudioElement(audio)
    c.setSongMap(makeSong({ barCount: 1 }))

    // Wait for the element to be ready enough to actually play. `poll`
    // sidesteps the addEventListener race where canplay can fire
    // between our `if (readyState < 2)` check and the listener attach.
    await vi.waitFor(() => expect(audio.readyState).toBeGreaterThanOrEqual(2), { timeout: 3000 })

    expect(c.isPlaying).toBe(false)
    c.play()
    // Wait for the controller's listener to flip isPlaying — which it
    // does inside its 'play' event handler, set by the controller's
    // `$effect`. If this never flips, the regression is "the play
    // event listener isn't wired in a real browser".
    await vi.waitFor(() => expect(c.isPlaying).toBe(true), { timeout: 3000 })
    expect(audio.paused).toBe(false)
  })

  it('pause() flips isPlaying false against the real audio element', async () => {
    const c = new PlaybackController()
    const { audio, cleanup } = makeAudio()
    cleanups.push(() => c.destroy(), cleanup)

    c.setAudioElement(audio)
    c.setSongMap(makeSong({ barCount: 1 }))
    await vi.waitFor(() => expect(audio.readyState).toBeGreaterThanOrEqual(2), { timeout: 3000 })

    c.play()
    await vi.waitFor(() => expect(c.isPlaying).toBe(true), { timeout: 3000 })

    c.pause()
    await vi.waitFor(() => expect(c.isPlaying).toBe(false), { timeout: 3000 })
    expect(audio.paused).toBe(true)
  })

  /**
   * This is the test that catches today's regression class: the click
   * loop must actually start when `playWithClick` is true at play
   * time. We can't easily inspect Web Audio output, but each click
   * goes through `playMetronomeClick` → `ctx.createOscillator()`, so
   * spying on `createOscillator` counts clicks. One oscillator per
   * click. Our `barCount = 1, beatsPerBar = 4` song has 4 beats; the
   * loop fires them all once audio progresses past their time.
   */
  it('click loop creates oscillators when playWithClick is on (the live grid regression catcher)', async () => {
    const c = new PlaybackController()
    const { audio, cleanup } = makeAudio()
    cleanups.push(() => c.destroy(), cleanup)

    // Spy on AudioContext.createOscillator across all instances —
    // `playMetronomeClick` creates exactly one oscillator per click.
    const origCreate = AudioContext.prototype.createOscillator
    const oscillatorCalls: number[] = []
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      oscillatorCalls.push(this.currentTime)
      return origCreate.call(this)
    }
    cleanups.push(() => {
      AudioContext.prototype.createOscillator = origCreate
    })

    c.setAudioElement(audio)
    // beatDur = 0.5 s → 4 beats span 0..1.5 s in plan-time.
    c.setSongMap(makeSong({ barCount: 1, beatsPerBar: 4, beatDurationSec: 0.5 }))
    c.playWithClick = true
    await vi.waitFor(() => expect(audio.readyState).toBeGreaterThanOrEqual(2), { timeout: 3000 })

    c.play()
    await vi.waitFor(() => expect(audio.paused).toBe(false), { timeout: 3000 })
    // Let the rAF loop run while audio plays through the 4 beats.
    // 2.5 s real time gives the click loop plenty of headroom even on
    // slow CI machines.
    await sleep(2500)
    c.pause()

    // The controller can also pre-schedule count-in clicks via the
    // same `createOscillator` path, but this song has none — so every
    // oscillator we counted is a song click. Allow a small tolerance
    // in case the loop missed the very last one (audio paused right
    // around it).
    expect(oscillatorCalls.length).toBeGreaterThanOrEqual(3)
    expect(oscillatorCalls.length).toBeLessThanOrEqual(5)
  })

  /**
   * The bug fixed in commit e8025fc: pause/stop during count-in
   * pre-roll must cancel the deferred `audio.play()`. Unit tests with
   * fake timers covered the timing; this exercises the real audio
   * element so we'd catch any drift in the real lifecycle.
   */
  it('pause() during count-in pre-roll prevents the deferred audio.play()', async () => {
    const c = new PlaybackController()
    const { audio, cleanup } = makeAudio()
    cleanups.push(() => c.destroy(), cleanup)

    const playSpy = vi.spyOn(audio, 'play')

    c.setAudioElement(audio)
    // Tight trim: 4 beats × 0.5 s count-in needs 2.0 s pre-roll silence.
    c.setSongMap(makeSong({ barCount: 4, countInBeats: 4 }))
    c.playWithClick = true
    await vi.waitFor(() => expect(audio.readyState).toBeGreaterThanOrEqual(2), { timeout: 3000 })

    c.play()
    // Verify the deferred path was taken — audio.play() must NOT have
    // been called yet at this point (pre-roll is 2 s).
    expect(playSpy).not.toHaveBeenCalled()

    // Halfway through the pre-roll: user changes their mind.
    await sleep(500)
    c.pause()

    // Wait past where the deferred play would have fired. If the cancel
    // didn't work, playSpy would record a call here.
    await sleep(2000)
    expect(playSpy).not.toHaveBeenCalled()
    expect(audio.paused).toBe(true)
  })
})
