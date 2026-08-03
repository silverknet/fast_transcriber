/**
 * The rig indicator.
 *
 * Its entire value is that it is never optimistic. A green light meaning
 * "probably" gets trusted at load-in, and the first proof it was wrong is
 * silence in front of an audience — or a click in the house, which everyone
 * hears. So these tests lean almost entirely on the ways it could wrongly
 * reassure.
 */
import { describe, expect, it } from 'vitest'
import { rigHealth, isMonitorOnlyLaneKey, withoutHouseAssignmentForMonitorLanes } from './rigHealth'

const allGood = {
  deskIdentified: true,
  deskLabel: 'XR18 · fw 1.19',
  usbInputOk: true,
  fohSafe: true,
  monitorsConfigured: 2,
}

describe('green requires evidence for every check', () => {
  it('is ready when all four are proven', () => {
    const h = rigHealth(allGood)
    expect(h.ready).toBe(true)
    expect(h.broken).toBe(false)
    expect(h.checks.every((c) => c.state === 'pass')).toBe(true)
  })

  it('is NOT ready when the desk has not been read back for FOH safety', () => {
    // `null` means unproven, and unproven is the state the whole live rig was
    // silently in. It must never be green.
    const h = rigHealth({ ...allGood, fohSafe: null })
    expect(h.ready).toBe(false)
    expect(h.checks.find((c) => c.key === 'foh-safe')?.state).toBe('unknown')
  })

  it('is NOT ready when the USB input has not been checked', () => {
    expect(rigHealth({ ...allGood, usbInputOk: null }).ready).toBe(false)
  })

  it('is NOT ready without a desk', () => {
    expect(rigHealth({ ...allGood, deskIdentified: false }).ready).toBe(false)
  })

  it('unknown is not the same as broken', () => {
    // Amber vs red. "Not checked yet" should not read as "something is wrong",
    // or the red state stops meaning anything.
    const h = rigHealth({ ...allGood, fohSafe: null })
    expect(h.broken).toBe(false)
    expect(h.ready).toBe(false)
  })

  it('IS broken when click is actually still on the house', () => {
    const h = rigHealth({ ...allGood, fohSafe: false, unsafeChannels: [15] })
    expect(h.broken).toBe(true)
    expect(h.checks.find((c) => c.key === 'foh-safe')?.detail).toMatch(/15/)
  })
})

describe('it always says WHY', () => {
  it('surfaces the first real problem in the summary', () => {
    const h = rigHealth({ ...allGood, deskIdentified: false })
    expect(h.summary).toMatch(/Find my desk/i)
  })

  it('prefers a failure over a merely-unknown in the summary', () => {
    // If something is actually wrong, that is what you need to read first.
    const h = rigHealth({ ...allGood, usbInputOk: null, fohSafe: false, unsafeChannels: [15] })
    expect(h.summary).toMatch(/house/i)
  })

  it('every non-pass check carries a reason', () => {
    const h = rigHealth({
      deskIdentified: false,
      usbInputOk: null,
      fohSafe: null,
      monitorsConfigured: 0,
    })
    for (const c of h.checks) {
      if (c.state !== 'pass') expect(c.detail.length, c.key).toBeGreaterThan(0)
    }
  })

  it('uses no jargon a musician would not recognise', () => {
    const h = rigHealth({ deskIdentified: false, usbInputOk: false, fohSafe: false, monitorsConfigured: 0 })
    const text = h.checks.map((c) => `${c.label} ${c.detail}`).join(' ').toLowerCase()
    for (const word of ['osc', 'rtnsw', 'rtnsrc', 'insrc', '/ch/', 'enum', 'lr bus']) {
      expect(text, word).not.toContain(word)
    }
  })
})

describe('click and cues can never be assigned to the house', () => {
  it('knows which lanes are monitor-only', () => {
    expect(isMonitorOnlyLaneKey('click')).toBe(true)
    expect(isMonitorOnlyLaneKey('cue')).toBe(true)
    expect(isMonitorOnlyLaneKey('original')).toBe(false)
    expect(isMonitorOnlyLaneKey('stem:drums.wav')).toBe(false)
  })

  it('separates monitor-only channels from musical ones', () => {
    const { monitorOnlyChannels, musicalChannels } = withoutHouseAssignmentForMonitorLanes([
      { laneKey: 'original', channels: [9, 10] },
      { laneKey: 'click', channels: [11] },
      { laneKey: 'cue', channels: [12] },
    ])
    expect(monitorOnlyChannels).toEqual([11, 12])
    expect(musicalChannels).toEqual([9, 10])
  })

  it('a SHARED channel is treated as monitor-only — safety over convenience', () => {
    // Being wrong this way costs a quiet monitor. The other way puts click in
    // the PA, which ends the show.
    const { monitorOnlyChannels, musicalChannels } = withoutHouseAssignmentForMonitorLanes([
      { laneKey: 'original', channels: [9, 10] },
      { laneKey: 'click', channels: [10] },
    ])
    expect(monitorOnlyChannels).toEqual([10])
    expect(musicalChannels).toEqual([9])
  })

  it('ignores channels the desk does not have', () => {
    const { monitorOnlyChannels } = withoutHouseAssignmentForMonitorLanes([
      { laneKey: 'click', channels: [17, 18, 0, 99, 15] },
    ])
    expect(monitorOnlyChannels).toEqual([15])
  })
})

describe('evidence levels — configured is never dressed up as proven', () => {
  /**
   * The architecture's readiness rule: a green dot must NAME what it rests on.
   * A monitor assignment is a form field; desk read-back is the desk speaking.
   * These lock the honest mapping so the UI can say "set up" vs "proven".
   */
  const allGood = {
    deskIdentified: true,
    deskLabel: 'XR18',
    usbInputOk: true as const,
    fohSafe: true as const,
    monitorsConfigured: 3,
  }

  it('desk-backed checks carry observed evidence', () => {
    const h = rigHealth(allGood)
    for (const key of ['connected', 'usb-input', 'foh-safe'] as const) {
      expect(h.checks.find((c) => c.key === key)?.evidence).toBe('observed')
    }
  })

  it('monitor assignment is CONFIGURED — the desk said nothing about it', () => {
    expect(rigHealth(allGood).checks.find((c) => c.key === 'monitors')?.evidence).toBe('configured')
  })

  it('a fully green rig still admits which part is only configuration', () => {
    const h = rigHealth(allGood)
    expect(h.ready).toBe(true)
    expect(h.summary).toMatch(/not yet proven with signal/)
  })
})
