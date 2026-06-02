/**
 * Public entrypoint for the project setlist .als export.
 *
 * Internal modules:
 *   - `timings.ts`       — pure timing math + per-clip play ranges
 *   - `clickRender.ts`   — song-aligned click WAV generation
 *   - `preflight.ts`     — read-only export readiness check
 *   - `orchestrator.ts`  — end-to-end export pipeline
 */

export {
  exportProjectSetAls,
  CLICK_TRACK_SUBPATH,
  type SetlistExportArgs,
  type SetlistExportResult,
} from './orchestrator'

export {
  preflightProjectSetlist,
  type SetlistPreflightStatus,
  type SetlistPreflightSong,
} from './preflight'

export {
  songTimings,
  stemPlayRange,
  clickPlayRange,
  DEFAULT_BPM,
  type SongTimings,
  type ClipPlayRange,
} from './timings'
