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
import { fetchCloudSongs, getCloudProjectManifest, normalizeCloudSongMap, type CloudSongView } from './cloudSync'
import { collabContentFingerprint } from '$lib/songmap/collab'
import { metadataLiteFromSongMap, writeLastCloudProjectId } from '$lib/project/commit'
import { loadMixAudio } from '$lib/audio/loadAudio'
import { hydrateRestorableSong } from '$lib/stores/restorableSong'
import { audioSession } from '$lib/stores/audioSession'
import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
import {
  project,
  setActiveSong,
  setBrowserCloudProject,
  setProjectData,
  patchMetadataForFolder,
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
): Promise<
  { ok: true; songCount: number; skipped: number } | { ok: false; error: string }
> {
  const manifest = await getCloudProjectManifest(cloudProjectId)
  if (!manifest) return { ok: false, error: 'Could not load this cloud project.' }
  const songs = await fetchCloudSongs(cloudProjectId)

  registry.clear()
  let skipped = 0
  const entries: ProjectSongEntry[] = []
  const meta: Record<string, ProjectSongMetadataLite> = {}
  for (const cs of songs) {
    const sm = normalizeCloudSongMap(cs.song_map)
    if (!sm) {
      // COUNT IT. A song this build cannot read is skipped here, and silently
      // skipping EVERY song returned `{ ok: true, songCount: 0 }` — success,
      // with an empty project. That is what a stale deployment looks like from
      // the outside: barbro.app was serving a build from before the .smap
      // format went from 6 to 7, its parser threw "saved by a newer version of
      // BarBro" on all 17 songs, and this line threw the message away. The
      // owner's reasonable conclusion was that his gig data had been deleted.
      //
      // Nothing here can fix an out-of-date client. Saying so can.
      skipped++
      continue
    }
    const folder = folderFor(cs.id)
    const bs: BrowserSong = {
      cloudSongId: cs.id,
      folder,
      songMap: sm,
      cloudAudio: (cs.cloud_audio as CloudAudioManifest | null) ?? null,
    }
    registry.set(folder, bs)
    registry.set(cs.id, bs)
    // Seed the per-song sync watermark from the fetched row, exactly like the
    // desktop `joinCloudProject` does. Without this the first push computes its
    // conflict base from the coarser PROJECT revision (a fragile coincidence),
    // and 409 handling can't tell "user changed nothing" from a real conflict.
    entries.push({
      id: cs.id,
      folder,
      cloudSongId: cs.id,
      lastSyncedRevision: cs.revision,
      lastSyncedContentHash: collabContentFingerprint(sm),
      ...(cs.hidden ? { hidden: true } : {}),
    })
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
  // Remember this as the last session so a hard refresh re-opens it (browser
  // mode has no disk folder for the desktop restore path to find).
  writeLastCloudProjectId(cloudProjectId)
  return { ok: true, songCount: entries.length, skipped }
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
        // Browser-cloud song: no local disk folder, so the failsafe must NOT
        // block the cloud copy even when the sidecar happens to be running.
        localProjectPresent: false,
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
    // Fresh song → clear the previous "ignore missing audio" opt-out. Then, if
    // the audio genuinely couldn't be obtained, flag the session so the editor
    // shows a REAL "audio unavailable here" message instead of the generic
    // "No analyzed clip in session" dead-end (the song itself loaded fine).
    audioSession.update((s) => ({ ...s, missingAudioIgnored: false }))
    if (loaded.source === 'missing') {
      audioSession.update((s) => ({ ...s, missingReason: 'cloud-audio-unavailable' }))
    }
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

/**
 * The in-memory base map held for a browser cloud song — the "disk" equivalent a
 * live pull merges a remote change against for a NON-active song (the active song
 * merges against the live `songMap` store instead). Null when the song isn't in
 * the open project.
 */
export function getBrowserCloudSongMap(songId: string): SongMap | null {
  return registry.get(songId)?.songMap ?? null
}

/**
 * Replace a browser cloud song's held map (and optionally its cloud-audio
 * manifest) after a live pull merged a remote change in. The registry keys both
 * `folder` and `cloudSongId` to the SAME object, so this refreshes both — so a
 * later `loadCloudSongIntoEditor` for a non-active song opens the fresh copy.
 */
export function updateBrowserCloudSong(
  songId: string,
  songMap: SongMap,
  cloudAudio?: CloudAudioManifest | null,
): void {
  const bs = registry.get(songId)
  if (!bs) return
  bs.songMap = songMap
  if (cloudAudio !== undefined) bs.cloudAudio = cloudAudio
}

/**
 * Materialize a song a collaborator ADDED while we had the project open — create
 * its registry entry (so it's openable), append it to the project's song list
 * with the sync watermark seeded (so it appears in the list and its next pull
 * doesn't 409), and refresh its card metadata. Takes the already-normalized
 * `songMap` the pull worker computed, to avoid re-parsing. Idempotent on id.
 */
export function addBrowserCloudSong(cs: CloudSongView, songMap: SongMap): void {
  const folder = folderFor(cs.id)
  const bs: BrowserSong = { cloudSongId: cs.id, folder, songMap, cloudAudio: cs.cloud_audio }
  registry.set(folder, bs)
  registry.set(cs.id, bs)

  const cur = get(project)
  if (cur.data && !cur.data.songs.some((s) => s.id === cs.id)) {
    const entry: ProjectSongEntry = {
      id: cs.id,
      folder,
      cloudSongId: cs.id,
      lastSyncedRevision: cs.revision,
      lastSyncedContentHash: collabContentFingerprint(songMap),
      ...(cs.hidden ? { hidden: true } : {}),
    }
    setProjectData({ ...cur.data, songs: [...cur.data.songs, entry] })
  }
  patchMetadataForFolder(folder, metadataLiteFromSongMap(songMap))
}

/** The cloud-audio manifest for a song in the open browser cloud project. */
export function getBrowserCloudAudio(songId: string): CloudAudioManifest | null {
  return registry.get(songId)?.cloudAudio ?? null
}
