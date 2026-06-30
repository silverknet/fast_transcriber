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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlaybackController } from '$lib/audio/playbackController.svelte'
import { defaultCueSettings } from '$lib/songmap/defaults'
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
    cues: { ...defaultCueSettings(), mode: 'off', countInBeats: 0 },
    ...(opts.countInBeats !== undefined ? { countInBeats: opts.countInBeats } : {}),
  } as SongMap
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const cleanups: Array<() => void | Promise<void>> = []

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
    // Give the source a frame to actually start playing.
    await sleep(100)
    expect(c.currentTime).toBeGreaterThan(0)
  })

  it('pause() flips isPlaying false and freezes currentTime', async () => {
    const c = new PlaybackController()
    const buf = await decodeSilentBuffer(3)
    cleanups.push(() => c.destroy())

    c.setSongMap(makeSong({ barCount: 1 }))
    c.setAudioBuffer(buf)
    c.rangeEnd = buf.duration
    c.play()
    await sleep(300)
    const tBeforePause = c.currentTime
    c.pause()
    expect(c.isPlaying).toBe(false)
    await sleep(200)
    // currentTime stays put (within rAF tolerance).
    expect(Math.abs(c.currentTime - tBeforePause)).toBeLessThan(0.1)
  })

  /**
   * Live grid regression: the click loop must actually fire
   * oscillators when `playWithClick = true`. Each `playMetronomeClick`
   * creates one `OscillatorNode`, so spying on `createOscillator`
   * gives us a count. A 1-bar, 4-beat song should produce ≥3 within
   * a couple of seconds of playback.
   */
  it('click loop creates oscillators when playWithClick is on', async () => {
    const c = new PlaybackController()
    const buf = await decodeSilentBuffer(3)
    cleanups.push(() => c.destroy())

    const origCreate = AudioContext.prototype.createOscillator
    const oscillatorCalls: number[] = []
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      oscillatorCalls.push(this.currentTime)
      return origCreate.call(this)
    }
    cleanups.push(() => {
      AudioContext.prototype.createOscillator = origCreate
    })

    c.setSongMap(makeSong({ barCount: 1, beatsPerBar: 4, beatDurationSec: 0.5 }))
    c.setAudioBuffer(buf)
    c.rangeEnd = buf.duration
    c.playWithClick = true
    c.play()
    // 4 beats × 0.5 s = 2 s of play; wait a bit more so the loop fires.
    await sleep(2300)
    c.pause()

    expect(oscillatorCalls.length).toBeGreaterThanOrEqual(3)
    expect(oscillatorCalls.length).toBeLessThanOrEqual(5)
  })

  /**
   * Tight-trim count-in: when `prependSec > 0`, the source is started
   * AFTER the pre-roll. We don't measure the count-in oscillators
   * directly (they're scheduled in advance and counted in the unit
   * tests); here we just check that audio actually starts playing
   * within a window that fits prependSec + lookahead.
   */
  it('count-in pre-roll delays audio start by ~prependSec', async () => {
    const c = new PlaybackController()
    const buf = await decodeSilentBuffer(5)
    cleanups.push(() => c.destroy())

    c.setSongMap(makeSong({ barCount: 4, countInBeats: 4 }))
    c.setAudioBuffer(buf)
    c.rangeEnd = buf.duration
    c.playWithClick = true
    c.play()
    // Mid-prerollthe currentTime should still be ~0 (or the start position).
    await sleep(800)
    expect(c.currentTime).toBeLessThan(0.5)
    // After the full pre-roll (2 s) + a buffer, currentTime should
    // have started advancing.
    await sleep(2000)
    expect(c.currentTime).toBeGreaterThan(0.2)
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

    c.play()
    expect(c.isPlaying).toBe(true)
    // 700 ms of play range — wait for the auto-stop with margin.
    await vi.waitFor(() => expect(c.isPlaying).toBe(false), { timeout: 2500 })
    expect(c.currentTime).toBeCloseTo(0.3, 1)
  })

  /**
   * Mid-song-play guard. If `currentTime > firstDownbeatOriginalSec`,
   * no count-in pre-roll fires — `play()` starts the buffer at
   * `ctxStart + 0`, not `ctxStart + prependSec`.
   */
  it('skips count-in when currentTime is past the song start', async () => {
    const c = new PlaybackController()
    const buf = await decodeSilentBuffer(3)
    cleanups.push(() => c.destroy())

    c.setSongMap(makeSong({ barCount: 4, countInBeats: 4 }))
    c.setAudioBuffer(buf)
    c.rangeEnd = buf.duration
    c.playWithClick = true
    c.seek(1.0) // past firstDownbeatOriginalSec = 0
    c.play()
    await sleep(150)
    // currentTime jumped to ~1.0+ immediately, NOT held at 1.0 for 2 s.
    expect(c.currentTime).toBeGreaterThan(1.05)
  })
})
