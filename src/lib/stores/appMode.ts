import { derived } from 'svelte/store'
import { desktopCompanionStatus } from './desktopCompanionStatus'

/**
 * The app's operating mode, derived from whether the desktop sidecar is
 * reachable:
 *  - `'desktop'` → full features + **local HD audio**. Analysis, stems,
 *    transcription and TTS are available; the local WAV master is the audio.
 *  - `'browser'` → cloud-only consumer/collaborator mode. Play + edit chords/
 *    sections + live collab on the compressed cloud audio; no sidecar compute.
 *
 * Single source of truth for the navbar mode badge, feature gating, and — via
 * `desktopCompanionStatus.reachable` — the `resolveAudioSource` fidelity
 * failsafe (which must NEVER serve cloud audio while in `'desktop'` mode).
 */
export type AppMode = 'desktop' | 'browser'

export const appMode = derived(
  desktopCompanionStatus,
  ($s): AppMode => ($s.reachable ? 'desktop' : 'browser'),
)
