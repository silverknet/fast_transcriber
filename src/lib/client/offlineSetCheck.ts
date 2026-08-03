/**
 * Walk a project's songs and report what would be missing at a venue.
 *
 * The disk half of {@link offlineReadiness}: that module decides WHAT a song
 * needs, this one asks the sidecar whether it is there. Split so the rules stay
 * testable without a project on hand, and so there is one place that knows how
 * to ask.
 *
 * ## Why a ranged read rather than a download
 *
 * The only question is "does this file exist and have bytes in it". Downloading
 * a set's worth of stems to answer that would take minutes and a lot of memory,
 * so each check asks for the FIRST BYTE only. A zero-length file fails, which is
 * what we want — a truncated stem from an interrupted sync is exactly the kind
 * of thing that reads as present and plays as silence.
 */
import { BARBRO_DESKTOP_BEACON_PORT } from '$lib/client/desktopBeacon'
import { decodeSmapBytes } from '$lib/songmap/smapFile'
import {
  requiredAssetsForSong,
  setReadiness,
  songReadiness,
  type RequiredAsset,
  type SetReadiness,
  type SongReadiness,
} from '$lib/project/offlineReadiness'
import { readProjectSong } from '$lib/client/desktopProjectFs'
import type { SongMap } from '$lib/songmap/types'

const BASE_URL = `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`

/** Is this asset really on disk, with at least one byte? */
export async function assetPresent(
  projectPath: string,
  songFolder: string,
  subpath: string,
): Promise<boolean> {
  const url = new URL(`${BASE_URL}/native/project/song/asset/read`)
  url.searchParams.set('projectPath', projectPath)
  url.searchParams.set('songFolder', songFolder)
  url.searchParams.set('subpath', subpath)
  try {
    const res = await fetch(url.toString(), {
      cache: 'no-store',
      headers: { Range: 'bytes=0-0' },
    })
    if (!res.ok && res.status !== 206) return false
    const body = await res.arrayBuffer()
    return body.byteLength > 0
  } catch {
    return false // sidecar unreachable — treat as not ready rather than assume
  }
}

export type SetCheckProgress = { done: number; total: number; song: string }

export type ProjectSongRef = { id: string; folder: string }

/**
 * Check every song in the set.
 *
 * Songs are checked one at a time on purpose: this runs against a local disk
 * while the app may also be loading audio, and a burst of parallel reads makes
 * the progress meaningless without making it meaningfully faster.
 */
export async function checkSetForOffline(
  projectPath: string,
  songs: readonly ProjectSongRef[],
  onProgress?: (p: SetCheckProgress) => void,
): Promise<SetReadiness> {
  const results: SongReadiness[] = []
  let done = 0

  for (const song of songs) {
    let sm: SongMap | null = null
    const read = await readProjectSong(projectPath, song.folder)
    if (read.ok) {
      try {
        sm = decodeSmapBytes(read.bytes).project.songMap
      } catch {
        sm = null
      }
    }

    if (!sm) {
      // The `.smap` itself is unreadable, so nothing else about this song can
      // be established. Reported as a blocker rather than skipped.
      results.push({
        songId: song.id,
        title: song.folder,
        assets: [],
        playable: false,
        complete: false,
        summary: 'Song file could not be read on this machine.',
      })
      done++
      onProgress?.({ done, total: songs.length, song: song.folder })
      continue
    }

    const presence = new Map<string, boolean>()
    for (const asset of requiredAssetsForSong(sm)) {
      presence.set(asset.subpath, await assetPresent(projectPath, song.folder, asset.subpath))
    }

    results.push(
      songReadiness(song.id, sm, (a: RequiredAsset) => presence.get(a.subpath) === true),
    )
    done++
    onProgress?.({ done, total: songs.length, song: sm.metadata?.title || song.folder })
  }

  return setReadiness(results)
}
