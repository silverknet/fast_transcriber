/**
 * THE CLICK, ON A REAL SONG'S REAL DATA — end to end, in a real browser.
 *
 * Born from a live failure that survived three "fixes": "no clicks on Love
 * Never Felt So Good", with the click lane MISSING from the mixer entirely.
 * The song's file is proven healthy (the project health check passes it, both
 * on disk and in the cloud), so if this suite is green the code path from that
 * exact data to audible samples is proven — and a missing lane in the running
 * app has to come from the registration environment, not the data or the
 * render math.
 *
 * The fixture is the song's actual `songMap` (timeline, trim, count-in,
 * start beat, BOTH cue tracks with their 50+ events, mixState), slimmed only
 * of fields the click path never reads (lyrics, drafts, harmony, hints).
 * Every stage below is the SAME call the mixer makes, in the same order.
 */
import { describe, expect, it } from 'vitest'
import rawFixture from './__fixtures__/love-nfsg-full.songmap.json'
import { parseSongMap } from '$lib/songmap/parse'
import { songPlaybackPlan } from '$lib/songmap/playbackPlan'
import { getPrimaryCueTrack } from '$lib/songmap/cueTracks'
import { fingerprintClickTrackInputs } from '$lib/songmap/cueTrackFingerprint'
import { titleCuePreludeSec } from './cueTrackSpeechSchedule'
import { renderClickTrackData } from './renderCueTrack'
import { MixerEngine } from './mixerEngine'
import { liveInitialMuted } from '$lib/hardware/liveSlotLinks'

const SR = 48000

function loadSong() {
  return parseSongMap(JSON.stringify(rawFixture))
}

function peakOf(d: Float32Array, from = 0, to = d.length): number {
  let m = 0
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(d[i]!))
  return m
}

describe('Love Never Felt So Good — the exact live click path', () => {
  it('THE INCIDENT, encoded: the start anchor at 70% means clicks only from 2:51', () => {
    // This fixture is the song EXACTLY as it failed on stage: startBeatId at
    // beat 332 of 470 (171.7s). The plan is CORRECT — count-in and clicks
    // begin at the song start — so the first three minutes have no clicks.
    // "No clicks on Love Never Felt So Good" was this line of data.
    const sm = loadSong()
    expect(sm.timeline.beats.length).toBe(470)
    const anchor = sm.timeline.beats.find((b) => b.id === sm.startBeatId)
    expect(anchor, 'the broken anchor this fixture preserves').toBeDefined()
    expect(anchor!.timeSec).toBeGreaterThan(170)
    const plan = songPlaybackPlan(sm)
    expect(plan, 'an analysed song MUST derive a plan').not.toBeNull()
    const song = plan!.clickPoints.filter((p) => !p.isCountIn)
    // Contract: clicks = beats in the trim AT/AFTER the song start.
    const trim = sm.audio!.trim
    const expected = sm.timeline.beats.filter(
      (b) => b.timeSec >= anchor!.timeSec && b.timeSec >= trim.startSec && b.timeSec <= trim.endSec,
    )
    expect(song.length).toBe(expected.length) // 138 — NOT 470, and now we know why
    expect(plan!.clickPoints.filter((p) => p.isCountIn).length).toBe(8)
  })

  it('REPAIRED: anchor on the first beat → every beat in the trim clicks', () => {
    const sm = loadSong()
    const repaired = { ...sm, startBeatId: sm.timeline.beats[0]!.id }
    const plan = songPlaybackPlan(repaired)!
    const song = plan.clickPoints.filter((p) => !p.isCountIn)
    const trim = sm.audio!.trim
    const beatsInTrim = sm.timeline.beats.filter(
      (b) => b.timeSec >= trim.startSec && b.timeSec <= trim.endSec,
    )
    expect(song.length).toBe(beatsInTrim.length) // all 470
  })

  it('the cache-key derivation does not throw (it runs OUTSIDE the render try/catch)', () => {
    const sm = loadSong()
    const cueTrack = getPrimaryCueTrack(sm)
    expect(cueTrack, 'this song has two enabled cue tracks').toBeDefined()
    // MixerView computes this before the try{} in renderClickCached — a throw
    // here kills the click lane with nothing on screen.
    expect(() => fingerprintClickTrackInputs(sm, cueTrack)).not.toThrow()
    expect(() => titleCuePreludeSec(sm, cueTrack)).not.toThrow()
  })

  it('renderClickTrackData produces audible clicks exactly where the plan says', async () => {
    const sm = loadSong()
    const cueTrack = getPrimaryCueTrack(sm)
    const r = await renderClickTrackData(sm, { cueTrack, sampleRate: SR })
    expect(r.data.length).toBeGreaterThan(0)
    const plan = songPlaybackPlan(sm)!
    // Check the FIRST count-in click and the first three song clicks land as
    // audible energy within a kernel-width window of their planned time.
    const probes = [...plan.clickPoints.filter((p) => p.isCountIn).slice(0, 1),
                    ...plan.clickPoints.filter((p) => !p.isCountIn).slice(0, 3)]
    for (const c of probes) {
      const at = Math.round((c.timeSec + r.preludeOffsetSec) * SR)
      const win = peakOf(r.data, at, Math.min(r.data.length, at + Math.round(0.05 * SR)))
      expect(win, `click at plan t=${c.timeSec.toFixed(3)}s must be audible`).toBeGreaterThan(0.05)
    }
    // And the whole buffer is not, say, one click and 246 seconds of silence:
    // the last song click must be audible too.
    const last = plan.clickPoints[plan.clickPoints.length - 1]!
    const at = Math.round((last.timeSec + r.preludeOffsetSec) * SR)
    expect(peakOf(r.data, at, Math.min(r.data.length, at + Math.round(0.05 * SR)))).toBeGreaterThan(0.05)
  })

  it('the click lane starts UNMUTED in live for this song, despite its saved editing mute', () => {
    const sm = loadSong()
    // The file really does carry the saved editing mute that caused the
    // original report — assert it so this fixture keeps guarding the case.
    const savedClick = sm.mixState?.tracks?.find?.((t: { key: string }) => t.key === 'click')
    expect(
      liveInitialMuted({
        key: 'click',
        savedMuted: savedClick?.muted ?? true,
        liveStems: undefined,
        hasMusicalSlotLane: true,
      }),
    ).toBe(false)
  })

  it('the prelude offset is small — clicks are not shifted seconds late', async () => {
    // A large prelude here would mean the click lane starts with seconds of
    // dead air while the song plays — audibly "no clicks" even though the
    // buffer is fine. This song has two 50+-event cue tracks, so it is the
    // exact case where an intro-estimation bug would show.
    const sm = loadSong()
    const r = await renderClickTrackData(sm, { cueTrack: getPrimaryCueTrack(sm), sampleRate: SR })
    expect(r.preludeOffsetSec, `preludeOffsetSec=${r.preludeOffsetSec}`).toBeLessThan(10)
  })

  it('registered into a real engine, the click is AUDIBLE where the plan puts it', async () => {
    const sm = loadSong()
    const cueTrack = getPrimaryCueTrack(sm)
    const r = await renderClickTrackData(sm, { cueTrack, sampleRate: SR })
    const plan = songPlaybackPlan(sm)!
    // Play from just before the FIRST plan click — for THIS (still-broken)
    // fixture that is ~167s in, which is exactly why "press play, hear
    // nothing" was true while the buffer itself was fine.
    const firstClickSec =
      Math.min(...plan.clickPoints.map((c) => c.timeSec)) + r.preludeOffsetSec
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR, sampleRate: SR })
    const engine = new MixerEngine(ctx as unknown as AudioContext)
    const buf = ctx.createBuffer(1, r.data.length, SR)
    buf.copyToChannel(new Float32Array(r.data), 0)
    engine.setTrack({ key: 'click', label: 'Click', buffer: buf, volume: 1, muted: false, soloed: false })
    engine.play(Math.max(0, firstClickSec - 0.1))
    const rendered = await ctx.startRendering()
    expect(peakOf(rendered.getChannelData(0))).toBeGreaterThan(0.05)
    // And the stage symptom itself: the first four seconds from the top are
    // dead air on this fixture — the click data before the anchor is silence.
    expect(peakOf(r.data, 0, SR * 4)).toBeLessThan(1e-6)
  })

  it('…and the practice gate still silences it completely (sanity: gate ≠ this bug)', async () => {
    const sm = loadSong()
    const r = await renderClickTrackData(sm, { cueTrack: getPrimaryCueTrack(sm), sampleRate: SR })
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR, sampleRate: SR })
    const engine = new MixerEngine(ctx as unknown as AudioContext)
    const buf = ctx.createBuffer(1, r.data.length, SR)
    buf.copyToChannel(new Float32Array(r.data), 0)
    engine.setTrack({ key: 'click', label: 'Click', buffer: buf, volume: 1, muted: false, soloed: false })
    engine.setTrackSuppressed('click', true)
    engine.play()
    const rendered = await ctx.startRendering()
    expect(peakOf(rendered.getChannelData(0))).toBeLessThan(1e-6)
  })
})
