/**
 * REGRESSION tests for the live-mode REPLAY disaster (first-gig show-stopper):
 * replaying the same song a second time produced dead/garbled audio.
 *
 * Root cause: after an ANNOUNCED play — `play(0, { startDelaySec })`, used when a
 * spoken song-name plays first — the auto-stop timer was armed from `positionSec()`
 * (which is 0 during the pre-roll) and so fired ~`startDelaySec` too early; its
 * guard then failed and it never re-armed, wedging the transport in `playing`
 * past the song end. The next Play resumed from `≈duration` → no sources → silence.
 *
 * Real Chromium + real AudioContext (npm run test:browser). Short buffers so the
 * real-time waits stay ~1s. These MUST stay green for live to be trustworthy.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { MixerEngine } from '$lib/audio/mixerEngine'

function makeSilentWavArrayBuffer(durationSec: number, sampleRate = 8000): ArrayBuffer {
  const numFrames = Math.floor(durationSec * sampleRate)
  const dataSize = numFrames * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  view.setUint32(0, 0x52494646, false) // "RIFF"
  view.setUint32(4, 36 + dataSize, true)
  view.setUint32(8, 0x57415645, false) // "WAVE"
  view.setUint32(12, 0x666d7420, false) // "fmt "
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  view.setUint32(36, 0x64617461, false) // "data"
  view.setUint32(40, dataSize, true)
  return buffer
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let engine: MixerEngine

async function freshEngine(durationSec: number): Promise<MixerEngine> {
  const eng = new MixerEngine()
  const buf = await eng.ac.decodeAudioData(makeSilentWavArrayBuffer(durationSec))
  eng.setTrack({ key: 'original', label: 'Song', buffer: buf, volume: 1, muted: false, soloed: false })
  return eng
}

afterEach(async () => {
  await engine?.dispose().catch(() => {})
})

describe('MixerEngine replay (live show-stopper)', () => {
  it('auto-stops after an ANNOUNCED play (startDelaySec) instead of wedging', async () => {
    engine = await freshEngine(0.4)
    await engine.play(0, { startDelaySec: 0.25 }) // spoken-name pre-roll
    // Audio ends ≈ 0.04 + 0.25 + 0.4 = 0.69s. Give it margin.
    await sleep(1100)
    expect(engine.snapshot().state).toBe('stopped') // RED without fix: stays 'playing'
    expect(engine.activeSourceCount).toBe(0)
    expect(engine.snapshot().positionSec).toBeLessThanOrEqual(0.41) // never runs past the end
  })

  it('replays the SAME song from the top after it finished', async () => {
    engine = await freshEngine(0.4)
    await engine.play(0, { startDelaySec: 0.25 })
    await sleep(1100) // let it finish + auto-stop
    expect(engine.snapshot().state).toBe('stopped')

    await engine.play() // hit Play again — must restart from the top
    expect(engine.activeSourceCount).toBe(1) // RED without fix: 0 (startAt ≈ duration → no source)
    expect(engine.snapshot().state).toBe('playing')
    expect(engine.snapshot().positionSec).toBeLessThan(0.1) // from the top, not the end
  })

  it('a normal (no-announcement) play still auto-stops at the end', async () => {
    engine = await freshEngine(0.3)
    await engine.play(0)
    await sleep(700)
    expect(engine.snapshot().state).toBe('stopped')
    expect(engine.activeSourceCount).toBe(0)
  })

  it('plain stop → play replays cleanly with exactly one source set (no overlap)', async () => {
    engine = await freshEngine(2)
    await engine.play(0)
    await sleep(80)
    expect(engine.activeSourceCount).toBe(1)
    engine.stop()
    expect(engine.activeSourceCount).toBe(0)
    await engine.play(0)
    await sleep(80)
    expect(engine.activeSourceCount).toBe(1) // fresh set, not doubled
    expect(engine.snapshot().state).toBe('playing')
  })
})
