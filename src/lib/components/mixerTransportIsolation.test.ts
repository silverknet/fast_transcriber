/**
 * Overview/live mixer owns its own audio clock — and asks for the transpose
 * rather than knowing it.
 *
 * Two failures to guard against, in opposite directions:
 *
 * 1. MIRRORING. If MixerView reads the edit route's `transport` singleton, a
 *    stale personal varispeed/tempo-hold makes the mixer play slow or fast, or
 *    inserts a pitch-shift worklet, when the mixer never asked for it. That
 *    singleton is a live object owned by another surface.
 *
 * 2. NOT TRANSPOSING AT ALL. Removing the mirroring by deleting the mixer's
 *    `setPlaybackRate` outright is the opposite bug, and it is the one that
 *    shipped: transposing did nothing in Overview, silently, on the surface most
 *    songs are actually played from.
 *
 * The behaviour itself is covered by `mixerTransposeRuntime.browser.test.ts`,
 * which mounts the component and watches the engine. What is left here is the
 * one thing only source can answer: that the mixer does not reach for another
 * surface's state.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const MIXER_VIEW = new URL('./MixerView.svelte', import.meta.url)
const src = () => readFileSync(MIXER_VIEW, 'utf8')

describe('MixerView transport isolation', () => {
  it('does not mirror the edit transport singleton', () => {
    const s = src()
    expect(s).not.toContain("from '$lib/audio/transport.svelte'")
    expect(s).not.toContain('transport.transposeRate')
    expect(s).not.toContain('transport.residualShiftSemitones')
    expect(s).not.toContain('transport.tempoHold')
  })

  it('DOES apply a transpose to its own engine', () => {
    // Without this, transposing is silently inaudible in Overview.
    expect(src()).toContain('setPlaybackRate')
  })

  it('asks the transpose store rather than deriving the offset itself', () => {
    expect(src()).toContain('transposeSettings')
  })
})
