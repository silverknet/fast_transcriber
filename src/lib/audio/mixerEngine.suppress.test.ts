/**
 * Locks the transient track-suppression used to duck the baked cue lane during
 * a loop/replay (so it doesn't collide with the live dynamic cue). Suppression
 * must force the track's gain to 0 WITHOUT mutating its stored mute/volume, and
 * restore the correct gain when lifted. Uses a minimal AudioContext mock — the
 * "does it actually go silent" question is covered by real playback in the app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MixerEngine, type MixerTrack } from '$lib/audio/mixerEngine'

class MockParam {
  value = 0
}
class MockGain {
  gain = new MockParam()
  connect = vi.fn()
  disconnect = vi.fn()
}

const createdGains: MockGain[] = []

class MockAudioContext {
  currentTime = 0
  state = 'running'
  destination = {}
  createGain() {
    const g = new MockGain()
    createdGains.push(g)
    return g
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
    key: 'cue',
    label: 'Cue',
    buffer: { duration: 1 } as unknown as AudioBuffer,
    volume: 0.8,
    muted: false,
    soloed: false,
    ...over,
  }
}

describe('MixerEngine.setTrackSuppressed', () => {
  beforeEach(() => {
    createdGains.length = 0
    vi.stubGlobal('AudioContext', MockAudioContext)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forces the track gain to 0 and restores it, preserving mute/volume', () => {
    const eng = new MixerEngine()
    eng.setTrack(makeTrack())
    // createdGains[0] = masterGain, createdGains[1] = the cue track gain.
    const cueGain = createdGains[1]!
    expect(cueGain.gain.value).toBe(0.8)

    eng.setTrackSuppressed('cue', true)
    expect(cueGain.gain.value).toBe(0)
    // Stored state is untouched — the pill/toggle must still read "on".
    expect(eng.listTracks().find((t) => t.key === 'cue')?.muted).toBe(false)
    expect(eng.listTracks().find((t) => t.key === 'cue')?.volume).toBe(0.8)

    eng.setTrackSuppressed('cue', false)
    expect(cueGain.gain.value).toBe(0.8)
  })

  it('keeps a suppressed track silent even after its volume changes', () => {
    const eng = new MixerEngine()
    eng.setTrack(makeTrack())
    const cueGain = createdGains[1]!
    eng.setTrackSuppressed('cue', true)
    eng.setVolume('cue', 1.2)
    expect(cueGain.gain.value).toBe(0)
    eng.setTrackSuppressed('cue', false)
    expect(cueGain.gain.value).toBe(1.2)
  })

  it('a muted track that is then unsuppressed stays silent (mute still wins)', () => {
    const eng = new MixerEngine()
    eng.setTrack(makeTrack({ muted: true }))
    const cueGain = createdGains[1]!
    expect(cueGain.gain.value).toBe(0)
    eng.setTrackSuppressed('cue', true)
    expect(cueGain.gain.value).toBe(0)
    eng.setTrackSuppressed('cue', false)
    expect(cueGain.gain.value).toBe(0) // muted, so still silent
  })

  it('suppressing an unknown key is a harmless no-op', () => {
    const eng = new MixerEngine()
    eng.setTrack(makeTrack())
    const cueGain = createdGains[1]!
    expect(() => eng.setTrackSuppressed('nope', true)).not.toThrow()
    expect(cueGain.gain.value).toBe(0.8)
  })
})
