import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import { parseSongMap } from './parse'
import { validateSongMap } from './validate'
import { toCollabSongMap, collabContentFingerprint } from './collab'
import { mergeForConflict } from './collabMerge'
import type { DrumMachine, SongMap } from './types'

const machine: DrumMachine = {
  enabled: true,
  style: 'funk',
  complexity: 0.72,
  loudness: 0.4,
  fills: 0.9,
  crashOnSectionStart: false,
  kit: 'tr707',
  pulse: 'ride',
  voices: { tom: false, cymbal: true },
  perSection: {
    verse1: { complexity: 0.3 },
    chorus1: { style: 'disco', loudness: 0.8, fills: 1, pulse: 'hihat' },
    breakdown: { muted: true, voices: { snare: false } },
  },
}

function roundTrip(sm: SongMap): SongMap {
  return parseSongMap(JSON.stringify(sm))
}

describe('drumMachine schema', () => {
  it('survives a save/load round-trip with every field intact', () => {
    const sm: SongMap = { ...createEmptySongMap(), drumMachine: machine }
    expect(roundTrip(sm).drumMachine).toEqual(machine)
  })

  it('validates as a well-formed SongMap', () => {
    const sm: SongMap = { ...createEmptySongMap(), drumMachine: machine }
    expect(validateSongMap(roundTrip(sm)).ok).toBe(true)
  })

  it('is absent, not invented, on songs without a drum machine track', () => {
    expect(roundTrip(createEmptySongMap()).drumMachine).toBeUndefined()
  })

  it('clamps out-of-range knobs instead of trusting them', () => {
    const sm = {
      ...createEmptySongMap(),
      drumMachine: { enabled: true, style: 'rock', complexity: 9, loudness: -4, fills: 1.5 },
    } as unknown as SongMap
    const out = roundTrip(sm).drumMachine!
    expect(out.complexity).toBe(1)
    expect(out.loudness).toBe(0)
    expect(out.fills).toBe(1)
  })

  it('falls back to a usable style rather than dropping the whole track', () => {
    const sm = {
      ...createEmptySongMap(),
      drumMachine: { enabled: true, style: 'polka', perSection: { v1: { complexity: 0.5 } } },
    } as unknown as SongMap
    const out = roundTrip(sm).drumMachine!
    expect(out.style).toBe('rock')
    // The user's per-section work is not collateral damage.
    expect(out.perSection?.v1?.complexity).toBe(0.5)
  })

  it('drops an unreadable per-section entry without losing its siblings', () => {
    const sm = {
      ...createEmptySongMap(),
      drumMachine: {
        enabled: true,
        style: 'pop',
        perSection: { good: { complexity: 0.4 }, bad: 'nonsense' },
      },
    } as unknown as SongMap
    const out = roundTrip(sm).drumMachine!
    expect(out.perSection?.good?.complexity).toBe(0.4)
    expect(out.perSection?.bad).toBeUndefined()
  })

  it('reaches collaborators — the track is part of synced content', () => {
    const sm: SongMap = { ...createEmptySongMap(), drumMachine: machine }
    expect((toCollabSongMap(sm) as SongMap).drumMachine).toEqual(machine)
  })

  it('counts toward the collab fingerprint, so an edit actually pushes', () => {
    const a: SongMap = { ...createEmptySongMap(), drumMachine: machine }
    const b: SongMap = {
      ...createEmptySongMap(),
      drumMachine: { ...machine, complexity: 0.1 },
    }
    expect(collabContentFingerprint(a)).not.toBe(collabContentFingerprint(b))
  })

  it('a local re-render alone does not count as a change', () => {
    const a: SongMap = { ...createEmptySongMap(), drumMachine: machine }
    const b: SongMap = {
      ...createEmptySongMap(),
      drumMachine: {
        ...machine,
        renderExport: {
          fingerprint: 'abc123',
          durationSec: 120,
          sampleRate: 44100,
          generatedAt: '2026-07-30T00:00:00Z',
          preludeOffsetSec: 0,
          relativePath: 'renders/machine.wav',
        },
      },
    }
    expect(collabContentFingerprint(a)).toBe(collabContentFingerprint(b))
  })

  it('conflicting drum machines resolve whole-field, keeping mine intact', () => {
    const mine: SongMap = { ...createEmptySongMap(), drumMachine: machine }
    const theirs: SongMap = {
      ...createEmptySongMap(),
      drumMachine: { enabled: true, style: 'ballad' },
    }
    const r = mergeForConflict(mine, theirs)
    const conflict = r.conflicts.find((c) => c.path === 'drumMachine')
    expect(conflict).toBeDefined()
    expect(conflict!.label).toBe('Drum machine')
  })

  it('rejects an unknown pulse voice rather than persisting nonsense', () => {
    const sm = {
      ...createEmptySongMap(),
      drumMachine: { enabled: true, style: 'rock', pulse: 'cowbell' },
    } as unknown as SongMap
    expect(roundTrip(sm).drumMachine?.pulse).toBeUndefined()
  })

  it('keeps only real kit pieces in the voice switches', () => {
    const sm = {
      ...createEmptySongMap(),
      drumMachine: {
        enabled: true,
        style: 'rock',
        voices: { snare: false, kazoo: false, tom: 'maybe' },
      },
    } as unknown as SongMap
    const voices = roundTrip(sm).drumMachine?.voices
    expect(voices).toEqual({ snare: false })
  })

  it('treats a missing `enabled` as on — an absent flag should not silence the track', () => {
    const sm = {
      ...createEmptySongMap(),
      drumMachine: { style: 'rock' },
    } as unknown as SongMap
    expect(roundTrip(sm).drumMachine?.enabled).toBe(true)
  })
})
