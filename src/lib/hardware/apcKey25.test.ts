import { describe, expect, it } from 'vitest'
import {
  createApcKnobEngine,
  APC_CLIP_PAD_COUNT,
  APC_RGB_LED_SOLID_100_STATUS,
  APC_PLAY_NOTE,
  APC_RECORD_NOTE,
  APC_SHIFT_NOTE,
  APC_STOP_ALL_CLIPS_NOTE,
  adjustApcLaneVolume,
  apcClipPadLedMessage,
  apcSceneLaunchLedMessage,
  apcSingleLedMessage,
  apcTrackButtonLedMessage,
  isApcKey25ControlPortName,
  isApcKey25KeysPortName,
  isLikelyApcKey25Mk2Name,
  midiBytesHex,
  parseApcKey25Message,
  relativeCcDelta,
} from './apcKey25'

describe('parseApcKey25Message', () => {
  it('parses transport and track buttons', () => {
    expect(parseApcKey25Message([0x90, APC_PLAY_NOTE, 0x7f])).toEqual({ type: 'play', pressed: true })
    expect(parseApcKey25Message([0x80, APC_PLAY_NOTE, 0x00])).toEqual({ type: 'play', pressed: false })
    expect(parseApcKey25Message([0x90, APC_STOP_ALL_CLIPS_NOTE, 0x7f])).toEqual({
      type: 'stop-all-clips',
      pressed: true,
    })
    expect(parseApcKey25Message([0x90, 0x42, 0x7f])).toEqual({
      type: 'track-button',
      index: 2,
      pressed: true,
    })
    expect(parseApcKey25Message([0x90, APC_RECORD_NOTE, 0x7f])).toEqual({
      type: 'record',
      pressed: true,
    })
    expect(parseApcKey25Message([0x90, APC_SHIFT_NOTE, 0x7f])).toEqual({
      type: 'shift',
      pressed: true,
    })
    expect(parseApcKey25Message([0x80, APC_SHIFT_NOTE, 0x00])).toEqual({
      type: 'shift',
      pressed: false,
    })
  })

  it('does not mistake echoed single-LED commands for button presses', () => {
    expect(parseApcKey25Message([0x90, APC_PLAY_NOTE, 0x01])).toBeNull()
    expect(parseApcKey25Message([0x90, APC_PLAY_NOTE, 0x02])).toBeNull()
    expect(parseApcKey25Message([0x90, APC_STOP_ALL_CLIPS_NOTE, 0x01])).toBeNull()
    expect(parseApcKey25Message([0x90, APC_RECORD_NOTE, 0x02])).toBeNull()
    expect(parseApcKey25Message([0x90, 0x42, 0x01])).toBeNull()
    expect(parseApcKey25Message([0x90, 0x54, 0x02])).toBeNull()
  })

  it('parses scene buttons and clip pads', () => {
    expect(parseApcKey25Message([0x90, 0x54, 0x7f])).toEqual({
      type: 'scene-launch',
      index: 2,
      pressed: true,
    })
    expect(parseApcKey25Message([0x90, 0x11, 0x55])).toEqual({
      type: 'clip-pad',
      index: 17,
      row: 2,
      col: 1,
      pressed: true,
      velocity: 0x55,
    })
  })

  it('parses relative knobs', () => {
    expect(parseApcKey25Message([0xb0, 0x30, 0x01])).toEqual({
      type: 'knob',
      index: 0,
      delta: 1,
      rawValue: 1,
    })
    expect(parseApcKey25Message([0xb0, 0x37, 0x7f])).toEqual({
      type: 'knob',
      index: 7,
      delta: -1,
      rawValue: 127,
    })
  })
})

describe('APC helpers', () => {
  it('decodes common two-complement relative CC values', () => {
    expect(relativeCcDelta(0)).toBe(0)
    expect(relativeCcDelta(1)).toBe(1)
    expect(relativeCcDelta(10)).toBe(10)
    expect(relativeCcDelta(64)).toBe(0)
    expect(relativeCcDelta(65)).toBe(-63)
    expect(relativeCcDelta(127)).toBe(-1)
  })

  it('adjusts lane volume with clamping', () => {
    expect(adjustApcLaneVolume(1, 1)).toBeCloseTo(1.025)
    expect(adjustApcLaneVolume(1, -1)).toBeCloseTo(0.975)
    expect(adjustApcLaneVolume(1.49, 10)).toBe(1.5)
    expect(adjustApcLaneVolume(0.01, -10)).toBe(0)
  })

  it('builds single LED messages', () => {
    expect(apcSingleLedMessage(APC_PLAY_NOTE, 'on')).toEqual([0x90, APC_PLAY_NOTE, 0x01])
    expect(apcSingleLedMessage(APC_PLAY_NOTE, 'blink')).toEqual([0x90, APC_PLAY_NOTE, 0x02])
    expect(apcSingleLedMessage(APC_PLAY_NOTE, 'off')).toEqual([0x90, APC_PLAY_NOTE, 0x00])
    expect(apcTrackButtonLedMessage(3, 'on')).toEqual([0x90, 0x43, 0x01])
    expect(apcSceneLaunchLedMessage(1, 'blink')).toEqual([0x90, 0x53, 0x02])
  })

  it('builds RGB clip-pad LED messages', () => {
    expect(apcClipPadLedMessage(0, 'green')).toEqual([APC_RGB_LED_SOLID_100_STATUS, 0x00, 0x15])
    expect(apcClipPadLedMessage(9, 'red')).toEqual([APC_RGB_LED_SOLID_100_STATUS, 0x09, 0x05])
    expect(apcClipPadLedMessage(APC_CLIP_PAD_COUNT - 1, 'off')).toEqual([
      APC_RGB_LED_SOLID_100_STATUS,
      0x27,
      0x00,
    ])
    expect(() => apcClipPadLedMessage(APC_CLIP_PAD_COUNT, 'green')).toThrow('0..39')
  })

  it('matches APC Key 25 names and formats MIDI bytes', () => {
    expect(isLikelyApcKey25Mk2Name('APC Key 25 mk2')).toBe(true)
    expect(isLikelyApcKey25Mk2Name('Akai APC KEY25 MIDI')).toBe(true)
    expect(isLikelyApcKey25Mk2Name('Launchkey')).toBe(false)
    expect(midiBytesHex([0x90, 0x5b, 0x7f])).toBe('90 5B 7F')
  })
})

describe('createApcKnobEngine', () => {
  it('locks absolute mode on a mid-range value and uses soft pickup', () => {
    const eng = createApcKnobEngine()
    expect(eng.mode).toBe('unknown')
    // Knob physically at raw 100 (≈1.18) while the lane sits at 0.5 — the
    // first message must be swallowed (no jump), and mode locks to absolute.
    expect(eng.next(0, 100, 0.5)).toBeNull()
    expect(eng.mode).toBe('absolute')
    // Still far away → still swallowed.
    expect(eng.next(0, 90, 0.5)).toBeNull()
    // Sweeping down CROSSES the lane value (0.5 ≈ raw 42) → picked up.
    expect(eng.next(0, 40, 0.5)).not.toBeNull()
    // From then on the knob tracks directly.
    expect(eng.next(0, 50, 0.47)).toBeCloseTo((50 / 127) * 1.5, 5)
  })

  it('picks up immediately when the knob is already near the lane value', () => {
    const eng = createApcKnobEngine()
    // raw 42 → target ≈ 0.496; lane at 0.5 → within tolerance → moves.
    expect(eng.next(2, 42, 0.5)).toBeCloseTo((42 / 127) * 1.5, 5)
  })

  it('treats ambiguous small values as bounded relative deltas', () => {
    const eng = createApcKnobEngine()
    // Relative-encoded +1 / −1 (raw 1 / 127) — small safe steps.
    const up = eng.next(0, 1, 1.0)
    expect(up).toBeCloseTo(1.025, 5)
    const down = eng.next(0, 127, 1.0)
    expect(down).toBeCloseTo(0.975, 5)
    expect(eng.mode).toBe('unknown')
    // raw 60 is unambiguously mid-range → this LOCKS absolute mode. Soft pickup
    // is not engaged (the knob's ~0.71 target is far from the lane at 1.0, and
    // there's no prior absolute raw to have crossed), so the message is
    // swallowed rather than yanking the fader. (Was a dead `.toBeNull` with no
    // call — it asserted nothing.)
    expect(eng.next(0, 60, 1.0)).toBeNull()
    expect(eng.mode).toBe('absolute')
  })

  it('engages pickup by CROSSING the lane value even when never within tolerance', () => {
    // Isolate the `crossed` branch from the `near` branch: both raw values sit
    // well outside the ±0.08 window, so the only way pickup can engage is by
    // the knob sweeping ACROSS the lane's current value between two messages.
    const eng = createApcKnobEngine()
    // Lane at 0.5 → currentRaw ≈ 42. raw 20 (≈0.24) is below and not near →
    // swallowed, but records the position.
    expect(eng.next(0, 20, 0.5)).toBeNull()
    expect(eng.mode).toBe('absolute')
    // raw 70 (≈0.83) is above and still not near (|0.83−0.5| ≫ 0.08), but it
    // crossed 42 coming from 20 → pickup engages and the lane jumps to target.
    expect(eng.next(0, 70, 0.5)).toBeCloseTo((70 / 127) * 1.5, 5)
  })

  it('dropPickup forces a fresh pickup after bank switches', () => {
    const eng = createApcKnobEngine()
    expect(eng.next(0, 60, 0.7)).not.toBeNull() // near 0.708 → picked up
    eng.dropPickup()
    // Different lane now under the knob, far away → swallowed again.
    expect(eng.next(0, 60, 0.1)).toBeNull()
  })
})

describe('isApcKey25ControlPortName', () => {
  it('accepts the CONTROL port but rejects the piano keybed and other devices', () => {
    expect(isApcKey25ControlPortName('APC Key 25 mk2 Control')).toBe(true)
    expect(isApcKey25ControlPortName('APC Key 25 mk2 Keys')).toBe(false)
    // Single-port setups (no "Keys"/"Control" split) still count as control.
    expect(isApcKey25ControlPortName('APC Key 25')).toBe(true)
    expect(isApcKey25ControlPortName('Akai MPK mini')).toBe(false)
    expect(isApcKey25ControlPortName('Some Piano Keys')).toBe(false)
    expect(isApcKey25ControlPortName(null)).toBe(false)
  })
})

describe('isApcKey25KeysPortName', () => {
  it('matches only the APC keybed port', () => {
    expect(isApcKey25KeysPortName('APC Key 25 mk2 Keys')).toBe(true)
    expect(isApcKey25KeysPortName('APC Key 25 mk2 Control')).toBe(false)
    expect(isApcKey25KeysPortName('APC Key 25')).toBe(false)
    expect(isApcKey25KeysPortName('Akai MPK mini')).toBe(false)
    expect(isApcKey25KeysPortName(null)).toBe(false)
  })
})
