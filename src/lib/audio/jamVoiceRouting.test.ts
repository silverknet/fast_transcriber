/**
 * THE UNSTOPPABLE CHORD TRACK — pinned so it cannot come back.
 *
 * Reported from a rehearsal: "why aren't the barbro chords linked to custom 1
 * in live — [they] don't turn off sometimes when i turn the stem off".
 *
 * The mixer computed the jam's suppression list by EXCLUDING a voice when its
 * lane existed. Inverted. Adding the Chords track to the mixer was the thing
 * that switched a SECOND chord voice on — fired per frame straight into the
 * jam's own audio path, with no channel, no fader, no mute and no pill. Muting
 * the lane, pressing its live pad, pulling its fader: none of it reached the
 * jam copy. A chord track that cannot be stopped, on stage.
 *
 * "Sometimes" was the two halves being remembered separately in localStorage —
 * the lane here, "hear chords" over in the Chords tab — so it appeared and
 * vanished between songs and sessions.
 */
import { describe, expect, it } from 'vitest'
import {
  JAM_VOICES,
  jamVoicesSuppressedInEditor,
  jamVoicesSuppressedInMixer,
} from './jamVoiceRouting'

describe('the mixer never lets the jam fire a chord voice', () => {
  it('suppresses every voice when the chord lane is HOSTED — the doubling case', () => {
    // Hosted means the engine already plays it on its own clock. Firing it per
    // frame as well is the same note twice, on two clocks.
    expect(jamVoicesSuppressedInMixer(['original', 'chord-machine'])).toEqual([...JAM_VOICES])
  })

  it('THE BUG: hosting the lane must not open a second, unmutable path', () => {
    // This is the exact regression. Before the fix, 'keys' was DROPPED from the
    // list precisely when `chord-machine` was present — so adding the Chords
    // track armed the copy that no mute could reach.
    expect(jamVoicesSuppressedInMixer(['chord-machine'])).toContain('keys')
    expect(jamVoicesSuppressedInMixer(['arp-machine'])).toContain('arp')
    expect(jamVoicesSuppressedInMixer(['chord-machine', 'arp-machine'])).toEqual([...JAM_VOICES])
  })

  it('suppresses every voice when the lane is ABSENT — the no-owner case', () => {
    // Unhosted is worse, not better: nothing on screen would even hint at it.
    expect(jamVoicesSuppressedInMixer([])).toEqual([...JAM_VOICES])
    expect(jamVoicesSuppressedInMixer(['original', 'stem:drums.wav'])).toEqual([...JAM_VOICES])
  })

  it('is unconditional — no lane arrangement can produce a firing voice', () => {
    // Property-ish: the answer must not depend on the lanes at all, because
    // every past version of this bug was a condition someone thought was safe.
    const arrangements = [
      [],
      ['chord-machine'],
      ['arp-machine'],
      ['chord-machine', 'arp-machine'],
      ['bass-machine', 'drum-machine', 'chord-machine'],
      ['stem:vocals.wav', 'stem:other.wav'],
    ]
    for (const lanes of arrangements) {
      expect(jamVoicesSuppressedInMixer(lanes), lanes.join(',')).toEqual([...JAM_VOICES])
    }
  })

  it('covers all three voices — a new voice must be added to the list, not forgotten', () => {
    expect([...JAM_VOICES].sort()).toEqual(['arp', 'bass', 'keys'])
  })
})

describe('the Chords tab still previews', () => {
  it('suppresses nothing — previewing is the point there, and no lane competes', () => {
    expect(jamVoicesSuppressedInEditor()).toEqual([])
  })
})
