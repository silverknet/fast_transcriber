/**
 * REGRESSION tests for the live-mode STEM-BUTTON disaster: at the first gig the
 * stem buttons did nothing, and the same button hit a different stem per song
 * because the mapping was POSITIONAL (pad N = whatever lane loaded into slot N).
 *
 * These pin the fix: a FIXED canonical instrument→slot map (`laneSlotIndex`), so
 * a given stem is ALWAYS the same button, every song — and the round track
 * buttons mirror the bottom pad row.
 */
import { describe, it, expect } from 'vitest'
import { laneSlotIndex, resolveLiveCommand, DEFAULT_LIVE_MAPPING, CANONICAL_LIVE_SLOTS } from './liveMidiMap'
import type { ApcKey25Action } from './apcKey25'

const M = DEFAULT_LIVE_MAPPING

/** Simulate MixerView's slotting: lane keys → fixed 8-slot array (null = empty). */
function slotsFor(laneKeys: string[]): (string | null)[] {
  const slots: (string | null)[] = Array(8).fill(null)
  for (const key of laneKeys) {
    const i = laneSlotIndex(key)
    if (i != null) slots[i] = key
  }
  return slots
}

describe('laneSlotIndex — fixed canonical stem slots', () => {
  it('maps each instrument to its fixed slot, both key schemes', () => {
    expect(laneSlotIndex('stem:drums.wav')).toBe(0)
    expect(laneSlotIndex('stem:Drums')).toBe(0) // cloud scheme
    expect(laneSlotIndex('stem:bass.wav')).toBe(1)
    expect(laneSlotIndex('stem:vocals.wav')).toBe(2)
    expect(laneSlotIndex('stem:Vocals')).toBe(2)
    expect(laneSlotIndex('stem:other.wav')).toBe(3)
    expect(laneSlotIndex('stem:guitar.wav')).toBe(4)
    expect(laneSlotIndex('stem:fx.wav')).toBe(5)
    expect(laneSlotIndex('click')).toBe(6)
    expect(laneSlotIndex('cue')).toBe(7)
  })

  it('returns null for the full mix and unknown lanes', () => {
    expect(laneSlotIndex('original')).toBeNull()
    expect(laneSlotIndex('stem:mystery.wav')).toBeNull()
  })

  it('THE FIX: a given instrument is the SAME slot across different songs', () => {
    // Song A: full 4-stem Demucs set + click. Song B: only drums + vocals + cue.
    const songA = slotsFor(['stem:drums.wav', 'stem:bass.wav', 'stem:vocals.wav', 'stem:other.wav', 'click'])
    const songB = slotsFor(['stem:Vocals', 'stem:Drums', 'cue'])

    // Drums is slot 0 in BOTH; vocals is slot 2 in BOTH — never shifts.
    expect(songA[0]).toContain('drums')
    expect(songB[0]).toContain('Drums')
    expect(songA[2]).toContain('vocals')
    expect(songB[2]).toContain('Vocals')

    // Song B has no bass/other → those slots are empty, and nothing else shifts.
    expect(songB[1]).toBeNull() // bass slot dark
    expect(songB[3]).toBeNull() // other slot dark
    expect(songB[2]).not.toBeNull() // vocals still on slot 2, not shifted to slot 1
  })

  it('slot count matches the canonical layout', () => {
    expect(CANONICAL_LIVE_SLOTS.length).toBe(8)
    expect(CANONICAL_LIVE_SLOTS[0]).toBe('drums')
  })
})

describe('resolveLiveCommand — track buttons mirror the stem pads', () => {
  const clipPad = (index: number): ApcKey25Action => ({
    type: 'clip-pad',
    index,
    row: 0,
    col: index,
    pressed: true,
    velocity: 100,
  })
  const trackBtn = (index: number): ApcKey25Action => ({ type: 'track-button', index, pressed: true })

  it('clip-pad n and track-button n both toggle the same canonical stem slot', () => {
    for (let i = 0; i < 8; i++) {
      expect(resolveLiveCommand(clipPad(i), M)).toEqual({ type: 'toggle-stem', index: i })
      expect(resolveLiveCommand(trackBtn(i), M)).toEqual({ type: 'toggle-stem', index: i })
    }
  })

  it('ignores track-button releases', () => {
    expect(resolveLiveCommand({ type: 'track-button', index: 2, pressed: false }, M)).toBeNull()
  })
})
