import { writable } from 'svelte/store'

/**
 * Transient state for an in-progress analysis job.
 * Set by the import page before navigating to /analyzing.
 * Cleared by /analyzing on completion or cancellation.
 */
export type AnalyzingState = {
  /** Original HQ file still in memory — used for full-quality trimmed WAV extraction. */
  hqFile: File
}

export const analyzingState = writable<AnalyzingState | null>(null)
