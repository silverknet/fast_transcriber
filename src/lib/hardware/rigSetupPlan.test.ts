/**
 * The setup checks' ordering rules.
 *
 * The point of encoding these as data is that "you cannot answer this yet" and
 * "this is broken" stay distinct. Conflating them is how someone ends up
 * re-seating XLRs when the real problem is that the desk's input block is still
 * on Local instead of USB.
 */
import { describe, expect, it } from 'vitest'
import {
  RIG_CHECKS,
  checkState,
  nextActionable,
  rigCheck,
  rigReady,
  type CheckId,
  type CheckState,
} from './rigSetupPlan'

const results = (r: Partial<Record<CheckId, CheckState>>) => r

describe('dependency ordering', () => {
  it('every prerequisite is listed BEFORE the check that needs it', () => {
    const seen = new Set<CheckId>()
    for (const check of RIG_CHECKS) {
      for (const dep of check.requires) {
        expect(seen.has(dep), `${check.id} requires ${dep}, which comes later`).toBe(true)
      }
      seen.add(check.id)
    }
  })

  it('every prerequisite actually exists', () => {
    for (const check of RIG_CHECKS) {
      for (const dep of check.requires) expect(() => rigCheck(dep)).not.toThrow()
    }
  })

  it('the first check needs nothing — there is always somewhere to start', () => {
    expect(RIG_CHECKS[0]!.requires).toEqual([])
  })
})

describe('blocked vs failed', () => {
  it('a check whose prerequisite has not passed is BLOCKED, not failed', () => {
    // Telling someone the main output "failed" when audio never reached the
    // desk sends them to the wrong end of the signal chain.
    expect(checkState('main-lr', results({}))).toBe('blocked')
  })

  it('becomes ready once its prerequisites pass', () => {
    const r = results({
      'output-device': 'passed',
      'usb-arrives': 'passed',
      'channel-identity': 'passed',
      'desk-connect': 'passed',
    })
    expect(checkState('main-lr', r)).toBe('ready')
  })

  it('a failed prerequisite still blocks — not a cascade of failures', () => {
    const r = results({ 'output-device': 'failed' })
    expect(checkState('usb-arrives', r)).toBe('blocked')
  })

  it('keeps its own explicit result over anything derived', () => {
    const r = results({ 'main-lr': 'passed' })
    expect(checkState('main-lr', r)).toBe('passed')
  })
})

describe('what to do next', () => {
  it('points at the first thing that can be done', () => {
    expect(nextActionable(results({}))).toBe('output-device')
  })

  it('points at a FAILED check before moving on', () => {
    const r = results({ 'output-device': 'passed', 'usb-arrives': 'failed' })
    expect(nextActionable(r)).toBe('usb-arrives')
  })

  it('skips past what already passed', () => {
    const r = results({ 'output-device': 'passed' })
    expect(nextActionable(r)).toBe('usb-arrives')
  })

  it('returns null when nothing is left', () => {
    const all = Object.fromEntries(RIG_CHECKS.map((c) => [c.id, 'passed'])) as Record<
      CheckId,
      CheckState
    >
    expect(nextActionable(all)).toBeNull()
  })
})

describe('readiness', () => {
  it('is not ready while anything is unanswered', () => {
    expect(rigReady(results({}))).toBe(false)
  })

  it('a deliberately skipped check does not block readiness', () => {
    // Not every rig has in-ears; skipping is a real answer.
    const all = Object.fromEntries(RIG_CHECKS.map((c) => [c.id, 'passed'])) as Record<
      CheckId,
      CheckState
    >
    expect(rigReady({ ...all, 'aux-sends': 'skipped' })).toBe(true)
  })

  it('one failure is enough to be not ready', () => {
    const all = Object.fromEntries(RIG_CHECKS.map((c) => [c.id, 'passed'])) as Record<
      CheckId,
      CheckState
    >
    expect(rigReady({ ...all, 'foh-safety': 'failed' })).toBe(false)
  })
})

describe('the content is actually useful', () => {
  it('every check says what to do when it fails', () => {
    for (const c of RIG_CHECKS) {
      expect(c.remedy.length, `${c.id} has no remedy`).toBeGreaterThan(20)
      expect(c.question.endsWith('?'), `${c.id}'s question is not a question`).toBe(true)
    }
  })

  it('names the USB routing trap explicitly', () => {
    // An X Air channel sources Local or USB and defaults to Local; until that
    // block is switched the desk looks broken. It is the single most common
    // failure, so the remedy must say it rather than hint.
    const usb = rigCheck('usb-arrives')
    expect(usb.remedy).toMatch(/Routing/i)
    expect(usb.remedy).toMatch(/USB/i)
    expect(usb.remedy).toMatch(/Local/i)
  })

  it('marks which checks write to the desk', () => {
    // Writing to someone's live desk is not something to do unannounced.
    expect(rigCheck('foh-safety').writesToDesk).toBe(true)
    expect(rigCheck('usb-arrives').writesToDesk).toBe(false)
  })
})
