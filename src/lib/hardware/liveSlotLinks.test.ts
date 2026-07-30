import { describe, it, expect } from 'vitest'
import {
  effectiveSlotLink,
  isGroupOn,
  isLiveSlotLink,
  nextGroupMuted,
  resolveLaneSlot,
  resolveLiveSlotLanes,
  slotIndexByName,
  slotNameByIndex,
  LIVE_SLOT_COUNT,
} from './liveSlotLinks'

const DRUMS = slotIndexByName('drums')
const BASS = slotIndexByName('bass')

describe('resolveLaneSlot', () => {
  it('falls back to the filename guess when nothing is set', () => {
    expect(resolveLaneSlot('stem:drums.wav')).toBe(DRUMS)
    expect(resolveLaneSlot('stem:Drums')).toBe(DRUMS) // cloud key scheme
  })

  it('an explicit link wins over the filename', () => {
    // A file called "drums" deliberately parked on the Bass button.
    expect(resolveLaneSlot('stem:drums.wav', 'bass')).toBe(BASS)
  })

  it('links a track the filename guess cannot recognise', () => {
    expect(resolveLaneSlot('stem:percussion.wav')).toBeNull() // before
    expect(resolveLaneSlot('stem:percussion.wav', 'drums')).toBe(DRUMS) // after
  })

  it("'none' removes a lane the guess would have claimed", () => {
    expect(resolveLaneSlot('stem:drums.wav', 'none')).toBeNull()
  })
})

describe('resolveLiveSlotLanes', () => {
  it('puts several tracks on one button, in order', () => {
    const slots = resolveLiveSlotLanes([
      { key: 'stem:drums.wav' },
      { key: 'stem:percussion.wav', liveSlot: 'drums' },
      { key: 'stem:bass.wav' },
    ])
    expect(slots[DRUMS]).toEqual(['stem:drums.wav', 'stem:percussion.wav'])
    expect(slots[BASS]).toEqual(['stem:bass.wav'])
  })

  it('always returns all 8 slots, empty where nothing is linked', () => {
    const slots = resolveLiveSlotLanes([{ key: 'stem:drums.wav' }])
    expect(slots).toHaveLength(LIVE_SLOT_COUNT)
    expect(slots[BASS]).toEqual([])
  })

  it('drops lanes that belong to no slot', () => {
    const slots = resolveLiveSlotLanes([
      { key: 'original' },
      { key: 'stem:weird.wav' },
      { key: 'stem:drums.wav', liveSlot: 'none' },
    ])
    expect(slots.every((s) => s.length === 0)).toBe(true)
  })

  it('keeps the click and cue lanes on their own buttons', () => {
    const slots = resolveLiveSlotLanes([{ key: 'click' }, { key: 'cue' }])
    expect(slots[slotIndexByName('click')]).toEqual(['click'])
    expect(slots[slotIndexByName('cue')]).toEqual(['cue'])
  })

  it('an unconfigured song groups exactly as it did before', () => {
    const slots = resolveLiveSlotLanes([
      { key: 'stem:drums.wav' },
      { key: 'stem:bass.wav' },
      { key: 'stem:vocals.wav' },
      { key: 'stem:other.wav' },
    ])
    expect(slots[DRUMS]).toEqual(['stem:drums.wav'])
    expect(slots[BASS]).toEqual(['stem:bass.wav'])
    expect(slots[slotIndexByName('vocals')]).toEqual(['stem:vocals.wav'])
    expect(slots[slotIndexByName('other')]).toEqual(['stem:other.wav'])
  })
})

describe('nextGroupMuted — one press never splits the group', () => {
  const muted = (set: string[]) => (k: string) => set.includes(k)

  it('all on → press mutes all', () => {
    expect(nextGroupMuted(['a', 'b'], muted([]))).toBe(true)
  })

  it('all off → press unmutes all', () => {
    expect(nextGroupMuted(['a', 'b'], muted(['a', 'b']))).toBe(false)
  })

  it('mixed → press mutes all, so the next press brings the whole group back', () => {
    expect(nextGroupMuted(['a', 'b'], muted(['a']))).toBe(true)
    expect(nextGroupMuted(['a', 'b'], muted([]))).toBe(true)
  })

  it('an empty group is inert', () => {
    expect(nextGroupMuted([], muted([]))).toBe(false)
  })
})

describe('isGroupOn — the LED', () => {
  const muted = (set: string[]) => (k: string) => set.includes(k)

  it('lit when anything in the group sounds', () => {
    expect(isGroupOn(['a', 'b'], muted(['a']))).toBe(true)
    expect(isGroupOn(['a', 'b'], muted([]))).toBe(true)
  })

  it('dark when the whole group is muted, or empty', () => {
    expect(isGroupOn(['a', 'b'], muted(['a', 'b']))).toBe(false)
    expect(isGroupOn([], muted([]))).toBe(false)
  })
})

describe('effectiveSlotLink — what the picker shows', () => {
  it('shows the guessed slot when nothing is set', () => {
    expect(effectiveSlotLink('stem:drums.wav')).toBe('drums')
  })

  it("shows 'none' for a track the guess does not recognise", () => {
    expect(effectiveSlotLink('stem:percussion.wav')).toBe('none')
  })

  it('shows the explicit setting when there is one', () => {
    expect(effectiveSlotLink('stem:drums.wav', 'bass')).toBe('bass')
    expect(effectiveSlotLink('stem:drums.wav', 'none')).toBe('none')
  })

  it('ignores junk from an older or newer schema', () => {
    expect(effectiveSlotLink('stem:drums.wav', 'trumpet' as never)).toBe('drums')
  })
})

describe('slot name/index round-trip', () => {
  it('survives a name → index → name trip for every slot', () => {
    for (let i = 0; i < LIVE_SLOT_COUNT; i++) {
      const name = slotNameByIndex(i)
      expect(name).not.toBeNull()
      expect(slotIndexByName(name!)).toBe(i)
    }
  })

  it('rejects out-of-range indices and junk links', () => {
    expect(slotNameByIndex(-1)).toBeNull()
    expect(slotNameByIndex(LIVE_SLOT_COUNT)).toBeNull()
    expect(isLiveSlotLink('trumpet')).toBe(false)
    expect(isLiveSlotLink('none')).toBe(true)
    expect(isLiveSlotLink('drums')).toBe(true)
  })
})
