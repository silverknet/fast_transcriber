/**
 * What the rig page remembers, and what it refuses to let you do.
 *
 * The interesting rule is the overlap check: sending BarBro to a channel that
 * is ALSO marked monitor-only takes the music off the house bus, and you find
 * out when the first song starts to an empty-sounding room.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RIG_SETUP,
  parseMonitorChannels,
  parseRigSetup,
  resolveProfileRequest,
  rigSetupProblems,
  type RigSetup,
} from './rigSetupStore'

const setup = (over: Partial<RigSetup> = {}): RigSetup => ({ ...DEFAULT_RIG_SETUP, ...over })

describe('remembering the rig', () => {
  it('round-trips a real setup', () => {
    const s = setup({ host: '192.168.1.10', port: 10024, leftCh: 9, rightCh: 10 })
    expect(parseRigSetup(JSON.stringify(s))).toEqual(s)
  })

  it('falls back to defaults rather than breaking on junk', () => {
    for (const raw of [null, '', '{', 'null', '[]', '{"host":123}']) {
      expect(() => parseRigSetup(raw), String(raw)).not.toThrow()
    }
    expect(parseRigSetup('{')).toEqual(DEFAULT_RIG_SETUP)
  })

  it('rejects channels outside the desk instead of sending them', () => {
    // The XR18 has SIXTEEN channels (17/18 is the aux return, /rtn/aux —
    // verified on real hardware). Writing to a channel it does not have is a
    // silent no-op: X-AIR ignores unknown addresses with no reply and no error.
    const parsed = parseRigSetup(JSON.stringify({ leftCh: 0, rightCh: 99 }))
    expect(parsed.leftCh).toBe(DEFAULT_RIG_SETUP.leftCh)
    expect(parsed.rightCh).toBe(DEFAULT_RIG_SETUP.rightCh)
  })

  it('rejects an impossible port', () => {
    expect(parseRigSetup(JSON.stringify({ port: 0 })).port).toBe(10024)
    expect(parseRigSetup(JSON.stringify({ port: 99999 })).port).toBe(10024)
  })

  it('defaults to the channels the lane map already expects', () => {
    // `defaultXAirChannelsForLane('original')` is 9/10; starting somewhere else
    // would make the page disagree with the rest of the app on day one.
    expect(DEFAULT_RIG_SETUP.leftCh).toBe(9)
    expect(DEFAULT_RIG_SETUP.rightCh).toBe(10)
  })
})

describe('monitor-only channels', () => {
  it('accepts the ways people actually type a list', () => {
    for (const text of ['15, 16', '15 16', '15,16', ' 15 , 16 ']) {
      expect(parseMonitorChannels(text), text).toEqual([15, 16])
    }
  })

  it('drops nonsense and duplicates instead of passing them to the desk', () => {
    expect(parseMonitorChannels('15, abc, 99, 0, 16, 15')).toEqual([15, 16])
  })

  it('an empty field means none', () => {
    expect(parseMonitorChannels('')).toEqual([])
  })
})

describe('problems worth stopping for', () => {
  it('is happy with a sane rig', () => {
    expect(rigSetupProblems(setup())).toEqual([])
  })

  it('catches left and right being the same channel', () => {
    expect(rigSetupProblems(setup({ leftCh: 9, rightCh: 9 }))[0]).toMatch(/same channel/i)
  })

  it('catches a music channel ALSO marked monitor-only', () => {
    // The failure: the house gets no music, discovered when the show starts.
    const problems = rigSetupProblems(setup({ leftCh: 15, rightCh: 16, monitorOnly: '15, 16' }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/house would get no music/i)
    expect(problems[0]).toMatch(/15, 16/)
  })

  it('names only the overlapping channel', () => {
    const problems = rigSetupProblems(setup({ leftCh: 9, rightCh: 15, monitorOnly: '15, 16' }))
    expect(problems[0]).toMatch(/Channel 15 /)
    expect(problems[0]).not.toMatch(/16/)
  })

  it('says the problem in words, so the button is never just greyed out', () => {
    for (const p of rigSetupProblems(setup({ leftCh: 5, rightCh: 5 }))) {
      expect(p.length).toBeGreaterThan(30)
    }
  })
})

describe('channels that no longer exist', () => {
  it('migrates a setup saved with the old 17/18 defaults', () => {
    // The XR18 has no channels 17/18. A saved setup still naming them must not
    // silently become an EMPTY monitor-only list — that would make the
    // front-of-house safety check pass with nothing to check, reporting "click
    // is off the house" when it was never looked at.
    expect(parseMonitorChannels('17, 18')).toEqual([15, 16])
  })

  it('does not duplicate when both the old and new numbers are present', () => {
    expect(parseMonitorChannels('15, 17, 16, 18')).toEqual([15, 16])
  })

  it('still rejects channels that never existed', () => {
    expect(parseMonitorChannels('19, 99, 0')).toEqual([])
  })
})

describe("the 'auto' profile derivation — evidence instead of a switch", () => {
  const auto = (host: string, channels: number) =>
    resolveProfileRequest({ profileRequest: 'auto', host }, channels)

  it('the gig machine: desk saved + 18 channels → multichannel, no human step', () => {
    expect(auto('192.168.1.217', 18)).toBe('multichannel')
  })

  it('a laptop: desk saved but stereo device → stereo (nowhere to split)', () => {
    expect(auto('192.168.1.217', 2)).toBe('stereo-passthrough')
  })

  it('an HDMI television: 6 channels but NO desk → stereo, click is not lost into a phantom speaker', () => {
    expect(auto('', 6)).toBe('stereo-passthrough')
  })

  it('an explicit override always wins over the evidence', () => {
    expect(resolveProfileRequest({ profileRequest: 'stereo-passthrough', host: 'x' }, 18)).toBe(
      'stereo-passthrough',
    )
    expect(resolveProfileRequest({ profileRequest: 'multichannel', host: '' }, 2)).toBe('multichannel')
  })

  it("a fresh setup parses to 'auto' — the derivation is the default, not an upgrade step", () => {
    expect(parseRigSetup(null).profileRequest).toBe('auto')
    expect(parseRigSetup('{"host":"1.2.3.4"}').profileRequest).toBe('auto')
  })
})
