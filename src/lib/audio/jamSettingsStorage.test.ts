/**
 * The rules for reading persisted jam settings.
 *
 * The case that matters most is the one that was wrong: a MISSING key must
 * yield the fallback, while a deliberately stored `0` must survive. The old
 * code could not tell those apart, because `Number(null)` is `0` and `0` is
 * finite — so a fresh device got `keysVolume = 0` and the chords lane was
 * silent.
 */
import { describe, expect, it } from 'vitest'
import { parseBool, parseNum, parsePatch, parseStr } from './jamSettingsStorage'
import { DEFAULT_PATCH, structuredClonePatch } from './keysSynth'

describe('parseNum', () => {
  it('a MISSING key yields the fallback, not zero', () => {
    // RED before the fix: returned clamp(0, min, max).
    expect(parseNum(null, 0.5, 0, 1)).toBe(0.5)
    expect(parseNum(null, 1, -2, 2)).toBe(1)
  })

  it('an empty string is missing too', () => {
    expect(parseNum('', 0.5, 0, 1)).toBe(0.5)
    expect(parseNum('   ', 0.5, 0, 1)).toBe(0.5)
  })

  it('a stored ZERO is respected — a fader pulled to silence stays silent', () => {
    expect(parseNum('0', 0.5, 0, 1)).toBe(0)
  })

  it('reads a stored value', () => {
    expect(parseNum('0.9', 0.5, 0, 1)).toBeCloseTo(0.9, 6)
    expect(parseNum('-1', 0, -2, 2)).toBe(-1)
  })

  it('clamps out-of-range values rather than discarding them', () => {
    expect(parseNum('99', 1, -2, 2)).toBe(2)
    expect(parseNum('-99', 1, -2, 2)).toBe(-2)
  })

  it('falls back on junk', () => {
    expect(parseNum('not-a-number', 0.5, 0, 1)).toBe(0.5)
    expect(parseNum('NaN', 0.5, 0, 1)).toBe(0.5)
  })

  it('falls back on infinities rather than clamping them', () => {
    expect(parseNum('Infinity', 0.5, 0, 1)).toBe(0.5)
    expect(parseNum('-Infinity', 0.5, 0, 1)).toBe(0.5)
  })
})

describe('parseBool', () => {
  it('missing yields the fallback', () => {
    expect(parseBool(null, true)).toBe(true)
    expect(parseBool(null, false)).toBe(false)
    expect(parseBool('', true)).toBe(true)
  })

  it("only '1' is true", () => {
    expect(parseBool('1', false)).toBe(true)
    expect(parseBool('0', true)).toBe(false)
    expect(parseBool('true', true)).toBe(false)
  })
})

describe('parseStr', () => {
  const ALLOWED = ['up', 'down', 'updown'] as const

  it('missing yields the fallback', () => {
    expect(parseStr(null, ALLOWED, 'up')).toBe('up')
  })

  it('a value outside the allowed set falls back', () => {
    expect(parseStr('sideways', ALLOWED, 'up')).toBe('up')
  })

  it('reads an allowed value', () => {
    expect(parseStr('updown', ALLOWED, 'up')).toBe('updown')
  })
})

describe('parsePatch', () => {
  const fallback = () => structuredClonePatch(DEFAULT_PATCH)

  it('missing yields the fallback', () => {
    expect(parsePatch(null, fallback).name).toBe(DEFAULT_PATCH.name)
    expect(parsePatch('', fallback).name).toBe(DEFAULT_PATCH.name)
  })

  it('malformed JSON falls back rather than throwing', () => {
    expect(parsePatch('{oh no', fallback).name).toBe(DEFAULT_PATCH.name)
  })

  it('an object that is not a patch falls back', () => {
    expect(parsePatch('{"name":"x"}', fallback).name).toBe(DEFAULT_PATCH.name)
    expect(parsePatch('null', fallback).name).toBe(DEFAULT_PATCH.name)
    expect(parsePatch('42', fallback).name).toBe(DEFAULT_PATCH.name)
  })

  it('reads a real stored patch', () => {
    const saved = { ...structuredClonePatch(DEFAULT_PATCH), name: 'My Sound' }
    expect(parsePatch(JSON.stringify(saved), fallback).name).toBe('My Sound')
  })
})
