/**
 * Guards the lane-alignment list against the bug it exists to prevent: a
 * BarBro-rendered lane that forgets to declare its baked-in preamble gets
 * silence prepended twice and plays at a constant offset against the song.
 *
 * The list is derived from MixerView's own lane keys, so adding a generated
 * lane there without listing it here fails rather than sounding wrong.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PREBAKED_PREAMBLE_LANE_KEYS, laneHasPrebakedPreamble } from './laneAlignment'

const MIXER_VIEW = new URL('../components/MixerView.svelte', import.meta.url)

/**
 * Lane keys whose loader renders audio through one of the `render*WavBlob`
 * helpers — those bake `titleCuePreludeSec + prependSec` into the buffer.
 * Scraped from the source so the test tracks the real lane list.
 */
function generatedLaneKeysInMixerView(): string[] {
  const src = readFileSync(MIXER_VIEW, 'utf8')
  // Each chunk runs from one `plan.push({` to the next, so a lane's body can
  // never bleed into its neighbour's.
  const chunks = src.split('plan.push({').slice(1)
  const keys: string[] = []
  for (const chunk of chunks) {
    const key = /^\s*key:\s*[`']([^`']+)[`']/.exec(chunk)?.[1]
    if (!key) continue
    if (/render[A-Za-z]*WavBlob\(/.test(chunk)) keys.push(key)
  }
  return keys
}

describe('lane alignment', () => {
  it('every BarBro-rendered lane declares its baked-in preamble', () => {
    const generated = generatedLaneKeysInMixerView()
    // Sanity: the scrape must actually find lanes, or the test proves nothing.
    expect(generated.length).toBeGreaterThan(0)
    for (const key of generated) {
      expect(laneHasPrebakedPreamble(key), `lane '${key}' must be in PREBAKED_PREAMBLE_LANE_KEYS`).toBe(
        true,
      )
    }
  })

  it('includes the drum machine — it renders with the same preamble as the band', () => {
    expect(laneHasPrebakedPreamble('drum-machine')).toBe(true)
  })

  it('does not claim recorded audio has a preamble', () => {
    // The original mix and stems are files on disk; they need silence prepended.
    expect(laneHasPrebakedPreamble('original')).toBe(false)
    expect(laneHasPrebakedPreamble('stem:drums')).toBe(false)
  })

  it('lists only keys, never labels', () => {
    for (const k of PREBAKED_PREAMBLE_LANE_KEYS) expect(k).not.toMatch(/\s/)
  })
})
