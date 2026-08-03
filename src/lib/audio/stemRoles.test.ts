/**
 * Roles, not files. Written against Martin's real project, where several songs
 * play `stem:drums.wav` AND `drum-machine` together — the case per-lane
 * loudness matching gets wrong, because what has to sit at a consistent level
 * is the sum a listener hears.
 */
import { describe, expect, it } from 'vitest'
import {
  audibleLanes,
  lanesByRole,
  roleForLaneKey,
  roleStackGainDb,
  stackedRoles,
} from './stemRoles'

describe('what role does a lane play', () => {
  it('separated stems keep their own name', () => {
    expect(roleForLaneKey('stem:drums.wav')).toBe('drums')
    expect(roleForLaneKey('stem:bass.wav')).toBe('bass')
    expect(roleForLaneKey('stem:vocals.wav')).toBe('vocals')
  })

  it('a drum machine IS drums — the gap that made matching wrong', () => {
    expect(roleForLaneKey('drum-machine')).toBe('drums')
    expect(roleForLaneKey('drums-gen')).toBe('drums')
    expect(roleForLaneKey('bass-machine')).toBe('bass')
    expect(roleForLaneKey('bass-gen')).toBe('bass')
  })

  it('harmonic machines land in "other", where their stem twin lives', () => {
    expect(roleForLaneKey('chord-machine')).toBe('other')
    expect(roleForLaneKey('arp-machine')).toBe('other')
  })

  it('the full mix and the private lanes are not programme roles', () => {
    expect(roleForLaneKey('original')).toBeNull()
    expect(roleForLaneKey('click')).toBeNull()
    expect(roleForLaneKey('cue')).toBeNull()
  })
})

describe('which roles are built from several lanes', () => {
  // "Ramlar" as saved: separated drums plus a drum machine at 1.15.
  const ramlar = [
    { key: 'stem:drums.wav', volume: 1.05 },
    { key: 'drum-machine', volume: 1.15 },
    { key: 'stem:bass.wav', volume: 1 },
    { key: 'arp-machine', volume: 1.09, muted: true },
  ]

  it('spots the stacked role', () => {
    expect(stackedRoles(ramlar)).toEqual(['drums'])
  })

  it('a MUTED contributor does not stack anything', () => {
    expect(stackedRoles([...ramlar.filter((l) => l.key !== 'drum-machine')])).toEqual([])
    expect(
      stackedRoles([{ key: 'stem:drums.wav', volume: 1 }, { key: 'drum-machine', volume: 1, muted: true }]),
    ).toEqual([])
  })

  it('a fader pulled to silence does not stack either', () => {
    expect(
      stackedRoles([{ key: 'stem:drums.wav', volume: 1 }, { key: 'drum-machine', volume: 0 }]),
    ).toEqual([])
  })

  it('groups the audible lanes under their role', () => {
    const byRole = lanesByRole(ramlar)
    expect(byRole.get('drums')!.map((l) => l.key)).toEqual(['stem:drums.wav', 'drum-machine'])
    expect(byRole.get('bass')!).toHaveLength(1)
    expect(byRole.has('other'), 'the muted arp must not appear').toBe(false)
  })

  it('audibleLanes drops muted and silent lanes', () => {
    expect(audibleLanes(ramlar).map((l) => l.key)).toEqual([
      'stem:drums.wav',
      'drum-machine',
      'stem:bass.wav',
    ])
  })
})

describe('how much a stacked role overshoots', () => {
  it('two lanes at unity is ~3 dB hotter than one — exactly what a per-lane target misses', () => {
    expect(roleStackGainDb([{ key: 'a', volume: 1 }, { key: 'b', volume: 1 }])).toBeCloseTo(3.01, 2)
  })

  it('one lane at unity is 0 dB — nothing to explain', () => {
    expect(roleStackGainDb([{ key: 'a', volume: 1 }])).toBeCloseTo(0, 6)
  })

  it('four lanes at unity is ~6 dB', () => {
    expect(
      roleStackGainDb([
        { key: 'a', volume: 1 },
        { key: 'b', volume: 1 },
        { key: 'c', volume: 1 },
        { key: 'd', volume: 1 },
      ]),
    ).toBeCloseTo(6.02, 2)
  })

  it('counts only what is audible', () => {
    expect(
      roleStackGainDb([{ key: 'a', volume: 1 }, { key: 'b', volume: 1, muted: true }]),
    ).toBeCloseTo(0, 6)
  })
})
