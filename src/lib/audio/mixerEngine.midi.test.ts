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

  it('audio tracks still play normally alongside', async () => {
    const { inst } = makeInstrument()
    engine.setTrack(audioTrack('original', 30))
    engine.setTrack(midiTrack('drum-machine', inst))
    await engine.play(0)
    expect(engine.snapshot().state).toBe('playing')
  })
})
