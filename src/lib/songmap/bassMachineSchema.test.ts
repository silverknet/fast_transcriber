import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import { parseSongMap } from './parse'
import { validateSongMap } from './validate'
import { toCollabSongMap, collabContentFingerprint } from './collab'
import { mergeForConflict } from './collabMerge'
import type { BassMachine, SongMap } from './types'

const machine: BassMachine = {
  enabled: true,
  style: 'walking',
  complexity: 0.7,
  loudness: 0.45,
  octave: -1,
  perSection: {
    verse1: { style: 'roots', complexity: 0.3 },
    chorus1: { style: 'octaves', octave: 1 },
    breakdown: { muted: true },
  },
}

const roundTrip = (sm: SongMap): SongMap => parseSongMap(JSON.stringify(sm))

describe('bassMachine schema', () => {
  it('survives a save/load round-trip with every field intact', () => {
    const sm: SongMap = { ...createEmptySongMap(), bassMachine: machine }
    expect(roundTrip(sm).bassMachine).toEqual(machine)
  })

  it('validates as a well-formed SongMap', () => {
    const sm: SongMap = { ...createEmptySongMap(), bassMachine: machine }
    expect(validateSongMap(roundTrip(sm)).ok).toBe(true)
  })

  it('is absent, not invented, on songs without one', () => {
    expect(roundTrip(createEmptySongMap()).bassMachine).toBeUndefined()
  })

  it('clamps knobs and the octave instead of trusting them', () => {
    const sm = {
      ...createEmptySongMap(),
      bassMachine: { enabled: true, style: 'roots', complexity: 5, loudness: -2, octave: 9 },
    } as unknown as SongMap
    const out = roundTrip(sm).bassMachine!
    expect(out.complexity).toBe(1)
    expect(out.loudness).toBe(0)
    expect(out.octave).toBe(2)
  })

  it('falls back to a usable style rather than dropping the track', () => {
    const sm = {
      ...createEmptySongMap(),
      bassMachine: { enabled: true, style: 'slap-funk', perSection: { v1: { octave: 1 } } },
    } as unknown as SongMap
    const out = roundTrip(sm).bassMachine!
    expect(out.style).toBe('roots')
    expect(out.perSection?.v1?.octave).toBe(1)
  })

  it('reaches collaborators and counts toward the fingerprint', () => {
    const a: SongMap = { ...createEmptySongMap(), bassMachine: machine }
    const b: SongMap = { ...createEmptySongMap(), bassMachine: { ...machine, octave: 1 } }
    expect((toCollabSongMap(a) as SongMap).bassMachine).toEqual(machine)
    expect(collabContentFingerprint(a)).not.toBe(collabContentFingerprint(b))
  })

  it('a local re-render alone does not count as a change', () => {
    const a: SongMap = { ...createEmptySongMap(), bassMachine: machine }
    const b: SongMap = {
      ...createEmptySongMap(),
      bassMachine: {
        ...machine,
        renderExport: {
          fingerprint: 'abc',
          durationSec: 100,
          sampleRate: 44100,
          generatedAt: '2026-07-30T00:00:00Z',
          preludeOffsetSec: 0,
          relativePath: 'renders/bass-machine.wav',
        },
      },
    }
    expect(collabContentFingerprint(a)).toBe(collabContentFingerprint(b))
  })

  it('conflicting bass machines resolve whole-field', () => {
    const mine: SongMap = { ...createEmptySongMap(), bassMachine: machine }
    const theirs: SongMap = {
      ...createEmptySongMap(),
      bassMachine: { enabled: true, style: 'pedal' },
    }
    const conflict = mergeForConflict(mine, theirs).conflicts.find((c) => c.path === 'bassMachine')
    expect(conflict).toBeDefined()
    expect(conflict!.label).toBe('Bass machine')
  })

  it('round-trips a customized sound', () => {
    const sm: SongMap = {
      ...createEmptySongMap(),
      bassMachine: {
        ...machine,
        tone: {
          waveA: 'square',
          waveB: 'sine',
          levelA: 0.9,
          levelB: 0.6,
          detuneA: 0,
          detuneB: 0,
          cutoffHz: 900,
          resonance: 2.1,
          velToCutoff: 0.7,
          attack: 0.003,
          decay: 0.18,
          sustain: 0.6,
          release: 0.12,
          drive: 0.5,
        },
      },
    }
    expect(roundTrip(sm).bassMachine?.tone).toEqual(sm.bassMachine!.tone)
  })

  it('repairs a partial or out-of-range sound rather than dropping the track', () => {
    const sm = {
      ...createEmptySongMap(),
      bassMachine: { enabled: true, style: 'roots', tone: { cutoffHz: 99999, waveA: 'kazoo' } },
    } as unknown as SongMap
    const tone = roundTrip(sm).bassMachine!.tone!
    expect(tone.cutoffHz).toBeLessThanOrEqual(8000)
    expect(tone.waveA).toBe('sawtooth') // the default
    expect(tone.decay).toBeGreaterThan(0) // filled in
  })

  it('no stored tone means the default sound, not silence', () => {
    const sm: SongMap = { ...createEmptySongMap(), bassMachine: { enabled: true, style: 'roots' } }
    expect(roundTrip(sm).bassMachine?.tone).toBeUndefined()
  })

  it('the two machine tracks are independent fields', () => {
    const sm: SongMap = {
      ...createEmptySongMap(),
      bassMachine: machine,
      drumMachine: { enabled: true, style: 'funk' },
    }
    const out = roundTrip(sm)
    expect(out.bassMachine?.style).toBe('walking')
    expect(out.drumMachine?.style).toBe('funk')
  })
})
