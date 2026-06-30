/**
 * Unit tests for the buffer-based `PlaybackController`.
 *
 * The controller plays audio via `AudioBufferSourceNode` against ONE
 * `AudioContext` that ALSO hosts the click oscillators. There is only
 * one clock; sync between song and clicks is guaranteed by
 * construction. These tests check the math + the lifecycle hooks; the
 * "does it actually ring in sync" question lives in the browser
 * tests (`*.browser.test.ts`) where we can run a real `AudioContext`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackController } from '$lib/audio/playbackController.svelte'
import { defaultCueSettings } from '$lib/songmap/defaults'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import type { SongMap } from '$lib/songmap/types'

// ── Mocks ────────────────────────────────────────────────────────────

class MockAudioParam {
  value = 0
  setValueAtTime = vi.fn()
  linearRampToValueAtTime = vi.fn()
  exponentialRampToValueAtTime = vi.fn()
}

class MockGainNode {
  gain = new MockAudioParam()
  connect = vi.fn()
  disconnect = vi.fn()
}

class MockOscillatorNode {
  frequency = new MockAudioParam()
  type = ''
  connect = vi.fn()
  start: (t: number) => void
  stop = vi.fn()
  constructor(public _scheduledStarts: number[]) {
    this.start = (t: number) => {
      this._scheduledStarts.push(t)
    }
  }
}

class MockBufferSourceNode {
  buffer: { duration: number } | null = null
  connect = vi.fn()
  disconnect = vi.fn()
  /** Each `start` call records `[ctxTime, offset]`. */
  starts: Array<[number, number?]> = []
  start = (when: number, offset?: number) => {
    this.starts.push([when, offset])
  }
  stop = vi.fn()
  onended: (() => void) | null = null
}

class MockAudioContext {
  currentTime = 0
  destination = {}
  state: 'running' | 'suspended' | 'closed' = 'running'
  /** Every `osc.start(t)` call ends up here. */
  scheduledStarts: number[] = []
  /** Buffer sources created via `createBufferSource`. */
  bufferSources: MockBufferSourceNode[] = []
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  createGain() {
    return new MockGainNode()
  }
  createOscillator() {
    return new MockOscillatorNode(this.scheduledStarts)
  }
  createBufferSource() {
    const s = new MockBufferSourceNode()
    this.bufferSources.push(s)
    return s
  }
}

let lastCtx: MockAudioContext | null = null

function makeSong(opts: {
  barCount?: number
  trimStartSec?: number
  trimEndSec?: number
  countInBeats?: number
  startBeatId?: string
}): SongMap {
  const barCount = opts.barCount ?? 4
  const bd = 0.5
  const beatsPerBar = 4
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
      fileName: 'x.wav',
      trim: { startSec: trimStartSec, endSec: trimEndSec },
      source: 'upload',
    },
    timeline: { bars, beats },
    sections: [],
    harmony: [],
    cues: { ...defaultCueSettings(), mode: 'off', countInBeats: 0 },
    ...(opts.countInBeats !== undefined ? { countInBeats: opts.countInBeats } : {}),
    ...(opts.startBeatId !== undefined ? { startBeatId: opts.startBeatId } : {}),
  } as SongMap
}

/** Build a fake decoded buffer with the requested duration. */
function makeBuffer(durationSec: number): AudioBuffer {
  return { duration: durationSec } as unknown as AudioBuffer
}

beforeEach(() => {
  vi.useFakeTimers()
  lastCtx = null
  ;(globalThis as { AudioContext: typeof AudioContext }).AudioContext = function (
    this: MockAudioContext,
  ) {
    const c = new MockAudioContext()
    lastCtx = c
    return c
  } as unknown as typeof AudioContext
  ;(globalThis as { requestAnimationFrame: (cb: FrameRequestCallback) => number }).requestAnimationFrame = vi.fn(
    () => 1 as number,
  )
  ;(globalThis as { cancelAnimationFrame: (h: number) => void }).cancelAnimationFrame = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────

describe('PlaybackController construction', () => {
  it('exposes initial state defaults', () => {
    const c = new PlaybackController()
    expect(c.isPlaying).toBe(false)
    expect(c.currentTime).toBe(0)
    expect(c.mediaReady).toBe(false)
    expect(c.playWithClick).toBe(false)
    expect(c.clickVolume).toBeCloseTo(1.5)
    expect(c.songVolume).toBeCloseTo(1)
    c.destroy()
  })

  it('plan is null until songMap is set', () => {
    const c = new PlaybackController()
    expect(c.plan).toBeNull()
    c.setSongMap(makeSong({ barCount: 2 }))
    expect(c.plan).not.toBeNull()
    c.destroy()
  })

  it('mediaReady is derived from audioBuffer (not audio element)', () => {
    const c = new PlaybackController()
    expect(c.mediaReady).toBe(false)
    c.setAudioBuffer(makeBuffer(10))
    expect(c.mediaReady).toBe(true)
    c.setAudioBuffer(null)
    expect(c.mediaReady).toBe(false)
    c.destroy()
  })

  it('plan recomputes when songMap is mutated through setSongMap', () => {
    const c = new PlaybackController()
    c.setSongMap(makeSong({ barCount: 2, countInBeats: 4 }))
    expect(c.plan?.countInBeats).toBe(4)
    c.setSongMap(makeSong({ barCount: 2, countInBeats: 8 }))
    expect(c.plan?.countInBeats).toBe(8)
    c.destroy()
  })
})

describe('PlaybackController.play() — buffer scheduling', () => {
  it('no-ops when there is no audioBuffer', () => {
    const c = new PlaybackController()
    c.setSongMap(makeSong({ barCount: 2 }))
    c.play()
    expect(c.isPlaying).toBe(false)
    expect(lastCtx).toBeNull()
    c.destroy()
  })

  it('creates a BufferSource and schedules it at ctx.currentTime + lookahead', () => {
    const c = new PlaybackController()
    c.setSongMap(makeSong({ barCount: 4 }))
    c.setAudioBuffer(makeBuffer(8))
    c.rangeEnd = 8
    c.play()
    expect(c.isPlaying).toBe(true)
    expect(lastCtx).not.toBeNull()
    const ctx = lastCtx!
    expect(ctx.bufferSources.length).toBe(1)
    const src = ctx.bufferSources[0]!
    // Lookahead is 0.04 s (matches MixerEngine).
    expect(src.starts[0]![0]).toBeCloseTo(0.04, 3)
    // Started from buffer offset 0 (we're at currentTime 0).
    expect(src.starts[0]![1]).toBeCloseTo(0, 6)
    c.destroy()
  })

  it('starts the source from the rangeStart when currentTime is outside the range', () => {
    const c = new PlaybackController()
    c.setSongMap(makeSong({ barCount: 4 }))
    c.setAudioBuffer(makeBuffer(8))
    c.rangeStart = 1.5
    c.rangeEnd = 7
    c.currentTime = 0 // outside [1.5, 7)
    c.play()
    const src = lastCtx!.bufferSources[0]!
    expect(src.starts[0]![1]).toBeCloseTo(1.5, 6)
    c.destroy()
  })

  it('with count-in, schedules source AFTER prependSec of pre-roll', () => {
    const c = new PlaybackController()
    // Tight trim — 4-beat count-in × 0.5 s needs 2.0 s prepend.
    c.setSongMap(makeSong({ barCount: 4, countInBeats: 4 }))
    c.setAudioBuffer(makeBuffer(8))
    c.rangeEnd = 8
    c.playWithClick = true
    c.play()
    const src = lastCtx!.bufferSources[0]!
    // Source starts at lookahead + prependSec = 0.04 + 2.0
    expect(src.starts[0]![0]).toBeCloseTo(2.04, 2)
    c.destroy()
  })

  it('with count-in, pre-schedules N click oscillators at ctxStart + c.timeSec', () => {
    const c = new PlaybackController()
    c.setSongMap(makeSong({ barCount: 4, countInBeats: 4 }))
    c.setAudioBuffer(makeBuffer(8))
    c.rangeEnd = 8
    c.playWithClick = true
    c.play()
    const ctx = lastCtx!
    const starts = ctx.scheduledStarts.slice().sort((a, b) => a - b)
    // 4 count-in clicks.
    expect(starts.length).toBe(4)
    // First click rings ~one beat into the pre-roll (count-in starts
    // at `ctxStart - countInDuration = ctxStart - 2.0`; the first c.timeSec
    // is `-prependSec = -2.0`, so fireAt = ctxStart - 2.0 = 0.04).
    expect(starts[0]).toBeCloseTo(0.04, 2)
    // Even spacing — every consecutive pair is exactly beatDur (0.5s) apart.
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBeCloseTo(0.5, 3)
    }
    c.destroy()
  })

  it('does nothing if already playing', () => {
    const c = new PlaybackController()
    c.setSongMap(makeSong({ barCount: 2 }))
    c.setAudioBuffer(makeBuffer(4))
    c.rangeEnd = 4
    c.play()
    expect(lastCtx!.bufferSources.length).toBe(1)
    c.play() // second call
    expect(lastCtx!.bufferSources.length).toBe(1)
    c.destroy()
  })

  it('skips count-in when playWithClick is off', () => {
    const c = new PlaybackController()
    c.setSongMap(makeSong({ barCount: 4, countInBeats: 4 }))
    c.setAudioBuffer(makeBuffer(8))
    c.rangeEnd = 8
    c.playWithClick = false
    c.play()
    const src = lastCtx!.bufferSources[0]!
    // No pre-roll — source starts at lookahead only.
    expect(src.starts[0]![0]).toBeCloseTo(0.04, 3)
    c.destroy()
  })
})

describe('PlaybackController.pause() and seek()', () => {
  it('pause() stops the source and freezes currentTime', () => {
    const c = new PlaybackController()
    c.setSongMap(makeSong({ barCount: 4 }))
    c.setAudioBuffer(makeBuffer(8))
    c.rangeEnd = 8
    c.play()
    expect(c.isPlaying).toBe(true)
    // Pretend ctx advanced 1 second.
    lastCtx!.currentTime = 1.04
    c.pause()
    expect(c.isPlaying).toBe(false)
    // playStartCtxTime was 0.04; after 1.04 we're 1.0 s into the buffer.
    expect(c.currentTime).toBeCloseTo(1.0, 3)
    c.destroy()
  })

  it('stop() resets currentTime to rangeStart and clears state', () => {
    const c = new PlaybackController()
    c.setSongMap(makeSong({ barCount: 4 }))
    c.setAudioBuffer(makeBuffer(8))
    c.rangeStart = 2
    c.rangeEnd = 6
    c.currentTime = 4
    c.play()
    c.stop()
    expect(c.isPlaying).toBe(false)
    expect(c.currentTime).toBe(2)
    c.destroy()
  })

  it('seek() updates currentTime', () => {
    const c = new PlaybackController()
    c.setSongMap(makeSong({ barCount: 4 }))
    c.setAudioBuffer(makeBuffer(8))
    c.seek(3.0)
    expect(c.currentTime).toBe(3.0)
    c.destroy()
  })

  it('seek() clamps to the buffer duration', () => {
    const c = new PlaybackController()
    c.setSongMap(makeSong({ barCount: 4 }))
    c.setAudioBuffer(makeBuffer(8))
    c.seek(100)
    expect(c.currentTime).toBe(8)
    c.seek(-1)
    expect(c.currentTime).toBe(0)
    c.destroy()
  })
})

describe('PlaybackController volume sync (derived clamps)', () => {
  it('clampedSongVolume tracks songVolume in [0, 1]', () => {
    const c = new PlaybackController()
    c.songVolume = 0.42
    expect(c.clampedSongVolume).toBeCloseTo(0.42, 4)
    c.songVolume = 5
    expect(c.clampedSongVolume).toBe(1)
    c.songVolume = -1
    expect(c.clampedSongVolume).toBe(0)
    c.destroy()
  })

  it('clampedClickVolume clamps at zero (no upper cap)', () => {
    const c = new PlaybackController()
    c.clickVolume = 1.7
    expect(c.clampedClickVolume).toBeCloseTo(1.7, 4)
    c.clickVolume = -3
    expect(c.clampedClickVolume).toBe(0)
    c.destroy()
  })
})

describe('PlaybackController destroy', () => {
  it('closes the AudioContext if one was created', () => {
    const c = new PlaybackController()
    c.setSongMap(makeSong({ barCount: 2 }))
    c.setAudioBuffer(makeBuffer(4))
    c.rangeEnd = 4
    c.play()
    expect(lastCtx).not.toBeNull()
    c.destroy()
    expect(lastCtx?.close).toHaveBeenCalled()
  })

  it('is safe to call without prior play()', () => {
    const c = new PlaybackController()
    expect(() => c.destroy()).not.toThrow()
  })
})

describe('PlaybackController reactivity', () => {
  it('mutating countInBeats mid-stream changes plan.clickPoints count', () => {
    const c = new PlaybackController()
    c.setSongMap(makeSong({ barCount: 4, countInBeats: 4 }))
    const ciCountA = (c.plan?.clickPoints ?? []).filter((p) => p.isCountIn).length
    expect(ciCountA).toBe(4)
    c.setSongMap(makeSong({ barCount: 4, countInBeats: 8 }))
    const ciCountB = (c.plan?.clickPoints ?? []).filter((p) => p.isCountIn).length
    expect(ciCountB).toBe(8)
    c.destroy()
  })

  it('mutating startBeatId shifts firstDownbeatOriginalSec', () => {
    const c = new PlaybackController()
    c.setSongMap(makeSong({ barCount: 4 }))
    expect(c.plan?.firstDownbeatOriginalSec).toBe(0)
    c.setSongMap(makeSong({ barCount: 4, startBeatId: 'b1_0' }))
    expect(c.plan?.firstDownbeatOriginalSec).toBeCloseTo(2.0, 6)
    c.destroy()
  })
})
