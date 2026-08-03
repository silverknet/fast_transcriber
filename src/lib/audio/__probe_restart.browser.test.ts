import { describe, expect, it } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import type { SongMap } from '$lib/songmap/types'

function makeSong(countInBeats: number): SongMap {
  const bd = 0.5, bpb = 4, barCount = 8
  const beats: SongMap['timeline']['beats'] = []
  const bars: SongMap['timeline']['bars'] = []
  for (let bar = 0; bar < barCount; bar++) {
    const barId = `bar${bar}`; const s = bar * bpb * bd; const beatIds: string[] = []
    for (let i = 0; i < bpb; i++) { const id = `b${bar}_${i}`; beatIds.push(id); beats.push({ id, barId, indexInBar: i, timeSec: s + i * bd }) }
    bars.push({ id: barId, index: bar, startSec: s, endSec: s + bpb * bd, meter: { numerator: bpb, denominator: 4 }, beatCount: bpb, beatIds })
  }
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: { title: 'T', bpm: 120, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
    audio: { fileName: 'x.wav', trim: { startSec: 0, endSec: 16 }, source: 'upload' },
    timeline: { bars, beats }, sections: [], harmony: [], cueTracks: [], countInBeats,
  } as SongMap
}
function wavFile(seconds = 16): File {
  const sr = 44100, n = Math.floor(sr * seconds)
  const b = new ArrayBuffer(44 + n * 2), dv = new DataView(b)
  const a = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) }
  a(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); a(8, 'WAVE'); a(12, 'fmt ')
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true); a(36, 'data'); dv.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(0.3 * 32767 * Math.sin((2 * Math.PI * 220 * i) / sr)), true)
  return new File([b], 'x.wav', { type: 'audio/wav' })
}
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('probe: play -> pause -> stop -> play', () => {
  it('prints transport state at each step', async () => {
    const mod = await import('$lib/audio/transport.svelte')
    const t = mod.transport
    try {
      t.configure(makeSong(8))
      await t.loadFile(wavFile())
      t.playWithClick = true
      t.clickVolume = 1

      t.play(); await frame(); await frame()
      console.log('AFTER PLAY 1: pos=%s gain=%s playing=%s', t.songTimeSec.toFixed(3), t.clickMasterForTest?.gain.value, t.isPlaying)
      await wait(1200)
      console.log('  +1.2s (still in count-in): pos=%s', t.songTimeSec.toFixed(3))
      await wait(4000)
      console.log('  +5.2s (song running): pos=%s', t.songTimeSec.toFixed(3))

      t.pause(); await frame()
      console.log('AFTER PAUSE: pos=%s gain=%s playing=%s', t.songTimeSec.toFixed(3), t.clickMasterForTest?.gain.value, t.isPlaying)

      t.stop(); await frame()
      console.log('AFTER STOP:  pos=%s gain=%s playing=%s', t.songTimeSec.toFixed(3), t.clickMasterForTest?.gain.value, t.isPlaying)

      t.play(); await frame(); await frame()
      console.log('AFTER PLAY 2: pos=%s gain=%s playing=%s', t.songTimeSec.toFixed(3), t.clickMasterForTest?.gain.value, t.isPlaying)
      await wait(1200)
      console.log('  +1.2s: pos=%s  (should still be 0 if count-in ran)', t.songTimeSec.toFixed(3))
      await wait(4000)
      console.log('  +5.2s: pos=%s', t.songTimeSec.toFixed(3))
      expect(t.isPlaying).toBe(true)
    } finally { t.stop(); t.dispose() }
  }, 60_000)
})
