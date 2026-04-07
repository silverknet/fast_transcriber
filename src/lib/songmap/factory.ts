import type { AudioSession } from '$lib/stores/audioSession'
import { defaultCueSettings, emptySongMetadata } from './defaults'
import { SONGMAP_FORMAT_VERSION } from './version'
import type { SongMap } from './types'

export type IdFactory = () => string

const defaultIdFactory: IdFactory = () => crypto.randomUUID()

export type CreateEmptySongMapOptions = {
  idFactory?: IdFactory
  now?: () => string
}

export function createEmptySongMap(options: CreateEmptySongMapOptions = {}): SongMap {
  const nowIso = options.now?.() ?? new Date().toISOString()
  const meta = emptySongMetadata(nowIso)
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    app: { name: 'BarBro' },
    metadata: meta,
    timeline: { bars: [], beats: [] },
    sections: [],
    harmony: [],
    cues: defaultCueSettings(),
  }
}

export type CreateSongMapFromAudioSessionOptions = CreateEmptySongMapOptions & {
  /** Override display title (default: file name without extension) */
  title?: string
}

/**
 * Builds a SongMap with `AudioReference` from the current session and empty timeline.
 * Bars/beats are filled by analysis or import later.
 */
export function createSongMapFromAudioSession(
  session: AudioSession,
  options: CreateSongMapFromAudioSessionOptions = {},
): SongMap {
  const nowIso = options.now?.() ?? new Date().toISOString()
  const baseName = session.name.replace(/\.[^.]+$/, '') || 'Untitled'
  const title = options.title ?? baseName

  const map = createEmptySongMap({ ...options, now: () => nowIso })
  map.metadata = {
    ...map.metadata,
    title,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
  map.audio = {
    fileName: session.name,
    mimeType: session.file?.type,
    durationSec: Math.max(0, session.endSec - session.startSec),
    trim: { startSec: session.startSec, endSec: session.endSec },
    source: 'upload',
  }
  return map
}

export function newId(factory: IdFactory = defaultIdFactory): string {
  return factory()
}
