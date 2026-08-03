/**
 * The band's patch plan, validated. The fixture is the REAL band: piano
 * stereo, sång (lead vocals) mono, guitar mono, on a rig where BarBro's own
 * audio occupies desk strips 9-12.
 */
import { describe, expect, it } from 'vitest'
import {
  availableInputChannels,
  isValidPerformerInput,
  patchList,
  performerInputProblems,
  reservedDeskChannels,
} from './performerInputs'
import { liveRigLayout } from '$lib/hardware/liveRigPlan'
import type { Performer } from './types'

const LAYOUT = liveRigLayout({
  profileRequest: 'multichannel',
  deviceChannels: 18,
  firstDeskChannel: 9,
})

const band: Performer[] = [
  {
    id: 'martin',
    name: 'Martin',
    inputs: [{ id: 'i-piano', label: 'Piano', channels: [1, 2] }],
  },
  {
    id: 'emma',
    name: 'Emma',
    inputs: [{ id: 'i-sang', label: 'Sång', channels: [3] }],
  },
  {
    id: 'thor',
    name: 'Thor',
    inputs: [{ id: 'i-guitar', label: 'Guitar', channels: [4] }],
  },
]

describe('reserved channels — BarBro’s own strips are never offerable', () => {
  it('the current rig reserves 9-12 (song pair + click + cue)', () => {
    expect([...reservedDeskChannels(LAYOUT)].sort((a, b) => a - b)).toEqual([9, 10, 11, 12])
  })
})

describe('availability', () => {
  it('the real band leaves 8 free jacks on this rig', () => {
    const free = availableInputChannels(band, LAYOUT)
    expect(free).toEqual([5, 6, 7, 8, 13, 14, 15, 16])
    expect(free).not.toContain(9)
    expect(free).not.toContain(1)
  })

  it('editing an input offers its OWN channels back', () => {
    const free = availableInputChannels(band, LAYOUT, 'i-piano')
    expect(free).toContain(1)
    expect(free).toContain(2)
    expect(free).not.toContain(3)
  })

  it('a keyboardist with three keyboards fits — six channels, no collisions', () => {
    const keys: Performer = {
      id: 'k',
      name: 'Keys',
      inputs: [
        { id: 'k1', label: 'Nord', channels: [5, 6] },
        { id: 'k2', label: 'Rhodes', channels: [7, 8] },
        { id: 'k3', label: 'Moog', channels: [13, 14] },
      ],
    }
    expect(performerInputProblems([...band, keys], LAYOUT)).toEqual([])
    expect(availableInputChannels([...band, keys], LAYOUT)).toEqual([15, 16])
  })
})

describe('problems, in stage language', () => {
  it('the healthy band has none', () => {
    expect(performerInputProblems(band, LAYOUT)).toEqual([])
  })

  it('plugging into a BarBro strip is named for what it would do', () => {
    const bad: Performer[] = [
      { id: 'x', name: 'Martin', inputs: [{ id: 'i', label: 'Piano', channels: [11] }] },
    ]
    const problems = performerInputProblems(bad, LAYOUT)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/carries BarBro/)
    expect(problems[0]).toMatch(/channel 11/)
  })

  it('two inputs on one jack names BOTH claimants', () => {
    const clash: Performer[] = [
      { id: 'a', name: 'Emma', inputs: [{ id: 'i1', label: 'Sång', channels: [3] }] },
      { id: 'b', name: 'Thor', inputs: [{ id: 'i2', label: 'Guitar', channels: [3] }] },
    ]
    const problems = performerInputProblems(clash, LAYOUT)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('Emma')
    expect(problems[0]).toContain('Thor')
  })
})

describe('input validity', () => {
  it('mono and stereo are the only shapes; junk is invalid', () => {
    expect(isValidPerformerInput({ id: 'i', label: 'x', channels: [3] })).toBe(true)
    expect(isValidPerformerInput({ id: 'i', label: 'x', channels: [1, 2] })).toBe(true)
    expect(isValidPerformerInput({ id: 'i', label: 'x', channels: [] })).toBe(false)
    expect(isValidPerformerInput({ id: 'i', label: 'x', channels: [1, 2, 3] })).toBe(false)
    expect(isValidPerformerInput({ id: 'i', label: 'x', channels: [0] })).toBe(false)
    expect(isValidPerformerInput({ id: 'i', label: 'x', channels: [17] })).toBe(false)
    expect(isValidPerformerInput({ id: 'i', label: 'x', channels: [3, 3] })).toBe(false)
  })
})

describe('the patch list — what gets taped to the desk', () => {
  it('one line per input, roster order', () => {
    expect(patchList(band)).toEqual([
      { performer: 'Martin', label: 'Piano', channels: [1, 2] },
      { performer: 'Emma', label: 'Sång', channels: [3] },
      { performer: 'Thor', label: 'Guitar', channels: [4] },
    ])
  })
})
