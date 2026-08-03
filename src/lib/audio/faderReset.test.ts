import { describe, expect, it } from 'vitest'
import { planFaderReset } from './faderReset'

describe('clearing hand-compensation before loudness matching', () => {
  it('resets stem faders that were riding to compensate for level differences', () => {
    // "Den första": drums pushed to 1.50 because that song's drums are quiet.
    const plan = planFaderReset([
      { key: 'stem:drums.wav', volume: 1.5 },
      { key: 'stem:bass.wav', volume: 1 },
      { key: 'stem:vocals.wav', volume: 1 },
    ])
    expect(plan.reset).toEqual(['stem:drums.wav'])
    expect(plan.summary).toMatch(/Reset 1 stem fader to unity/)
  })

  it('says so when there is nothing to do', () => {
    const plan = planFaderReset([{ key: 'stem:drums.wav', volume: 1 }])
    expect(plan.reset).toEqual([])
    expect(plan.summary).toMatch(/already at unity/)
  })

  it('never touches the full mix, the click or the cues', () => {
    // `original` is deliberately pulled to 0.31 on several of Martin's songs.
    const plan = planFaderReset([
      { key: 'original', volume: 0.31, muted: true },
      { key: 'click', volume: 0.5 },
      { key: 'cue', volume: 0.5 },
      { key: 'stem:bass.wav', volume: 1.14 },
    ])
    expect(plan.reset).toEqual(['stem:bass.wav'])
  })

  it('clears a MUTED stem’s stale compensation too', () => {
    const plan = planFaderReset([{ key: 'stem:vocals.wav', volume: 0.78, muted: true }])
    expect(plan.reset).toEqual(['stem:vocals.wav'])
  })
})

describe('a blended role is a decision, not compensation', () => {
  // "Ramlar": separated drums at 1.05 AND a drum machine at 1.15.
  const blended = [
    { key: 'stem:drums.wav', volume: 1.05 },
    { key: 'drum-machine', volume: 1.15 },
    { key: 'stem:bass.wav', volume: 1.2 },
  ]

  it('leaves both drum lanes alone and says why', () => {
    const plan = planFaderReset(blended)
    expect(plan.reset).toEqual(['stem:bass.wav'])
    expect(plan.skippedRoles).toEqual(['drums'])
    expect(plan.summary).toMatch(/leaving drums alone/)
    expect(plan.summary).toMatch(/that balance is yours/)
  })

  it('once the machine is muted, drums are a single lane again and reset normally', () => {
    const plan = planFaderReset([
      { key: 'stem:drums.wav', volume: 1.05 },
      { key: 'drum-machine', volume: 1.15, muted: true },
    ])
    expect(plan.skippedRoles).toEqual([])
    expect(plan.reset.sort()).toEqual(['drum-machine', 'stem:drums.wav'])
  })
})
