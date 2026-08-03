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
 * Lane keys that position themselves on the mix timeline — either by baking
 * the preamble into a rendered WAV, or (MIDI lanes) by adding it when they
 * schedule. Scraped from the source so the test tracks the real lane list.
 *
 * Both markers matter: when the drum machine moved from a WAV render to a live
 * instrument it stopped matching the first pattern, and without the second the
 * guard would have gone on passing while silently covering one lane fewer.
 */
const GENERATOR_MARKERS = [
  /render[A-Za-z]*WavBlob\(/, // offline WAV lanes
  /^\s*instrument:/m, // live MIDI lanes
  // Direct-buffer lanes (the click): synthesized straight into an AudioBuffer
  // at the engine's rate — no WAV, no decode — with the preamble baked into the
  // samples exactly as the WAV path bakes it. See `renderClickTrackData`.
  /^\s*bufferLoader:/m,
]

function generatedLaneKeysInMixerView(): string[] {
  const src = readFileSync(MIXER_VIEW, 'utf8')
  // Each chunk runs from one `plan.push({` to the next, so a lane's body can
  // never bleed into its neighbour's.
  const chunks = src.split('plan.push({').slice(1)
  const keys: string[] = []
  for (const chunk of chunks) {
    const key = /^\s*key:\s*[`']([^`']+)[`']/.exec(chunk)?.[1]
    if (!key) continue
    if (GENERATOR_MARKERS.some((m) => m.test(chunk))) keys.push(key)
  }
  return keys
}

describe('lane alignment', () => {
  it('every BarBro-rendered lane declares its baked-in preamble', () => {
    const generated = generatedLaneKeysInMixerView()
    // Naming the lanes explicitly, rather than just counting them, is what
    // makes a lane silently dropping out of the scrape a failure.
    expect(generated).toEqual(
      expect.arrayContaining([
        'click',
        'drums-gen',
        'drum-machine',
        'bass-gen',
        'bass-machine',
        'chord-machine',
        'arp-machine',
      ]),
    )
    for (const key of generated) {
      expect(laneHasPrebakedPreamble(key), `lane '${key}' must be in PREBAKED_PREAMBLE_LANE_KEYS`).toBe(
        true,
      )
    }
  })

  it('includes the drum machine — now a MIDI lane, same preamble either way', () => {
    // It moved from a baked WAV to a live instrument; the property that its
    // own time base already contains the preamble is unchanged, so it must
    // still be exempt from `computePrepend`.
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
