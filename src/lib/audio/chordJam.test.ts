import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import type { SongMap } from '$lib/songmap/types'

// The voices themselves are exercised elsewhere; here we assert WHAT gets fired
// and WHEN, so the synths are spies.
const played = {
  chord: [] as number[][],
  bass: [] as number[],
  arp: [] as number[],
  stops: [] as string[],
}

vi.mock('./chordPlayback', async (orig) => ({
  ...(await orig<typeof import('./chordPlayback')>()),
  playChordPlayback: (notes: number[]) => played.chord.push(notes),
  stopChordPlayback: () => played.stops.push('chord'),
  resumeChordPlayback: async () => {},
  setChordPlaybackVolume: () => {},
  setChordPatch: () => {},
}))
vi.mock('./chordBass', async (orig) => ({
  ...(await orig<typeof import('./chordBass')>()),
  playBassNote: (m: number) => played.bass.push(m),
  stopBass: () => played.stops.push('bass'),
  resumeBass: async () => {},
  setBassVolume: () => {},
  setBassPatch: () => {},
}))
vi.mock('./chordArp', async (orig) => ({
  ...(await orig<typeof import('./chordArp')>()),
  playArpNote: (m: number) => played.arp.push(m),
  stopArp: () => played.stops.push('arp'),
  resumeArp: async () => {},
  setArpVolume: () => {},
  setArpPatch: () => {},
}))

/** Four bars of 4/4 at 0.5 s per beat, with a chord on bars 1 and 3. */
function makeSong(): SongMap {
  const bd = 0.5
  const beatsPerBar = 4
  const barCount = 4
  const beats: SongMap['timeline']['beats'] = []
  const bars: SongMap['timeline']['bars'] = []
  for (let bar = 0; bar < barCount; bar++) {
    const barId = `bar${bar}`
    const barStart = bar * beatsPerBar * bd
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
      endSec: barStart + beatsPerBar * bd,
      meter: { numerator: beatsPerBar, denominator: 4 },
      beatCount: beatsPerBar,
      beatIds,
    })
  }
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'T',
      bpm: 120,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    audio: { fileName: 'x.wav', trim: { startSec: 0, endSec: 8 }, source: 'upload' },
    timeline: { bars, beats },
    sections: [],
    harmony: [
      { id: 'h1', beatId: 'b0_0', chord: { root: 'C', quality: 'maj' } },
      { id: 'h2', beatId: 'b2_0', chord: { root: 'F', quality: 'maj' } },
    ],
    cueTracks: [],
  } as unknown as SongMap
}

async function freshJam() {
  vi.resetModules()
  const mod = await import('./chordJam.svelte')
  const jam = mod.chordJam
  jam.keysOn = false
  jam.bassOn = false
  jam.arpOn = false
  jam.configure(makeSong())
  return jam
}

beforeEach(() => {
  played.chord = []
  played.bass = []
  played.arp = []
  played.stops = []
})

describe('chordJam — schedules', () => {
  it('derives a chord change point per NEW chord, not per beat', async () => {
    const jam = await freshJam()
    // Two chords over four bars → two change points (carry-forward in between).
    expect(jam.keysPointsForTest.length).toBe(2)
    expect(jam.keysPointsForTest[0]!.timeSec).toBeCloseTo(0, 6)
    expect(jam.keysPointsForTest[1]!.timeSec).toBeCloseTo(4, 6)
  })

  it('bass follows the beat grid, carrying the chord forward', async () => {
    const jam = await freshJam()
    jam.bassPattern = '4/4'
    expect(jam.bassHitsForTest.length).toBe(16) // every beat of four 4/4 bars
  })

  it('arp rate changes the hit density', async () => {
    const jam = await freshJam()
    jam.arpOn = true
    jam.arpRate = '1/8'
    const eighths = jam.arpHitsForTest.length
    jam.arpRate = '1/16'
    expect(jam.arpHitsForTest.length).toBeGreaterThan(eighths)
    jam.arpRate = '1/4'
    expect(jam.arpHitsForTest.length).toBeLessThan(eighths)
  })
})

describe('chordJam — firing', () => {
  it('fires nothing while every voice is off', async () => {
    const jam = await freshJam()
    jam.setPosition(0, true)
    jam.setPosition(2, true)
    expect(played.chord).toEqual([])
    expect(played.bass).toEqual([])
    expect(played.arp).toEqual([])
  })

  it('retriggers the keys only when the chord CHANGES', async () => {
    const jam = await freshJam()
    jam.keysOn = true
    jam.setPosition(0, true) // chord 1
    jam.setPosition(1, true) // same chord carried forward
    jam.setPosition(2, true)
    expect(played.chord.length).toBe(1)
    jam.setPosition(4, true) // chord 2
    expect(played.chord.length).toBe(2)
  })

  it('fires every bass hit crossed between frames', async () => {
    const jam = await freshJam()
    jam.bassOn = true
    jam.bassPattern = '4/4'
    jam.setPosition(0, true)
    expect(played.bass.length).toBe(1)
    jam.setPosition(1.0, true) // crossed beats at 0.5 and 1.0
    expect(played.bass.length).toBe(3)
  })

  it('does NOT machine-gun after a seek far ahead', async () => {
    const jam = await freshJam()
    jam.bassOn = true
    jam.bassPattern = '4/4'
    jam.setPosition(0, true)
    played.bass = []
    jam.setPosition(7.5, true) // jumped ~15 hits forward
    expect(played.bass.length).toBe(1) // just the one under the playhead
  })

  it('releases every voice when playback stops', async () => {
    const jam = await freshJam()
    jam.keysOn = true
    jam.bassOn = true
    jam.setPosition(0, true)
    played.stops = []
    jam.setPosition(0, false)
    expect(played.stops).toContain('chord')
    expect(played.stops).toContain('bass')
  })

  it('re-attacks after a stop/start rather than staying silent', async () => {
    const jam = await freshJam()
    jam.keysOn = true
    jam.setPosition(0, true)
    jam.setPosition(0, false)
    played.chord = []
    jam.setPosition(0, true)
    expect(played.chord.length).toBe(1)
  })

  it('configure() with the SAME map is a no-op — no spurious re-attack', async () => {
    // The host wires `$effect(() => chordJam.configure($songMap))`, which fires
    // on every reactive tick of the song store. Passing the same map must
    // short-circuit (`if (sm === this.#songMap) return`) so firing state isn't
    // reset and a held note isn't re-attacked. Locks the guard's contract.
    //
    // NOTE: this cannot reproduce the browser-only `state_proxy_equality_mismatch`
    // that motivated the `$state.raw` fix — the node env does not proxy `$state`
    // objects, so identity holds here regardless. It guards the guard, not the proxy.
    const jam = await freshJam()
    const song = makeSong()
    jam.configure(song)
    jam.bassOn = true
    jam.bassPattern = '4/4'
    jam.setPosition(0, true)
    expect(played.bass.length).toBe(1) // one hit at the downbeat
    played.bass = []
    jam.configure(song) // same object, same playhead
    jam.setPosition(0, true)
    expect(played.bass).toEqual([]) // guard held → nothing re-fired
  })

  it('reassigning the song map still recomputes the schedule ($state.raw stays reactive)', async () => {
    // The real risk of the `$state` → `$state.raw` fix: does a NEW map still
    // drive the `$derived` schedules? If `$state.raw` dropped reactivity the
    // grids would go stale on a song switch — the live-mode failure mode.
    const jam = await freshJam()
    expect(jam.keysPointsForTest.length).toBe(2)
    jam.configure(null)
    expect(jam.keysPointsForTest.length).toBe(0) // recomputed to empty
    jam.configure(makeSong())
    expect(jam.keysPointsForTest.length).toBe(2) // recomputed again
  })

  it('an idle surface cannot silence the one that is playing', async () => {
    const jam = await freshJam()
    jam.keysOn = true
    jam.setPosition(0, true, 'mixer')
    played.stops = []
    // The editor timeline is mounted but not sounding; its stop must be ignored.
    jam.setPosition(0, false, 'editor')
    expect(played.stops).toEqual([])
    // The owner's own stop still works.
    jam.setPosition(0, false, 'mixer')
    expect(played.stops).toContain('chord')
  })
})

describe('chordJam — live control surface', () => {
  it('toggles a voice and releases it immediately on the way off', async () => {
    const jam = await freshJam()
    expect(jam.isOn('arp')).toBe(false)
    jam.toggleVoice('arp')
    expect(jam.isOn('arp')).toBe(true)
    played.stops = []
    jam.toggleVoice('arp')
    expect(jam.isOn('arp')).toBe(false)
    // Released on the spot — waiting for the next frame leaves a note hanging.
    expect(played.stops).toContain('arp')
  })

  it('cycles the arp rate 1/4 → 1/8 → 1/16 → 1/4', async () => {
    const jam = await freshJam()
    jam.arpRate = '1/4'
    expect(jam.cycleArpRate()).toBe('1/8')
    expect(jam.cycleArpRate()).toBe('1/16')
    expect(jam.cycleArpRate()).toBe('1/4')
  })

  it('ignores an unknown arp rate rather than silencing the arp', async () => {
    const jam = await freshJam()
    jam.arpRate = '1/8'
    jam.setArpRate('9/9' as never)
    expect(jam.arpRate).toBe('1/8')
  })

  it('anyOn reflects whether the jam needs driving at all', async () => {
    const jam = await freshJam()
    expect(jam.anyOn).toBe(false)
    jam.setVoice('bass', true)
    expect(jam.anyOn).toBe(true)
    jam.setVoice('bass', false)
    expect(jam.anyOn).toBe(false)
  })
})
