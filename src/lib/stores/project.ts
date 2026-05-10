/**
 * BarBro project store — one project at a time.
 *
 * Holds: the picked folder handle, the parsed manifest, a per-song metadata
 * cache for the list view, and which song (if any) is currently being edited
 * via the project flow.
 *
 * `activeSongFolder` and `activeSongId` are always set together or both
 * null. They drive the autosave guard in `projectAutosave.ts` — if either
 * is null, autosave will not write to disk.
 */

import { get, writable } from 'svelte/store'
import type { ProjectFile } from '$lib/project/types'
import type { SongKey } from '$lib/songmap'

export interface ProjectSongMetadataLite {
  title: string
  artist?: string
  keyDetail?: SongKey
  bpm?: number
}

export type ProjectEditingMode = 'project-song' | 'standalone' | null

export interface ProjectStoreState {
  folderHandle: FileSystemDirectoryHandle | null
  data: ProjectFile | null
  metadataByFolder: Record<string, ProjectSongMetadataLite>
  activeSongFolder: string | null
  activeSongId: string | null
  editingMode: ProjectEditingMode
}

const empty: ProjectStoreState = {
  folderHandle: null,
  data: null,
  metadataByFolder: {},
  activeSongFolder: null,
  activeSongId: null,
  editingMode: null,
}

export const project = writable<ProjectStoreState>(empty)

export function setActiveProject(
  folderHandle: FileSystemDirectoryHandle,
  data: ProjectFile,
  metadataByFolder: Record<string, ProjectSongMetadataLite> = {},
): void {
  project.set({
    folderHandle,
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

export function patchMetadataForFolder(folder: string, meta: ProjectSongMetadataLite): void {
  project.update((s) => ({
    ...s,
    metadataByFolder: { ...s.metadataByFolder, [folder]: meta },
  }))
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
