/**
 * The enforced half of the desktop/browser split: which actions need the
 * sidecar (native/Python compute or local-filesystem access) and are therefore
 * unavailable in browser mode. Components gate on `sidecarGate` and show
 * `reason(action)` instead of a broken button.
 *
 * See docs/domains/desktop-vs-browser.md for the capability matrix.
 */
import { derived } from 'svelte/store'
import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'

/** Actions that require the desktop sidecar. Everything NOT here works browser-only. */
export type SidecarAction =
  | 'analyze' // beat-grid detection (madmom)
  | 'separateStems' // Demucs
  | 'transcribeLyrics' // Whisper transcription / "Fit to song"
  | 'ttsCue' // Piper spoken cues
  | 'youtubeImport'
  | 'openLocalFolder' // OS folder access
  | 'uploadCloudAudio' // ffmpeg transcode → upload the compressed copy (creator)

export const SIDECAR_ACTIONS: readonly SidecarAction[] = [
  'analyze',
  'separateStems',
  'transcribeLyrics',
  'ttsCue',
  'youtubeImport',
  'openLocalFolder',
  'uploadCloudAudio',
]

const ACTION_LABEL: Record<SidecarAction, string> = {
  analyze: 'Analyzing a song',
  separateStems: 'Separating stems',
  transcribeLyrics: 'Transcribing & fitting lyrics',
  ttsCue: 'Generating spoken cues',
  youtubeImport: 'Importing from YouTube',
  openLocalFolder: 'Opening a local project folder',
  uploadCloudAudio: 'Preparing shareable cloud audio',
}

/** Pure: is a sidecar action available given reachability? */
export function isSidecarActionAvailable(_action: SidecarAction, sidecarReachable: boolean): boolean {
  // Every listed action needs native compute / local FS — available iff the
  // sidecar is reachable. Kept per-action so a future browser-capable action
  // (e.g. WASM transcode) can override just its own row.
  return sidecarReachable
}

/** User-facing explanation shown when an action is gated in Collab mode. */
export function sidecarActionGateReason(action: SidecarAction): string {
  return `${ACTION_LABEL[action]} needs Studio mode (the BarBro desktop app). Open it and this lights up.`
}

/** Reactive gate for components. */
export const sidecarGate = derived(desktopCompanionStatus, ($s) => ({
  /** True in desktop mode. */
  reachable: $s.reachable,
  /** `true` when the action can run right now. */
  available: (action: SidecarAction) => isSidecarActionAvailable(action, $s.reachable),
  /** Message to show when it can't. */
  reason: sidecarActionGateReason,
}))
