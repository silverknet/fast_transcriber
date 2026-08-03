/**
 * DOES THE METRONOME ACTUALLY MAKE SOUND?
 *
 * Not "was a click scheduled" — every unit test already says yes — but "do
 * samples come out", in a real render. Written after two separate changes broke
 * the audible click in two different ways at once:
 *
 *  - the pause fix closed the click gain to kill pending count-in voices, and
 *    had to re-open it on every path back to playing — miss one and the click
 *    is silently gone;
 *  - the metronome VOICE was swapped for a layered sound in `clickSounds.ts`,
 *    which no test rendered even once.
 *
 * A silent click has no error, no failed assertion, nothing in a log. This is
 * the only kind of test that can see it.
 */
import { describe, expect, it } from 'vitest'
import { playMetronomeClick } from './debugClickTrack'
import { createClickSoundResources, scheduleClickSound, CLICK_SOUND_OPTIONS } from './clickSounds'

const SR = 48000

function peakOf(buf: AudioBuffer): number {
  let m = 0
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]!))
  }
  return m
}

describe('the metronome voice produces sound', () => {
  it('playMetronomeClick renders audible samples — downbeat and offbeat', async () => {
    for (const downbeat of [true, false]) {
      const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: SR / 4, sampleRate: SR })
      const master = ctx.createGain()
      master.gain.value = 1
      master.connect(ctx.destination)
      playMetronomeClick(ctx as unknown as AudioContext, master, 0.02, downbeat)
      const rendered = await ctx.startRendering()
      expect(
        peakOf(rendered),
        `the ${downbeat ? 'downbeat' : 'offbeat'} click is silent`,
      ).toBeGreaterThan(0.05)
    }
  })

  it('every selectable click sound is audible, not just the default', async () => {
    for (const opt of CLICK_SOUND_OPTIONS) {
      const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: SR / 4, sampleRate: SR })
      const master = ctx.createGain()
      master.connect(ctx.destination)
      scheduleClickSound({
        ctx,
        destination: master,
        resources: createClickSoundResources(ctx),
        sound: opt.id,
        startTime: 0.02,
        downbeat: true,
      })
      const rendered = await ctx.startRendering()
      expect(peakOf(rendered), `click sound "${opt.id}" is silent`).toBeGreaterThan(0.03)
    }
  })
})

describe('the click gate lifecycle, in a real graph', () => {
  /**
   * The pause fix silences pending clicks by closing the master gain with
   * `cancelScheduledValues` + `setValueAtTime(0)`. These prove the two halves
   * against a REAL AudioParam timeline, where mocks cannot lie:
   * closed means silent, and re-armed means audible again.
   */
  it('a click through a CLOSED gate is silent', async () => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: SR / 4, sampleRate: SR })
    const master = ctx.createGain()
    master.connect(ctx.destination)
    // What #silenceClicks does.
    master.gain.cancelScheduledValues(0)
    master.gain.setValueAtTime(0, 0)
    master.gain.value = 0
    playMetronomeClick(ctx as unknown as AudioContext, master, 0.02, true)
    const rendered = await ctx.startRendering()
    expect(peakOf(rendered)).toBeLessThan(1e-6)
  })

  it('a click through a RE-ARMED gate rings — silence then arm then click', async () => {
    // The full pause → play cycle on one real timeline. If arming after a
    // silence does not restore sound, this is the "click never comes back" bug.
    const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: SR / 2, sampleRate: SR })
    const master = ctx.createGain()
    master.connect(ctx.destination)
    // pause at t=0 …
    master.gain.cancelScheduledValues(0)
    master.gain.setValueAtTime(0, 0)
    // … play again at t=0.1 (what #armClicks does) …
    master.gain.cancelScheduledValues(0.1)
    master.gain.setValueAtTime(1.5, 0.1)
    // … and a click scheduled after that.
    playMetronomeClick(ctx as unknown as AudioContext, master, 0.2, true)
    const rendered = await ctx.startRendering()
    expect(peakOf(rendered), 'the click did not come back after re-arming').toBeGreaterThan(0.05)
  })
})
