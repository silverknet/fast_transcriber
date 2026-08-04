/**
 * The project-wide live BUTTON start state, and the promise that turning it on
 * changes nothing until someone actually chooses.
 */
import { describe, expect, it } from 'vitest'
import { CANONICAL_LIVE_SLOTS } from './liveMidiMap'
import { LIVE_SLOT_NAMES } from '$lib/project/types'
import { audibleSlotSet, normalizeLiveSlots, slotStartsOn } from './liveSlotDefaults'

describe('the schema list and the hardware list are the same ten buttons', () => {
  it('cannot drift — a slot the schema cannot name is a slot nobody can configure', () => {
    expect([...LIVE_SLOT_NAMES]).toEqual([...CANONICAL_LIVE_SLOTS])
  })
})

describe('unset = exactly the old behaviour', () => {
  it('legacy fallback: drums, bass and other on; vocals off', () => {
    const on = audibleSlotSet(undefined, undefined)
    expect(on.has('drums')).toBe(true)
    expect(on.has('bass')).toBe(true)
    expect(on.has('other')).toBe(true)
    expect(on.has('vocals')).toBe(false)
  })

  it('follows an existing stem list for the four stem buttons', () => {
    const on = audibleSlotSet(undefined, ['drums', 'bass'])
    expect(on.has('drums')).toBe(true)
    expect(on.has('bass')).toBe(true)
    expect(on.has('other')).toBe(false)
    expect(on.has('vocals')).toBe(false)
  })

  it('keeps click and cue on, whatever the stems say', () => {
    // Click starts on for every analysed song — the fix for "some songs have
    // clicks, some don't". A stem list must never have been able to change it.
    for (const stems of [undefined, [], ['vocals'] as const]) {
      const on = audibleSlotSet(undefined, stems as never)
      expect(on.has('click'), `stems=${JSON.stringify(stems)}`).toBe(true)
      expect(on.has('cue')).toBe(true)
    }
  })

  it('keeps the linked-on-purpose buttons on: guitar, fx, custom 1 and 2', () => {
    const on = audibleSlotSet(undefined, [])
    for (const name of ['guitar', 'fx', 'custom1', 'custom2'] as const) {
      expect(on.has(name), name).toBe(true)
    }
  })
})

describe('an explicit choice takes over completely', () => {
  it('only the named buttons start on', () => {
    const on = audibleSlotSet(['drums', 'bass', 'click', 'cue'], ['vocals', 'other'])
    expect([...on].sort()).toEqual(['bass', 'click', 'cue', 'drums'])
  })

  it('can start the chord machine OFF — impossible with a stem list', () => {
    expect(slotStartsOn('custom1', ['drums', 'bass'], undefined)).toBe(false)
    expect(slotStartsOn('custom1', ['drums', 'bass', 'custom1'], undefined)).toBe(true)
  })

  it('can run a set with NO click — one visible project decision, not twenty saved ones', () => {
    expect(slotStartsOn('click', ['drums', 'bass'], undefined)).toBe(false)
  })

  it('EMPTY means every button starts off, and does not fall back', () => {
    expect(audibleSlotSet([], ['drums', 'bass']).size).toBe(0)
    for (const name of LIVE_SLOT_NAMES) expect(slotStartsOn(name, [], undefined)).toBe(false)
  })

  it('ignores the old stem list entirely once set', () => {
    // Both present: the newer, more expressive setting wins outright rather
    // than merging — a half-applied setting is worse than either.
    expect(slotStartsOn('other', ['drums'], ['other'])).toBe(false)
  })
})

describe('a null slot is never on', () => {
  it('a lane on no button cannot start audible', () => {
    expect(slotStartsOn(null, undefined, undefined)).toBe(false)
    expect(slotStartsOn(null, [...LIVE_SLOT_NAMES], undefined)).toBe(false)
  })
})

describe('normalizeLiveSlots', () => {
  it('keeps canonical order and drops duplicates and junk', () => {
    expect(normalizeLiveSlots(['custom1', 'nonsense', 'bass', 'bass', 'drums'])).toEqual([
      'drums',
      'bass',
      'custom1',
    ])
  })

  it('distinguishes "no setting" from "everything off"', () => {
    expect(normalizeLiveSlots(undefined)).toBeUndefined()
    expect(normalizeLiveSlots('drums')).toBeUndefined()
    expect(normalizeLiveSlots([])).toEqual([])
  })
})
