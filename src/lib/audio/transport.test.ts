/**
 * Unit tests for the `MixerEngine`-backed `UnifiedTransport`.
 *
 * The transport plays the song as ONE `MixerEngine` track and rings the
 * metronome through a `clickMaster` gain on that SAME `AudioContext` — one
 * clock, so song and clicks cannot drift. The scheduling DECISIONS reuse the
 * pure `clickScheduling` module, exactly as `PlaybackController` does. These
 * tests copy the mock-`AudioContext` harness from `playbackController.test.ts`
 * and assert the timing math + lifecycle: source scheduled at `ctx.currentTime
 * + 0.04 (+ preroll)`, count-in clicks pre-scheduled at `playStartCtx +
 * clickPoint.timeSec`, the rAF click loop schedules song-beat clicks, song-time
 * derives correctly, and `pause()` freezes the position. "Does it actually ring
 * in sync" lives in the browser tests, where a real `AudioContext` runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import type { SongMap } from '$lib/songmap/types'

// ── Mocks (copied from playbackController.test.ts, + decodeAudioData) ─

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

/** Duration (s) the mock `decodeAudioData` hands back. */
let decodeDurationSec = 8

class MockAudioContext {
  currentTime = 0
  destination = {}
  state: 'running' | 'suspended' | 'closed' = 'running'
  /** Every `osc.start(t)` call ends up here (the metronome clicks). */
  scheduledStarts: number[] = []
  /** BufferSources created via `createBufferSource` (the song). */
  bufferSources: MockBufferSourceNode[] = []
  /** Every gain node created (master, click master, track gains…). */
  createdGains: MockGainNode[] = []
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  createGain() {
    const g = new MockGainNode()
    this.createdGains.push(g)
    return g
  }
  createOscillator() {
    return new MockOscillatorNode(this.scheduledStarts)
  }
  createBufferSource() {
    const s = new MockBufferSourceNode()
    this.bufferSources.push(s)
    return s
  }
  decodeAudioData(_bytes: ArrayBuffer): Promise<AudioBuffer> {
    return Promise.resolve(makeBuffer(decodeDurationSec))
  }
}

/** The most-recently-created MixerEngine context (the playback + click ctx). */
let lastCtx: MockAudioContext | null = null

// ── Controllable rAF queue (so we can flush frames deterministically) ─
let rafCbs = new Map<number, FrameRequestCallback>()
let rafSeq = 0
function flushFrame(): void {
  const entries = [...rafCbs]
  rafCbs.clear()
  for (const [, cb] of entries) cb(0)
}

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
    cueTracks: [],
    ...(opts.countInBeats !== undefined ? { countInBeats: opts.countInBeats } : {}),
    ...(opts.startBeatId !== undefined ? { startBeatId: opts.startBeatId } : {}),
  } as SongMap
}

/** Build a fake decoded buffer with the requested duration. */
function makeBuffer(durationSec: number): AudioBuffer {
  return { duration: durationSec } as unknown as AudioBuffer
}

/** A stand-in File whose `arrayBuffer()` resolves; content is ignored (mock decode). */
function makeFile(name = 'x.wav'): File {
  return { name, arrayBuffer: async () => new ArrayBuffer(8) } as unknown as File
}

/**
 * Fresh transport per test. The module singleton is stateful, so we import a new
 * module instance after resetting the registry.
 */
async function freshTransport() {
  vi.resetModules()
  const mod = await import('$lib/audio/transport.svelte')
  return mod.transport
}

/** Load + register the song track, awaiting the decode microtask. */
async function loadSong(
  t: Awaited<ReturnType<typeof freshTransport>>,
  sm: SongMap,
  durationSec = 8,
) {
  decodeDurationSec = durationSec
  t.configure(sm)
  await t.loadFile(makeFile())
}

beforeEach(() => {
  vi.useFakeTimers()
  lastCtx = null
  rafCbs = new Map()
  rafSeq = 0
  decodeDurationSec = 8
  ;(globalThis as { AudioContext: typeof AudioContext }).AudioContext = function (
    this: MockAudioContext,
  ) {
    const c = new MockAudioContext()
    lastCtx = c
    return c
  } as unknown as typeof AudioContext
  // The MixerEngine schedules its auto-stop via `window.setTimeout`; the unit
  // env is node, so give it a window that routes to the (faked) global timers.
  ;(globalThis as { window: typeof globalThis }).window = globalThis as typeof globalThis
  ;(globalThis as { requestAnimationFrame: (cb: FrameRequestCallback) => number }).requestAnimationFrame =
    vi.fn((cb: FrameRequestCallback) => {
      const id = ++rafSeq
      rafCbs.set(id, cb)
      return id
    })
  ;(globalThis as { cancelAnimationFrame: (h: number) => void }).cancelAnimationFrame = vi.fn(
    (h: number) => {
      rafCbs.delete(h)
    },
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────

describe('UnifiedTransport configuration + readiness', () => {
  it('is not ready until a file is loaded, then exposes song-time duration', async () => {
    const t = await freshTransport()
    t.configure(makeSong({ barCount: 4 }))
    expect(t.ready).toBe(false)
    expect(t.durationSec).toBe(0)
    await loadSong(t, makeSong({ barCount: 4 }), 8)
    expect(t.ready).toBe(true)
    // Whole buffer is song-time (trimStart 0), so duration = 8.
    expect(t.durationSec).toBeCloseTo(8, 6)
    expect(t.audioBuffer?.duration).toBe(8)
    t.dispose()
  })

  it('mediaOffsetSec follows the plan trimStart; song-time subtracts it', async () => {
    const t = await freshTransport()
    // trimStart 1.5 → buffer position 1.5 is song-time 0.
    await loadSong(t, makeSong({ barCount: 4, trimStartSec: 1.5, trimEndSec: 8 }), 8)
    expect(t.mediaOffsetSec).toBeCloseTo(1.5, 6)
    // durationSec = bufferDuration − mediaOffset.
    expect(t.durationSec).toBeCloseTo(8 - 1.5, 6)
    t.dispose()
  })
})

describe('UnifiedTransport — song switching resets position (regression)', () => {
  it('loading a new song resets to the top even when the singleton was left mid-song', async () => {
    const t = await freshTransport()
    // Song A: play, advance the shared engine clock into the second half, pause.
    await loadSong(t, makeSong({ barCount: 8 }), 16)
    t.play()
    const ctx = lastCtx!
    ctx.currentTime = 10 // ~second half of the 16s buffer
    t.pause()
    expect(t.songTimeSec).toBeGreaterThan(5) // paused mid-song

    // Load a DIFFERENT file (new song) into the SAME persistent transport.
    t.configure(makeSong({ barCount: 8 }))
    await t.loadFile(makeFile('song-b.wav'))

    // Must be reset to the top — not the previous song's leftover position.
    expect(t.songTimeSec).toBeCloseTo(0, 6)

    // …and playing the new song starts the source from offset 0 (the top),
    // which is also where the click loop anchors (fixes "clicks start midway").
    t.play()
    const newSource = lastCtx!.bufferSources[lastCtx!.bufferSources.length - 1]!
    expect(newSource.starts[0]![1]).toBeCloseTo(0, 6)
    t.dispose()
  })
})

describe('UnifiedTransport.play() — engine source scheduling', () => {
  it('no-ops (no engine/context created) when no file is loaded', async () => {
    const t = await freshTransport()
    t.configure(makeSong({ barCount: 2 }))
    t.play()
    expect(t.isPlaying).toBe(false)
    expect(lastCtx).toBeNull()
    t.dispose()
  })

  it('schedules the song source at ctx.currentTime + 0.04, offset 0, from song start', async () => {
    const t = await freshTransport()
    await loadSong(t, makeSong({ barCount: 4 }), 8)
    t.play()
    expect(t.isPlaying).toBe(true)
    expect(lastCtx).not.toBeNull()
    const ctx = lastCtx!
    expect(ctx.bufferSources.length).toBe(1)
    const src = ctx.bufferSources[0]!
    // Lookahead 0.04 (MixerEngine's), no pre-roll.
    expect(src.starts[0]![0]).toBeCloseTo(0.04, 3)
    expect(src.starts[0]![1]).toBeCloseTo(0, 6)
    t.dispose()
  })

  it('starts from rangeStart (buffer-time) when the playhead is outside the range', async () => {
    const t = await freshTransport()
    await loadSong(t, makeSong({ barCount: 4 }), 8)
    // Song-time range [1.5, 7); trimStart 0 → same in buffer-time.
    t.setRangeSongTime(1.5, 7)
    t.play()
    const src = lastCtx!.bufferSources[0]!
    expect(src.starts[0]![1]).toBeCloseTo(1.5, 6)
    t.dispose()
  })

  it('does nothing if already playing', async () => {
    const t = await freshTransport()
    await loadSong(t, makeSong({ barCount: 2 }), 4)
    t.play()
    expect(lastCtx!.bufferSources.length).toBe(1)
    t.play() // second call ignored
    expect(lastCtx!.bufferSources.length).toBe(1)
    t.dispose()
  })
})

describe('UnifiedTransport.play() — count-in', () => {
  it('with count-in, schedules the source AFTER prependSec of pre-roll', async () => {
    const t = await freshTransport()
    // Tight trim, 4-beat count-in × 0.5 s = 2.0 s prepend.
    await loadSong(t, makeSong({ barCount: 4, countInBeats: 4 }), 8)
    t.playWithClick = true
    t.play()
    const src = lastCtx!.bufferSources[0]!
    // Source starts at lookahead + prependSec = 0.04 + 2.0.
    expect(src.starts[0]![0]).toBeCloseTo(2.04, 2)
    expect(src.starts[0]![1]).toBeCloseTo(0, 6)
    t.dispose()
  })

  it('pre-schedules N count-in clicks at playStartCtx + clickPoint.timeSec', async () => {
    const t = await freshTransport()
    await loadSong(t, makeSong({ barCount: 4, countInBeats: 4 }), 8)
    t.playWithClick = true
    t.play()
    const ctx = lastCtx!
    const starts = ctx.scheduledStarts.slice().sort((a, b) => a - b)
    // Exactly the four count-in clicks (no song clicks yet — the loop is rAF).
    expect(starts.length).toBe(4)
    // ctxStart = 0.04 + 2.0 = 2.04; count-in points at -2/-1.5/-1/-0.5.
    ;[0.04, 0.54, 1.04, 1.54].forEach((expected, i) => {
      expect(starts[i]).toBeCloseTo(expected, 2)
    })
    // Even beat spacing.
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBeCloseTo(0.5, 3)
    }
    t.dispose()
  })

  it('skips count-in and pre-roll when playWithClick is off', async () => {
    const t = await freshTransport()
    await loadSong(t, makeSong({ barCount: 4, countInBeats: 4 }), 8)
    t.playWithClick = false
    t.play()
    const ctx = lastCtx!
    // No pre-roll — source at lookahead only, and no count-in oscillators.
    expect(ctx.bufferSources[0]!.starts[0]![0]).toBeCloseTo(0.04, 3)
    expect(ctx.scheduledStarts.length).toBe(0)
    t.dispose()
  })
})

describe('UnifiedTransport click loop — song beats', () => {
  it('schedules the song downbeat once plan-time reaches it', async () => {
    const t = await freshTransport()
    // No count-in so the first non-count-in click (the downbeat) is at plan-time 0.
    await loadSong(t, makeSong({ barCount: 4, countInBeats: 0 }), 8)
    t.playWithClick = true
    t.play()
    const ctx = lastCtx!
    // Nothing pre-scheduled (no count-in) and the loop hasn't ticked yet.
    expect(ctx.scheduledStarts.length).toBe(0)
    // Advance the shared clock to the source's start (ctxStart = 0.04): plan-time
    // is now 0, so the downbeat at timeSec 0 enters the lookahead window.
    ctx.currentTime = 0.04
    flushFrame()
    expect(ctx.scheduledStarts.length).toBeGreaterThanOrEqual(1)
    // The downbeat is scheduled at ctxNow + max(lead, delta) = 0.04 + 0.002.
    const first = ctx.scheduledStarts.slice().sort((a, b) => a - b)[0]!
    expect(first).toBeCloseTo(0.042, 3)
    t.dispose()
  })

  it('does not schedule song clicks when playWithClick is off', async () => {
    const t = await freshTransport()
    await loadSong(t, makeSong({ barCount: 4, countInBeats: 0 }), 8)
    t.playWithClick = false
    t.play()
    const ctx = lastCtx!
    ctx.currentTime = 0.04
    flushFrame()
    expect(ctx.scheduledStarts.length).toBe(0)
    t.dispose()
  })
})

describe('UnifiedTransport song-time + pause/seek/stop', () => {
  it('reports song-start during the start-lookahead, then advances with the clock', async () => {
    const t = await freshTransport()
    await loadSong(t, makeSong({ barCount: 4, countInBeats: 0 }), 8)
    t.play()
    // Before the clock passes ctxStart the playhead stays pinned at song start.
    expect(t.songTimeSec).toBeCloseTo(0, 6)
    // Advance the clock 1 s past ctxStart (0.04) and tick.
    lastCtx!.currentTime = 1.04
    flushFrame()
    expect(t.songTimeSec).toBeCloseTo(1.0, 3)
    t.dispose()
  })

  it('subtracts mediaOffset so song-time is 0 at the trim start', async () => {
    const t = await freshTransport()
    await loadSong(t, makeSong({ barCount: 4, trimStartSec: 1.5, trimEndSec: 8 }), 8)
    // Start from the trim start (song-time 0 = buffer 1.5).
    t.seek(0)
    expect(t.songTimeSec).toBeCloseTo(0, 6)
    t.play()
    // 1 s of playback past ctxStart (0.04): buffer 1.5 → 2.5.
    lastCtx!.currentTime = 1.04
    flushFrame()
    // buffer 2.5 − mediaOffset 1.5 = song-time 1.0.
    expect(t.songTimeSec).toBeCloseTo(1.0, 3)
    t.dispose()
  })

  it('pause() freezes the position', async () => {
    const t = await freshTransport()
    await loadSong(t, makeSong({ barCount: 4, countInBeats: 0 }), 8)
    t.play()
    expect(t.isPlaying).toBe(true)
    lastCtx!.currentTime = 1.04 // 1 s into the buffer (ctxStart was 0.04)
    t.pause()
    expect(t.isPlaying).toBe(false)
    expect(t.songTimeSec).toBeCloseTo(1.0, 3)
    // Position stays put even as the clock keeps moving.
    lastCtx!.currentTime = 3.0
    expect(t.songTimeSec).toBeCloseTo(1.0, 3)
    t.dispose()
  })

  it('seek() moves the song-time position while stopped', async () => {
    const t = await freshTransport()
    await loadSong(t, makeSong({ barCount: 4, countInBeats: 0 }), 8)
    t.seek(3.0)
    expect(t.isPlaying).toBe(false)
    expect(t.songTimeSec).toBeCloseTo(3.0, 6)
    t.dispose()
  })

  it('stop() returns the playhead to the range start', async () => {
    const t = await freshTransport()
    await loadSong(t, makeSong({ barCount: 4, countInBeats: 0 }), 8)
    t.setRangeSongTime(2, 6)
    t.play()
    lastCtx!.currentTime = 3.0
    flushFrame()
    t.stop()
    expect(t.isPlaying).toBe(false)
    expect(t.songTimeSec).toBeCloseTo(2, 6)
    t.dispose()
  })

  it('auto-stops at the range end via the rAF guard', async () => {
    const t = await freshTransport()
    await loadSong(t, makeSong({ barCount: 4, countInBeats: 0 }), 8)
    t.setRangeSongTime(0, 2) // stop when buffer position reaches ~2
    t.play()
    expect(t.isPlaying).toBe(true)
    // Advance past the range end and tick — the guard should stop playback.
    lastCtx!.currentTime = 0.04 + 2.5
    flushFrame()
    expect(t.isPlaying).toBe(false)
    t.dispose()
  })
})

// Gains are created in order on the engine's context: [0] engine masterGain,
// [1] the transport's click master, [2] the song track gain. (Reactive
// re-sync of these on knob changes is covered by the browser tests, where the
// real `$effect` scheduler runs; here we pin the imperative initialisation.)
describe('UnifiedTransport volume knobs', () => {
  it('initialises the click master gain from clickVolume and clamps songVolume onto the track gain', async () => {
    const t = await freshTransport()
    t.clickVolume = 1.7
    t.songVolume = 5 // out of range → clamped to 1
    await loadSong(t, makeSong({ barCount: 2 }), 4)
    const ctx = lastCtx!
    expect(ctx.createdGains[1]!.gain.value).toBeCloseTo(1.7, 4) // click master (no upper cap)
    expect(ctx.createdGains[2]!.gain.value).toBe(1) // song track, clamped into [0, 1]
    t.dispose()
  })

  it('clamps a negative songVolume up to 0 on the track gain', async () => {
    const t = await freshTransport()
    t.songVolume = -1
    await loadSong(t, makeSong({ barCount: 2 }), 4)
    expect(lastCtx!.createdGains[2]!.gain.value).toBe(0)
    t.dispose()
  })
})

// The `playbackAdapter` is the `PlaybackControllerLike` view `WaveformPlayer`
// drives. Its job is the song-time ↔ buffer-time conversion at the edge; these
// pin those conversions (the timing engine itself is covered above).
describe('UnifiedTransport.playbackAdapter (PlaybackControllerLike view)', () => {
  it('reports currentTime in BUFFER-time and seek() takes BUFFER-time', async () => {
    const t = await freshTransport()
    // trimStart 1.5 → buffer position 1.5 is song-time 0.
    await loadSong(t, makeSong({ barCount: 4, trimStartSec: 1.5, trimEndSec: 8 }), 8)
    const a = t.playbackAdapter
    expect(a.mediaTimeOffsetSec).toBeCloseTo(1.5, 6)
    expect(a.mediaReady).toBe(true)
    expect(a.audioBuffer).toBe(t.audioBuffer)
    // Seek in BUFFER-time 4.0 → song-time 2.5.
    a.seek(4.0)
    expect(t.songTimeSec).toBeCloseTo(2.5, 6)
    // currentTime is BUFFER-time = songTime + mediaOffset = 4.0.
    expect(a.currentTime).toBeCloseTo(4.0, 6)
    t.dispose()
  })

  it('rangeStart/rangeEnd are BUFFER-time and clamp play() to that window', async () => {
    const t = await freshTransport()
    await loadSong(t, makeSong({ barCount: 4, trimStartSec: 1.5, trimEndSec: 8 }), 8)
    const a = t.playbackAdapter
    // Host sets the two edges independently, in BUFFER-time.
    a.rangeStart = 3
    a.rangeEnd = 7
    expect(a.rangeStart).toBeCloseTo(3, 6)
    expect(a.rangeEnd).toBeCloseTo(7, 6)
    // Head at song start (buffer 1.5) is outside [3, 7) → the source starts at
    // BUFFER position 3 (proving the buffer-time range reached the engine).
    a.play()
    expect(lastCtx!.bufferSources[0]!.starts[0]![1]).toBeCloseTo(3, 6)
    t.dispose()
  })

  it('proxies the UI knobs, no-ops setAudioBuffer/setAudioElement, and is stable', async () => {
    const t = await freshTransport()
    await loadSong(t, makeSong({ barCount: 2 }), 4)
    const a = t.playbackAdapter
    a.playWithClick = true
    a.clickVolume = 1.9
    a.songVolume = 0.4
    a.clickOffsetSec = 0.01
    a.debugClickTiming = true
    expect(t.playWithClick).toBe(true)
    expect(t.clickVolume).toBeCloseTo(1.9, 6)
    expect(t.songVolume).toBeCloseTo(0.4, 6)
    expect(t.clickOffsetSec).toBeCloseTo(0.01, 6)
    expect(t.debugClickTiming).toBe(true)
    // Transport owns the decode — these must not disturb the buffer.
    const buf = t.audioBuffer
    a.setAudioBuffer(null)
    a.setAudioElement(null)
    expect(t.audioBuffer).toBe(buf)
    expect(a.ownsDecode).toBe(true)
    // Same object every read (stable identity for the host's controller prop).
    expect(t.playbackAdapter).toBe(a)
    t.dispose()
  })
})
