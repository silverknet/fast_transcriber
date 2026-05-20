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
