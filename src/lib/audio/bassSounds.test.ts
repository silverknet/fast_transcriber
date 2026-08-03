import { describe, expect, it } from 'vitest'
import {
  BASS_SOUNDS,
  DEFAULT_BASS_SOUND_ID,
  bassSound,
  bassSoundGroups,
  nearestRoot,
} from './bassSounds'
import { BASS_PATCH } from './chordBass'
import { normalizeBassTone } from './bassTone'

describe('bass sounds', () => {
  it('offers both families in the picker', () => {
    const groups = bassSoundGroups().map((g) => g.group)
    expect(groups).toContain('BarBro synth')
    expect(groups).toContain('Sampled')
  })

  it('ids are unique — the picker keys off them', () => {
    expect(new Set(BASS_SOUNDS.map((s) => s.id)).size).toBe(BASS_SOUNDS.length)
  })

  it('the default is the chords view patch, so it starts where you expect', () => {
    const s = bassSound(DEFAULT_BASS_SOUND_ID)
    expect(s.kind).toBe('synth')
    if (s.kind !== 'synth') return
    expect(s.tone.cutoffHz).toBe(BASS_PATCH.filter.cutoffHz)
    expect(s.tone.waveA).toBe(BASS_PATCH.oscA.type)
  })

  it('an unknown id falls back rather than breaking the track', () => {
    expect(bassSound('nope').id).toBe(BASS_SOUNDS[0]!.id)
    expect(bassSound(undefined).id).toBe(BASS_SOUNDS[0]!.id)
  })

  it('every synth sound is a complete, valid tone', () => {
    for (const s of BASS_SOUNDS) {
      if (s.kind !== 'synth') continue
      expect(normalizeBassTone(s.tone), s.id).toEqual(s.tone)
    }
  })

  it('synth sounds are actually distinct from each other', () => {
    const tones = BASS_SOUNDS.filter((s) => s.kind === 'synth').map((s) =>
      JSON.stringify((s as { tone: unknown }).tone),
    )
    expect(new Set(tones).size).toBe(tones.length)
  })

  it('sampled sets declare roots so the player can shift from them', () => {
    for (const s of BASS_SOUNDS) {
      if (s.kind !== 'sample') continue
      expect(s.roots.length, s.id).toBeGreaterThan(0)
      expect([...s.roots].sort((a, b) => a - b), s.id).toEqual(s.roots)
    }
  })

  it('picks the nearest recorded root, including above the highest', () => {
    const roots = [28, 33, 40, 47]
    expect(nearestRoot(roots, 28)).toBe(28)
    expect(nearestRoot(roots, 34)).toBe(33)
    expect(nearestRoot(roots, 39)).toBe(40)
    expect(nearestRoot(roots, 60)).toBe(47) // shifted up rather than dropped
  })
})
