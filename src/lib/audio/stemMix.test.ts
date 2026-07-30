import { describe, it, expect } from 'vitest'
import { resolveStemAudibility } from './stemMix'

const KEYS = ['stem:drums', 'stem:bass', 'stem:vocals', 'stem:other']

describe('resolveStemAudibility', () => {
  it('plays the original when all stems are on (default, nothing disabled)', () => {
    expect(resolveStemAudibility(KEYS, {})).toEqual({ playOriginal: true, audibleStemKeys: [] })
  })

  it('plays the original when every stem is explicitly on', () => {
    const on = Object.fromEntries(KEYS.map((k) => [k, true]))
    expect(resolveStemAudibility(KEYS, on)).toEqual({ playOriginal: true, audibleStemKeys: [] })
  })

  it('plays exactly the enabled stems when a subset is on', () => {
    const enabled = { 'stem:vocals': false, 'stem:other': false }
    expect(resolveStemAudibility(KEYS, enabled)).toEqual({
      playOriginal: false,
      audibleStemKeys: ['stem:drums', 'stem:bass'],
    })
  })

  it('mutes the original but keeps a single enabled stem audible', () => {
    const enabled = Object.fromEntries(KEYS.map((k) => [k, k === 'stem:drums']))
    expect(resolveStemAudibility(KEYS, enabled)).toEqual({
      playOriginal: false,
      audibleStemKeys: ['stem:drums'],
    })
  })

  it('is silent (no original, no stems) when everything is off', () => {
    const off = Object.fromEntries(KEYS.map((k) => [k, false]))
    expect(resolveStemAudibility(KEYS, off)).toEqual({ playOriginal: false, audibleStemKeys: [] })
  })

  it('always plays the original when the song has no stems', () => {
    expect(resolveStemAudibility([], {})).toEqual({ playOriginal: true, audibleStemKeys: [] })
    expect(resolveStemAudibility([], { anything: false })).toEqual({
      playOriginal: true,
      audibleStemKeys: [],
    })
  })

  it('preserves stemKeys order in the audible subset', () => {
    const enabled = { 'stem:drums': false }
    expect(resolveStemAudibility(KEYS, enabled).audibleStemKeys).toEqual([
      'stem:bass',
      'stem:vocals',
      'stem:other',
    ])
  })
})
