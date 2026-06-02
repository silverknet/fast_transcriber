import { writable } from 'svelte/store'

/**
 * Why audio is unavailable. Drives the relink banner in the editor.
 *  - `file-not-found`: the song's referenced audio file (under
 *    `<song>/audio/<filename>`) couldn't be read off disk.
 *  - `sha-mismatch`: a file was found at the referenced path but its
 *    SHA-256 doesn't match the SongMap's `originalSha256` — the user
 *    is asked to confirm before we proceed.
 */
export type AudioMissingReason = 'file-not-found' | 'sha-mismatch'

export type AudioSession = {
  file: File | null
  name: string
  startSec: number
  endSec: number
  /** Set when `file === null` because audio is missing on disk (not just unloaded). */
  missingReason?: AudioMissingReason
}

export const audioSession = writable<AudioSession>({
  file: null,
  name: '',
  startSec: 0,
  endSec: 0,
})
