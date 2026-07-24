import { derived } from 'svelte/store'
import { desktopCompanionStatus } from './desktopCompanionStatus'
import { project } from './project'
import { audioSession } from './audioSession'
import { cloudDiskPaths } from './cloudDiskPaths'

/**
 * The app's operating mode, derived from whether the desktop sidecar is
 * reachable. Two product modes:
 *
 *  - `'studio'`  (desktop client present) → **Studio mode**: full features +
 *    local **HD audio**. Analysis, stems, transcription, TTS all available; the
 *    local WAV master is the audio.
 *  - `'collab'`  (no desktop client) → **Collab mode**: cloud-only. Play + edit
 *    chords/sections + live-collaborate on the compressed cloud audio. No
 *    sidecar compute.
 *
 * Single source of truth for the navbar mode badge, feature gating, and — via
 * `desktopCompanionStatus.reachable` — the `resolveAudioSource` fidelity
 * failsafe (which must NEVER serve cloud audio while in Studio mode).
 */
export type AppMode = 'studio' | 'collab'

export const appMode = derived(
  desktopCompanionStatus,
  ($s): AppMode => ($s.reachable ? 'studio' : 'collab'),
)

/** Short badge label per mode. Change here to rename the modes everywhere. */
export const MODE_LABEL: Record<AppMode, string> = {
  studio: 'Studio',
  collab: 'Collab',
}

/** One-line description of what each mode is + which audio it uses. */
export const MODE_TAGLINE: Record<AppMode, string> = {
  studio: 'Studio mode — full features + local HD audio. Analysis, stems & transcription available.',
  collab:
    'Collab mode — play, edit chords/sections & collaborate live on cloud audio. Analysis, stems & transcription need Studio mode (the desktop app).',
}

/**
 * ── The canonical AUDIO-MODE state model ────────────────────────────────────
 *
 * Exactly which audio the OPEN project is playing, and WHY — the single source
 * of truth for the navbar badge and its action. `appMode` above is only a
 * capability flag (is the sidecar up); this is the honest per-project state.
 *
 *  - `no-project`        nothing open.
 *  - `studio-hd`         Disk project, sidecar up, playing the LOCAL HD master.
 *                        The good state.                                (ok)
 *  - `studio-relink`     Disk project, sidecar up, but the local audio file
 *                        didn't resolve — relink it.                    (warn)
 *  - `offline-disk`      Disk project but the desktop app isn't running — its
 *                        audio can't be read.                           (warn)
 *  - `collab`            Browser-cloud project, NO local copy of it on this
 *                        machine → compressed cloud audio is correct.   (info)
 *  - `collab-switchable` Browser-cloud project, sidecar up, AND a local HD copy
 *                        of THIS project exists here → you're on cloud when you
 *                        could be on HD. Offer to switch.               (warn)
 *  - `collab-no-audio`   Browser-cloud project but the cloud audio couldn't be
 *                        obtained → no playback.                        (error)
 */
export type AudioModeKind =
  | 'no-project'
  | 'studio-hd'
  | 'studio-relink'
  | 'offline-disk'
  | 'collab'
  | 'collab-switchable'
  | 'collab-no-audio'

export interface AudioModeInfo {
  kind: AudioModeKind
  /** Short badge text. */
  label: string
  tone: 'ok' | 'info' | 'warn' | 'error'
  /** One-line plain-language explanation of the state ("why"). */
  detail: string
  /** Present ONLY for `collab-switchable`: the disk folder to open to get HD. */
  switchToDiskPath?: string
}

export const audioMode = derived(
  [project, desktopCompanionStatus, audioSession, cloudDiskPaths],
  ([$p, $s, $a, $paths]): AudioModeInfo => {
    if (!$p.data) {
      return {
        kind: 'no-project',
        label: $s.reachable ? MODE_LABEL.studio : MODE_LABEL.collab,
        tone: 'info',
        detail: $s.reachable ? MODE_TAGLINE.studio : MODE_TAGLINE.collab,
      }
    }

    // ── Disk project ──
    if ($p.osPath !== null) {
      if (!$s.reachable) {
        return {
          kind: 'offline-disk',
          label: 'Offline',
          tone: 'warn',
          detail: "This project is on disk, but the desktop app isn't running — start it to load its audio.",
        }
      }
      if ($a.missingReason === 'file-not-found' || $a.missingReason === 'sha-mismatch') {
        return {
          kind: 'studio-relink',
          label: 'HD · relink',
          tone: 'warn',
          detail: "Studio mode, but this song's local audio file didn't resolve — relink it.",
        }
      }
      return {
        kind: 'studio-hd',
        label: 'HD · local',
        tone: 'ok',
        detail: 'Studio mode — playing your local HD master.',
      }
    }

    // ── Browser-cloud project ──
    if ($a.missingReason === 'cloud-audio-unavailable') {
      return {
        kind: 'collab-no-audio',
        label: 'Cloud · no audio',
        tone: 'error',
        detail:
          "This project's cloud audio couldn't be loaded. Open it from disk (Studio) for HD audio, or its cloud audio hasn't been prepared yet.",
      }
    }
    const diskPath = $p.data.cloud ? $paths[$p.data.cloud.projectId] : undefined
    if ($s.reachable && diskPath) {
      return {
        kind: 'collab-switchable',
        label: 'Cloud → HD',
        tone: 'warn',
        detail:
          "You're on compressed CLOUD audio, but a local HD copy of this project is on this computer. Click to switch to Studio (HD + stems).",
        switchToDiskPath: diskPath,
      }
    }
    return {
      kind: 'collab',
      label: 'Cloud audio',
      tone: 'info',
      detail:
        'Collab mode — compressed cloud audio (no local copy of this project on this computer).',
    }
  },
)
