/**
 * Browser-mode live RECEIVE. The desktop pull (`cloudSync.pullCloudChanges` →
 * `applyCloudSongIntoLocal`) merges remote changes into each song's `.smap` on
 * DISK; browser/collab mode has no disk, so this is the parallel worker that
 * merges them into the in-memory `registry` (all songs) and the live `songMap`
 * store (the open song) instead.
 *
 * It reuses every source-agnostic primitive the desktop path uses —
 * `fetchCloudSongs` (delta by revision), `normalizeCloudSongMap`, the content-
 * hash self-echo guard, and `applyRemoteSongMap` (which merges + installs via
 * the undo-safe `patchSongMapRemote`). The only differences are: base map comes
 * from the registry, the merged result is written back to the registry, and
 * there is no manifest persistence.
 *
 * Lives in its own module (not `cloudSync.ts`) because `browserCloudProject.ts`
 * statically imports `cloudSync`, so `cloudSync` reaches this worker via a
 * dynamic `import()` to avoid a static import cycle.
 */
import { get } from 'svelte/store'
import { project as projectStore, setProjectData, patchMetadataForFolder } from '$lib/stores/project'
import { songMap } from '$lib/stores/songMap'
import { applyRemoteSongMap } from '$lib/project/songSession'
import { metadataLiteFromSongMap } from '$lib/project/commit'
import { collabContentFingerprint } from '$lib/songmap/collab'
import { cloudConflict } from '$lib/stores/cloudConflict'
import { getCloudProjectManifest, fetchCloudSongs, normalizeCloudSongMap, type CloudSongView } from './cloudSync'
import { getBrowserCloudSongMap, updateBrowserCloudSong, addBrowserCloudSong } from './browserCloudProject'
import type { ProjectFile } from '$lib/project/types'

/**
 * Merge one cloud song into browser-mode memory. Mirrors `applyCloudSongIntoLocal`
 * minus disk I/O. Returns the sync watermark to stamp, or null (skip) for a
 * self-echo, an unmigratable row, or a not-yet-known song.
 */
async function applyCloudSongIntoBrowser(
  proj: ProjectFile,
  cloudSong: CloudSongView,
): Promise<{ songId: string; revision: number; contentHash: string; changed: boolean; title: string } | null> {
  try {
    const incoming = normalizeCloudSongMap(cloudSong.song_map)
    if (!incoming) {
      console.warn(`[browserCloudPull] skipping unmigratable song ${cloudSong.id}`)
      return null
    }
    const entry = proj.songs.find((s) => s.id === cloudSong.id)
    if (!entry) {
      // New song added by a collaborator — materialize it so it appears in the
      // project list live and is openable (registry + list entry + card).
      addBrowserCloudSong(cloudSong, incoming)
      return {
        songId: cloudSong.id,
        revision: cloudSong.revision,
        contentHash: collabContentFingerprint(incoming),
        changed: true,
        title: incoming.metadata?.title ?? '',
      }
    }

    const incomingHash = collabContentFingerprint(incoming)
    // Self-echo guard (identical to the desktop worker): our own push echoing
    // back, or an unchanged song → advance the watermark, install nothing.
    if (entry.lastSyncedContentHash && entry.lastSyncedContentHash === incomingHash) {
      return {
        songId: cloudSong.id,
        revision: cloudSong.revision,
        contentHash: entry.lastSyncedContentHash,
        changed: false,
        title: incoming.metadata?.title ?? '',
      }
    }

    // Base map = the registry snapshot (the "disk" equivalent). For the ACTIVE
    // song `applyRemoteSongMap` merges against the live `songMap` and installs
    // via `patchSongMapRemote`; for others it just computes `merged`.
    const base = getBrowserCloudSongMap(cloudSong.id) ?? incoming
    const plan = applyRemoteSongMap({
      songId: cloudSong.id,
      incoming,
      disk: base,
      lastSyncedContentHash: entry.lastSyncedContentHash,
      expectedAudio: cloudSong.expected_audio ?? undefined,
    })
    if (plan.needsUserResolution && plan.report) {
      // Structural remote change on a mid-edit song — surface the conflict dialog
      // instead of silently picking a side. Skip: no install, no watermark
      // advance, so it re-fires until the user resolves it.
      if (get(cloudConflict) === null) {
        cloudConflict.set({
          cloudProjectId: proj.cloud!.projectId,
          cloudSongId: cloudSong.id,
          localSongId: entry.id,
          local: get(songMap) ?? base,
          remote: incoming,
          remoteRevision: cloudSong.revision,
          report: plan.report,
        })
      }
      return null
    }

    // Keep the registry in lockstep: for the active song `songMap` now holds the
    // installed merge; for others `plan.merged` is the fresh copy.
    const registryMap = plan.appliedToMemory ? (get(songMap) ?? plan.merged) : plan.merged
    updateBrowserCloudSong(cloudSong.id, registryMap, cloudSong.cloud_audio)
    // Refresh the project-list card (title/key/bpm) live.
    patchMetadataForFolder(entry.folder, metadataLiteFromSongMap(registryMap))

    return {
      songId: cloudSong.id,
      revision: cloudSong.revision,
      contentHash: collabContentFingerprint(registryMap),
      changed: true,
      title: registryMap.metadata?.title ?? '',
    }
  } catch (e) {
    console.warn(`[browserCloudPull] skipping malformed song ${cloudSong.id}:`, e)
    return null
  }
}

/**
 * Browser-mode counterpart of `pullCloudChanges`. Same return shape (so
 * `cloudAutoPull`'s toast works unchanged), but merges into memory and does NOT
 * persist a manifest. Reached via a dispatch branch in `pullCloudChanges`.
 */
export async function pullCloudChangesBrowser(): Promise<
  | { ok: true; pulledSongs: number; revision: number; changedTitles: string[] }
  | { ok: false; error: string }
> {
  const snap = get(projectStore)
  const proj = snap.data
  if (!proj || snap.osPath !== null || !proj.cloud) {
    return { ok: false, error: 'No browser cloud project.' }
  }
  const cloudProjectId = proj.cloud.projectId

  const manifest = await getCloudProjectManifest(cloudProjectId)
  if (!manifest) return { ok: false, error: 'Could not fetch cloud manifest.' }

  const songs = await fetchCloudSongs(cloudProjectId, proj.cloud.lastSyncedRevision)

  const syncedBySong = new Map<string, { revision: number; contentHash: string }>()
  const changedTitles: string[] = []
  for (const cloudSong of songs) {
    const res = await applyCloudSongIntoBrowser(proj, cloudSong)
    if (!res) continue
    syncedBySong.set(res.songId, { revision: res.revision, contentHash: res.contentHash })
    if (res.changed) changedTitles.push(res.title || 'Untitled song')
  }

  // Re-read: the loop patched `metadataByFolder` (preserved by setProjectData)
  // and Phase E may append new songs to `data.songs`.
  const latest = get(projectStore).data ?? proj
  const nextManifest: ProjectFile = {
    ...latest,
    name: manifest.project.name,
    songs: latest.songs.map((s) => {
      const u = syncedBySong.get(s.id)
      return u ? { ...s, lastSyncedRevision: u.revision, lastSyncedContentHash: u.contentHash } : s
    }),
    cloud: {
      ...(latest.cloud ?? proj.cloud),
      lastSyncedRevision: manifest.project.revision,
      lastPulledAt: new Date().toISOString(),
    },
  }
  setProjectData(nextManifest)
  // No `persistManifest` — browser mode has no disk.
  return {
    ok: true,
    pulledSongs: songs.length,
    revision: manifest.project.revision,
    changedTitles,
  }
}
