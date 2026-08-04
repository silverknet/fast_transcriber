import { describe, expect, it } from 'vitest'
import {
  CHANNEL_LINK_PAIRS,
  chLinkAddress,
  guardDrift,
  linkGuardAddresses,
  linkPairFor,
  linkVerifyPlan,
  readChannelLinks,
  stereoLinkProblems,
  stereoLinkTargets,
} from './channelLink'
import { liveRigLayout } from './liveRigPlan'
import type { Performer } from '$lib/project/types'

const performer = (name: string, inputs: Performer['inputs']): Performer => ({
  id: `p-${name}`,
  name,
  role: '',
  inputs,
})

/** The band's real rig: BarBro on 9-12, keys 5/6, guitar 7/8, mics 1-3. */
const bandLayout = () =>
  liveRigLayout({ profileRequest: 'multichannel', deviceChannels: 4, firstDeskChannel: 9 })

describe('linkPairFor', () => {
  it('accepts the desk’s fixed pairs', () => {
    expect(linkPairFor([9, 10])).toBe('9-10')
    expect(linkPairFor([10, 9])).toBe('9-10') // order is not the operator’s job
    expect(linkPairFor([1, 2])).toBe('1-2')
    expect(linkPairFor([15, 16])).toBe('15-16')
  })

  it('refuses a straddling pair — the desk has no such address', () => {
    expect(linkPairFor([6, 7])).toBeNull()
    expect(linkPairFor([2, 3])).toBeNull()
  })

  it('refuses non-adjacent, mono and out-of-range channels', () => {
    expect(linkPairFor([5, 8])).toBeNull()
    expect(linkPairFor([3])).toBeNull()
    expect(linkPairFor([1, 2, 3])).toBeNull()
    expect(linkPairFor([16, 17])).toBeNull()
  })

  it('every pair label has an address the desk understands', () => {
    for (const pair of CHANNEL_LINK_PAIRS) {
      expect(chLinkAddress(pair)).toMatch(/^\/config\/chlink\/\d+-\d+$/)
    }
  })
})

describe('stereoLinkTargets', () => {
  it('gives BarBro’s song one fader', () => {
    const targets = stereoLinkTargets(bandLayout(), [])
    expect(targets).toHaveLength(1)
    expect(targets[0].pair).toBe('9-10')
    expect(targets[0].channels).toEqual([9, 10])
    expect(targets[0].label).toMatch(/BarBro/)
  })

  it('NEVER offers the click/cue pair — they are two different signals', () => {
    // 11 is click and 12 is cue in this layout: adjacent, a legal desk pair,
    // and linking them would tie the drummer's click to the cue level forever.
    const layout = bandLayout()
    expect(layout.slots.map((s) => s.deskChannel)).toEqual([9, 10, 11, 12])
    const pairs = stereoLinkTargets(layout, []).map((t) => t.pair)
    expect(pairs).not.toContain('11-12')
  })

  it('links each performer’s stereo input and leaves mono alone', () => {
    const performers = [
      performer('Martin', [{ id: 'a', label: 'Nord', channels: [5, 6] }]),
      performer('Thor', [{ id: 'b', label: 'Guitar', channels: [7, 8] }]),
      performer('Emma', [{ id: 'c', label: 'Sång', channels: [3] }]),
    ]
    const targets = stereoLinkTargets(bandLayout(), performers)
    expect(targets.map((t) => t.pair)).toEqual(['9-10', '5-6', '7-8'])
    expect(targets[1].label).toBe('Martin · Nord')
  })

  it('does not offer the same pair twice', () => {
    const performers = [
      performer('A', [{ id: 'a', label: 'Keys', channels: [5, 6] }]),
      performer('B', [{ id: 'b', label: 'Keys too', channels: [6, 5] }]),
    ]
    expect(stereoLinkTargets(bandLayout(), performers).map((t) => t.pair)).toEqual(['9-10', '5-6'])
  })

  it('skips an unlinkable patch rather than writing a bogus address', () => {
    const performers = [performer('Martin', [{ id: 'a', label: 'Nord', channels: [6, 7] }])]
    expect(stereoLinkTargets(bandLayout(), performers).map((t) => t.pair)).toEqual(['9-10'])
  })

  it('has nothing to offer with no layout and no stereo inputs', () => {
    expect(stereoLinkTargets(null, [])).toEqual([])
  })
})

describe('stereoLinkProblems', () => {
  it('names an unlinkable stereo patch and the pair to move to', () => {
    const performers = [performer('Martin', [{ id: 'a', label: 'Nord', channels: [6, 7] }])]
    const problems = stereoLinkProblems(bandLayout(), performers)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('6/7')
    expect(problems[0]).toContain('7/8')
  })

  it('is silent when everything is on a real pair', () => {
    const performers = [performer('Martin', [{ id: 'a', label: 'Nord', channels: [5, 6] }])]
    expect(stereoLinkProblems(bandLayout(), performers)).toEqual([])
  })

  it('flags BarBro starting on an even channel', () => {
    const layout = liveRigLayout({
      profileRequest: 'multichannel',
      deviceChannels: 4,
      firstDeskChannel: 10,
    })
    const problems = stereoLinkProblems(layout, [])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/10 and 11/)
  })

  it('says nothing about mono inputs', () => {
    const performers = [performer('Emma', [{ id: 'c', label: 'Sång', channels: [3] }])]
    expect(stereoLinkProblems(bandLayout(), performers)).toEqual([])
  })
})

describe('the guard — linking must not move the audio', () => {
  const target = stereoLinkTargets(bandLayout(), [])[0]

  it('guards input source, USB return and house assign on both strips', () => {
    expect(linkGuardAddresses(target)).toEqual([
      '/ch/09/preamp/rtnsw',
      '/ch/09/config/rtnsrc',
      '/ch/09/mix/lr',
      '/ch/10/preamp/rtnsw',
      '/ch/10/config/rtnsrc',
      '/ch/10/mix/lr',
    ])
  })

  it('catches the failure that would make the song mono in both ears', () => {
    const before = {
      '/ch/09/config/rtnsrc': [{ type: 'i', value: 0 }],
      '/ch/10/config/rtnsrc': [{ type: 'i', value: 1 }],
    }
    // The desk copied the odd strip's USB return onto the even one.
    const after = {
      '/ch/09/config/rtnsrc': [{ type: 'i', value: 0 }],
      '/ch/10/config/rtnsrc': [{ type: 'i', value: 0 }],
    }
    const drift = guardDrift(before, after, linkGuardAddresses(target))
    expect(drift).toHaveLength(1)
    expect(drift[0]).toContain('strip 10')
    expect(drift[0]).toContain('USB channel')
  })

  it('reports nothing when the link left everything else alone', () => {
    const state = {
      '/ch/09/preamp/rtnsw': [{ type: 'i', value: 1 }],
      '/ch/10/preamp/rtnsw': [{ type: 'i', value: 1 }],
      '/ch/09/config/rtnsrc': [{ type: 'i', value: 0 }],
      '/ch/10/config/rtnsrc': [{ type: 'i', value: 1 }],
      '/ch/09/mix/lr': [{ type: 'i', value: 1 }],
      '/ch/10/mix/lr': [{ type: 'i', value: 1 }],
    }
    expect(guardDrift(state, { ...state }, linkGuardAddresses(target))).toEqual([])
  })

  it('an unanswered read is not drift — silence is not evidence', () => {
    const before = { '/ch/09/mix/lr': [{ type: 'i', value: 1 }] }
    expect(guardDrift(before, {}, linkGuardAddresses(target))).toEqual([])
    expect(guardDrift({}, before, linkGuardAddresses(target))).toEqual([])
  })

  it('the verify plan expects the link to actually be on', () => {
    expect(linkVerifyPlan([target])).toEqual([{ address: '/config/chlink/9-10', expect: 1 }])
  })
})

describe('readChannelLinks', () => {
  it('reports the pairs the desk says are linked', () => {
    const replies: Record<string, { type: string; value: number }[]> = {}
    for (const pair of CHANNEL_LINK_PAIRS) replies[chLinkAddress(pair)] = [{ type: 'i', value: 0 }]
    replies['/config/chlink/9-10'] = [{ type: 'i', value: 1 }]
    const { linked, answered } = readChannelLinks(replies)
    expect(linked).toEqual(['9-10'])
    expect(answered).toBe(CHANNEL_LINK_PAIRS.length)
  })

  it('counts how much the desk actually answered', () => {
    const { linked, answered } = readChannelLinks({})
    expect(linked).toEqual([])
    expect(answered).toBe(0)
  })
})
