/**
 * RUNTIME proof that a personal transpose reaches the mixer's audio clock.
 *
 * Every previous guard for this was a source grep. They confirmed each wire
 * existed and passed happily while transpose did nothing at all, because
 * `/edit` never handed `transposeSemitones` to `<MixerPanel>` — so the mixer
 * fell back to the song's `transpose.baseSemitones` (0). A string search cannot
 * catch a value that is simply never passed.
 *
 * This mounts the real component chain and watches what it does to a real
 * `MixerEngine`. The only question that matters: does the playback rate change?
 *
 * The prop-drilling this used to check is gone: the offset now lives in
 * `transposeSettings`, which every surface reads. The last group below is the
 * one that matters most — the LIVE STAGE mounts the mixer with no transpose
 * props whatsoever, and must still transpose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import MixerPanel from './editor/MixerPanel.svelte'
import MixerView from './MixerView.svelte'
import { MixerEngine } from '$lib/audio/mixerEngine'
import { varispeedRate } from '$lib/audio/varispeed'
import { get } from 'svelte/store'
import { songMap } from '$lib/stores/songMap'
import { project as projectStore } from '$lib/stores/project'
import { transposeSettings } from '$lib/stores/transposeSettings.svelte'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { SongMap } from '$lib/songmap/types'

/** The mixer only renders with a song loaded (`{#if $songMap}`). */
function seedSong(): SongMap {
  const bars = Array.from({ length: 4 }, (_, i) => ({
    id: `bar${i}`,
    index: i,
    startSec: 1 + i * 2,
    endSec: 3 + i * 2,
    meter: { numerator: 4, denominator: 4 },
    beatCount: 4,
    beatIds: [0, 1, 2, 3].map((j) => `b${i}_${j}`),
  }))
  const beats = bars.flatMap((b, i) =>
    [0, 1, 2, 3].map((j) => ({
      id: `b${i}_${j}`,
      barId: b.id,
      indexInBar: j,
      timeSec: 1 + i * 2 + j * 0.5,
    })),
  )
  return {
    ...createEmptySongMap(),
    timeline: { bars, beats },
    audio: { trim: { startSec: 1, endSec: 9 } } as SongMap['audio'],
  }
}

/** Every rate the mixer pushed into its engine, in order. */
let rates: number[] = []
let spy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  songMap.set(seedSong())
  transposeSettings.resetForTest()
  transposeSettings.setVarispeedAudio(false)
  transposeSettings.setTempoHold(0)
  rates = []
  spy = vi
    .spyOn(MixerEngine.prototype, 'setPlaybackRate')
    .mockImplementation(function (this: MixerEngine, r: number) {
      rates.push(r)
    })
})
afterEach(() => spy.mockRestore())

/** Mount and let effects settle. Loading a project fails here; irrelevant. */
async function mount(props: Record<string, unknown>) {
  render(MixerPanel, { keyLabel: 'C', ...props })
  await new Promise((r) => setTimeout(r, 400))
}

const sawRate = (want: number) => rates.some((r) => Math.abs(r - want) < 1e-6)

describe('personal transpose reaches the mixer engine', () => {
  it('-2 semitones slows the engine to the -2 varispeed rate', async () => {
    await mount({ transposeSemitones: -2, varispeedAudio: true, tempoHold: 0 })
    const want = varispeedRate(-2) // ≈ 0.8909
    expect(want).toBeLessThan(1) // sanity: -2 really is a slow-down
    expect(sawRate(want), `engine never got the -2 rate; saw ${JSON.stringify(rates)}`).toBe(true)
  })

  it('+3 semitones speeds it up', async () => {
    await mount({ transposeSemitones: 3, varispeedAudio: true, tempoHold: 0 })
    const want = varispeedRate(3)
    expect(want).toBeGreaterThan(1)
    expect(sawRate(want), `saw ${JSON.stringify(rates)}`).toBe(true)
  })

  it('leaves the engine at unity when the varispeed switch is off', async () => {
    // Transpose is then display-only, which is the documented behaviour.
    await mount({ transposeSemitones: -2, varispeedAudio: false, tempoHold: 0 })
    expect(rates.every((r) => r === 1)).toBe(true)
  })

  it('the artifacts dial at 1 holds the tempo — the rate stays at unity', async () => {
    // tempoHold = 1 means the worklet does all the pitch work.
    await mount({ transposeSemitones: -2, varispeedAudio: true, tempoHold: 1 })
    expect(rates.every((r) => Math.abs(r - 1) < 1e-9)).toBe(true)
  })

  it('the dial half-way lands between unity and full varispeed', async () => {
    await mount({ transposeSemitones: -2, varispeedAudio: true, tempoHold: 0.5 })
    const full = varispeedRate(-2)
    const got = rates.find((r) => r !== 1)
    expect(got, `saw ${JSON.stringify(rates)}`).toBeDefined()
    expect(got!).toBeGreaterThan(full)
    expect(got!).toBeLessThan(1)
  })
})

describe('the LIVE STAGE transposes — it passes no props at all', () => {
  /**
   * `/project/playback` mounts `<MixerView initialPlaybackMode lockPlaybackMode
   * liveMode />`. It has never passed a transpose prop, and the fallback it
   * landed on (`transpose.baseSemitones`) is written nowhere in the app, so it
   * was permanently stuck at concert pitch. Reading the store fixes that by
   * construction; this proves it, using the same no-props mount.
   */
  async function mountLive() {
    render(MixerView, { initialPlaybackMode: true, lockPlaybackMode: true, liveMode: true })
    await new Promise((r) => setTimeout(r, 400))
  }

  it('follows the offset set for this song, with no props', async () => {
    transposeSettings.setVarispeedAudio(true)
    transposeSettings.loadForCurrentSong()
    transposeSettings.setSemitones(-2)
    await mountLive()
    const want = varispeedRate(-2)
    expect(sawRate(want), `live stage never got the -2 rate; saw ${JSON.stringify(rates)}`).toBe(
      true,
    )
  })

  it('stays at unity when the varispeed switch is off', async () => {
    transposeSettings.setVarispeedAudio(false)
    transposeSettings.loadForCurrentSong()
    transposeSettings.setSemitones(-2)
    await mountLive()
    expect(rates.every((r) => r === 1)).toBe(true)
  })

  it('picks up the per-song offset saved by the editor', async () => {
    // The editor writes this key; the stage must read the same one. Built from
    // the live song identity rather than hardcoded, so it cannot pass by
    // accident if the fixture's title changes.
    const songId = get(projectStore).activeSongId ?? 'standalone'
    const title = get(songMap)?.metadata.title ?? ''
    localStorage.setItem(`barbro::xpose::${songId}::${title}`, '4')
    transposeSettings.setVarispeedAudio(true)
    transposeSettings.resetForTest()
    transposeSettings.loadForCurrentSong()
    expect(transposeSettings.semitones, 'store did not read the editor key').toBe(4)
    await mountLive()
    expect(sawRate(varispeedRate(4)), `saw ${JSON.stringify(rates)}`).toBe(true)
  })
})
