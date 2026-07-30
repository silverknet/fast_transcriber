import { describe, it, expect } from 'vitest'
import { isLaneReorderable, moveKey, sortBySavedOrder } from './laneOrder'

describe('sortBySavedOrder', () => {
  it('restores a remembered order', () => {
    const keys = ['stem:a', 'stem:b', 'stem:c']
    expect(sortBySavedOrder(keys, ['stem:c', 'stem:a', 'stem:b'])).toEqual([
      'stem:c',
      'stem:a',
      'stem:b',
    ])
  })

  it('pins the original to the top even when the saved order puts it elsewhere', () => {
    const keys = ['stem:a', 'original', 'stem:b']
    expect(sortBySavedOrder(keys, ['stem:b', 'stem:a', 'original'])[0]).toBe('original')
  })

  it('drops a new track at the BOTTOM rather than into the middle', () => {
    const keys = ['stem:a', 'stem:b', 'stem:new']
    expect(sortBySavedOrder(keys, ['stem:b', 'stem:a'])).toEqual(['stem:b', 'stem:a', 'stem:new'])
  })

  it('keeps several new tracks in their natural order', () => {
    const keys = ['x', 'y', 'z']
    expect(sortBySavedOrder(keys, [])).toEqual(['x', 'y', 'z'])
  })

  it('ignores saved keys the song no longer has', () => {
    expect(sortBySavedOrder(['stem:a'], ['stem:gone', 'stem:a'])).toEqual(['stem:a'])
  })

  it('never duplicates a key, even from a corrupted saved order', () => {
    const out = sortBySavedOrder(['a', 'b'], ['a', 'a', 'b', 'a'])
    expect(out).toEqual(['a', 'b'])
  })

  it('is idempotent — re-sorting its own output changes nothing', () => {
    const keys = ['stem:a', 'original', 'stem:b']
    const once = sortBySavedOrder(keys, ['stem:b', 'stem:a'])
    expect(sortBySavedOrder(once, once)).toEqual(once)
  })
})

describe('moveKey', () => {
  const keys = ['original', 'a', 'b', 'c']

  it('moves a lane down', () => {
    expect(moveKey(keys, 'a', 'c')).toEqual(['original', 'b', 'c', 'a'])
  })

  it('moves a lane up', () => {
    expect(moveKey(keys, 'c', 'a')).toEqual(['original', 'c', 'a', 'b'])
  })

  it('refuses to drop anything above the pinned original', () => {
    expect(moveKey(keys, 'c', 'original')).toEqual(keys)
  })

  it('refuses to drag the original itself', () => {
    expect(moveKey(keys, 'original', 'c')).toEqual(keys)
  })

  it('a drop on itself is a no-op', () => {
    expect(moveKey(keys, 'b', 'b')).toEqual(keys)
  })

  it('ignores unknown keys', () => {
    expect(moveKey(keys, 'ghost', 'b')).toEqual(keys)
    expect(moveKey(keys, 'b', 'ghost')).toEqual(keys)
  })

  it('does not mutate the input', () => {
    const input = [...keys]
    moveKey(input, 'a', 'c')
    expect(input).toEqual(keys)
  })
})

describe('isLaneReorderable', () => {
  it('locks the original, allows everything else', () => {
    expect(isLaneReorderable('original')).toBe(false)
    expect(isLaneReorderable('stem:drums.wav')).toBe(true)
    expect(isLaneReorderable('click')).toBe(true)
  })
})
