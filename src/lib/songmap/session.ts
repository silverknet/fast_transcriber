import type { AudioSession } from '$lib/stores/audioSession'
import type { AudioReference, SongMap } from './types'

/**
 * Full in-app restorable state: the durable `SongMap` JSON model plus playable bytes.
 * `SongMap` alone serializes to JSON; bytes are always carried beside it (File, IndexedDB, S3, …).
 */
export type RestorableSongState = {
  songMap: SongMap
  /** Playable audio; null if not loaded (e.g. JSON-only import before blob fetch). */
  audioBlob: File | Blob | null
  /** Optional stable id for DB rows / blob storage keys (not required inside `SongMap`). */
  songId?: string
}

/**
 * After timeline/metadata edits, keep `map.audio` aligned with the live trim/file in `audioSession`
 * so exported JSON and DB payloads stay consistent with what the user hears.
 */
export function mergeAudioReferenceFromSession(map: SongMap, session: AudioSession): SongMap {
  if (!session.file) return map

  const duration = Math.max(0, session.endSec - session.startSec)
  const audio: AudioReference = {
    fileName: session.name,
    mimeType: session.file.type || map.audio?.mimeType,
    durationSec: duration,
    trim: { startSec: session.startSec, endSec: session.endSec },
    source: map.audio?.source ?? 'upload',
    sha256: map.audio?.sha256,
  }
  return { ...map, audio }
}

/**
 * Build `AudioSession` from a parsed map + optional blob (e.g. after loading `.smap` JSON + sidecar).
 */
export function audioSessionFromMapAndBlob(
  map: SongMap,
  blob: File | Blob | null,
): AudioSession {
  const a = map.audio
  const trim = a?.trim ?? { startSec: 0, endSec: a?.durationSec ?? 0 }
  const name = a?.fileName ?? 'audio.wav'
  let file: File | null = null
  if (blob) {
    file =
      blob instanceof File
        ? blob
        : new File([blob], name, { type: a?.mimeType ?? 'application/octet-stream' })
  }
  return {
    file,
    name,
    startSec: trim.startSec,
    endSec: trim.endSec,
  }
}

export function restorableSongState(
  songMap: SongMap,
  audioBlob: File | Blob | null,
  songId?: string,
): RestorableSongState {
  return { songMap, audioBlob, songId }
}
