/**
 * THE LOST SONG — 2026-08-05.
 *
 * A song was added and analysed at 09:27; its folder, .smap and 54 MB of audio
 * were written. A cloud pull that had started earlier finished at 09:37 and
 * wrote a 16-song manifest over the 17-song one. The song was perfectly intact
 * on disk and completely invisible in the app, because nothing scans the
 * `songs/` directory — the manifest IS the project. A manual repair was
 * reverted twelve seconds after the app picked it up.
 *
 * The mechanism: `pullCloudChanges` snapshotted the project, then awaited a
 * cloud fetch plus a sidecar read/decode/encode/write PER SONG, then rebuilt
 * `songs` from the pre-await snapshot. Anything added in that window was
 * deleted from the store and then from disk.
 *
 * The fix is to re-read the store before building the manifest. This pins the
 * pure half — that stamping is keyed by id and never drops an unknown song —
 * so a future refactor cannot reintroduce a snapshot-shaped write.
 */
import { describe, expect, it } from 'vitest'
import { stampPulledSongs } from './cloudSync'
import type { ProjectSongEntry } from '$lib/project/types'

const song = (id: string, folder = `songs/${id}`): ProjectSongEntry => ({ id, folder })

describe('stamping a pull onto the songs the project has NOW', () => {
  const synced = new Map([['s1', { revision: 12, contentHash: 'abc' }]])

  it('stamps the songs the pull actually saw', () => {
    const [out] = stampPulledSongs([song('s1')], synced)
    expect(out.lastSyncedRevision).toBe(12)
    expect(out.lastSyncedContentHash).toBe('abc')
  })

  it('THE BUG: a song added DURING the pull survives instead of being deleted', () => {
    // The pull never heard of 'new-song' — it did not exist when the cloud
    // fetch started. Passing it through is the whole fix.
    const out = stampPulledSongs(
      [song('s1'), song('new-song', 'songs/Din-tid-kommer-a115f574')],
      synced,
    )
    expect(out.map((s) => s.id)).toEqual(['s1', 'new-song'])
    expect(out[1]).toEqual({ id: 'new-song', folder: 'songs/Din-tid-kommer-a115f574' })
  })

  it('never invents, reorders or drops entries', () => {
    const before = [song('a'), song('b'), song('c')]
    const after = stampPulledSongs(before, new Map())
    expect(after.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(after).toEqual(before)
  })

  it('leaves fields it does not own alone', () => {
    const rich: ProjectSongEntry = {
      id: 's1',
      folder: 'songs/one',
      cloudSongId: 'cloud-1',
      hidden: true,
    }
    expect(stampPulledSongs([rich], synced)[0]).toEqual({
      ...rich,
      lastSyncedRevision: 12,
      lastSyncedContentHash: 'abc',
    })
  })

  it('a stamp for a song that is no longer there does NOT resurrect it', () => {
    // The mirror hazard: a song REMOVED during the pull must stay removed.
    // `removeSongFromProject` leaves files on disk by default, so a union-style
    // merge against the old snapshot would bring deleted songs back.
    expect(stampPulledSongs([], synced)).toEqual([])
    expect(stampPulledSongs([song('s2')], synced).map((s) => s.id)).toEqual(['s2'])
  })
})
