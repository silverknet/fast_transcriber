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
   * Project-wide STEM TARGET (shared config): which `stems` at what `quality`
   * the project wants prepared. This is the source of truth for the SET of
   * stems, shared with collaborators. Whether a given MACHINE actually
   * auto-generates them is a separate, per-machine choice (the sidecar's
   * watch list) — so a collaborator on a weak laptop can leave auto-prep off
   * and wait for the owner's package without changing this config.
   */
  autoStems?: ProjectAutoStems
  /**
   * Project-wide defaults (shared config): applied to songs as their starting
   * point, overridable per song. Only ever written via `setProjectDefaults`.
   */
  defaults?: ProjectDefaults
  /**
   * Project-wide "sound" (shared config): loudness matching + per-stem
   * dynamics so drums/bass sit consistently across every song. Applied live in
   * the mixer and to backing-track exports. Only written via
   * `setProjectMastering`.
   */
  mastering?: ProjectMastering
  /**
   * The band roster (shared config): who performs in this project. Custom cues
   * can target a performer, and live mode routes a performer to an output
   * channel. Only ever written via `setProjectPerformers`.
   */
  performers?: Performer[]
}

/** How firmly a stem's levels are evened out (compression preset intensity). */
export type MasteringIntensity = 'off' | 'light' | 'firm'

/** Tone character: 'shaped' applies the stem-appropriate EQ preset (rich low
 * end for bass, punch + clarity for drums, presence for vocals/other). */
export type StemTone = 'natural' | 'shaped'

/** Per-stem sound settings inside the project mastering config. */
export interface StemSound {
  /** Envelope evening (compression). Absent = 'off'. */
  intensity?: MasteringIntensity
  /** Level trim in dB, applied after loudness matching. Clamped to ±9. */
  trimDb?: number
  /** Tone shaping preset. Absent = 'natural' (no EQ). */
  tone?: StemTone
}

export interface ProjectMastering {
  /** Master switch — false/absent = fully bypassed everywhere. */
  enabled: boolean
  /**
   * Bring each stem toward a fixed per-type loudness target so the same stem
   * sits at the same level in every song of the project.
   */
  matchLoudness?: boolean
  /** Per-stem sound (level trim, evening, tone). */
  stems?: Partial<Record<AutoStemName, StemSound>>
  /** Gentle glue compression + a safety limiter on the summed master bus. */
  masterGlue?: boolean
  /**
   * How hard the KICK inside the drums stem hits, 0…1 (absent/0 = untouched).
   * Drums-only: it works by compressing the sub-110 Hz band — which in a drums
   * stem is the kick and nothing else — in parallel with the dry lane. Playback
   * processing only; the stem file is never rewritten.
   */
  kickPunch?: number
}

/**
 * A performer in the band (shared config, syncs with collaborators). The
 * optional `userId` links the performer to a signed-in account — not required.
 * Custom cues can target a performer, and in live mode a performer maps to an
 * output channel (both built on top of this).
 */
export interface Performer {
  /** crypto.randomUUID() — stable identity. */
  id: string
  /** Display name, e.g. "Martin". */
  name: string
  /** Instrument / role, e.g. "Keyboards", "Vocals". */
  role?: string
  /** Optional link to a signed-in user's account id. Not compulsory. */
  userId?: string
  /**
   * XR18 aux bus (1-6) driving this performer's in-ear monitor mix. Which
   * performer is on which bus is band setup, so it's shared/synced; the exact
   * send levels live in the per-device live-rig config.
   */
  monitorBus?: number
}

export interface ProjectDefaults {
  /** Default count-in beats for songs in this project (per-song overridable). */
  countInBeats?: number
  /** Default pre-count-in spoken cue (Phase B). */
  preCountInCue?: PreCountInCueConfig
  /**
   * Which Demucs stems are AUDIBLE by default in live/playback mode. Applied to
   * every song on load, overriding each song's saved mute/solo — so the whole
   * set starts from one backing-track configuration (e.g. a gig with no live
   * drummer/bassist → `['drums', 'bass']`). `undefined` = the legacy default
   * (every stem audible except vocals). A song lacking the selected stems falls
   * back to its full original mix so it is never silent on stage.
   */
  liveStems?: AutoStemName[]
}

/**
 * Project-wide SONG ANNOUNCEMENT (the spoken song name before a song):
 *   - `auto`      speaks the name automatically when you start the song,
 *   - `triggered` speaks it only when you fire it from the controller,
 *   - `off`       never.
 * The text is each song's own title (overridable per song). Applies to every
 * song in the project — all or none.
 */
export type PreCountInCueMode = 'off' | 'auto' | 'triggered'

export interface PreCountInCueConfig {
  mode: PreCountInCueMode
  /** Legacy per-project custom phrase; announcements now default to each song's title. */
  text?: string
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
  /**
   * `collabContentFingerprint()` of the song's shared content the last time
   * it was successfully pushed or pulled. Lets the autosave skip no-op pushes
   * and lets 409 handling tell "the user changed nothing" (fast-forward) from
   * "both sides edited" (real conflict) — see `projectAutosave.ts`.
   */
  lastSyncedContentHash?: string
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
