import { describe, expect, it } from 'vitest'
import { MixerEngine } from './mixerEngine'

const SR = 48_000

function tone(ctx: BaseAudioContext, seconds = 0.7, frequency = 440): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(seconds * SR), SR)
  const data = buffer.getChannelData(0)
  for (let frame = 0; frame < data.length; frame += 1) {
    data[frame] = Math.sin((2 * Math.PI * frequency * frame) / SR) * 0.35
  }
  return buffer
}

function peakBetween(buffer: AudioBuffer, fromSec: number, toSec: number): number {
  const data = buffer.getChannelData(0)
  const from = Math.max(0, Math.floor(fromSec * buffer.sampleRate))
  const to = Math.min(data.length, Math.ceil(toSec * buffer.sampleRate))
  let peak = 0
  for (let frame = from; frame < to; frame += 1) peak = Math.max(peak, Math.abs(data[frame]!))
  return peak
}

function addTrack(
  engine: MixerEngine,
  ctx: BaseAudioContext,
  key: string,
  muted = false,
): void {
  engine.setTrack({
    key,
    label: key,
    buffer: tone(ctx),
    volume: 1,
    muted,
    soloed: false,
  })
}

describe('MixerEngine programmed echo transition', () => {
  it('captures only the currently audible musical mix, never click/cue or a muted original', async () => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR, sampleRate: SR })
    const engine = new MixerEngine(ctx as unknown as AudioContext)
    addTrack(engine, ctx, 'original', true)
    addTrack(engine, ctx, 'stem:drums.wav')
    addTrack(engine, ctx, 'stem:bass.wav')
    addTrack(engine, ctx, 'preview:orphan-take')
    addTrack(engine, ctx, 'click')
    addTrack(engine, ctx, 'cue')
    await engine.play()

    const result = engine.scheduleEchoTransition({
      throwAtCtxTime: 0.1,
      captureDurationSec: 0.08,
      dryCutAtCtxTime: 0.2,
      echoStopAtCtxTime: 0.5,
      delaySec: 0.06,
      sendLevel: 0.6,
      wetLevel: 0.7,
      feedback: 0.8,
      repeatBuild: 0.4,
      toneHz: 5000,
      blendReverbLevel: 0.3,
      blendReverbLengthSec: 0.4,
      sourceTrackKeys: ['stem:drums.wav', 'stem:bass.wav', 'click', 'cue'],
    })

    expect(result.scheduled).toBe(true)
    expect(result.audibleTrackKeys.sort()).toEqual(['stem:bass.wav', 'stem:drums.wav'])
    await engine.dispose()
  })

  it('fails closed when no musical source is audible', async () => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR, sampleRate: SR })
    const engine = new MixerEngine(ctx as unknown as AudioContext)
    addTrack(engine, ctx, 'original', true)
    addTrack(engine, ctx, 'click')
    await engine.play()

    expect(engine.scheduleEchoTransition({
      throwAtCtxTime: 0.1,
      captureDurationSec: 0.05,
      dryCutAtCtxTime: 0.2,
      echoStopAtCtxTime: 0.4,
      delaySec: 0.05,
      sendLevel: 0.6,
      wetLevel: 0.7,
      feedback: 0.8,
      repeatBuild: 0,
      toneHz: 5000,
      blendReverbLevel: 0.3,
      blendReverbLengthSec: 0.4,
    })).toMatchObject({
      scheduled: false,
      audibleTrackKeys: [],
      reason: 'no-audible-musical-source',
    })
    await engine.dispose()
  })

  it('keeps an intentional wet tail alive after the outgoing dry source is cut', async () => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR, sampleRate: SR })
    const engine = new MixerEngine(ctx as unknown as AudioContext)
    addTrack(engine, ctx, 'stem:drums.wav')
    await engine.play()
    engine.scheduleEchoTransition({
      throwAtCtxTime: 0.08,
      captureDurationSec: 0.06,
      dryCutAtCtxTime: 0.18,
      echoStopAtCtxTime: 0.48,
      delaySec: 0.055,
      sendLevel: 0.7,
      wetLevel: 0.8,
      feedback: 0.86,
      repeatBuild: 0.5,
      toneHz: 5200,
      blendReverbLevel: 0.4,
      blendReverbLengthSec: 0.45,
    })

    const rendered = await ctx.startRendering()
    expect(peakBetween(rendered, 0.22, 0.42)).toBeGreaterThan(0.01)
    await engine.dispose()
  })
})
