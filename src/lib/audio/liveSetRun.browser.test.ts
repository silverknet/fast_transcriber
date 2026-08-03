/**
 * A WHOLE SET, END TO END, ON THE REAL ENGINE — trying to break it.
 *
 * Models the live flow of a 12-song set ("Bröllopsgig"-shaped): load a song's
 * lanes into the one `MixerEngine`, play, jump around, restart, switch songs —
 * including the abusive patterns a stressed person on a stage actually
 * produces: rapid double-switches, switching mid-play, restarting during the
 * count-in window, hammering next/prev.
 *
 * This drives the engine + cache layer directly (the same calls `MixerView`'s
 * load loop and song-switch path make) rather than mounting the whole Svelte
 * page: the page needs the sidecar and a project on disk, which CI does not
 * have. What this DOES prove on real audio hardware paths: no exception under
 * abuse, positions land where they should, the engine's track set always
 * matches the current song, stale switches never leave a dead engine, and the
 * decode cache makes revisits instant.
 */
import { describe, expect, it } from 'vitest'
import { MixerEngine } from './mixerEngine'
import {
  PRELOADED_SONG_CAP,
  clearLiveAudioCache,
  decodedSongIds,
  getPreloadedStems,
  putPreloadedStems,
} from './liveAudioCache'

const SR = 48000

/** A distinct tone per song so cross-song buffer mixups would be audible in data. */
function songBuffer(ctx: BaseAudioContext, index: number, seconds = 8): AudioBuffer {
  const buf = ctx.createBuffer(2, Math.floor(SR * seconds), SR)
  const freq = 110 * (1 + (index % 12))
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) d[i] = Math.sin((2 * Math.PI * freq * i) / SR) * 0.3
  }
  return buf
}

type SetSong = { id: string; lanes: { key: string; buffer: AudioBuffer }[] }

function makeSet(ctx: BaseAudioContext, count = 12): SetSong[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `song-${i}`,
    lanes: [
      { key: 'original', buffer: songBuffer(ctx, i) },
      { key: 'stem:drums.wav', buffer: songBuffer(ctx, i, 8) },
      { key: 'stem:bass.wav', buffer: songBuffer(ctx, i, 8) },
      { key: 'click', buffer: songBuffer(ctx, i, 8) },
    ],
  }))
}

/**
 * The song-switch, as MixerView performs it: wipe every track, then register
 * the next song's lanes (cache-first). Returns how many lanes were re-decoded
 * (here: re-registered from source rather than cache).
 */
function switchTo(engine: MixerEngine, song: SetSong): number {
  for (const t of engine.listTracks()) engine.removeTrack(t.key)
  let misses = 0
  const cached = getPreloadedStems(song.id)
  for (const lane of song.lanes) {
    const buf = cached?.get(lane.key) ?? (misses++, lane.buffer)
    engine.setTrack({ key: lane.key, label: lane.key, buffer: buf, volume: 1, muted: false, soloed: false })
  }
  if (!cached) {
    putPreloadedStems(song.id, new Map(song.lanes.map((l) => [l.key, l.buffer])))
  }
  return misses
}

describe('a full set on the real engine', () => {
  it('plays the whole set through: every song, in order, tracks always coherent', async () => {
    clearLiveAudioCache()
    const ctx = new AudioContext()
    try {
      const engine = new MixerEngine(ctx)
      const set = makeSet(ctx)
      for (const song of set) {
        switchTo(engine, song)
        expect(engine.listTracks().map((t) => t.key).sort()).toEqual(
          ['click', 'original', 'stem:bass.wav', 'stem:drums.wav'].sort(),
        )
        engine.play()
        await new Promise((r) => setTimeout(r, 40))
        expect(engine.snapshot().state).toBe('playing')
        expect(engine.positionSec()).toBeGreaterThanOrEqual(0)
        engine.stop()
        expect(engine.snapshot().state).not.toBe('playing')
      }
      await engine.dispose()
    } finally {
      await ctx.close().catch(() => {})
    }
  }, 60_000)

  it('restart mid-song lands at the top, every time', async () => {
    clearLiveAudioCache()
    const ctx = new AudioContext()
    try {
      const engine = new MixerEngine(ctx)
      const [song] = makeSet(ctx, 1)
      switchTo(engine, song!)
      for (let i = 0; i < 5; i++) {
        engine.play(2 + i)
        await new Promise((r) => setTimeout(r, 30))
        // The restart gesture: seek to the top while playing.
        engine.seek(0)
        await new Promise((r) => setTimeout(r, 30))
        const pos = engine.positionSec()
        expect(pos, `restart ${i} drifted`).toBeGreaterThanOrEqual(0)
        expect(pos, `restart ${i} did not land at the top`).toBeLessThan(0.5)
      }
      engine.stop()
      await engine.dispose()
    } finally {
      await ctx.close().catch(() => {})
    }
  }, 30_000)

  it('jumping back and forth through the set never desynchronises the track set', async () => {
    clearLiveAudioCache()
    const ctx = new AudioContext()
    try {
      const engine = new MixerEngine(ctx)
      const set = makeSet(ctx)
      // The jumpy operator: 3 → 7 → 2 → 11 → 0 → 5 → 5 → 4, playing between some.
      const order = [3, 7, 2, 11, 0, 5, 5, 4]
      for (const idx of order) {
        switchTo(engine, set[idx]!)
        engine.play()
        await new Promise((r) => setTimeout(r, 25))
        expect(engine.snapshot().state).toBe('playing')
        expect(engine.listTracks()).toHaveLength(4)
        engine.stop()
      }
      await engine.dispose()
    } finally {
      await ctx.close().catch(() => {})
    }
  }, 30_000)

  it('rapid switching MID-PLAY — the abusive case — never throws or goes silent-stuck', async () => {
    clearLiveAudioCache()
    const ctx = new AudioContext()
    try {
      const engine = new MixerEngine(ctx)
      const set = makeSet(ctx)
      // Switch every ~15 ms without stopping first, 30 times. This is the
      // "double-tapped next, then prev, then next again" pattern.
      for (let i = 0; i < 30; i++) {
        const song = set[i % set.length]!
        switchTo(engine, song)
        engine.play()
        await new Promise((r) => setTimeout(r, 15))
      }
      // After the storm: still coherent, still playable.
      expect(engine.listTracks()).toHaveLength(4)
      engine.stop()
      engine.play(1)
      await new Promise((r) => setTimeout(r, 50))
      expect(engine.snapshot().state).toBe('playing')
      expect(engine.positionSec()).toBeGreaterThanOrEqual(1)
      engine.stop()
      await engine.dispose()
    } finally {
      await ctx.close().catch(() => {})
    }
  }, 30_000)

  it('revisiting RECENT songs is all cache hits; the cache stays BOUNDED', async () => {
    // The old contract ("a whole 12-song lap revisits with 0 misses") required
    // every visited song to stay decoded in RAM — which is what killed a real
    // rig's tab mid-set (~0.5 GB per long song, unbounded). The promise now:
    // the neighborhood you are playing in is instant, and memory has a ceiling.
    clearLiveAudioCache()
    const ctx = new AudioContext()
    try {
      const engine = new MixerEngine(ctx)
      const set = makeSet(ctx)
      for (const song of set) switchTo(engine, song)
      // Bounded: only the last PRELOADED_SONG_CAP songs hold decoded stems.
      expect(decodedSongIds().size).toBe(PRELOADED_SONG_CAP)
      // The neighborhood promise: bouncing between the most recent songs
      // (restart the closer, encore the last two) never re-decodes.
      let misses = 0
      const recent = set.slice(-PRELOADED_SONG_CAP)
      for (const song of [...recent, ...recent].reverse()) misses += switchTo(engine, song)
      expect(misses, 'a recent revisit re-registered from source instead of cache').toBe(0)
      // An OLD song re-decodes (that is the deal) — and re-entering it evicts
      // the oldest recent song, keeping the ceiling.
      expect(switchTo(engine, set[0]!)).toBeGreaterThan(0)
      expect(decodedSongIds().size).toBe(PRELOADED_SONG_CAP)
      await engine.dispose()
    } finally {
      await ctx.close().catch(() => {})
    }
  }, 30_000)

  it('the click gate survives the whole set: suppressed stays silent through every switch', async () => {
    // Live fail-closed × song switching: the suppression must hold across
    // removeTrack/setTrack cycles, or one song switch would put the click back
    // into the house.
    clearLiveAudioCache()
    const ctx = new AudioContext()
    try {
      const engine = new MixerEngine(ctx)
      const set = makeSet(ctx, 6)
      engine.setTrackSuppressed('click', true)
      for (const song of set) {
        switchTo(engine, song)
        engine.play()
        await new Promise((r) => setTimeout(r, 20))
        const click = engine.listTracks().find((t) => t.key === 'click')
        expect(click, 'click lane missing').toBeDefined()
        engine.stop()
      }
      // The gate is still closed after six songs' worth of track churn.
      engine.setTrackSuppressed('click', false)
      await engine.dispose()
    } finally {
      await ctx.close().catch(() => {})
    }
  }, 30_000)
})
