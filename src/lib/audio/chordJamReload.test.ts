/**
 * `reloadFromStorage` — the guard against the two implementations silently
 * overwriting each other.
 *
 * The Chords tab keeps its own copy of these knobs and writes the SAME
 * localStorage keys. This singleton read them once at import, so a tab edit
 * never reached it, and `syncSettings` then wrote the stale values back over
 * the edit. Mounting the mixer therefore reverted whatever you had just set.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `browser` is false in Node, which short-circuits every reader — so the
// storage path can only be exercised with both stubbed.
vi.mock('$app/environment', () => ({ browser: true }))

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})

async function jam() {
  return (await import('./chordJam.svelte')).chordJam
}

beforeEach(() => store.clear())

describe('reloadFromStorage', () => {
  it('picks up a value written by the other surface', async () => {
    const j = await jam()
    j.keysVolume = 0.5
    // Stand in for the Chords tab writing its own copy.
    store.set('barbro:hearChordsVol', '0.85')
    j.reloadFromStorage()
    expect(j.keysVolume).toBeCloseTo(0.85, 5)
  })

  it('picks up the arp knobs the lane depends on', async () => {
    const j = await jam()
    store.set('barbro:chordArpOctaves', '3')
    store.set('barbro:chordArpSwing', '0.4')
    store.set('barbro:chordArpDir', 'down')
    store.set('barbro:chordArpRate', '1/16')
    j.reloadFromStorage()
    expect(j.arpOctaves).toBe(3)
    expect(j.arpSwing).toBeCloseTo(0.4, 5)
    expect(j.arpDirection).toBe('down')
    expect(j.arpRate).toBe('1/16')
  })

  it('an empty store restores DEFAULTS, never zeros', async () => {
    // The silent-lane bug: a fresh device must not end up with volume 0.
    const j = await jam()
    j.keysVolume = 0.9
    j.reloadFromStorage()
    expect(j.keysVolume).toBe(0.5)
    expect(j.arpOctave).toBe(1)
    expect(j.arpVolume).toBeGreaterThan(0)
  })

  it('a stored zero volume is honoured', async () => {
    const j = await jam()
    store.set('barbro:chordArpVol', '0')
    j.reloadFromStorage()
    expect(j.arpVolume).toBe(0)
  })

  it('the keys patch follows the stored instrument name', async () => {
    const j = await jam()
    store.set('barbro:hearChordsInstr', 'Organ')
    j.reloadFromStorage()
    expect(j.keysInstrument).toBe('Organ')
    // Without the patch following, the lane keeps the previous sound.
    expect(j.keysPatch.name).toBe('Organ')
  })

  it('junk in storage falls back rather than corrupting the voice', async () => {
    const j = await jam()
    store.set('barbro:hearChordsPatch', '{broken')
    store.set('barbro:chordArpDir', 'sideways')
    j.reloadFromStorage()
    expect(j.keysPatch.env).toBeTruthy()
    expect(j.arpDirection).toBe('up')
  })

  it('round-trips through syncSettings without drift', async () => {
    const j = await jam()
    j.arpOctaves = 4
    j.arpSwing = 0.25
    j.keysVolume = 0.7
    j.syncSettings()
    j.arpOctaves = 1
    j.arpSwing = 0
    j.keysVolume = 0.1
    j.reloadFromStorage()
    expect(j.arpOctaves).toBe(4)
    expect(j.arpSwing).toBeCloseTo(0.25, 5)
    expect(j.keysVolume).toBeCloseTo(0.7, 5)
  })
})
