/**
 * One hardware AudioContext for the whole app.
 *
 * Browsers cap hardware contexts at roughly six per page and throw on the
 * seventh. The app used to construct six on a single editor load — mixer,
 * playback controller, chord playback, chord bass, chord arp, chord kick — so
 * the next request threw from wherever it landed. It surfaced as an
 * unexplained "paused in debugger" inside the cue renderer, which was itself
 * taking two more contexts for work that makes no sound.
 *
 * Browser-only: it needs a real `AudioContext` to be meaningful.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { __setAudioDeviceForTest, audioDevice, hasAudioDevice } from './audioDevice'

const restores: (() => void)[] = []
afterEach(() => {
  restores.splice(0).forEach((r) => r())
})

describe('the shared audio device', () => {
  it('hands the SAME context to every caller', () => {
    restores.push(__setAudioDeviceForTest(null))
    const a = audioDevice()
    const b = audioDevice()
    expect(a).toBe(b)
  })

  it('is not created until something asks', () => {
    restores.push(__setAudioDeviceForTest(null))
    expect(hasAudioDevice()).toBe(false)
    audioDevice()
    expect(hasAudioDevice()).toBe(true)
  })

  it('every audio consumer shares it — well under the browser cap', async () => {
    restores.push(__setAudioDeviceForTest(null))
    const { MixerEngine } = await import('./mixerEngine')
    const { KeysSynth } = await import('./keysSynth')

    const engine = new MixerEngine()
    const engine2 = new MixerEngine()
    const synths = [new KeysSynth(), new KeysSynth(), new KeysSynth()]
    await Promise.all(synths.map((s) => s.resume()))

    const device = audioDevice()
    // RED before this change: each of these built its own context, and six of
    // them on one page is already the browser's limit.
    expect(engine.ac).toBe(device)
    expect(engine2.ac).toBe(device)
    for (const s of synths) expect(s.contextForTest).toBe(device)
  })

  it('an engine may still be given its own context (tests, offline work)', async () => {
    restores.push(__setAudioDeviceForTest(null))
    const { MixerEngine } = await import('./mixerEngine')
    const own = new AudioContext()
    const engine = new MixerEngine(own)
    expect(engine.ac).toBe(own)
    expect(engine.ac).not.toBe(audioDevice())
    await own.close()
  })

  it('closing a synth does NOT close the shared device', async () => {
    // It is process-wide: closing it would silence the mixer and the editor.
    restores.push(__setAudioDeviceForTest(null))
    const { KeysSynth } = await import('./keysSynth')
    const synth = new KeysSynth()
    await synth.resume()
    await synth.close()
    expect(audioDevice().state).not.toBe('closed')
  })
})
