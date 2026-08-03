import { describe, expect, it } from 'vitest'
import {
  activeChain,
  addEffect,
  chainShapeKey,
  createEffectBus,
  forgetLane,
  isHookedUp,
  moveEffect,
  normalizeEffectBus,
  normalizeEffectBusses,
  removeEffect,
  renameBus,
  setEffectBypassed,
  setEffectSettings,
  setHookedUp,
  setSendAmount,
  type EffectBus,
} from './effectBusses'

const fresh = () => createEffectBus([], 'reverb')

describe('effect busses', () => {
  it('a new bus exists with one effect and nothing hooked up', () => {
    const b = fresh()
    expect(b.chain.map((u) => u.kind)).toEqual(['reverb'])
    expect(b.sends).toEqual({})
    expect(b.level).toBe(1)
  })

  it('can be created empty, as a rack to fill later', () => {
    const b = createEffectBus([])
    expect(b.chain).toEqual([])
    expect(b.label).toBe('Bus')
  })

  it('names repeats so two reverbs are tellable apart', () => {
    const a = createEffectBus([], 'reverb')
    const b = createEffectBus([a], 'reverb')
    expect(b.label).not.toBe(a.label)
    expect(b.id).not.toBe(a.id)
  })

  it('ids are stable and RNG-free, so collab merges reproduce', () => {
    expect(createEffectBus([]).id).toBe('bus-1')
    expect(createEffectBus([createEffectBus([])]).id).toBe('bus-2')
  })

  it('a new bus never collides with a legacy id', () => {
    const legacy = normalizeEffectBus({ id: 'bus-1', kind: 'delay', level: 1, sends: {} })!
    expect(createEffectBus([legacy]).id).toBe('bus-2')
  })

  it('hooking a channel up gives it an audible starting amount', () => {
    const b = setHookedUp(fresh(), 'stem:drums.wav', true)
    expect(isHookedUp(b, 'stem:drums.wav')).toBe(true)
    expect(b.sends['stem:drums.wav']).toBeGreaterThan(0)
  })

  it('NOT hooked up and hooked up at zero are different states', () => {
    const b = setSendAmount(setHookedUp(fresh(), 'a', true), 'a', 0)
    expect(isHookedUp(b, 'a')).toBe(true)
    expect(b.sends.a).toBe(0)
    expect(isHookedUp(setHookedUp(b, 'a', false), 'a')).toBe(false)
  })

  it('setting an amount on a channel that is not hooked up does nothing', () => {
    const b = fresh()
    expect(setSendAmount(b, 'ghost', 1)).toBe(b)
  })

  it('clamps send amounts', () => {
    const b = setHookedUp(fresh(), 'a', true)
    expect(setSendAmount(b, 'a', 99).sends.a).toBe(1.5)
    expect(setSendAmount(b, 'a', -5).sends.a).toBe(0)
  })

  it('a removed track is forgotten by every bus', () => {
    const a = setHookedUp(fresh(), 'gone', true)
    const b = setHookedUp(createEffectBus([a], 'delay'), 'gone', true)
    const out = forgetLane([a, b], 'gone')
    expect(out.every((x) => !isHookedUp(x, 'gone'))).toBe(true)
  })

  it('renaming ignores blank input rather than leaving an unnamed bus', () => {
    const b = fresh()
    expect(renameBus(b, '   ')).toBe(b)
    expect(renameBus(b, ' Vocal plate ').label).toBe('Vocal plate')
  })

  it('an empty or absent list normalizes to undefined, not an empty array', () => {
    expect(normalizeEffectBusses([])).toBeUndefined()
    expect(normalizeEffectBusses(undefined)).toBeUndefined()
  })
})

describe('the effect chain', () => {
  it('holds several effects in the order they were added', () => {
    const b = addEffect(addEffect(createEffectBus([]), 'reverb'), 'widener')
    expect(b.chain.map((u) => u.kind)).toEqual(['reverb', 'widener'])
  })

  it('gives every effect its own id, even two of the same kind', () => {
    const b = addEffect(addEffect(createEffectBus([]), 'delay'), 'delay')
    expect(b.chain[0]!.id).not.toBe(b.chain[1]!.id)
  })

  it('removes by id, leaving the rest in order', () => {
    let b = createEffectBus([])
    b = addEffect(addEffect(addEffect(b, 'reverb'), 'delay'), 'widener')
    const out = removeEffect(b, b.chain[1]!.id)
    expect(out.chain.map((u) => u.kind)).toEqual(['reverb', 'widener'])
  })

  it('removing something that is not there changes nothing', () => {
    const b = fresh()
    expect(removeEffect(b, 'nope')).toBe(b)
  })

  it('reorders — and order is what makes the sound different', () => {
    let b = createEffectBus([])
    b = addEffect(addEffect(b, 'reverb'), 'widener')
    const moved = moveEffect(b, b.chain[1]!.id, -1)
    expect(moved.chain.map((u) => u.kind)).toEqual(['widener', 'reverb'])
  })

  it('clamps a move at both ends instead of wrapping around', () => {
    let b = createEffectBus([])
    b = addEffect(addEffect(b, 'reverb'), 'widener')
    expect(moveEffect(b, b.chain[0]!.id, -1)).toBe(b) // already first
    expect(moveEffect(b, b.chain[1]!.id, +1)).toBe(b) // already last
    expect(moveEffect(b, b.chain[0]!.id, +99).chain.map((u) => u.kind)).toEqual([
      'widener',
      'reverb',
    ])
  })

  it('bypass keeps the effect and its settings, but takes it out of the audio', () => {
    let b = addEffect(createEffectBus([]), 'reverb')
    const id = b.chain[0]!.id
    b = setEffectSettings(b, id, { sizeSec: 4, dampHz: 3000 } as never)
    b = setEffectBypassed(b, id, true)
    expect(b.chain).toHaveLength(1)
    expect((b.chain[0] as { reverb?: { sizeSec: number } }).reverb?.sizeSec).toBe(4)
    expect(activeChain(b)).toHaveLength(0)
    // …and comes back exactly as it was.
    expect(activeChain(setEffectBypassed(b, id, false))).toHaveLength(1)
  })

  it('settings land on the right effect only', () => {
    let b = createEffectBus([])
    b = addEffect(addEffect(b, 'reverb'), 'delay')
    b = setEffectSettings(b, b.chain[1]!.id, { timeSec: 0.5 } as never)
    expect((b.chain[0] as { delay?: unknown }).delay).toBeUndefined()
    expect((b.chain[1] as { delay?: { timeSec: number } }).delay?.timeSec).toBe(0.5)
  })

  it('the shape key tracks the GRAPH, not the settings', () => {
    let b = addEffect(createEffectBus([]), 'reverb')
    const before = chainShapeKey(b)
    // Retuning must NOT look like a shape change — that is what lets the audio
    // layer update in place instead of rebuilding.
    b = setEffectSettings(b, b.chain[0]!.id, { sizeSec: 9 } as never)
    expect(chainShapeKey(b)).toBe(before)
    // Adding, reordering and bypassing all MUST look like a change.
    expect(chainShapeKey(addEffect(b, 'delay'))).not.toBe(before)
    expect(chainShapeKey(setEffectBypassed(b, b.chain[0]!.id, true))).not.toBe(before)
    const two = addEffect(b, 'delay')
    expect(chainShapeKey(moveEffect(two, two.chain[0]!.id, 1))).not.toBe(chainShapeKey(two))
  })
})

describe('reading stored busses', () => {
  it('normalizes stored busses, repairing rather than discarding', () => {
    const out = normalizeEffectBusses([
      { id: 'bus-1', label: '', level: 99, chain: [], sends: { a: 5, b: 'nope' } },
      { chain: [] }, // no id — unusable
      'garbage',
    ]) as EffectBus[]
    expect(out.length).toBe(1)
    expect(out[0]!.label).toBeTruthy()
    expect(out[0]!.level).toBe(1.5)
    expect(out[0]!.sends).toEqual({ a: 1.5 }) // 'b' dropped, 'a' clamped
  })

  it('keeps a multi-effect chain through a round-trip', () => {
    let b = createEffectBus([])
    b = addEffect(addEffect(b, 'reverb'), 'widener')
    b = setEffectSettings(b, b.chain[1]!.id, { width: 1.7 } as never)
    const back = normalizeEffectBus(JSON.parse(JSON.stringify(b)))!
    expect(back.chain.map((u) => u.kind)).toEqual(['reverb', 'widener'])
    expect((back.chain[1] as { widener?: { width: number } }).widener?.width).toBe(1.7)
  })

  it('drops an effect kind this build does not know, keeping the rest', () => {
    const back = normalizeEffectBus({
      id: 'bus-1',
      label: 'B',
      level: 1,
      sends: {},
      chain: [{ id: 'x-1', kind: 'flanger' }, { id: 'reverb-1', kind: 'reverb' }],
    })!
    expect(back.chain.map((u) => u.kind)).toEqual(['reverb'])
  })

  it('settings that do not match their effect are not smuggled through', () => {
    const back = normalizeEffectBus({
      id: 'bus-1',
      label: 'B',
      level: 1,
      sends: {},
      chain: [{ id: 'd-1', kind: 'delay', reverb: { sizeSec: 9 }, delay: { timeSec: 0.2 } }],
    })!
    expect((back.chain[0] as { reverb?: unknown }).reverb).toBeUndefined()
    expect((back.chain[0] as { delay?: { timeSec: number } }).delay?.timeSec).toBe(0.2)
  })

  it('repairs duplicate effect ids rather than letting the graph alias them', () => {
    const back = normalizeEffectBus({
      id: 'bus-1',
      label: 'B',
      level: 1,
      sends: {},
      chain: [{ id: 'same', kind: 'reverb' }, { id: 'same', kind: 'delay' }],
    })!
    expect(back.chain[0]!.id).not.toBe(back.chain[1]!.id)
  })
})

describe('LEGACY one-effect busses still load', () => {
  const legacy = (extra: Record<string, unknown> = {}) => ({
    id: 'reverb-1',
    kind: 'reverb',
    label: 'Vocal plate',
    level: 0.8,
    sends: { 'stem:vocals.wav': 0.4 },
    reverb: { sizeSec: 3.2, dampHz: 2800 },
    ...extra,
  })

  it('becomes a one-effect chain, losing nothing', () => {
    const b = normalizeEffectBus(legacy())!
    expect(b.id).toBe('reverb-1') // id preserved — it is the engine's bus key
    expect(b.label).toBe('Vocal plate')
    expect(b.level).toBe(0.8)
    expect(b.sends).toEqual({ 'stem:vocals.wav': 0.4 })
    expect(b.chain.map((u) => u.kind)).toEqual(['reverb'])
    expect((b.chain[0] as { reverb?: { sizeSec: number } }).reverb?.sizeSec).toBe(3.2)
  })

  it('migrates each legacy kind', () => {
    for (const kind of ['reverb', 'delay', 'widener'] as const) {
      const b = normalizeEffectBus({ id: `${kind}-1`, kind, level: 1, sends: {} })!
      expect(b.chain.map((u) => u.kind)).toEqual([kind])
    }
  })

  it('keeps a muted legacy bus muted', () => {
    expect(normalizeEffectBus(legacy({ muted: true }))!.muted).toBe(true)
  })

  it('a legacy bus with an unknown kind survives as an empty rack, not a lost bus', () => {
    const b = normalizeEffectBus({ id: 'x-1', kind: 'flanger', level: 1, sends: { a: 0.5 } })!
    expect(b.chain).toEqual([])
    expect(b.sends).toEqual({ a: 0.5 }) // the routing the user set is still there
  })

  it('an explicit chain wins over leftover legacy fields', () => {
    const b = normalizeEffectBus(legacy({ chain: [{ id: 'delay-1', kind: 'delay' }] }))!
    expect(b.chain.map((u) => u.kind)).toEqual(['delay'])
  })

  it('migrating is idempotent — re-reading its own output changes nothing', () => {
    const once = normalizeEffectBus(legacy())!
    const twice = normalizeEffectBus(JSON.parse(JSON.stringify(once)))!
    expect(twice).toEqual(once)
  })
})
