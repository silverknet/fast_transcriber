import { describe, expect, it } from 'vitest'
import { MixerEngine } from './mixerEngine'

/**
 * The song hand-off tail: a song change must not cut to silence.
 *
 * The load-bearing property is that the tail OUTLIVES the song — the operator
 * moves on, every track is torn down, and the reverb keeps ringing while the
 * next song loads. These drive the real `MixerEngine` in a real browser so a
 * regression that silences the hand-off actually fails.
 */

const SR = 44100

/** A short noisy buffer — something with energy for the reverb to bloom from. */
function toneBuffer(ctx: AudioContext, seconds = 4): AudioBuffer {
  const len = Math.floor(SR * seconds)
  const buf = ctx.createBuffer(2, len, SR)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = Math.sin((2 * Math.PI * 220 * i) / SR) * 0.5
  }
  return buf
}

function addSong(engine: MixerEngine, key = 'original') {
  engine.setTrack({
    key,
    label: key,
    buffer: toneBuffer(engine.ac),
    volume: 1,
    muted: false,
    soloed: false,
  })
}

const RING = { captureSec: 0.2, tailSec: 1.2, level: 0.6, toneHz: 3200 }

async function playingEngine(): Promise<MixerEngine> {
  const engine = new MixerEngine()
  addSong(engine)
  await engine.play(0)
  return engine
}

describe('song hand-off ring-out (real browser)', () => {
  it('schedules a tail that outlasts the dry song', async () => {
    const engine = await playingEngine()
    const r = engine.scheduleSongRingOut(RING)
    expect(r.scheduled).toBe(true)
    // The whole point: the tail is still going after the dry song has gone.
    expect(r.tailEndsAtCtxTime).toBeGreaterThan(r.dryEndsAtCtxTime)
    expect(r.dryEndsAtCtxTime).toBeGreaterThan(engine.ac.currentTime)
    await engine.dispose()
  }, 30_000)

  it('survives the transport stopping and every track being removed', async () => {
    const engine = await playingEngine()
    const r = engine.scheduleSongRingOut(RING)
    expect(r.scheduled).toBe(true)

    // Exactly what a song change does next.
    engine.stop()
    for (const t of engine.listTracks()) engine.removeTrack(t.key)

    // Still armed — a tail cancelled by the teardown would be no tail at all.
    expect(engine.listTracks()).toHaveLength(0)
    expect(engine.hasActiveRingOut()).toBe(true)
    await engine.dispose()
  }, 30_000)

  it('fades the dry lanes out rather than cutting them', async () => {
    const engine = await playingEngine()
    const before = engine.trackGainValueForTest('original')
    expect(before).toBeGreaterThan(0.5)
    engine.scheduleSongRingOut(RING)
    await new Promise((r) => setTimeout(r, 400)) // past the capture window
    expect(engine.trackGainValueForTest('original')).toBeLessThan(before * 0.1)
    await engine.dispose()
  }, 30_000)

  it('replaying the SAME song restores the faded mix — never a silent next press', async () => {
    const engine = await playingEngine()
    engine.scheduleSongRingOut(RING)
    await new Promise((r) => setTimeout(r, 300))
    expect(engine.trackGainValueForTest('original')).toBeLessThan(0.1)

    await engine.play(0) // operator aborts the change and starts the same song
    expect(engine.trackGainValueForTest('original')).toBeGreaterThan(0.5)
    // An abort is the one case where the tail SHOULD go: nothing handed off.
    expect(engine.hasActiveRingOut()).toBe(false)
    await engine.dispose()
  }, 30_000)

  it('the tail keeps ringing UNDER the next song — starting it must not cut it', async () => {
    // The whole point of the feature. Cancelling on play() would silence the
    // tail on the incoming song's first sample, which is the gap being fixed.
    const engine = await playingEngine()
    engine.scheduleSongRingOut(RING)
    await new Promise((r) => setTimeout(r, 250))
    expect(engine.hasActiveRingOut()).toBe(true)

    // Exactly what a song change does: tracks are replaced, then play.
    engine.stop()
    addSong(engine) // setTrack mints FRESH gain nodes — the taps go stale
    await engine.play(0)

    expect(engine.hasActiveRingOut()).toBe(true) // still ringing under the new song
    expect(engine.trackGainValueForTest('original')).toBeGreaterThan(0.5) // and it plays
    await engine.dispose()
  }, 30_000)

  it('an auto ring-out fires before a song ends on its own', async () => {
    // Natural song end: auto-advance only runs after the transport has stopped,
    // so without this the most common hand-off in a set gets no tail at all.
    const engine = new MixerEngine()
    engine.setTrack({
      key: 'original',
      label: 'original',
      buffer: toneBuffer(engine.ac, 0.9), // short song
      volume: 1,
      muted: false,
      soloed: false,
    })
    engine.setAutoRingOut({ captureSec: 0.3, tailSec: 1, level: 0.6, toneHz: 3200 })
    await engine.play(0)
    expect(engine.hasActiveRingOut()).toBe(false) // not yet — the song is playing

    await new Promise((r) => setTimeout(r, 750)) // past (end - captureSec)
    expect(engine.hasActiveRingOut()).toBe(true)
    await engine.dispose()
  }, 30_000)

  it('a manual stop cancels a pending auto ring-out', async () => {
    const engine = new MixerEngine()
    engine.setTrack({
      key: 'original',
      label: 'original',
      buffer: toneBuffer(engine.ac, 0.9),
      volume: 1,
      muted: false,
      soloed: false,
    })
    engine.setAutoRingOut({ captureSec: 0.3, tailSec: 1, level: 0.6, toneHz: 3200 })
    await engine.play(0)
    engine.stop() // operator stops before the end
    await new Promise((r) => setTimeout(r, 750))
    // Firing into a stopped transport would fade already-silent lanes and leave
    // them down for the next press.
    expect(engine.hasActiveRingOut()).toBe(false)
    await engine.dispose()
  }, 30_000)

  it('does not fire when the transport is already stopped', async () => {
    const engine = new MixerEngine()
    addSong(engine)
    const r = engine.scheduleSongRingOut(RING)
    expect(r.scheduled).toBe(false)
    expect(r.reason).toBe('transport-stopped')
    await engine.dispose()
  }, 30_000)

  it('does not fire when there is nothing audible to ring', async () => {
    const engine = new MixerEngine()
    engine.setTrack({
      key: 'original',
      label: 'original',
      buffer: toneBuffer(engine.ac),
      volume: 1,
      muted: true, // muted → nothing to hand off
      soloed: false,
    })
    await engine.play(0)
    const r = engine.scheduleSongRingOut(RING)
    expect(r.scheduled).toBe(false)
    expect(r.reason).toBe('no-audible-musical-source')
    await engine.dispose()
  }, 30_000)

  it('a rapid second press replaces the tail instead of stacking two', async () => {
    const engine = await playingEngine()
    expect(engine.scheduleSongRingOut(RING).scheduled).toBe(true)
    // Re-arm while still playing: the previous tail must be dropped, not layered.
    await engine.play(0)
    expect(engine.scheduleSongRingOut(RING).scheduled).toBe(true)
    expect(engine.hasActiveRingOut()).toBe(true)
    await engine.dispose()
  }, 30_000)

  it('dispose clears the tail rather than leaving it ringing', async () => {
    const engine = await playingEngine()
    engine.scheduleSongRingOut(RING)
    expect(engine.hasActiveRingOut()).toBe(true)
    await engine.dispose()
    expect(engine.hasActiveRingOut()).toBe(false)
  }, 30_000)
})
