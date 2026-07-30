import { describe, it, expect } from 'vitest'
import { prefetchPlan, decodedKeepSet, readyState } from './livePrefetch'

const SET = ['a', 'b', 'c', 'd', 'e']

describe('decodedKeepSet', () => {
  it('keeps current + next (window 1) = 2 songs', () => {
    expect(decodedKeepSet(SET, 1)).toEqual(['b', 'c'])
  })
  it('clamps at the end of the set', () => {
    expect(decodedKeepSet(SET, 4)).toEqual(['e'])
  })
  it('respects a wider window but never exceeds maxDecoded', () => {
    expect(decodedKeepSet(SET, 1, 2)).toEqual(['b', 'c', 'd'])
    expect(decodedKeepSet(SET, 1, 2, 2)).toEqual(['b', 'c']) // capped
  })
  it('is empty for an out-of-range index', () => {
    expect(decodedKeepSet(SET, -1)).toEqual([])
    expect(decodedKeepSet(SET, 9)).toEqual([])
  })
})

describe('prefetchPlan', () => {
  it('decodes current + next when nothing is resident (current first)', () => {
    const plan = prefetchPlan({ setlist: SET, currentIndex: 1, decoded: [], fetched: [] })
    expect(plan.decode).toEqual(['b', 'c']) // current then next
    expect(plan.evict).toEqual([])
  })

  it('EVICTS decoded songs outside the window (bounds RAM)', () => {
    // Playing 'c' now; 'a' + 'b' are stale decoded holdovers → evict them.
    const plan = prefetchPlan({ setlist: SET, currentIndex: 2, decoded: ['a', 'b', 'c'], fetched: [] })
    expect(plan.evict.sort()).toEqual(['a', 'b'])
    expect(plan.decode).toEqual(['d']) // next song still needs decoding
  })

  it('advancing the setlist keeps exactly {current,next} decoded', () => {
    // Moved from b→c: c already decoded (was "next"), now decode d, evict a & b.
    const plan = prefetchPlan({ setlist: SET, currentIndex: 2, decoded: ['b', 'c'], fetched: [] })
    expect(plan.decode).toEqual(['d'])
    expect(plan.evict).toEqual(['b'])
  })

  it('warms ALL un-fetched song bytes, nearest-first', () => {
    const plan = prefetchPlan({ setlist: SET, currentIndex: 2, decoded: [], fetched: [] })
    // distance order from index 2: c(0), b/d(1, forward d first), a/e(2, forward e first)
    expect(plan.fetch).toEqual(['c', 'd', 'b', 'e', 'a'])
  })

  it('skips already-fetched songs in the fetch list', () => {
    const plan = prefetchPlan({ setlist: SET, currentIndex: 0, decoded: [], fetched: ['a', 'b'] })
    expect(plan.fetch).toEqual(['c', 'd', 'e'])
  })
})

describe('readyState', () => {
  it('reports ready > fetched > cold', () => {
    const decoded = new Set(['a'])
    const fetched = new Set(['a', 'b'])
    expect(readyState('a', decoded, fetched)).toBe('ready')
    expect(readyState('b', decoded, fetched)).toBe('fetched')
    expect(readyState('c', decoded, fetched)).toBe('cold')
  })
})
