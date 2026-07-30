import { describe, it, expect } from 'vitest'
import { buildKickHits, kickShapeFor, kickVelocityGain } from './chordKick'

// Two bars, four beats each, one beat = 0.5s.
const beats = Array.from({ length: 8 }, (_, i) => ({
  timeSec: i * 0.5,
  barId: i < 4 ? 'bar1' : 'bar2',
}))

describe('buildKickHits', () => {
  it('downbeat → one hit per bar', () => {
    const hits = buildKickHits(beats, 'downbeat')
    expect(hits.map((h) => h.timeSec)).toEqual([0, 2])
  })

  it('1+3 → beats 1 and 3 of each bar', () => {
    const hits = buildKickHits(beats, '1+3')
    expect(hits.map((h) => h.timeSec)).toEqual([0, 1, 2, 3])
  })

  it('four → every beat', () => {
    const hits = buildKickHits(beats, 'four')
    expect(hits.map((h) => h.timeSec)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5])
  })

  it('accents the downbeat over the other hits', () => {
    const hits = buildKickHits(beats, 'four')
    expect(hits[0]!.velocity).toBeGreaterThan(hits[1]!.velocity)
    expect(hits[4]!.velocity).toBe(hits[0]!.velocity) // next bar's 1 is accented too
  })

  it('follows the bar, not a fixed beat count (5/4 keeps 1 & 3 only)', () => {
    const fiveFour = Array.from({ length: 10 }, (_, i) => ({
      timeSec: i * 0.5,
      barId: i < 5 ? 'bar1' : 'bar2',
    }))
    const hits = buildKickHits(fiveFour, '1+3')
    expect(hits.map((h) => h.timeSec)).toEqual([0, 1, 2.5, 3.5])
  })

  it('no beats → no hits', () => {
    expect(buildKickHits([], 'four')).toEqual([])
  })
})

describe('kickShapeFor', () => {
  it('more punch → higher, faster sweep and a shorter tail', () => {
    const soft = kickShapeFor(0)
    const hard = kickShapeFor(1)
    expect(hard.bodyStartHz).toBeGreaterThan(soft.bodyStartHz)
    expect(hard.bodySweepSec).toBeLessThan(soft.bodySweepSec)
    expect(hard.bodyDecaySec).toBeLessThan(soft.bodyDecaySec)
  })

  it('more punch → more beater click and knock', () => {
    expect(kickShapeFor(1).clickLevel).toBeGreaterThan(kickShapeFor(0).clickLevel)
    expect(kickShapeFor(1).knockLevel).toBeGreaterThan(kickShapeFor(0).knockLevel)
  })

  it('keeps the drum in tune as punch moves (fixed body end pitch)', () => {
    expect(kickShapeFor(0).bodyEndHz).toBe(kickShapeFor(1).bodyEndHz)
  })

  it('clamps out-of-range punch', () => {
    expect(kickShapeFor(-5)).toEqual(kickShapeFor(0))
    expect(kickShapeFor(9)).toEqual(kickShapeFor(1))
  })

  it('every sweep endpoint stays positive (exponential ramps reject zero)', () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const s = kickShapeFor(p)
      expect(s.bodyStartHz).toBeGreaterThan(0)
      expect(s.bodyEndHz).toBeGreaterThan(0)
      expect(s.bodySweepSec).toBeGreaterThan(0)
      expect(s.knockStartHz).toBeGreaterThan(0)
    }
  })
})

describe('kickVelocityGain', () => {
  it('is monotonic and keeps quiet hits audible', () => {
    expect(kickVelocityGain(0)).toBeGreaterThan(0)
    expect(kickVelocityGain(0.5)).toBeGreaterThan(kickVelocityGain(0))
    expect(kickVelocityGain(1)).toBeGreaterThan(kickVelocityGain(0.5))
    expect(kickVelocityGain(1)).toBe(1)
  })

  it('clamps out-of-range velocity', () => {
    expect(kickVelocityGain(-1)).toBe(kickVelocityGain(0))
    expect(kickVelocityGain(4)).toBe(kickVelocityGain(1))
  })
})
