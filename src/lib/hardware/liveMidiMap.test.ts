import { describe, it, expect } from 'vitest'
import {
  resolveLiveCommand,
  DEFAULT_LIVE_MAPPING,
  padToSection,
  sectionToPad,
  padToLiveSlot,
  SECTION_PAD_COUNT,
  controlId,
  liveLanePadLed,
  ABSENT_LANE_VELOCITY,
  STEM_ON_VELOCITY,
  CLICK_ON_VELOCITY,
  CUE_ON_VELOCITY,
  type LiveMapping,
} from './liveMidiMap'
import type { ApcKey25Action } from './apcKey25'
import { APC_PLAY_NOTE, parseApcKey25Message } from './apcKey25'

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

  it('remaining pad rows = section jumps (top-left is section 0)', () => {
    // Pad 32 = top row, col 0 → section 0.
    expect(resolveLiveCommand({ type: 'clip-pad', index: 32, row: 4, col: 0, pressed: true, velocity: 100 }, M)).toEqual({
      type: 'jump-section',
      index: 0,
    })
    // Pads 8/9 are Custom 1/2; pad 10 is the first section on that row.
    expect(resolveLiveCommand({ type: 'clip-pad', index: 10, row: 1, col: 2, pressed: true, velocity: 100 }, M)).toEqual({
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
    for (let s = 0; s < SECTION_PAD_COUNT; s++) expect(padToSection(sectionToPad(s)!)).toBe(s)
  })
  it('all ten live-slot pads + out of range are not sections', () => {
    expect(padToSection(0)).toBeNull()
    expect(padToSection(7)).toBeNull()
    expect(padToSection(8)).toBeNull()
    expect(padToSection(9)).toBeNull()
    expect(padToSection(40)).toBeNull()
  })

  it('maps row 4 pads 1/2 to Custom 1/2 and leaves the rest for sections', () => {
    expect(padToLiveSlot(8)).toBe(8)
    expect(padToLiveSlot(9)).toBe(9)
    expect(padToLiveSlot(10)).toBeNull()
    expect(sectionToPad(24)).toBe(10)
    expect(sectionToPad(SECTION_PAD_COUNT)).toBeNull()
  })
})

describe('bottom-row live lane LEDs', () => {
  it('keeps an absent slot visible as dim red', () => {
    expect(liveLanePadLed(null)).toEqual({ velocity: ABSENT_LANE_VELOCITY, dimmed: true })
  })

  it('distinguishes active, muted, click, and cue lanes', () => {
    expect(liveLanePadLed({ kind: 'stem', on: true })).toEqual({ velocity: STEM_ON_VELOCITY, dimmed: false })
    expect(liveLanePadLed({ kind: 'stem', on: false })).toEqual({ velocity: STEM_ON_VELOCITY, dimmed: true })
    expect(liveLanePadLed({ kind: 'click', on: true })).toEqual({ velocity: CLICK_ON_VELOCITY, dimmed: false })
    expect(liveLanePadLed({ kind: 'cue', on: false })).toEqual({ velocity: CUE_ON_VELOCITY, dimmed: true })
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

describe('one physical press = exactly one command (regression guard)', () => {
  /**
   * "The play button just flips on and off" is the signature of a double-fire:
   * play firing on press AND release pauses what it just started. The APC
   * sends Note On (0x90, velocity 127) on press and Note Off (0x80) — or
   * velocity-0 Note On — on release; only the press may become a command.
   */
  it('a full press/release cycle of Play yields ONE play-pause', () => {
    const press = parseApcKey25Message(new Uint8Array([0x90, APC_PLAY_NOTE, 0x7f]))
    const releaseOff = parseApcKey25Message(new Uint8Array([0x80, APC_PLAY_NOTE, 0x00]))
    const releaseVel0 = parseApcKey25Message(new Uint8Array([0x90, APC_PLAY_NOTE, 0x00]))
    const commands = [press, releaseOff, releaseVel0]
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .map((a) => resolveLiveCommand(a, DEFAULT_LIVE_MAPPING))
      .filter((c) => c !== null)
    expect(commands).toHaveLength(1)
    expect(commands[0]).toEqual({ type: 'play-pause' })
  })
})
