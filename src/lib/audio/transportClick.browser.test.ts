/**
 * THE EDITOR CLICK, END TO END, IN A REAL BROWSER.
 *
 * The unit tests drive the transport against a mocked `AudioContext`, where a
 * gain value is just a number. Here the REAL `$effect` graph runs against a
 * REAL `AudioParam` timeline — which is where "the click is silent and nothing
 * failed" lives.
 *
 * Exists because the pause fix (close the click gain to kill pre-scheduled
 * count-in voices) has to re-open that gain on EVERY path back to sound. Missing
 * one path is not an error anywhere — it is just a musician in the Grid tab
 * with no click.
 */
import { describe, expect, it } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import type { SongMap } from '$lib/songmap/types'

function makeSong(opts: { countInBeats?: number } = {}): SongMap {
  const bd = 0.5
  const beatsPerBar = 4
  const barCount = 4
  const beats: SongMap['timeline']['beats'] = []
  const bars: SongMap['timeline']['bars'] = []
  for (let bar = 0; bar < barCount; bar++) {
    const barId = `bar${bar}`
    const barStart = bar * beatsPerBar * bd
    const beatIds: string[] = []
    for (let i = 0; i < beatsPerBar; i++) {
      const id = `b${bar}_${i}`
      beatIds.push(id)
      beats.push({ id, barId, indexInBar: i, timeSec: barStart + i * bd })
    }
    bars.push({
      id: barId,
      index: bar,
      startSec: barStart,
      endSec: barStart + beatsPerBar * bd,
      meter: { numerator: beatsPerBar, denominator: 4 },
      beatCount: beatsPerBar,
      beatIds,
    })
  }
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'T',
      bpm: 120,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    audio: { fileName: 'x.wav', trim: { startSec: 0, endSec: 8 }, source: 'upload' },
    timeline: { bars, beats },
    sections: [],
    harmony: [],
    cueTracks: [],
    ...(opts.countInBeats ? { countInBeats: opts.countInBeats } : {}),
  } as SongMap
}

function wavFile(seconds = 4, freq = 220): File {
  const sr = 44100
  const n = Math.floor(sr * seconds)
  const bytes = new ArrayBuffer(44 + n * 2)
  const dv = new DataView(bytes)
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  dv.setUint32(4, 36 + n * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, 1, true)
  dv.setUint32(24, sr, true)
  dv.setUint32(28, sr * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  ascii(36, 'data')
  dv.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    dv.setInt16(44 + i * 2, Math.round(0.4 * 32767 * Math.sin((2 * Math.PI * freq * i) / sr)), true)
  }
  return new File([bytes], 'x.wav', { type: 'audio/wav' })
}

async function freshTransport() {
  const mod = await import('$lib/audio/transport.svelte')
  return mod.transport
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

/** The gain the click voices actually pass through, right now. */
function clickGainNow(t: Awaited<ReturnType<typeof freshTransport>>): number {
  const master = t.clickMasterForTest
  expect(master, 'transport has no click master').not.toBeNull()
  return master!.gain.value
}

describe('the Grid-tab click, on the real effect graph', () => {
  it('is AUDIBLE on plain play — the gate is open', async () => {
    const t = await freshTransport()
    try {
      t.configure(makeSong())
      await t.loadFile(wavFile())
      t.playWithClick = true
      t.clickVolume = 1.5
      t.play()
      await frame()
      await frame()
      expect(t.isPlaying).toBe(true)
      expect(clickGainNow(t), 'click gate closed on plain play').toBeCloseTo(1.5, 4)
    } finally {
      t.stop()
      t.dispose()
    }
  }, 30_000)

  it('comes BACK after pause → play', async () => {
    const t = await freshTransport()
    try {
      t.configure(makeSong())
      await t.loadFile(wavFile())
      t.playWithClick = true
      t.play()
      await frame()
      t.pause()
      await frame()
      expect(clickGainNow(t), 'pause must close the gate').toBe(0)
      t.play()
      await frame()
      await frame()
      expect(clickGainNow(t), 'the click never came back after pause').toBeGreaterThan(0)
    } finally {
      t.stop()
      t.dispose()
    }
  }, 30_000)

  it('turning the click ON mid-playback opens the gate', async () => {
    // The exact reported gesture: playing, then toggling the click on.
    const t = await freshTransport()
    try {
      t.configure(makeSong())
      await t.loadFile(wavFile())
      t.playWithClick = false
      t.play()
      await frame()
      t.playWithClick = true
      await frame()
      await frame()
      expect(clickGainNow(t), 'toggling click on while playing left the gate shut').toBeGreaterThan(0)
    } finally {
      t.stop()
      t.dispose()
    }
  }, 30_000)

  it('toggling OFF and ON again while playing still rings', async () => {
    const t = await freshTransport()
    try {
      t.configure(makeSong())
      await t.loadFile(wavFile())
      t.playWithClick = true
      t.play()
      await frame()
      t.playWithClick = false
      await frame()
      expect(clickGainNow(t)).toBe(0)
      t.playWithClick = true
      await frame()
      await frame()
      expect(clickGainNow(t), 'off/on cycle left the gate shut').toBeGreaterThan(0)
    } finally {
      t.stop()
      t.dispose()
    }
  }, 30_000)

  it('a count-in song still clicks after a pause DURING the count-in', async () => {
    // The original bug's scene, replayed end to end: pause mid-count-in (the
    // gate slams on pending voices), then play again — the new count-in must
    // be audible, not swallowed by the still-closed gate.
    const t = await freshTransport()
    try {
      t.configure(makeSong({ countInBeats: 4 }))
      await t.loadFile(wavFile())
      t.playWithClick = true
      t.play()
      await frame() // still inside the count-in pre-roll
      t.pause()
      await frame()
      expect(clickGainNow(t)).toBe(0)
      t.play()
      await frame()
      await frame()
      expect(clickGainNow(t), 'count-in swallowed after pause/play').toBeGreaterThan(0)
    } finally {
      t.stop()
      t.dispose()
    }
  }, 30_000)

  it('the volume slider works while playing', async () => {
    const t = await freshTransport()
    try {
      t.configure(makeSong())
      await t.loadFile(wavFile())
      t.playWithClick = true
      t.play()
      await frame()
      t.clickVolume = 0.7
      await frame()
      await frame()
      expect(clickGainNow(t)).toBeCloseTo(0.7, 4)
    } finally {
      t.stop()
      t.dispose()
    }
  }, 30_000)
})
