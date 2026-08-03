/**
 * The pitch shifter must process RECORDED audio only.
 *
 * The tempo-hold dial splits a transpose in two: varispeed covers
 * `n × (1 − hold)` by changing the playback rate, and a shifter covers the
 * residual `n × hold`. That adds up to `n` for a buffer lane.
 *
 * A MIDI lane's notes already carry the FULL `n`, so if it also passes through
 * the shifter it ends up `n × hold` semitones out of tune with everything else —
 * at hold 0.5 and a −2 transpose, a whole semitone flat against the stems.
 * Which is exactly what "the bass doesn't sound right when transposed" is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MixerEngine } from './mixerEngine'
import type { MidiInstrument } from './mixerEngine'

/** Records every connect() so the graph can be walked. */
type Edge = { from: object; to: object }
let edges: Edge[] = []

class MockNode {
  readonly kind: string
  gain = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }
  constructor(kind = 'node') {
    this.kind = kind
  }
  connect(dst: object) {
    edges.push({ from: this, to: dst })
    return dst
  }
  disconnect() {
    edges = edges.filter((e) => e.from !== this)
  }
}

class MockAudioContext {
  currentTime = 0
  sampleRate = 48000
  destination = new MockNode('destination')
  state = 'running'
  createGain() {
    return new MockNode('gain')
  }
  createDelay() {
    const n = new MockNode('delay') as MockNode & { delayTime: { value: number } }
    n.delayTime = { value: 0 }
    return n
  }
  createBufferSource() {
    return { buffer: null, playbackRate: { value: 1 }, connect() {}, start() {}, stop() {} }
  }
  createStereoPanner() {
    return new MockNode('panner')
  }
  resume() {
    return Promise.resolve()
  }
}

/** Can `from` reach `to` by following connections? */
function reaches(from: object, to: object, seen = new Set<object>()): boolean {
  if (from === to) return true
  if (seen.has(from)) return false
  seen.add(from)
  return edges.filter((e) => e.from === from).some((e) => reaches(e.to, to, seen))
}

function midiInstrument(): MidiInstrument {
  return {
    output: new MockNode('midi-out') as unknown as AudioNode,
    durationSec: 30,
    schedule: () => {},
    allNotesOff: () => {},
  }
}

let engine: MixerEngine
let shifter: MockNode

beforeEach(() => {
  edges = []
  vi.stubGlobal('AudioContext', MockAudioContext)
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  engine = new MixerEngine()
  shifter = new MockNode('shifter')
})

const audioTrack = (key: string) => ({
  key,
  label: key,
  buffer: { duration: 10, numberOfChannels: 2, sampleRate: 48000, length: 480000 } as AudioBuffer,
  volume: 1,
  muted: false,
  soloed: false,
})
const midiTrack = (key: string) => ({
  key,
  label: key,
  instrument: midiInstrument(),
  volume: 1,
  muted: false,
  soloed: false,
})

/** The engine's MIDI compensation delay. */
const midiDelay = (e: MixerEngine) =>
  (e as unknown as { unshiftedDelay: { delayTime: { value: number } } | null }).unshiftedDelay

describe('shifter latency compensation', () => {
  /**
   * MIDI lanes bypass the shifter so they are not transposed twice — but the
   * shifter also DELAYS everything through it. Bypassing it therefore makes the
   * MIDI lanes play early against the stems, which is what "the drums are out
   * of sync" sounds like. The editor already compensates its click track for
   * exactly this; the mixer has to do the same for its MIDI lanes.
   */
  it('delays MIDI by the shifter latency', () => {
    engine.setTrack(midiTrack('drum-machine'))
    engine.setAudioPitchShiftNode(shifter as unknown as AudioNode, 0.046)
    expect(midiDelay(engine)!.delayTime.value).toBeCloseTo(0.046, 6)
  })

  it('removes the delay when the shifter goes away', () => {
    engine.setAudioPitchShiftNode(shifter as unknown as AudioNode, 0.046)
    engine.setAudioPitchShiftNode(null)
    expect(midiDelay(engine)).toBeNull()
  })

  it('updates the latency even when the shifter node is unchanged', () => {
    // A worklet can report its latency after it is wired in.
    engine.setAudioPitchShiftNode(shifter as unknown as AudioNode, 0)
    engine.setAudioPitchShiftNode(shifter as unknown as AudioNode, 0.032)
    expect(midiDelay(engine)!.delayTime.value).toBeCloseTo(0.032, 6)
  })

  it('there is no delay at all with no shifter — pure varispeed stays exact', () => {
    engine.setTrack(midiTrack('drum-machine'))
    engine.setAudioPitchShiftNode(null)
    expect(midiDelay(engine), 'no shifter => no delay node at all').toBeNull()
  })

  it('a MIDI lane still reaches the master through the delay', () => {
    engine.setTrack(midiTrack('drum-machine'))
    engine.setAudioPitchShiftNode(shifter as unknown as AudioNode, 0.02)
    const gain = (engine as unknown as { trackGains: Map<string, object> }).trackGains.get('drum-machine')!
    expect(reaches(gain, engine.masterGain)).toBe(true)
    expect(reaches(gain, shifter)).toBe(false)
  })
})

describe('audio pitch shifter routing', () => {
  it('a RECORDED lane passes through the shifter', () => {
    engine.setTrack(audioTrack('original'))
    engine.setAudioPitchShiftNode(shifter as unknown as AudioNode)
    const gain = (engine as unknown as { trackGains: Map<string, object> }).trackGains.get('original')!
    expect(reaches(gain, shifter)).toBe(true)
  })

  it('a MIDI lane does NOT — its notes already carry the transpose', () => {
    engine.setTrack(midiTrack('bass-machine'))
    engine.setAudioPitchShiftNode(shifter as unknown as AudioNode)
    const gain = (engine as unknown as { trackGains: Map<string, object> }).trackGains.get('bass-machine')!
    expect(reaches(gain, shifter), 'MIDI lane is being pitch-shifted twice').toBe(false)
  })

  it('but the MIDI lane still reaches the speakers', () => {
    // Bypassing the shifter must not bypass the master.
    engine.setTrack(midiTrack('bass-machine'))
    engine.setAudioPitchShiftNode(shifter as unknown as AudioNode)
    const gain = (engine as unknown as { trackGains: Map<string, object> }).trackGains.get('bass-machine')!
    expect(reaches(gain, engine.masterGain)).toBe(true)
  })

  it('both kinds reach the speakers with no shifter at all', () => {
    engine.setTrack(audioTrack('original'))
    engine.setTrack(midiTrack('bass-machine'))
    engine.setAudioPitchShiftNode(null)
    const gains = (engine as unknown as { trackGains: Map<string, object> }).trackGains
    expect(reaches(gains.get('original')!, engine.masterGain)).toBe(true)
    expect(reaches(gains.get('bass-machine')!, engine.masterGain)).toBe(true)
  })

  it('removing the shifter restores the recorded path', () => {
    engine.setTrack(audioTrack('original'))
    engine.setAudioPitchShiftNode(shifter as unknown as AudioNode)
    engine.setAudioPitchShiftNode(null)
    const gain = (engine as unknown as { trackGains: Map<string, object> }).trackGains.get('original')!
    expect(reaches(gain, engine.masterGain)).toBe(true)
    expect(reaches(gain, shifter)).toBe(false)
  })

  it('swapping shifters does not leave the old one in the graph', () => {
    const second = new MockNode('shifter-2')
    engine.setTrack(audioTrack('original'))
    engine.setAudioPitchShiftNode(shifter as unknown as AudioNode)
    engine.setAudioPitchShiftNode(second as unknown as AudioNode)
    const gain = (engine as unknown as { trackGains: Map<string, object> }).trackGains.get('original')!
    expect(reaches(gain, second)).toBe(true)
    expect(reaches(gain, shifter)).toBe(false)
  })
})

describe('effect-bus returns and spoken cues', () => {
  /** A minimal bus whose chain is a single node. */
  function addBus(engine: MixerEngine, key: string) {
    const node = new MockNode(`bus:${key}`)
    engine.setBus({
      key,
      label: key,
      chain: { input: node as unknown as AudioNode, output: node as unknown as AudioNode },
      level: 1,
    })
    return node
  }

  it('a wet tail is transposed with its dry source', () => {
    // A send taps the track GAIN, so a recorded lane feeds the bus at ORIGINAL
    // pitch. If the return went straight to the master, the reverb tail came
    // back in the wrong key — audibly so at any real transpose.
    engine.setTrack(audioTrack('original'))
    const bus = addBus(engine, 'reverb')
    engine.setSend('original', 'reverb', 0.5)
    engine.setAudioPitchShiftNode(shifter as unknown as AudioNode, 0.02)
    expect(reaches(bus, shifter), 'bus return bypasses the shifter').toBe(true)
  })

  it('the return still reaches the speakers', () => {
    engine.setTrack(audioTrack('original'))
    const bus = addBus(engine, 'reverb')
    engine.setSend('original', 'reverb', 0.5)
    engine.setAudioPitchShiftNode(null)
    expect(reaches(bus, engine.masterGain)).toBe(true)
  })

  it('spoken cues are NOT pitch-shifted, but ARE latency-compensated', () => {
    // Nobody wants a transposed voice; everybody wants it on the beat.
    engine.setAudioPitchShiftNode(shifter as unknown as AudioNode, 0.02)
    const cue = new MockNode('cue')
    cue.connect(engine.unshiftedInput)
    expect(reaches(cue, shifter), 'cues must not be pitch-shifted').toBe(false)
    expect(reaches(cue, engine.masterGain)).toBe(true)
    // Must pass THROUGH the compensation delay, not merely coexist with one:
    // tapping the master directly also avoids the shifter, but arrives early.
    const delay = midiDelay(engine)!
    expect(delay.delayTime.value).toBeCloseTo(0.02, 6)
    expect(reaches(cue, delay as unknown as object), 'cue skips the latency delay').toBe(true)
  })

  it('DOCUMENTED DEVIATION: a MIDI lane send is shifted once too often', () => {
    // Its notes already carry the transpose, so its wet tail gets the residual
    // shift on top. Only bites with the tempo-hold dial above 0, and only on the
    // wet portion. A correct fix needs a second chain instance per bus; this
    // test exists so the trade-off is deliberate rather than forgotten.
    engine.setTrack(midiTrack('bass-machine'))
    const bus = addBus(engine, 'reverb')
    engine.setSend('bass-machine', 'reverb', 0.5)
    engine.setAudioPitchShiftNode(shifter as unknown as AudioNode, 0.02)
    expect(reaches(bus, shifter)).toBe(true)
  })
})
