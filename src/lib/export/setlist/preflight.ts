/**
 * Preflight checks for the project setlist export. Pure read-only —
 * inspects the project store's per-folder metadata and returns a
 * per-song "ready / not ready" status without touching disk.
 *
 * The dialog uses this to show users WHY a song will or won't be
 * included before they hit "Export."
 */

import { STEM_TRACKS } from '$lib/export/abletonSet'
import { getExportableSongs } from '$lib/project/types'
import type { ProjectFile } from '$lib/project/types'
import type { ProjectSongMetadataLite } from '$lib/stores/project'

export type SetlistPreflightSong = {
  songId: string
  folder: string
  title: string
  /** Counts of stems present in this song's metadata (out of `STEM_TRACKS.length`). */
  stemCount: number
  /** Non-empty when the song would be skipped. */
  blocker: string | null
}

export type SetlistPreflightStatus = {
  /** True iff at least one song is exportable. */
  ok: boolean
  songs: SetlistPreflightSong[]
}

export function preflightProjectSetlist(
  project: ProjectFile,
  metadataByFolder: Record<string, ProjectSongMetadataLite | undefined>,
): SetlistPreflightStatus {
  const songs: SetlistPreflightSong[] = []
  for (const entry of getExportableSongs(project)) {
    const meta = metadataByFolder[entry.folder]
    const stemRefs = meta?.stemRefs ?? {}
    let stemCount = 0
    for (const t of STEM_TRACKS) if (stemRefs[t.name]) stemCount++
    let blocker: string | null = null
    if (!meta) blocker = 'No metadata — refresh the project.'
    else if (stemCount === 0) blocker = 'No stems yet — split stems first.'
    songs.push({
      songId: entry.id,
      folder: entry.folder,
      title: meta?.title ?? entry.folder,
      stemCount,
      blocker,
    })
  }
  return {
    ok: songs.length > 0 && songs.every((s) => s.blocker == null),
    songs,
  }
}
