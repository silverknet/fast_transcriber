import { describe, expect, it } from 'vitest'
import {
  createEffectBus,
  forgetLane,
  isHookedUp,
  normalizeEffectBusses,
  renameBus,
  setHookedUp,
  setSendAmount,
  type EffectBus,
} from './effectBusses'

const fresh = () => createEffectBus([], 'reverb')

describe('effect busses', () => {
  it('a new bus exists with nothing hooked up', () => {
    const b = fresh()
    expect(b.kind).toBe('reverb')
    expect(b.label).toBe('Reverb')
    expect(b.sends).toEqual({})
  })

  it('names repeats of the same kind so two reverbs are tellable apart', () => {
    const first = createEffectBus([], 'reverb')
    const second = createEffectBus([first], 'reverb')
    expect(second.label).toBe('Reverb 2')
    expect(second.id).not.toBe(first.id)
  })

  it('ids are stable and RNG-free, so collab merges reproduce', () => {
    const a = createEffectBus([], 'delay')
    const b = createEffectBus([], 'delay')
    expect(a.id).toBe(b.id)
  })

  it('hooking a channel up gives it an audible starting amount', () => {
    const b = setHookedUp(fresh(), 'stem:drums', true)
    expect(isHookedUp(b, 'stem:drums')).toBe(true)
    expect(b.sends['stem:drums']).toBeGreaterThan(0)
  })

  it('NOT hooked up and hooked up at zero are different states', () => {
    // This is the whole reason `sends` is sparse: a channel turned down to 0
    // is still routed, and must not silently disappear from the bus.
    const hooked = setHookedUp(fresh(), 'stem:bass', true)
    const zeroed = setSendAmount(hooked, 'stem:bass', 0)
    expect(isHookedUp(zeroed, 'stem:bass')).toBe(true)
    expect(zeroed.sends['stem:bass']).toBe(0)

    const unhooked = setHookedUp(zeroed, 'stem:bass', false)
    expect(isHookedUp(unhooked, 'stem:bass')).toBe(false)
    expect(unhooked.sends['stem:bass']).toBeUndefined()
  })

  it('setting an amount on a channel that is not hooked up does nothing', () => {
    const b = setSendAmount(fresh(), 'ghost', 1)
    expect(isHookedUp(b, 'ghost')).toBe(false)
  })

  it('clamps send amounts', () => {
    const b = setSendAmount(setHookedUp(fresh(), 'x', true), 'x', 99)
    expect(b.sends.x).toBe(1.5)
  })

  it('hooking up one channel leaves the others alone', () => {
    let b = setHookedUp(fresh(), 'a', true)
    b = setHookedUp(b, 'b', true)
    b = setSendAmount(b, 'a', 0.9)
    expect(b.sends).toEqual({ a: 0.9, b: b.sends.b })
    expect(isHookedUp(b, 'b')).toBe(true)
  })

  it('a removed track is forgotten by every bus', () => {
    const r = setHookedUp(createEffectBus([], 'reverb'), 'stem:gone', true)
    const d = setHookedUp(createEffectBus([r], 'delay'), 'stem:gone', true)
    const after = forgetLane([r, d], 'stem:gone')
    expect(after.every((b) => !isHookedUp(b, 'stem:gone'))).toBe(true)
  })

  it('renaming ignores blank input rather than leaving an unnamed bus', () => {
    const b = fresh()
    expect(renameBus(b, '   ').label).toBe(b.label)
    expect(renameBus(b, ' Vocal plate ').label).toBe('Vocal plate')
  })

  it('normalizes stored busses, repairing rather than discarding', () => {
    const out = normalizeEffectBusses([
      { id: 'reverb-1', kind: 'reverb', label: '', level: 99, sends: { a: 5, b: 'nope' } },
      { kind: 'delay' }, // no id — unusable
      'garbage',
    ]) as EffectBus[]
    expect(out.length).toBe(1)
    expect(out[0]!.label).toBeTruthy()
    expect(out[0]!.level).toBe(1.5)
    expect(out[0]!.sends).toEqual({ a: 1.5 }) // 'b' dropped, 'a' clamped
  })

  it('an empty or absent list normalizes to undefined, not an empty array', () => {
    expect(normalizeEffectBusses([])).toBeUndefined()
    expect(normalizeEffectBusses(undefined)).toBeUndefined()
  })

  it('creates a stereo (widener) bus alongside the other kinds', () => {
    const b = createEffectBus([], 'widener')
    expect(b.kind).toBe('widener')
    expect(b.id).toBe('widener-1')
    expect(b.sends).toEqual({})
  })

  it('keeps widener settings through normalize, and only on a widener bus', () => {
    const out = normalizeEffectBusses([
      {
        id: 'widener-1',
        kind: 'widener',
        label: 'Stereo',
        level: 1,
        sends: {},
        widener: { rateHz: 0.5, depth: 0.4, monoBelowHz: 140, width: 1.3 },
      },
      // Settings that don't match the kind are dropped, not smuggled through.
      { id: 'reverb-9', kind: 'reverb', label: 'R', level: 1, sends: {}, widener: { width: 2 } },
    ]) as EffectBus[]
    expect(out[0]!.widener?.width).toBe(1.3)
    expect(out[1]!.widener).toBeUndefined()
  })

  it('an unknown kind falls back to reverb rather than breaking the song', () => {
    const out = normalizeEffectBusses([
      { id: 'x-1', kind: 'flanger', label: 'X', level: 1, sends: {} },
    ]) as EffectBus[]
    expect(out[0]!.kind).toBe('reverb')
  })
})
