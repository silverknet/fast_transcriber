/**
 * Browser-only project mode: open a shared cloud project with NO local folder
 * and NO sidecar, and load a song into the editor with its audio coming from the
 * cloud AAC. This is the consumer/collaborator entry — the orthogonal twin of
 * the desktop local-folder path (`commit.ts`).
 *
 * Songs (their `.smap` + cloud-audio manifest) are held in memory; audio is
 * obtained through the single audio-source boundary (`loadMixAudio`), so the
 * fidelity failsafe still applies (if the sidecar is somehow reachable, the
 * boundary refuses the cloud copy).
 */
import { get } from 'svelte/store'
import { fetchCloudSongs, getCloudProjectManifest, normalizeCloudSongMap } from './cloudSync'
import { metadataLiteFromSongMap } from '$lib/project/commit'
import { loadMixAudio } from '$lib/audio/loadAudio'
import { hydrateRestorableSong } from '$lib/stores/restorableSong'
import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
import {
  setActiveSong,
  setBrowserCloudProject,
  type ProjectSongMetadataLite,
} from '$lib/stores/project'
import { PROJECT_FILE_VERSION, PROJECT_SONGS_DIR } from '$lib/project/types'
import type { ProjectFile, ProjectSongEntry } from '$lib/project/types'
import type { CloudAudioManifest } from './cloudAudio'
import type { AudioSource } from '$lib/audio/resolveAudioSource'
import type { SongMap } from '$lib/songmap/types'

interface BrowserSong {
  cloudSongId: string
  folder: string
  songMap: SongMap
  cloudAudio: CloudAudioManifest | null
}

/** In-memory roster of the open browser cloud project (keyed by folder AND id). */
const registry = new Map<string, BrowserSong>()

/** Synthetic, stable folder key for a cloud song (no disk path exists). */
function folderFor(cloudSongId: string): string {
  return `${PROJECT_SONGS_DIR}/${cloudSongId.slice(0, 8)}`
}

/**
 * Open a cloud project in the browser: fetch its manifest + songs, hold them in
 * memory, and populate the project store with `osPath: null`. No sidecar, no
 * disk. Returns the number of songs loaded.
 */
export async function openCloudProjectInBrowser(
  cloudProjectId: string,
): Promise<{ ok: true; songCount: number } | { ok: false; error: string }> {
  const manifest = await getCloudProjectManifest(cloudProjectId)
  if (!manifest) return { ok: false, error: 'Could not load this cloud project.' }
  const songs = await fetchCloudSongs(cloudProjectId)

  registry.clear()
  const entries: ProjectSongEntry[] = []
  const meta: Record<string, ProjectSongMetadataLite> = {}
  for (const cs of songs) {
    const sm = normalizeCloudSongMap(cs.song_map)
    if (!sm) continue
    const folder = folderFor(cs.id)
    const bs: BrowserSong = {
      cloudSongId: cs.id,
      folder,
      songMap: sm,
      cloudAudio: (cs.cloud_audio as CloudAudioManifest | null) ?? null,
    }
    registry.set(folder, bs)
    registry.set(cs.id, bs)
    entries.push({ id: cs.id, folder, cloudSongId: cs.id, ...(cs.hidden ? { hidden: true } : {}) })
    meta[folder] = metadataLiteFromSongMap(sm)
  }

  const now = new Date().toISOString()
  const data: ProjectFile = {
    formatVersion: PROJECT_FILE_VERSION,
    id: cloudProjectId,
    name: manifest.project.name,
    createdAt: now,
    updatedAt: now,
    songs: entries,
    cloud: { projectId: cloudProjectId, lastSyncedRevision: manifest.project.revision },
  }
  setBrowserCloudProject(data, meta)
  return { ok: true, songCount: entries.length }
}

/**
 * Load a song from the open browser cloud project into the editor. Audio comes
 * from the cloud via the boundary; the editor is source-agnostic. Returns the
 * resolved audio `source` for display ("cloud" / "missing").
 */
export async function loadCloudSongIntoEditor(
  songId: string,
): Promise<{ ok: true; source: AudioSource } | { ok: false; error: string }> {
  const bs = registry.get(songId)
  if (!bs) return { ok: false, error: 'That song is not part of the open cloud project.' }
  try {
    const loaded = await loadMixAudio(
      {
        sidecarReachable: get(desktopCompanionStatus).reachable,
        songId: bs.cloudSongId,
        localAudioAvailable: false, // browser mode: there is no local master
        cloudAudio: bs.cloudAudio,
      },
      {
        // Never invoked in browser mode; present to satisfy the boundary's shape.
        loadLocal: async () => {
          throw new Error('No local audio in browser mode.')
        },
      },
    )
    hydrateRestorableSong({ songMap: bs.songMap, audioBlob: loaded.blob, songId: bs.cloudSongId })
    setActiveSong(bs.folder, bs.cloudSongId)
    return { ok: true, source: loaded.source }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** True if `songId` (or folder) is in the open browser cloud project. */
export function hasBrowserCloudSong(songId: string): boolean {
  return registry.has(songId)
}
