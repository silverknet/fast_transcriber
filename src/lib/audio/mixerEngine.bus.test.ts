/**
 * Effect-bus routing: sends, returns, and the teardown that keeps orphan taps
 * from feeding a bus after a track or bus is gone.
 *
 * Uses a minimal AudioContext mock and asserts on the CONNECTION GRAPH — "does
 * it actually sound wet" is a real-playback question, but "is the signal
 * routed where it should be" is exactly what silently breaks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MixerEngine, type MixerBus, type MixerTrack } from '$lib/audio/mixerEngine'

type Conn = { from: MockNode; to: MockNode }
let connections: Conn[] = []

class MockParam {
  value = 0
}
class MockNode {
  gain = new MockParam()
  label = ''
  connect = vi.fn((to: MockNode) => {
    connections.push({ from: this, to })
    return to
  })
  disconnect = vi.fn(() => {
    connections = connections.filter((c) => c.from !== this)
  })
}

class MockAudioContext {
  currentTime = 0
  state = 'running'
  destination = new MockNode()
  createGain() {
    return new MockNode()
  }
  createBufferSource() {
    return { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), buffer: null, onended: null }
  }
  resume() {
    return Promise.resolve()
  }
  close() {
    return Promise.resolve()
  }
}

function makeTrack(over: Partial<MixerTrack> = {}): MixerTrack {
  return {
    key: 'drums',
    label: 'Drums',
    buffer: { duration: 1 } as unknown as AudioBuffer,
    volume: 1,
    muted: false,
    soloed: false,
    ...over,
  }
}

function makeBus(key = 'reverb', over: Partial<MixerBus> = {}): MixerBus {
  const input = new MockNode()
  const output = new MockNode()
  input.label = `${key}:in`
  output.label = `${key}:out`
  return {
    key,
    label: 'Reverb',
    chain: { input: input as unknown as AudioNode, output: output as unknown as AudioNode },
    level: 0.5,
    ...over,
  }
}

/** Is there a path from `from` to `to` following current connections? */
function reaches(from: MockNode, to: MockNode, seen = new Set<MockNode>()): boolean {
  if (from === to) return true
  if (seen.has(from)) return false
  seen.add(from)
  return connections.filter((c) => c.from === from).some((c) => reaches(c.to, to, seen))
}

let engine: MixerEngine

beforeEach(() => {
  connections = []
  vi.stubGlobal('AudioContext', MockAudioContext)
  engine = new MixerEngine()
})

describe('effect busses', () => {
  it('a bus returns into the master bus', () => {
    const bus = makeBus()
    engine.setBus(bus)
    expect(reaches(bus.chain.output as unknown as MockNode, engine.masterGain as unknown as MockNode)).toBe(
      true,
    )
    expect(engine.listBusses().map((b) => b.key)).toEqual(['reverb'])
  })

  it('a send routes the track into the bus', () => {
    const bus = makeBus()
    engine.setBus(bus)
    engine.setTrack(makeTrack())
    engine.setSend('drums', 'reverb', 0.4)

    expect(engine.getSend('drums', 'reverb')).toBe(0.4)
    // Exactly one tap into the bus, via a send gain…
    const intoBus = connections.filter((c) => c.to === (bus.chain.input as unknown as MockNode))
    expect(intoBus.length).toBe(1)
    const sendGain = intoBus[0]!.from
    expect(sendGain.gain.value).toBe(0.4)

    // …fed by the track gain, which STILL reaches the master: a send is a tap
    // off the signal, not a re-route of it, so the dry path must survive.
    const trackGain = connections.find((c) => c.to === sendGain)!.from
    expect(reaches(trackGain, engine.masterGain as unknown as MockNode)).toBe(true)
  })

  it('two tracks can share one bus — the point of a bus', () => {
    const bus = makeBus()
    engine.setBus(bus)
    engine.setTrack(makeTrack({ key: 'drums' }))
    engine.setTrack(makeTrack({ key: 'bass', label: 'Bass' }))
    engine.setSend('drums', 'reverb', 0.3)
    engine.setSend('bass', 'reverb', 0.6)

    const intoBus = connections.filter((c) => c.to === (bus.chain.input as unknown as MockNode))
    expect(intoBus.length).toBe(2)
    expect(engine.getSend('drums', 'reverb')).toBe(0.3)
    expect(engine.getSend('bass', 'reverb')).toBe(0.6)
  })

  it('setting a send to 0 removes it', () => {
    engine.setBus(makeBus())
    engine.setTrack(makeTrack())
    engine.setSend('drums', 'reverb', 0.5)
    engine.setSend('drums', 'reverb', 0)
    expect(engine.getSend('drums', 'reverb')).toBe(0)
  })

  it('clamps send level into range', () => {
    engine.setBus(makeBus())
    engine.setTrack(makeTrack())
    engine.setSend('drums', 'reverb', 99)
    expect(engine.getSend('drums', 'reverb')).toBe(1.5)
  })

  it('reloading a track keeps its send alive', () => {
    // setTrack builds a BRAND NEW gain node; a send tapped off the old one
    // would be left dangling and the effect would silently go quiet. Lanes
    // reload constantly (every machine edit), so this is the common case.
    const bus = makeBus()
    engine.setBus(bus)
    engine.setTrack(makeTrack())
    engine.setSend('drums', 'reverb', 0.5)

    connections = connections.filter((c) => c.to !== (bus.chain.input as unknown as MockNode))
    engine.setTrack(makeTrack()) // the reload

    const intoBus = connections.filter((c) => c.to === (bus.chain.input as unknown as MockNode))
    expect(intoBus.length).toBe(1)
    expect(engine.getSend('drums', 'reverb')).toBe(0.5)
  })

  it('removing a track tears down its send tap', () => {
    const bus = makeBus()
    engine.setBus(bus)
    engine.setTrack(makeTrack())
    engine.setSend('drums', 'reverb', 0.5)
    engine.removeTrack('drums')

    expect(connections.filter((c) => c.to === (bus.chain.input as unknown as MockNode))).toEqual([])
    expect(engine.getSend('drums', 'reverb')).toBe(0)
  })

  it('removing a bus drops every send feeding it', () => {
    engine.setBus(makeBus())
    engine.setTrack(makeTrack({ key: 'drums' }))
    engine.setTrack(makeTrack({ key: 'bass' }))
    engine.setSend('drums', 'reverb', 0.3)
    engine.setSend('bass', 'reverb', 0.4)

    engine.removeBus('reverb')
    expect(engine.listBusses()).toEqual([])
    expect(engine.getSend('drums', 'reverb')).toBe(0)
    expect(engine.getSend('bass', 'reverb')).toBe(0)
  })

  it('a send aimed at a bus that does not exist yet is remembered, not lost', () => {
    engine.setTrack(makeTrack())
    engine.setSend('drums', 'reverb', 0.45) // bus added later
    expect(engine.getSend('drums', 'reverb')).toBe(0.45)

    const bus = makeBus()
    engine.setBus(bus)
    const intoBus = connections.filter((c) => c.to === (bus.chain.input as unknown as MockNode))
    expect(intoBus.length).toBe(1)
  })

  it('muting a bus silences its return without touching the sends', () => {
    const bus = makeBus('reverb', { level: 0.8 })
    engine.setBus(bus)
    engine.setTrack(makeTrack())
    engine.setSend('drums', 'reverb', 0.5)

    engine.setBus({ ...bus, muted: true })
    expect(engine.getSend('drums', 'reverb')).toBe(0.5)
    expect(engine.listBusses()[0]!.muted).toBe(true)
  })

  it('replacing a bus rewires it instead of stacking returns', () => {
    const first = makeBus()
    engine.setBus(first)
    const second = makeBus('reverb')
    engine.setBus(second)
    expect(engine.listBusses().length).toBe(1)
    // The old chain must no longer feed the master.
    expect(
      reaches(first.chain.output as unknown as MockNode, engine.masterGain as unknown as MockNode),
    ).toBe(false)
  })
})
