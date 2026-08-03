import type { AudioSession } from '$lib/stores/audioSession'
import { emptySongMetadata } from './defaults'
import { DEFAULT_DRAFT_NAME } from './drafts'
import { MIGRATED_ACTIVE_DRAFT_ID } from './draftsMigrate'
import { SONGMAP_FORMAT_VERSION } from './version'
import { emptyLiveRouting } from './liveRouting'
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
    cueTracks: [],
    liveRouting: emptyLiveRouting(),
    // A new song starts on one draft. Stamping the identity here (rather than
    // letting the parser fill it in on first load) is what keeps
    // save → load → save byte-identical.
    activeDraftId: MIGRATED_ACTIVE_DRAFT_ID,
    activeDraftName: DEFAULT_DRAFT_NAME,
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
