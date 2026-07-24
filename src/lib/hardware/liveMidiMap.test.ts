import { describe, it, expect } from 'vitest'
import {
  resolveLiveCommand,
  DEFAULT_LIVE_MAPPING,
  padToSection,
  sectionToPad,
  controlId,
  type LiveMapping,
} from './liveMidiMap'
import type { ApcKey25Action } from './apcKey25'

const M = DEFAULT_LIVE_MAPPING

describe('resolveLiveCommand (default mapping)', () => {
  it('maps Play press → play-pause, ignores release', () => {
    expect(resolveLiveCommand({ type: 'play', pressed: true }, M)).toEqual({ type: 'play-pause' })
    expect(resolveLiveCommand({ type: 'play', pressed: false }, M)).toBeNull()
  })

  it('maps Stop All Clips → stop, Record → replay-once', () => {
    expect(resolveLiveCommand({ type: 'stop-all-clips', pressed: true }, M)).toEqual({ type: 'stop' })
    expect(resolveLiveCommand({ type: 'record', pressed: true }, M)).toEqual({ type: 'replay-once' })
  })

  it('maps scene launches to prev/next/loop', () => {
    const sl = (index: number): ApcKey25Action => ({ type: 'scene-launch', index, pressed: true })
    expect(resolveLiveCommand(sl(0), M)).toEqual({ type: 'prev-song' })
    expect(resolveLiveCommand(sl(1), M)).toEqual({ type: 'next-song' })
    expect(resolveLiveCommand(sl(2), M)).toEqual({ type: 'loop' })
    expect(resolveLiveCommand(sl(3), M)).toEqual({ type: 'announce-song' })
  })

  it('bottom pad row (0–7) = stem toggles', () => {
    expect(resolveLiveCommand({ type: 'clip-pad', index: 3, row: 0, col: 3, pressed: true, velocity: 100 }, M)).toEqual({
      type: 'toggle-stem',
      index: 3,
    })
  })

  it('top pad rows = section jumps (top-left is section 0)', () => {
    // Pad 32 = top row, col 0 → section 0.
    expect(resolveLiveCommand({ type: 'clip-pad', index: 32, row: 4, col: 0, pressed: true, velocity: 100 }, M)).toEqual({
      type: 'jump-section',
      index: 0,
    })
    // Pad 8 = just above stems, col 0 → section 24.
    expect(resolveLiveCommand({ type: 'clip-pad', index: 8, row: 1, col: 0, pressed: true, velocity: 100 }, M)).toEqual({
      type: 'jump-section',
      index: 24,
    })
  })

  it('ignores knobs', () => {
    expect(resolveLiveCommand({ type: 'knob', index: 0, delta: 1, rawValue: 65 }, M)).toBeNull()
  })

  it('honors a re-learned binding (Play mapped to a track button)', () => {
    const custom: LiveMapping = { ...M, 'play-pause': 'track:0' }
    expect(resolveLiveCommand({ type: 'track-button', index: 0, pressed: true }, custom)).toEqual({ type: 'play-pause' })
    // The old Play button no longer plays (default record still fires replay).
    expect(resolveLiveCommand({ type: 'play', pressed: true }, custom)).toBeNull()
  })
})

describe('pad ↔ section geometry', () => {
  it('round-trips', () => {
    for (let s = 0; s < 32; s++) expect(padToSection(sectionToPad(s)!)).toBe(s)
  })
  it('bottom row + out of range are not sections', () => {
    expect(padToSection(0)).toBeNull()
    expect(padToSection(7)).toBeNull()
    expect(padToSection(40)).toBeNull()
  })
})

describe('controlId', () => {
  it('produces stable ids', () => {
    expect(controlId({ type: 'play', pressed: true })).toBe('play')
    expect(controlId({ type: 'scene-launch', index: 2, pressed: true })).toBe('scene:2')
    expect(controlId({ type: 'track-button', index: 5, pressed: true })).toBe('track:5')
    expect(controlId({ type: 'knob', index: 0, delta: 1, rawValue: 65 })).toBeNull()
  })
})
