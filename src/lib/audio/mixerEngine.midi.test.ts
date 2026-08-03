/**
 * MIDI tracks in the mixer.
 *
 * A generated part (drums, bass, chords, arp) shouldn't have to be rendered to
 * a WAV and decoded before you can hear it — that's what makes changing a
 * sound slow. A MIDI track schedules itself live instead.
 *
 * The contract these tests pin down: a MIDI track behaves like any other
 * channel. It has a fader, it obeys transport and seek, and — because its
 * output lands on the same track gain an audio lane uses — it feeds effect
 * sends without the routing layer knowing MIDI exists.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MixerEngine,
  type MidiInstrument,
  type MixerBus,
  type MixerTrack,
} from '$lib/audio/mixerEngine'

type Conn = { from: MockNode; to: MockNode }
let connections: Conn[] = []

class MockParam {
  value = 0
}
class MockNode {
  gain = new MockParam()
  connect = vi.fn((to: MockNode) => {
    connections.push({ from: this, to })
    return to
  })
  disconnect = vi.fn(() => {
    connections = connections.filter((c) => c.from !== this)
  })
}

class MockAudioContext {
  currentTime = 10
  state = 'running'
  destination = new MockNode()
  createGain() {
    return new MockNode()
  }
  createBufferSource() {
    return {
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      playbackRate: new MockParam(),
      buffer: null,
      onended: null,
    }
  }
  resume() {
    return Promise.resolve()
  }
  close() {
    return Promise.resolve()
  }
}

function makeInstrument(durationSec = 30) {
  const scheduled: { fromSec: number; atCtx: number; rate: number }[] = []
  const output = new MockNode()
  let offCount = 0
  const inst: MidiInstrument = {
    output: output as unknown as AudioNode,
    durationSec,
    schedule: (fromSec, atCtx, rate) => scheduled.push({ fromSec, atCtx, rate }),
    allNotesOff: () => {
      offCount++
    },
  }
  return { inst, output, scheduled, offs: () => offCount }
}

function midiTrack(key: string, inst: MidiInstrument): MixerTrack {
  return { key, label: key, instrument: inst, volume: 1, muted: false, soloed: false }
}

function audioTrack(key: string, duration = 20): MixerTrack {
  return {
    key,
    label: key,
    buffer: { duration } as unknown as AudioBuffer,
    volume: 1,
    muted: false,
    soloed: false,
  }
}

function makeBus(key = 'reverb'): MixerBus {
  const input = new MockNode()
  const output = new MockNode()
  return {
    key,
    label: 'Reverb',
    chain: { input: input as unknown as AudioNode, output: output as unknown as AudioNode },
    level: 1,
  }
}

let engine: MixerEngine

beforeEach(() => {
  connections = []
  vi.stubGlobal('AudioContext', MockAudioContext)
  // The transport drives a rAF tick; Node has none.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number,
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  // The auto-stop timer is scheduled via `window.setTimeout`.
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  engine = new MixerEngine()
})

describe('changing the rate mid-playback (transpose applied while a song plays)', () => {
  /**
   * The realistic transpose path: a song starts at rate 1 and the transpose
   * lands a moment later. Buffer lanes just take a new `playbackRate` and carry
   * on from where they are; a MIDI part CANNOT — its notes are pinned to context
   * times computed under the OLD rate, so it must be re-anchored from the live
   * playhead or the drums keep the old tempo while everything else moves.
   */
  function advance(sec: number) {
    const ctx = engine.ac as unknown as { currentTime: number }
    ctx.currentTime += sec
  }

  it('re-schedules the instrument from where the playhead ACTUALLY is', async () => {
    const { inst, scheduled } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(0)
    expect(scheduled.length).toBe(1)
    expect(scheduled[0]!.rate).toBe(1)

    advance(5) // five seconds in at rate 1 → playhead ≈ 5s
    engine.setPlaybackRate(0.8908987) // -2 semitones

    expect(scheduled.length, 'instrument was not re-scheduled').toBe(2)
    const re = scheduled[1]!
    expect(re.rate).toBeCloseTo(0.8908987, 6)
    // RED if it re-anchored from 0: the part would replay from the top.
    expect(re.fromSec, `re-anchored at ${re.fromSec}, expected ≈5`).toBeGreaterThan(4.5)
    expect(re.fromSec).toBeLessThan(5.6)
    // ...and scheduled at/just after the current context time, never in the past.
    expect(re.atCtx).toBeGreaterThanOrEqual((engine.ac as unknown as { currentTime: number }).currentTime)
  })

  it('the playhead does not jump when the rate changes', async () => {
    const { inst } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(0)
    advance(5)
    const before = engine.snapshot().positionSec
    engine.setPlaybackRate(0.8908987)
    const after = engine.snapshot().positionSec
    // A discontinuity here IS the drums-out-of-sync symptom.
    expect(Math.abs(after - before)).toBeLessThan(0.05)
  })

  it('a second rate change re-anchors again, without compounding', async () => {
    const { inst, scheduled } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(0)
    advance(4)
    engine.setPlaybackRate(0.891)
    const posA = engine.snapshot().positionSec
    advance(4) // 4 wall seconds at 0.891 → ~3.56 song seconds
    engine.setPlaybackRate(1.122)
    const posB = engine.snapshot().positionSec
    expect(posB).toBeGreaterThan(posA)
    expect(posB - posA).toBeCloseTo(4 * 0.891, 1)
    expect(scheduled[scheduled.length - 1]!.rate).toBeCloseTo(1.122, 6)
  })

  it('setting the SAME rate does not re-schedule (no needless retrigger)', async () => {
    const { inst, scheduled } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(0)
    advance(2)
    engine.setPlaybackRate(1)
    expect(scheduled.length).toBe(1)
  })
})

describe('rolling-window instruments', () => {
  /** An instrument that schedules in a window and needs topping up. */
  function makeWindowed() {
    const ticks: number[] = []
    const output = new MockNode()
    const inst: MidiInstrument = {
      output: output as unknown as AudioNode,
      durationSec: 300,
      schedule: () => {},
      allNotesOff: () => {},
      tick: (positionSec) => ticks.push(positionSec),
    }
    return { inst, ticks }
  }

  const nextFrame = () => new Promise((r) => setTimeout(r, 5))

  // LOAD-BEARING: the drum instrument schedules a rolling window, so it falls
  // silent once the first window runs out unless the transport tops it up.
  it('ticks the instrument as the transport advances', async () => {
    const { inst, ticks } = makeWindowed()
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(12)
    await nextFrame()
    expect(ticks.length).toBeGreaterThan(0)
    // It reports where the transport IS, so the lane knows how much of its
    // window is left. Playback is scheduled a hair in the future, so the very
    // first tick can sit fractionally before the requested position.
    expect(ticks[0]).toBeGreaterThan(11.5)
    expect(ticks[0]).toBeLessThan(12.5)
  })

  it('does not tick while stopped', async () => {
    const { inst, ticks } = makeWindowed()
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(0)
    await nextFrame()
    engine.stop()
    const after = ticks.length
    await nextFrame()
    expect(ticks.length).toBe(after)
  })

  it('an instrument without tick is left alone', async () => {
    // Drums and bass schedule everything up front; the hook is optional.
    const { inst, scheduled } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(0)
    await nextFrame()
    expect(scheduled.length).toBe(1) // no crash, no re-schedule
  })
})

describe('MIDI tracks', () => {
  it('wires the instrument output through the track fader', () => {
    const { inst, output } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    // Straight onto a node that reaches the master — i.e. the track gain.
    expect(connections.some((c) => c.from === output)).toBe(true)
  })

  it('schedules itself on play, from the requested position', async () => {
    const { inst, scheduled } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(12)
    expect(scheduled.length).toBe(1)
    expect(scheduled[0]!.fromSec).toBe(12)
    // Scheduled slightly in the future, never in the past.
    expect(scheduled[0]!.atCtx).toBeGreaterThan(10)
  })

  it('is silenced and re-scheduled on replay, never left overlapping', async () => {
    const { inst, scheduled, offs } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(0)
    await engine.play(5)
    expect(offs()).toBeGreaterThan(0)
    expect(scheduled.length).toBe(2)
    expect(scheduled[1]!.fromSec).toBe(5)
  })

  it('goes quiet on stop', async () => {
    const { inst, offs } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(0)
    const before = offs()
    engine.stop()
    expect(offs()).toBeGreaterThan(before)
  })

  it('follows varispeed like the audio lanes', async () => {
    const { inst, scheduled } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    engine.setPlaybackRate(1.5)
    await engine.play(0)
    expect(scheduled.at(-1)!.rate).toBe(1.5)
  })

  it('counts toward the mix duration, so a MIDI-only song is not zero-length', () => {
    const { inst } = makeInstrument(42)
    engine.setTrack(midiTrack('drum-machine', inst))
    expect(engine.durationSec()).toBe(42)
  })

  it('mixes with audio tracks — the longest wins', () => {
    const { inst } = makeInstrument(12)
    engine.setTrack(audioTrack('original', 30))
    engine.setTrack(midiTrack('drum-machine', inst))
    expect(engine.durationSec()).toBe(30)
  })

  it('has a working fader, like any other channel', () => {
    const { inst } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    engine.setVolume('drum-machine', 0.25)
    expect(engine.listTracks().find((t) => t.key === 'drum-machine')?.volume).toBe(0.25)
  })

  it('feeds an effect bus — the whole point of routing through the fader', () => {
    const bus = makeBus()
    const { inst } = makeInstrument()
    engine.setBus(bus)
    engine.setTrack(midiTrack('drum-machine', inst))
    engine.setSend('drum-machine', 'reverb', 0.5)

    const intoBus = connections.filter((c) => c.to === (bus.chain.input as unknown as MockNode))
    expect(intoBus.length).toBe(1)
    expect(engine.getSend('drum-machine', 'reverb')).toBe(0.5)
  })

  it('is silenced and unwired when removed', () => {
    const { inst, output, offs } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    engine.removeTrack('drum-machine')
    expect(offs()).toBeGreaterThan(0)
    expect(connections.some((c) => c.from === output)).toBe(false)
  })

  it('changing varispeed mid-play re-schedules the part at the new rate', async () => {
    // A buffer source follows its `playbackRate`; a MIDI part is already pinned
    // to context times computed at the OLD rate. Without a re-schedule the
    // drums keep the old tempo while every other lane changes — loud and
    // obvious, and invisible to every other test.
    const { inst, scheduled } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(0)
    expect(scheduled.length).toBe(1)

    engine.setPlaybackRate(1.5)
    expect(scheduled.length).toBe(2)
    expect(scheduled.at(-1)!.rate).toBe(1.5)
  })

  it('re-scheduling targets where the playhead WILL be, not where it is', async () => {
    // Scheduling from `positionSec()` at a future context time would drag the
    // part late by the lead-in.
    const { inst, scheduled } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(10)
    const posNow = engine.positionSec()
    engine.rescheduleInstrument('drum-machine')

    const last = scheduled.at(-1)!
    const leadIn = last.atCtx - engine.currentCtxTime()
    expect(leadIn).toBeGreaterThan(0) // scheduled in the future
    // fromSec must be advanced by exactly that lead-in, or the part lands late.
    expect(last.fromSec).toBeCloseTo(posNow + leadIn, 6)
  })

  it('re-scheduling during an announcement pre-roll keeps the playhead NEGATIVE', async () => {
    // `positionSec()` floors at 0; during a pre-roll the true playhead is
    // behind the audio start. Anchoring on the floored value would place the
    // whole part seconds early, permanently, because schedule() pins absolute
    // context times.
    const { inst, scheduled } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(0, { startDelaySec: 2 })
    engine.rescheduleInstrument('drum-machine')

    expect(engine.positionSec()).toBe(0) // floored
    expect(scheduled.at(-1)!.fromSec).toBeLessThan(-1) // but the part is not
  })

  it('a quantized jump silences MIDI AT the boundary, not when it commits', async () => {
    // The jump commits up to JUMP_LOOKAHEAD early and stops buffer lanes with
    // `source.stop(at)`. Silencing MIDI immediately would punch that much
    // silence into the drums before every section launch.
    const offAt: (number | undefined)[] = []
    const { inst } = makeInstrument()
    const spy = { ...inst, allNotesOff: (at?: number) => offAt.push(at) }
    engine.setTrack(midiTrack('drum-machine', spy))
    await engine.play(0)
    offAt.length = 0

    engine.armJumpAtPosition(engine.positionSec() + 0.01, 30)
    await new Promise((r) => setTimeout(r, 30))

    expect(offAt.length, 'the jump silenced the instrument').toBeGreaterThan(0)
    expect(offAt.at(-1), 'silenced at a context time, not immediately').toBeGreaterThan(0)
  })

  it('re-scheduling silences the old notes first', async () => {
    const { inst, offs } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(0)
    const before = offs()
    engine.rescheduleInstrument('drum-machine')
    expect(offs()).toBeGreaterThan(before)
  })

  it('re-scheduling a stopped track is a no-op', () => {
    const { inst, scheduled } = makeInstrument()
    engine.setTrack(midiTrack('drum-machine', inst))
    engine.rescheduleInstrument('drum-machine')
    expect(scheduled).toEqual([])
  })

  it('removing a track disposes its instrument', () => {
    const { inst } = makeInstrument()
    let disposed = 0
    engine.setTrack(midiTrack('drum-machine', { ...inst, dispose: () => disposed++ }))
    engine.removeTrack('drum-machine')
    expect(disposed).toBe(1)
  })

  it('audio tracks still play normally alongside', async () => {
    const { inst } = makeInstrument()
    engine.setTrack(audioTrack('original', 30))
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(0)
    expect(engine.snapshot().state).toBe('playing')
  })
})
