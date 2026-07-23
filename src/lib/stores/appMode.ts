import { derived } from 'svelte/store'
import { desktopCompanionStatus } from './desktopCompanionStatus'

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
