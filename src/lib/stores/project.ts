/**
 * BarBro project store — one project at a time.
 *
 * Canonical identity is the project's absolute OS path on disk. The desktop
 * sidecar is the only I/O layer for project files; the web app does not
 * touch the filesystem for project mode. A non-null `osPath` means a
 * project is open.
 *
 * `activeSongFolder` and `activeSongId` are always set together or both
 * null. They drive the autosave guard in `projectAutosave.ts` — if either
 * is null, autosave will not write to disk.
 */

import { get, writable } from 'svelte/store'
import type { ProjectFile } from '$lib/project/types'
import type { SongKey } from '$lib/songmap'
import type { StemRefs } from '$lib/songmap/types'

export interface ProjectSongMetadataLite {
  title: string
  artist?: string
  keyDetail?: SongKey
  bpm?: number
  /**
   * Persisted stem refs from the song's .smap — used by the project view
   * to render a stem-status overview without loading the full audio chunk.
   */
  stemRefs?: StemRefs
  /**
   * Stem renderings on disk grouped by quality preset. See
   * `ProjectSongMetadataInfo.stemsByPreset` for the schema. Empty/absent
   * when no stems exist yet.
   */
  stemsByPreset?: Record<string, string[]>
  hasAls?: boolean
  /** True iff `<song>/cue/cue-track.wav` exists on disk. */
  hasCueTrack?: boolean
  /** True iff `<song>/cue/click-track.wav` exists on disk. */
  hasClickTrack?: boolean
  /** Count-in beats before bar 1 when `cues.mode === 'countIn'`; absent otherwise. */
  countInBeats?: number
}

export type ProjectEditingMode = 'project-song' | 'standalone' | null

export interface ProjectStoreState {
  /**
   * Absolute OS path to the project folder. Null when no project is open;
   * always non-null when `data` is non-null.
   */
  osPath: string | null
  data: ProjectFile | null
  metadataByFolder: Record<string, ProjectSongMetadataLite>
  activeSongFolder: string | null
  activeSongId: string | null
  editingMode: ProjectEditingMode
}

const empty: ProjectStoreState = {
  osPath: null,
  data: null,
  metadataByFolder: {},
  activeSongFolder: null,
  activeSongId: null,
  editingMode: null,
}

export const project = writable<ProjectStoreState>(empty)

export function setActiveProject(
  osPath: string,
  data: ProjectFile,
  metadataByFolder: Record<string, ProjectSongMetadataLite> = {},
): void {
  project.set({
    osPath,
    data,
    metadataByFolder,
    activeSongFolder: null,
    activeSongId: null,
    editingMode: null,
  })
}

export function setProjectData(data: ProjectFile): void {
  project.update((s) => ({ ...s, data }))
}

export function setMetadataByFolder(map: Record<string, ProjectSongMetadataLite>): void {
  project.update((s) => ({ ...s, metadataByFolder: map }))
}

/**
 * Merge a partial patch into the cached lite metadata for one song folder.
 * Critical: this is a MERGE, not a replace. Disk-state fields (hasCueTrack,
 * hasClickTrack, hasAls, stemsOnDisk) live alongside songMap-derived fields
 * (title, bpm, etc.) — a caller updating one shouldn't wipe the other.
 *
 * Use `setMetadataByFolder` for the wholesale-replace path (called by
 * `refreshProjectInfo` with the sidecar's authoritative scan).
 */
export function patchMetadataForFolder(folder: string, patch: Partial<ProjectSongMetadataLite>): void {
  project.update((s) => {
    const existing = s.metadataByFolder[folder] ?? { title: '' }
    return {
      ...s,
      metadataByFolder: {
        ...s.metadataByFolder,
        [folder]: { ...existing, ...patch },
      },
    }
  })
}

export function setActiveSong(folder: string, id: string): void {
  project.update((s) => ({
    ...s,
    activeSongFolder: folder,
    activeSongId: id,
    editingMode: 'project-song',
  }))
}

export function clearActiveSong(): void {
  project.update((s) => ({
    ...s,
    activeSongFolder: null,
    activeSongId: null,
    editingMode: s.editingMode === 'project-song' ? null : s.editingMode,
  }))
}

export function markEditingStandalone(): void {
  project.update((s) => ({
    ...s,
    activeSongFolder: null,
    activeSongId: null,
    editingMode: 'standalone',
  }))
}

export function closeProject(): void {
  project.set(empty)
}

/** Quick read without subscribing. */
export function getProjectSnapshot(): ProjectStoreState {
  return get(project)
}
