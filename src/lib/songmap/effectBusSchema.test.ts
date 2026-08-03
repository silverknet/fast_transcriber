import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import { parseSongMap } from './parse'
import { validateSongMap } from './validate'
import { serializeSongMap } from './serialize'
import {
  addEffect,
  createEffectBus,
  setEffectBypassed,
  setEffectSettings,
  setHookedUp,
} from './effectBusses'
import type { SongMap } from './types'

/**
 * `normalizeEffectBusses` inside `parseSongMap` is the ONLY migration point for
 * effect busses — `validate.ts` does not inspect them. So the real .smap round
 * trip is what decides whether someone's saved rack survives a reload, and it
 * needs testing at that level rather than only against the helper.
 */

const roundTrip = (sm: SongMap): SongMap => parseSongMap(JSON.stringify(sm))

/** A .smap holding raw (possibly legacy-shaped) bus JSON. */
function withRawBusses(busses: unknown[]): string {
  const sm = createEmptySongMap() as unknown as Record<string, unknown>
  sm.effectBusses = busses
  return JSON.stringify(sm)
}

describe('effect busses — .smap round-trip', () => {
  it('keeps a multi-effect rack, in order, with its routing', () => {
    let bus = createEffectBus([], 'reverb')
    bus = addEffect(bus, 'widener')
    bus = setEffectSettings(bus, bus.chain[1]!.id, { width: 1.75 } as never)
    bus = setHookedUp(bus, 'stem:drums.wav', true)

    const back = roundTrip({ ...createEmptySongMap(), effectBusses: [bus] })
    const out = back.effectBusses![0]!
    expect(out.chain.map((u) => u.kind)).toEqual(['reverb', 'widener'])
    expect((out.chain[1] as { widener?: { width: number } }).widener?.width).toBe(1.75)
    expect(out.sends['stem:drums.wav']).toBeGreaterThan(0)
  })

  it('preserves a reordered rack, since order is audible', () => {
    let bus = addEffect(addEffect(createEffectBus([]), 'widener'), 'reverb')
    const back = roundTrip({ ...createEmptySongMap(), effectBusses: [bus] })
    expect(back.effectBusses![0]!.chain.map((u) => u.kind)).toEqual(['widener', 'reverb'])
  })

  it('keeps a bypassed effect bypassed, with its settings', () => {
    let bus = addEffect(createEffectBus([]), 'delay')
    bus = setEffectSettings(bus, bus.chain[0]!.id, { timeSec: 0.42 } as never)
    bus = { ...bus, chain: [{ ...bus.chain[0]!, bypassed: true }] }
    const out = roundTrip({ ...createEmptySongMap(), effectBusses: [bus] }).effectBusses![0]!
    expect(out.chain[0]!.bypassed).toBe(true)
    expect((out.chain[0] as { delay?: { timeSec: number } }).delay?.timeSec).toBe(0.42)
  })

  it('LEGACY: a saved one-effect bus opens as a one-effect rack, losing nothing', () => {
    const back = parseSongMap(
      withRawBusses([
        {
          id: 'reverb-1',
          kind: 'reverb',
          label: 'Vocal plate',
          level: 0.8,
          muted: true,
          sends: { 'stem:vocals.wav': 0.45 },
          reverb: { sizeSec: 3.2, dampHz: 2800 },
        },
      ]),
    )
    const out = back.effectBusses![0]!
    expect(out.id).toBe('reverb-1') // the engine's bus key — must not change
    expect(out.label).toBe('Vocal plate')
    expect(out.level).toBe(0.8)
    expect(out.muted).toBe(true)
    expect(out.sends).toEqual({ 'stem:vocals.wav': 0.45 })
    expect(out.chain.map((u) => u.kind)).toEqual(['reverb'])
    expect((out.chain[0] as { reverb?: { sizeSec: number } }).reverb?.sizeSec).toBe(3.2)
  })

  it('LEGACY: a mixed old/new file loads both', () => {
    const back = parseSongMap(
      withRawBusses([
        { id: 'delay-1', kind: 'delay', label: 'Echo', level: 1, sends: {} },
        { id: 'bus-2', label: 'Rack', level: 1, sends: {}, chain: [{ id: 'r-1', kind: 'reverb' }] },
      ]),
    )
    expect(back.effectBusses!.map((b) => b.chain.map((u) => u.kind))).toEqual([['delay'], ['reverb']])
  })

  it('writes a legacy mirror, so an older build degrades instead of flattening the rack', () => {
    // `collabMerge` classifies `effectBusses` as a 'safe' whole-field
    // last-write-wins with NO prompt. A build that predates chains reads `kind`
    // and ignores `chain`; with no `kind` it falls back to a default reverb, and
    // if that user saves, every collaborator's rack is silently replaced. The
    // mirror means such a build sees the FIRST effect instead of a stray default.
    let bus = addEffect(createEffectBus([], 'delay'), 'widener')
    bus = setEffectSettings(bus, bus.chain[0]!.id, { timeSec: 0.4 } as never)
    const written = JSON.parse(serializeSongMap({ ...createEmptySongMap(), effectBusses: [bus] }))
    const raw = written.effectBusses[0]
    expect(raw.kind).toBe('delay') // the first effect, not a default
    expect(raw.delay.timeSec).toBe(0.4)
    expect(raw.chain).toHaveLength(2) // …and the real chain is still there
  })

  it('the mirror never wins on read — the chain is the truth', () => {
    let bus = addEffect(createEffectBus([], 'delay'), 'widener')
    const written = serializeSongMap({ ...createEmptySongMap(), effectBusses: [bus] })
    const back = parseSongMap(written).effectBusses![0]!
    expect(back.chain.map((u) => u.kind)).toEqual(['delay', 'widener'])
    expect((back as unknown as { kind?: string }).kind).toBeUndefined()
  })

  it('mirrors the first NON-bypassed effect, which is what an old build would play', () => {
    let bus = addEffect(createEffectBus([], 'reverb'), 'delay')
    bus = setEffectBypassed(bus, bus.chain[0]!.id, true)
    const raw = JSON.parse(serializeSongMap({ ...createEmptySongMap(), effectBusses: [bus] }))
      .effectBusses[0]
    expect(raw.kind).toBe('delay')
  })

  it('an empty rack gets no mirror rather than an invented effect', () => {
    const raw = JSON.parse(
      serializeSongMap({ ...createEmptySongMap(), effectBusses: [createEffectBus([])] }),
    ).effectBusses[0]
    expect(raw.kind).toBeUndefined()
  })

  it('a round-tripped map still validates', () => {
    let bus = addEffect(createEffectBus([], 'reverb'), 'widener')
    bus = setHookedUp(bus, 'stem:bass.wav', true)
    expect(validateSongMap(roundTrip({ ...createEmptySongMap(), effectBusses: [bus] })).ok).toBe(true)
  })

  it('re-saving a migrated file is stable — no drift on the second open', () => {
    const once = parseSongMap(
      withRawBusses([
        { id: 'widener-1', kind: 'widener', label: 'Wide', level: 1, sends: { a: 0.3 } },
      ]),
    )
    const twice = roundTrip(once)
    expect(twice.effectBusses).toEqual(once.effectBusses)
  })
})
