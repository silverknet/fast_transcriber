/**
 * BarBro project (set / tour / gig) — top-level container that groups songs.
 *
 * Disk layout:
 *
 * ```
 * MyTour2026/
 * ├── barbro.project.json
 * ├── songs/
 * │   ├── opener-7f3a9c2d/
 * │   │   ├── song.smap
 * │   │   └── ...
 * │   └── heavy-tune-91c2ab8f/
 * │       └── song.smap
 * └── exports/
 * ```
 *
 * Title / artist / key / bpm are NOT duplicated here — they live inside each
 * song's .smap and are loaded into a per-folder cache for the list view.
 */

export const PROJECT_FILE_VERSION = 1 as const
export const PROJECT_FILENAME = 'barbro.project.json'
export const PROJECT_SONGS_DIR = 'songs'

export interface ProjectFile {
  formatVersion: typeof PROJECT_FILE_VERSION
  /** crypto.randomUUID() — stable identity for the project as a whole. */
  id: string
  name: string
  /** ISO timestamp. */
  createdAt: string
  /**
   * Last time the project manifest changed:
   * project rename, add/remove song, hide/unhide, reorder.
   * Does NOT update when individual song.smap files are edited.
   */
  updatedAt: string
  /** Order of this array IS the setlist order. */
  songs: ProjectSongEntry[]
  /**
   * Cloud-collab linkage. Absent on standalone (local-only) projects.
   * Populated by `createCloudProject` / `joinCloudProject` in Phase 4.
   * Local-only fields here MUST NOT round-trip to the cloud — they
   * describe this device's view of sync state.
   */
  cloud?: ProjectCloudLink
  /**
   * Project-wide auto stem-separation policy. When `enabled`, the desktop
   * companion renders the listed `stems` at `quality` for every non-hidden
   * song with audio, in the background. Absent on projects that never
   * configured it (treated as disabled).
   */
  autoStems?: ProjectAutoStems
}

/** Demucs stem slots the auto-splitter can target. Matches `StemName` in desktopBridge. */
export type AutoStemName = 'vocals' | 'drums' | 'bass' | 'other'

/** Quality preset slugs. Matches the `slug` field of `STEM_QUALITY_PRESETS`. */
export type AutoStemQuality = 'best' | 'balanced' | 'preview'

export const AUTO_STEM_NAMES: readonly AutoStemName[] = ['vocals', 'drums', 'bass', 'other']
export const AUTO_STEM_QUALITIES: readonly AutoStemQuality[] = ['best', 'balanced', 'preview']

export interface ProjectAutoStems {
  /** Master switch. When false the scheduler does nothing for this project. */
  enabled: boolean
  /** Which stems every song should end up with. Empty = nothing to do. */
  stems: AutoStemName[]
  /** Target render quality. Stems below this tier get re-rendered up to it. */
  quality: AutoStemQuality
}

export interface ProjectCloudLink {
  /** Matches `cloud_projects.id`. Equal to `ProjectFile.id` at create-collab time. */
  projectId: string
  /** Last `cloud_projects.revision` this device successfully pulled and applied. */
  lastSyncedRevision: number
  /** Count of un-pushed song edits since the last successful push. */
  pendingChanges?: number
  /** ISO timestamp of the most recent successful push. */
  lastPushedAt?: string
  /** ISO timestamp of the most recent successful pull. */
  lastPulledAt?: string
}

export interface ProjectSongEntry {
  /** crypto.randomUUID() — stable identity for the song inside this project. */
  id: string
  /**
   * Normalized relative path from project root.
   * Example: `"songs/opener-7f3a9c2d"`.
   * Validated on parse: relative, forward-slash only, no `..`, no leading
   * slash, must start with `"songs/"` in v1.
   */
  folder: string
  /** Excluded from any bulk/set export. Still visible in the list. */
  hidden?: boolean
  /**
   * Matches `cloud_songs.id` for cloud-linked songs. Equal to
   * `ProjectSongEntry.id` at create-collab time so we don't need an id
   * remapping table. Absent for songs created locally after a project
   * was linked (they get one once the next push succeeds).
   */
  cloudSongId?: string
  /** Last `cloud_songs.revision` this device pulled for this song. */
  lastSyncedRevision?: number
}

/**
 * Validate a project-relative folder path. Throws on violation.
 * Used in parse.ts to fail-open on bad manifests rather than silently
 * accept dangerous paths that drive future filesystem writes.
 */
export function validateProjectFolderPath(p: unknown, label: string = 'folder'): string {
  if (typeof p !== 'string' || p.length === 0) {
    throw new Error(`Invalid ${label}: must be a non-empty string`)
  }
  if (p.startsWith('/')) {
    throw new Error(`Invalid ${label}: must not start with "/"`)
  }
  if (p.includes('\\')) {
    throw new Error(`Invalid ${label}: must use forward slashes, not backslashes`)
  }
  if (p.endsWith('/')) {
    throw new Error(`Invalid ${label}: must not end with "/"`)
  }
  if (p.includes('//')) {
    throw new Error(`Invalid ${label}: must not contain "//"`)
  }
  const parts = p.split('/')
  for (const seg of parts) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new Error(`Invalid ${label}: must not contain "." or ".." segments`)
    }
  }
  if (!p.startsWith(`${PROJECT_SONGS_DIR}/`)) {
    throw new Error(`Invalid ${label}: must start with "${PROJECT_SONGS_DIR}/"`)
  }
  return p
}

/**
 * Single helper used by every loop that walks the project for export
 * purposes (Ableton bulk export, future PDF set list, future cloud sync).
 * Hidden entries are filtered out at the source so future code can't
 * accidentally include them.
 */
export function getExportableSongs(project: ProjectFile): ProjectSongEntry[] {
  return project.songs.filter((s) => !s.hidden)
}

/** Returns the leaf folder name from `"songs/opener-7f3a9c2d"` → `"opener-7f3a9c2d"`. */
export function songFolderLeaf(folder: string): string {
  const ix = folder.lastIndexOf('/')
  return ix === -1 ? folder : folder.slice(ix + 1)
}
