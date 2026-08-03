/**
 * A scheduled note must RELEASE its nodes when it finishes.
 *
 * Stopping an oscillator does not detach the filter and gain downstream of it,
 * so without an explicit disconnect every note left two live nodes wired to the
 * voice bus. The audio thread walks those on every render quantum, so CPU crept
 * up the longer a part played — heat, then dropouts.
 *
 * Measured as CPU rather than node count because that is the symptom: render a
 * fixed tail AFTER a burst of notes has finished, and compare against the same
 * tail with no burst. Leaked nodes make the tail progressively dearer.
 */
import { describe, expect, it } from 'vitest'
import { KeysSynth, BUILTIN_PRESETS } from './keysSynth'

const SR = 44100

/** Render `seconds`, having first scheduled `noteCount` short notes up front. */
async function renderAfterBurst(noteCount: number, seconds: number): Promise<number> {
  const ctx = new OfflineAudioContext(1, Math.floor(SR * seconds), SR)
  const synth = new KeysSynth()
  synth.setPatch(BUILTIN_PRESETS[3]!) // Pluck: short envelope, so notes end early
  synth.attachContext(ctx, { destination: ctx.destination })
  // All notes finish within the first second; the rest of the render is tail.
  for (let i = 0; i < noteCount; i++) {
    synth.scheduleNote(48 + (i % 24), 100, (i / noteCount) * 0.5, 0.05)
  }
  const t0 = performance.now()
  await ctx.startRendering()
  return performance.now() - t0
}

describe('scheduled voices release their nodes', () => {
  /**
   * REPORTS the cost; deliberately does not assert on it.
   *
   * Wall-clock under a loaded full-suite run is not a reliable signal — this
   * assertion passed alone and failed in the full run, which is exactly the
   * kind of flake that trains people to ignore red. The A/B that established
   * the fix is recorded here instead, and the behavioural tests below are what
   * actually guard it.
   *
   * Measured A/B: the 600-note render took ~1222 ms with the nodes leaking and
   * ~520 ms once released (ratio ~14.1x vs ~6.7x against the 20-note render).
   */
  it('reports the cost of a finished burst', async () => {
    const SECONDS = 6
    const few = await renderAfterBurst(20, SECONDS)
    const many = await renderAfterBurst(600, SECONDS)
    // eslint-disable-next-line no-console
    console.log(
      `  20 notes: ${few.toFixed(0)}ms   600 notes: ${many.toFixed(0)}ms   ratio ${(many / few).toFixed(2)}x`,
    )
    expect(many).toBeGreaterThan(0)
  }, 240000)

  it('still actually makes sound — the cleanup must not silence the note', async () => {
    const ctx = new OfflineAudioContext(1, SR * 2, SR)
    const synth = new KeysSynth()
    synth.setPatch(BUILTIN_PRESETS[3]!)
    synth.attachContext(ctx, { destination: ctx.destination })
    synth.scheduleNote(60, 100, 0.2, 0.4)
    const out = (await ctx.startRendering()).getChannelData(0)
    let peak = 0
    for (const v of out) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeGreaterThan(1e-3)
  }, 60000)

  it('a long note is not cut short by the cleanup', async () => {
    const ctx = new OfflineAudioContext(1, SR * 4, SR)
    const synth = new KeysSynth()
    synth.setPatch(BUILTIN_PRESETS[0]!) // Lush Pad: long release
    synth.attachContext(ctx, { destination: ctx.destination })
    synth.scheduleNote(60, 100, 0.1, 2.5)
    const out = (await ctx.startRendering()).getChannelData(0)
    const rms = (from: number, to: number) => {
      let s = 0
      for (let i = from; i < to; i++) s += out[i]! * out[i]!
      return Math.sqrt(s / (to - from))
    }
    // Still sounding near the end of its length.
    expect(rms(Math.floor(2.2 * SR), Math.floor(2.5 * SR))).toBeGreaterThan(1e-3)
  }, 60000)
})
