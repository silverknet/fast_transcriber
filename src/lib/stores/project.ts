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
  transposeSemitones?: number
  bpm?: number
  /**
   * Count-in beats from `cues.countInBeats` when `cues.mode === 'countIn'`.
   * Absent / 0 when the song has no count-in. Surfaced on the project song
   * card so users see at a glance how much lead-in each song carries
   * before Ableton playback (the count-in is baked into the click WAV).
   */
  countInBeats?: number
  /**
   * Persisted stem refs from the song's .smap — used by the project view
   * to render a stem-status overview without loading the full audio chunk.
   */
  stemRefs?: StemRefs
  /**
   * Audio content-identity hints, projected from the song's
   * `audio.{sha256,durationSec}`. Lets the project list show "audio
   * matched / missing / mismatch" badges per row (Phase 5 reconciler
   * writes the verdict; this carries the raw signal needed to compare
   * without loading the full .smap on every render).
   */
  audioSha256?: string
  audioDurationSec?: number
  /**
   * Stem renderings on disk grouped by quality preset. See
   * `ProjectSongMetadataInfo.stemsByPreset` for the schema. Empty/absent
   * when no stems exist yet.
   */
  stemsByPreset?: Record<string, string[]>
  hasAls?: boolean
  /** True iff a rendered cue track exists on disk. */
  hasCueTrack?: boolean
  /** True iff `<song>/cue/click-track.wav` exists on disk. */
  hasClickTrack?: boolean
  /**
   * True when the song's `.smap` names an audio source. Stub songs from
   * "Add empty" have no `audio` block; these get a dimmed audio badge on
   * the project card until the user opens them in the editor and uploads.
   */
  hasAudio?: boolean
  /**
   * True once the song has a beat grid (`metadata.analyzed` or bars present).
   * Drives the "Not analyzed" state on the project card so users can tell an
   * un-analyzed song apart from an analyzed one that just has no key yet.
   */
  analyzed?: boolean
  /**
   * Key from the cached chord-chroma analysis (`chordHints.detectedKey`).
   * Shown on the card when there's no committed `keyDetail`, and populated
   * for every analyzed song by the background key-detection pass
   * (`keyBackfill.ts`).
   */
  detectedKey?: SongKey
  /**
   * True when the key shown on the card is the DETECTED one (no committed
   * `keyDetail`) — the card renders it in a muted style to distinguish
   * "detected" from "set".
   */
  keyIsDetected?: boolean
}

export type ProjectEditingMode = 'project-song' | 'standalone' | null

export interface ProjectStoreState {
  /**
   * Absolute OS path to the project folder. Null when no project is open, and
   * — the one exception — null when a cloud project is open in BROWSER mode
   * (no local folder; storage is the cloud + IndexedDB). Otherwise non-null
   * whenever `data` is non-null. `osPath === null && data !== null` is the
   * "browser mode" signal.
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

/**
 * Open a cloud project in BROWSER mode — no local folder, `osPath` stays null.
 * File I/O goes to the cloud + IndexedDB, not the sidecar. This is the only
 * setter that leaves `data` non-null while `osPath` is null.
 */
export function setBrowserCloudProject(
  data: ProjectFile,
  metadataByFolder: Record<string, ProjectSongMetadataLite> = {},
): void {
  project.set({
    osPath: null,
    data,
    metadataByFolder,
    activeSongFolder: null,
    activeSongId: null,
    editingMode: null,
  })
}

/** True when a project is open with no local folder (cloud + IndexedDB only). */
export function isBrowserCloudProject(s: ProjectStoreState): boolean {
  return s.osPath === null && s.data !== null
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
