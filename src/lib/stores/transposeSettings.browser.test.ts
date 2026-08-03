/**
 * The single transpose owner.
 *
 * Browser-only because the store reads `localStorage` behind `browser`, which
 * is false in the node project — the same reason a silent-default bug in
 * `chordJam` survived for months in a fully green unit suite.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { transposeSettings } from './transposeSettings.svelte'
import { project as projectStore } from './project'
import { songMap } from './songMap'
import { createEmptySongMap } from '$lib/songmap/factory'
import { varispeedRate } from '$lib/audio/varispeed'
import type { SongMap } from '$lib/songmap/types'

function song(title: string, baseSemitones?: number): SongMap {
  const sm = { ...createEmptySongMap(), metadata: { ...createEmptySongMap().metadata, title } }
  return baseSemitones === undefined ? sm : { ...sm, transpose: { baseSemitones } }
}

function useSong(songId: string, title: string, baseSemitones?: number) {
  projectStore.update((p) => ({ ...p, activeSongId: songId }))
  songMap.set(song(title, baseSemitones))
  transposeSettings.resetForTest()
  transposeSettings.loadForCurrentSong()
}

beforeEach(() => {
  localStorage.clear()
  transposeSettings.resetForTest()
  transposeSettings.setVarispeedAudio(false)
  transposeSettings.setTempoHold(0)
})

describe('per-song offset', () => {
  it('remembers a different offset for each song', () => {
    useSong('s1', 'Norrtälje')
    transposeSettings.setSemitones(-2)
    useSong('s2', 'Other')
    expect(transposeSettings.semitones, 'a new song must not inherit the offset').toBe(0)
    transposeSettings.setSemitones(5)
    useSong('s1', 'Norrtälje')
    expect(transposeSettings.semitones).toBe(-2)
    useSong('s2', 'Other')
    expect(transposeSettings.semitones).toBe(5)
  })

  it('survives a reload — the offset is persisted, not just in memory', () => {
    useSong('s1', 'Norrtälje')
    transposeSettings.setSemitones(-3)
    transposeSettings.resetForTest()
    transposeSettings.loadForCurrentSong()
    expect(transposeSettings.semitones).toBe(-3)
  })

  it('clamps to the legal range', () => {
    useSong('s1', 'X')
    transposeSettings.setSemitones(99)
    expect(transposeSettings.semitones).toBe(12)
    transposeSettings.setSemitones(-99)
    expect(transposeSettings.semitones).toBe(-12)
  })

  it('returning to 0 clears the stored value rather than storing a zero', () => {
    useSong('s1', 'X')
    transposeSettings.setSemitones(4)
    transposeSettings.setSemitones(0)
    expect(localStorage.getItem('barbro::xpose::s1::X')).toBeNull()
  })

  it('uses the SAME storage key the editor already wrote', () => {
    // Load-bearing: users have offsets saved under this exact format.
    localStorage.setItem('barbro::xpose::s1::Norrtälje', '-2')
    useSong('s1', 'Norrtälje')
    expect(transposeSettings.semitones).toBe(-2)
  })

  it('seeds once from a legacy .smap transpose when nothing is stored', () => {
    useSong('s9', 'Legacy', -4)
    expect(transposeSettings.semitones).toBe(-4)
  })

  it('a stored offset beats the legacy .smap value', () => {
    localStorage.setItem('barbro::xpose::s9::Legacy', '1')
    useSong('s9', 'Legacy', -4)
    expect(transposeSettings.semitones).toBe(1)
  })
})

describe('the plan — derived once, for everyone', () => {
  it('is inert while the varispeed switch is off', () => {
    useSong('s1', 'X')
    transposeSettings.setSemitones(-2)
    expect(transposeSettings.plan.rate).toBe(1)
    expect(transposeSettings.plan.shiftSemitones).toBe(0)
    // ...but MIDI notes still move: that is lossless and always correct.
    expect(transposeSettings.plan.noteSemitones).toBe(-2)
  })

  it('pure varispeed at dial 0: rate carries the whole transpose', () => {
    useSong('s1', 'X')
    transposeSettings.setVarispeedAudio(true)
    transposeSettings.setSemitones(-2)
    expect(transposeSettings.plan.rate).toBeCloseTo(varispeedRate(-2), 9)
    expect(transposeSettings.plan.shiftSemitones).toBe(0)
    expect(transposeSettings.plan.noteSemitones).toBe(-2)
  })

  it('dial at 1 holds tempo: the worklet carries the whole transpose', () => {
    useSong('s1', 'X')
    transposeSettings.setVarispeedAudio(true)
    transposeSettings.setTempoHold(1)
    transposeSettings.setSemitones(-2)
    expect(transposeSettings.plan.rate).toBeCloseTo(1, 9)
    expect(transposeSettings.plan.shiftSemitones).toBeCloseTo(-2, 9)
  })

  it('dial half-way splits between them, still summing to the whole', () => {
    useSong('s1', 'X')
    transposeSettings.setVarispeedAudio(true)
    transposeSettings.setTempoHold(0.5)
    transposeSettings.setSemitones(-2)
    const { rate, shiftSemitones } = transposeSettings.plan
    expect(rate).toBeGreaterThan(varispeedRate(-2))
    expect(rate).toBeLessThan(1)
    expect(shiftSemitones).toBeCloseTo(-1, 6)
  })

  it('the dial and the switch are per-device, NOT per-song', () => {
    useSong('s1', 'X')
    transposeSettings.setVarispeedAudio(true)
    transposeSettings.setTempoHold(0.4)
    useSong('s2', 'Y')
    expect(transposeSettings.varispeedAudio).toBe(true)
    expect(transposeSettings.tempoHold).toBeCloseTo(0.4, 6)
  })
})

describe('no double knowledge', () => {
  it('derives its own song identity — no surface hands it one', () => {
    // This is the whole point: a new surface gets transpose by importing the
    // store, with no props to forget. Forgetting a prop is what left the live
    // stage permanently at concert pitch.
    projectStore.update((p) => ({ ...p, activeSongId: 'auto' }))
    songMap.set(song('Derived'))
    transposeSettings.resetForTest()
    transposeSettings.loadForCurrentSong()
    transposeSettings.setSemitones(7)
    expect(localStorage.getItem('barbro::xpose::auto::Derived')).toBe('7')
    expect(get(projectStore).activeSongId).toBe('auto')
  })
})
