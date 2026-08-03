import type {
  LiveProducerReference,
  SongLiveMixerChannel,
  SongLiveRouting,
  SongLiveSourceIntent,
  SongMap,
} from './types'

export const LIVE_ROUTING_VERSION = 1 as const

export const LIVE_SUPPORTED_PERSISTED_PRODUCER_KINDS = [
  'original-audio',
  'stem-audio',
  'detected-drum-midi',
  'drum-machine-midi',
  'detected-bass-midi',
  'bass-machine-midi',
] as const

type LegacySongSources = Pick<
  SongMap,
  'audio' | 'stemRefs' | 'drumMidi' | 'drumMachine' | 'bassMidi' | 'bassMachine'
>

function stableLegacyId(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function legacyProducerRecords(song: LegacySongSources): Array<{
  sourceId: string
  producer: LiveProducerReference
}> {
  const records: Array<{ sourceId: string; producer: LiveProducerReference }> = []
  if (song.audio) {
    records.push({
      sourceId: 'live-source:original',
      producer: { kind: 'original-audio' },
    })
  }
  for (const [stemRefKey, relativePath] of Object.entries(song.stemRefs ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const migratedId = stableLegacyId(`${stemRefKey}\u0000${relativePath}`)
    records.push({
      sourceId: `live-source:stem:${migratedId}`,
      producer: {
        kind: 'stem-audio',
        stemId: `legacy-stem:${migratedId}`,
      },
    })
  }
  if (song.drumMidi) {
    records.push({
      sourceId: 'live-source:detected-drums',
      producer: { kind: 'detected-drum-midi' },
    })
  }
  if (song.drumMachine) {
    records.push({
      sourceId: 'live-source:drum-machine',
      producer: { kind: 'drum-machine-midi' },
    })
  }
  if (song.bassMidi) {
    records.push({
      sourceId: 'live-source:detected-bass',
      producer: { kind: 'detected-bass-midi' },
    })
  }
  if (song.bassMachine) {
    records.push({
      sourceId: 'live-source:bass-machine',
      producer: { kind: 'bass-machine-midi' },
    })
  }
  return records
}

export function migrateLegacyLiveStemRefs(
  song: LegacySongSources,
): Record<string, string> | undefined {
  const refs: Record<string, string> = {}
  for (const [stemRefKey, relativePath] of Object.entries(song.stemRefs ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const migratedId = stableLegacyId(`${stemRefKey}\u0000${relativePath}`)
    refs[`legacy-stem:${migratedId}`] = relativePath
  }
  return Object.keys(refs).length > 0 ? refs : undefined
}

/**
 * V6 compatibility adapter. It records every persisted producer but admits
 * none of them. Labels, filenames, editor mute/solo, ordering, and `liveSlot`
 * are deliberately ignored. A future Live setup flow must explicitly review
 * each source and assign its rig lane before it can become audible.
 */
export function migrateLegacyLiveRouting(song: LegacySongSources): SongLiveRouting {
  const sources: SongLiveSourceIntent[] = []
  const mixerChannels: SongLiveMixerChannel[] = []

  for (const record of legacyProducerRecords(song)) {
    const mixerChannelId = record.sourceId.replace('live-source:', 'live-mixer:')
    sources.push({
      id: record.sourceId,
      producer: record.producer,
      admission: 'excluded',
      required: false,
      mixerChannelId,
      main: false,
      monitorSends: [],
    })
    mixerChannels.push({
      id: mixerChannelId,
      sourceId: record.sourceId,
      processing: { gain: 1 },
    })
  }

  return {
    version: LIVE_ROUTING_VERSION,
    sources,
    mixerChannels,
    sumGroups: [],
  }
}

export function emptyLiveRouting(): SongLiveRouting {
  return {
    version: LIVE_ROUTING_VERSION,
    sources: [],
    mixerChannels: [],
    sumGroups: [],
  }
}
