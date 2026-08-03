import {
  SONGMAP_CHORD_LAYERS_FORMAT_VERSION,
  SONGMAP_CUE_TRACK_FORMAT_VERSION,
  SONGMAP_DRAFTS_FORMAT_VERSION,
  SONGMAP_FORMAT_VERSION,
  SONGMAP_LEGACY_FORMAT_VERSION,
  SONGMAP_LYRICS_FORMAT_VERSION,
  SONGMAP_TRANSPOSE_FORMAT_VERSION,
} from './version'
import { isLiveSlotLink } from '$lib/hardware/liveSlotLinks'
import { clampChannelEq } from '$lib/audio/channelEq'
import type {
  AudioReference,
  Bar,
  Beat,
  ChordLayer,
  ChordSymbol,
  CueAnchor,
  CueEvent,
  CueSettings,
  CueTrack,
  HarmonyEvent,
  LyricWord,
  Lyrics,
  Meter,
  RenderedCueExport,
  Section,
  SectionLayer,
  SongDraft,
  SongKey,
  SongMap,
  SongMapAppInfo,
  SongMetadata,
  SongMapTimeline,
  SongLiveRouting,
  SongLiveSourceIntent,
  SongLiveMixerChannel,
  SongLiveSumGroup,
  LiveProducerReference,
  SongTranspose,
} from './types'
import { defaultCueSettings } from './defaults'
import { createDefaultCueTrack } from './cueTracks'
import { DEFAULT_DRAFT_NAME, makeDraft } from './drafts'
import { MIGRATED_ACTIVE_DRAFT_ID, migrateLayersToDrafts } from './draftsMigrate'
import {
  AUDIO_FINGERPRINT_BUCKETS,
  AUDIO_FINGERPRINT_VERSION,
  type AudioFingerprint,
} from '$lib/audio/audioFingerprint'
import { validateSongMap } from './validate'
import { normalizeBassTone } from '$lib/audio/bassTone'
import { normalizeEffectBusses } from './effectBusses'
import {
  migrateLegacyLiveRouting,
  migrateLegacyLiveStemRefs,
} from './liveRouting'

export class SongMapParseError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'SongMapParseError'
  }
}

export type ParseSongMapOptions = {
  /**
   * When true (default), drop keys not in the v1 schema instead of failing.
   * Forward-compatible clients can log stripped keys in dev.
   */
  stripUnknown?: boolean
  /**
   * When false, skip the `validateSongMap` gate and return the map even if it
   * is structurally inconsistent. For DIAGNOSTICS ONLY (the project health
   * check wants the FULL error list, not the first error as a thrown parse
   * failure). Every load path keeps the default.
   */
  validate?: boolean
}

function expectObject(v: unknown, path: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new SongMapParseError('Expected object', path)
  }
  return v as Record<string, unknown>
}

function optString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') return undefined
  return v
}

function reqString(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new SongMapParseError('Expected string', path)
  return v
}

function optNum(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return v
}

function reqNum(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SongMapParseError('Expected number', path)
  return v
}

function parseMeter(raw: unknown, path: string): Meter {
  const o = expectObject(raw, path)
  return {
    numerator: reqNum(o.numerator, `${path}.numerator`),
    denominator: reqNum(o.denominator, `${path}.denominator`),
  }
}

function parseChord(raw: unknown, path: string): ChordSymbol {
  const o = expectObject(raw, path)
  return {
    root: reqString(o.root, `${path}.root`) as ChordSymbol['root'],
    accidental: optString(o.accidental) as ChordSymbol['accidental'] | undefined,
    quality: optString(o.quality),
    extensions: Array.isArray(o.extensions) ? o.extensions.map((x) => String(x)) : undefined,
    alterations: Array.isArray(o.alterations) ? o.alterations.map((x) => String(x)) : undefined,
    bass: optString(o.bass) as ChordSymbol['bass'] | undefined,
    bassAccidental: optString(o.bassAccidental) as ChordSymbol['bassAccidental'] | undefined,
    displayRaw: reqString(o.displayRaw, `${path}.displayRaw`),
  }
}

function parseBar(raw: unknown, path: string): Bar {
  const o = expectObject(raw, path)
  return {
    id: reqString(o.id, `${path}.id`),
    index: reqNum(o.index, `${path}.index`),
    startSec: reqNum(o.startSec, `${path}.startSec`),
    endSec: reqNum(o.endSec, `${path}.endSec`),
    meter: parseMeter(o.meter, `${path}.meter`),
    beatCount: reqNum(o.beatCount, `${path}.beatCount`),
    beatIds: Array.isArray(o.beatIds)
      ? o.beatIds.map((id, i) => reqString(id, `${path}.beatIds[${i}]`))
      : (() => {
          throw new SongMapParseError('beatIds must be array', `${path}.beatIds`)
        })(),
  }
}

function parseBeat(raw: unknown, path: string): Beat {
  const o = expectObject(raw, path)
  return {
    id: reqString(o.id, `${path}.id`),
    barId: reqString(o.barId, `${path}.barId`),
    indexInBar: reqNum(o.indexInBar, `${path}.indexInBar`),
    timeSec: reqNum(o.timeSec, `${path}.timeSec`),
    strength: optNum(o.strength),
    confidence: optNum(o.confidence),
    source: optString(o.source) as Beat['source'],
  }
}

function parseSection(raw: unknown, path: string): Section {
  const o = expectObject(raw, path)
  const br = expectObject(o.barRange, `${path}.barRange`)
  return {
    id: reqString(o.id, `${path}.id`),
    kind: reqString(o.kind, `${path}.kind`) as Section['kind'],
    label: reqString(o.label, `${path}.label`),
    barRange: {
      startBarIndex: reqNum(br.startBarIndex, `${path}.barRange.startBarIndex`),
      endBarIndex: reqNum(br.endBarIndex, `${path}.barRange.endBarIndex`),
    },
    color: optString(o.color),
  }
}

function parseHarmony(raw: unknown, path: string): HarmonyEvent {
  const o = expectObject(raw, path)
  const beatAnchor =
    o.beatAnchor && typeof o.beatAnchor === 'object' && !Array.isArray(o.beatAnchor)
      ? {
          indexInBar: reqNum(
            (o.beatAnchor as Record<string, unknown>).indexInBar,
            `${path}.beatAnchor.indexInBar`,
          ),
        }
      : undefined
  const out: HarmonyEvent = {
    id: reqString(o.id, `${path}.id`),
    barId: reqString(o.barId, `${path}.barId`),
    beatId: optString(o.beatId),
    startSec: reqNum(o.startSec, `${path}.startSec`),
    endSec: reqNum(o.endSec, `${path}.endSec`),
    chord: parseChord(o.chord, `${path}.chord`),
    beatAnchor,
  }
  // Off-grid chords are anchored by bar + fraction (no beat) — preserve it.
  if (typeof o.barFraction === 'number' && Number.isFinite(o.barFraction)) {
    out.barFraction = o.barFraction
  }
  return out
}

function parseHarmonyArray(raw: unknown, path: string): HarmonyEvent[] {
  if (!Array.isArray(raw)) return []
  return raw.map((h, i) => parseHarmony(h, `${path}[${i}]`))
}

const SONG_KEY_MODES = new Set(['major', 'minor'])

function parseSongKey(raw: unknown, path: string): SongKey | undefined {
  if (raw === undefined || raw === null) return undefined
  const o = expectObject(raw, path)
  const mode = reqString(o.mode, `${path}.mode`)
  if (!SONG_KEY_MODES.has(mode)) {
    throw new SongMapParseError('keyDetail.mode must be major or minor', `${path}.mode`)
  }
  return {
    root: reqString(o.root, `${path}.root`) as SongKey['root'],
    accidental: optString(o.accidental) as SongKey['accidental'] | undefined,
    mode: mode as SongKey['mode'],
  }
}

function parseTranspose(raw: unknown, path: string): SongTranspose | undefined {
  if (raw === undefined || raw === null) return undefined
  const o = expectObject(raw, path)
  return {
    baseSemitones: reqNum(o.baseSemitones, `${path}.baseSemitones`),
  }
}

function parseLyricWord(raw: unknown, path: string): LyricWord {
  const o = expectObject(raw, path)
  const word: LyricWord = {
    text: reqString(o.text, `${path}.text`),
    startSec: reqNum(o.startSec, `${path}.startSec`),
    endSec: reqNum(o.endSec, `${path}.endSec`),
    line: reqNum(o.line, `${path}.line`),
  }
  if (typeof o.aligned === 'boolean') word.aligned = o.aligned
  return word
}

function parseLyrics(raw: unknown, path: string): Lyrics | undefined {
  if (raw === undefined || raw === null) return undefined
  const o = expectObject(raw, path)
  const out: Lyrics = {
    words: Array.isArray(o.words)
      ? o.words.map((w, i) => parseLyricWord(w, `${path}.words[${i}]`))
      : [],
    sourceText: reqString(o.sourceText, `${path}.sourceText`),
  }
  const alignedAt = optString(o.alignedAt)
  if (alignedAt) out.alignedAt = alignedAt
  const tv = optNum(o.transcriberVersion)
  if (tv !== undefined) out.transcriberVersion = tv
  return out
}

function parseChordLayer(raw: unknown, path: string): ChordLayer {
  const o = expectObject(raw, path)
  const layer: ChordLayer = {
    id: reqString(o.id, `${path}.id`),
    name: reqString(o.name, `${path}.name`),
    harmony: parseHarmonyArray(o.harmony, `${path}.harmony`),
  }
  const source = optString(o.source)
  if (source === 'manual' || source === 'sheet-import' || source === 'suggestions') {
    layer.source = source
  }
  const createdAt = optString(o.createdAt)
  if (createdAt) layer.createdAt = createdAt
  return layer
}

function parseChordLayers(raw: unknown, path: string): ChordLayer[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) return undefined
  const layers = raw.map((l, i) => parseChordLayer(l, `${path}[${i}]`))
  return layers.length > 0 ? layers : undefined
}

function parseSectionLayer(raw: unknown, path: string): SectionLayer {
  const o = expectObject(raw, path)
  const layer: SectionLayer = {
    id: reqString(o.id, `${path}.id`),
    name: reqString(o.name, `${path}.name`),
    sections: Array.isArray(o.sections)
      ? o.sections.map((sec, i) => parseSection(sec, `${path}.sections[${i}]`))
      : [],
  }
  const source = optString(o.source)
  if (source === 'manual' || source === 'sheet-import' || source === 'suggestions') {
    layer.source = source
  }
  const createdAt = optString(o.createdAt)
  if (createdAt) layer.createdAt = createdAt
  return layer
}

function parseSectionLayers(raw: unknown, path: string): SectionLayer[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) return undefined
  const layers = raw.map((l, i) => parseSectionLayer(l, `${path}[${i}]`))
  return layers.length > 0 ? layers : undefined
}

function parseDraft(raw: unknown, path: string): SongDraft {
  const o = expectObject(raw, path)
  const source = optString(o.source)
  return makeDraft({
    id: reqString(o.id, `${path}.id`),
    name: reqString(o.name, `${path}.name`),
    source:
      source === 'manual' || source === 'sheet-import' || source === 'suggestions'
        ? source
        : undefined,
    createdAt: optString(o.createdAt),
    sections: Array.isArray(o.sections)
      ? o.sections.map((sec, i) => parseSection(sec, `${path}.sections[${i}]`))
      : [],
    harmony: parseHarmonyArray(o.harmony, `${path}.harmony`),
    lyrics: parseLyrics(o.lyrics, `${path}.lyrics`),
  })
}

function parseDrafts(raw: unknown, path: string): SongDraft[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) return undefined
  const drafts = raw.map((d, i) => parseDraft(d, `${path}[${i}]`))
  return drafts.length > 0 ? drafts : undefined
}

function parseFingerprint(raw: unknown): AudioFingerprint | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  if (o.version !== AUDIO_FINGERPRINT_VERSION) return undefined
  const dur = optNum(o.durationSec)
  if (dur === undefined) return undefined
  if (!Array.isArray(o.envelope)) return undefined
  const envelope = o.envelope.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0))
  if (envelope.length !== AUDIO_FINGERPRINT_BUCKETS) return undefined
  return { version: AUDIO_FINGERPRINT_VERSION, durationSec: dur, envelope }
}

function parseAudio(raw: unknown, path: string): AudioReference {
  const o = expectObject(raw, path)
  const trim = expectObject(o.trim, `${path}.trim`)
  return {
    fileName: reqString(o.fileName, `${path}.fileName`),
    mimeType: optString(o.mimeType),
    durationSec: optNum(o.durationSec),
    sampleRate: optNum(o.sampleRate),
    channels: optNum(o.channels),
    fileSize: optNum(o.fileSize),
    trim: {
      startSec: reqNum(trim.startSec, `${path}.trim.startSec`),
      endSec: reqNum(trim.endSec, `${path}.trim.endSec`),
    },
    sha256: optString(o.sha256),
    originalSha256: optString(o.originalSha256),
    fingerprint: parseFingerprint(o.fingerprint),
    originalPath: optString(o.originalPath),
    source: reqString(o.source, `${path}.source`) as AudioReference['source'],
  }
}

function parseExpectedAudio(raw: unknown, path: string): import('./types').ExpectedAudio | undefined {
  if (raw === undefined || raw === null) return undefined
  const o = expectObject(raw, path)
  return {
    fileName: reqString(o.fileName, `${path}.fileName`),
    mimeType: optString(o.mimeType),
    durationSec: optNum(o.durationSec),
    sampleRate: optNum(o.sampleRate),
    channels: optNum(o.channels),
    fileSize: optNum(o.fileSize),
    sha256: optString(o.sha256),
    originalSha256: optString(o.originalSha256),
    fingerprint: parseFingerprint(o.fingerprint),
  }
}

function parseStemRefs(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') result[k] = v
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function parseCues(raw: unknown, path: string): CueSettings {
  const o = expectObject(raw, path)
  return {
    mode: reqString(o.mode, `${path}.mode`) as CueSettings['mode'],
    countInBeats: reqNum(o.countInBeats, `${path}.countInBeats`),
    useSectionLabels: Boolean(o.useSectionLabels),
    prependSec: optNum(o.prependSec),
    template: optString(o.template),
    language: optString(o.language),
    spokenIntroText: optString(o.spokenIntroText),
  }
}

function parseMixState(raw: unknown, path: string): import('./types').MixState | undefined {
  if (raw === undefined || raw === null) return undefined
  const o = expectObject(raw, path)
  const tracksRaw = o.tracks
  if (!Array.isArray(tracksRaw)) {
    throw new SongMapParseError('mixState.tracks must be an array', `${path}.tracks`)
  }
  const tracks: import('./types').MixTrackState[] = []
  for (let i = 0; i < tracksRaw.length; i++) {
    const t = expectObject(tracksRaw[i], `${path}.tracks[${i}]`)
    const key = reqString(t.key, `${path}.tracks[${i}].key`)
    const volume = reqNum(t.volume, `${path}.tracks[${i}].volume`)
    if (!(volume >= 0)) {
      throw new SongMapParseError('volume must be >= 0', `${path}.tracks[${i}].volume`)
    }
    const entry: import('./types').MixTrackState = { key, volume }
    if (typeof t.muted === 'boolean' && t.muted) entry.muted = true
    if (typeof t.soloed === 'boolean' && t.soloed) entry.soloed = true
    // Unknown slot names are dropped rather than rejected: a song written by a
    // newer build must still open here, falling back to the name-based guess.
    if (isLiveSlotLink(t.liveSlot)) entry.liveSlot = t.liveSlot
    // Coerced, never thrown on: a malformed band flattens instead of taking
    // the whole song down.
    const eq = clampChannelEq(t.eq)
    if (eq) entry.eq = eq
    tracks.push(entry)
  }
  const out: import('./types').MixState = { tracks }
  if (typeof o.master === 'number' && o.master >= 0) out.master = o.master
  return out
}

function parseLiveProducer(raw: unknown, path: string): LiveProducerReference {
  const o = expectObject(raw, path)
  const kind = reqString(o.kind, `${path}.kind`)
  switch (kind) {
    case 'original-audio':
    case 'detected-drum-midi':
    case 'drum-machine-midi':
    case 'detected-bass-midi':
    case 'bass-machine-midi':
    case 'chord-machine-keys-midi':
    case 'chord-machine-arp-midi':
    case 'keybed-midi':
    case 'chord-jam-keys-midi':
    case 'chord-jam-bass-midi':
    case 'chord-jam-arp-midi':
    case 'preview-audio':
    case 'test-signal':
      return { kind }
    case 'stem-audio':
      return {
        kind,
        stemId: reqString(o.stemId, `${path}.stemId`),
      }
    case 'unknown':
      return {
        kind,
        producerType: reqString(o.producerType, `${path}.producerType`),
      }
    default:
      return { kind: 'unknown', producerType: kind }
  }
}

function parseLiveRouting(raw: unknown, path: string): SongLiveRouting {
  const o = expectObject(raw, path)
  if (o.version !== 1) {
    throw new SongMapParseError('Unsupported liveRouting version', `${path}.version`)
  }
  if (!Array.isArray(o.sources)) {
    throw new SongMapParseError('liveRouting.sources must be an array', `${path}.sources`)
  }
  if (!Array.isArray(o.mixerChannels)) {
    throw new SongMapParseError(
      'liveRouting.mixerChannels must be an array',
      `${path}.mixerChannels`,
    )
  }
  if (!Array.isArray(o.sumGroups)) {
    throw new SongMapParseError('liveRouting.sumGroups must be an array', `${path}.sumGroups`)
  }

  const sources: SongLiveSourceIntent[] = o.sources.map((rawSource, index) => {
    const sourcePath = `${path}.sources[${index}]`
    const source = expectObject(rawSource, sourcePath)
    if (source.admission !== 'included' && source.admission !== 'excluded') {
      throw new SongMapParseError(
        'admission must be included or excluded',
        `${sourcePath}.admission`,
      )
    }
    if (typeof source.required !== 'boolean' || typeof source.main !== 'boolean') {
      throw new SongMapParseError(
        'required and main must be booleans',
        sourcePath,
      )
    }
    if (!Array.isArray(source.monitorSends)) {
      throw new SongMapParseError(
        'monitorSends must be an array',
        `${sourcePath}.monitorSends`,
      )
    }
    return {
      id: reqString(source.id, `${sourcePath}.id`),
      producer: parseLiveProducer(source.producer, `${sourcePath}.producer`),
      admission: source.admission,
      required: source.required,
      mixerChannelId: reqString(
        source.mixerChannelId,
        `${sourcePath}.mixerChannelId`,
      ),
      main: source.main,
      monitorSends: source.monitorSends.map((rawSend, sendIndex) => {
        const sendPath = `${sourcePath}.monitorSends[${sendIndex}]`
        const send = expectObject(rawSend, sendPath)
        const gain = reqNum(send.gain, `${sendPath}.gain`)
        if (gain < 0) {
          throw new SongMapParseError('gain must be >= 0', `${sendPath}.gain`)
        }
        return {
          performerId: reqString(send.performerId, `${sendPath}.performerId`),
          gain,
        }
      }),
    }
  })

  const mixerChannels: SongLiveMixerChannel[] = o.mixerChannels.map(
    (rawChannel, index) => {
      const channelPath = `${path}.mixerChannels[${index}]`
      const channel = expectObject(rawChannel, channelPath)
      const processing = expectObject(
        channel.processing,
        `${channelPath}.processing`,
      )
      const gain = reqNum(processing.gain, `${channelPath}.processing.gain`)
      if (gain < 0) {
        throw new SongMapParseError(
          'gain must be >= 0',
          `${channelPath}.processing.gain`,
        )
      }
      const parsed: SongLiveMixerChannel = {
        id: reqString(channel.id, `${channelPath}.id`),
        sourceId: reqString(channel.sourceId, `${channelPath}.sourceId`),
        processing: { gain },
      }
      if (processing.eq !== undefined) {
        parsed.processing.eq = clampChannelEq(processing.eq)
      }
      const rigSourceLaneId = optString(channel.rigSourceLaneId)
      if (rigSourceLaneId !== undefined) parsed.rigSourceLaneId = rigSourceLaneId
      const sumGroupId = optString(channel.sumGroupId)
      if (sumGroupId !== undefined) parsed.sumGroupId = sumGroupId
      return parsed
    },
  )

  const sumGroups: SongLiveSumGroup[] = o.sumGroups.map((rawGroup, index) => {
    const groupPath = `${path}.sumGroups[${index}]`
    const group = expectObject(rawGroup, groupPath)
    if (!Array.isArray(group.mixerChannelIds)) {
      throw new SongMapParseError(
        'mixerChannelIds must be an array',
        `${groupPath}.mixerChannelIds`,
      )
    }
    return {
      id: reqString(group.id, `${groupPath}.id`),
      rigSourceLaneId: reqString(
        group.rigSourceLaneId,
        `${groupPath}.rigSourceLaneId`,
      ),
      mixerChannelIds: group.mixerChannelIds.map((value, memberIndex) =>
        reqString(value, `${groupPath}.mixerChannelIds[${memberIndex}]`),
      ),
    }
  })

  return { version: 1, sources, mixerChannels, sumGroups }
}

function parseCueTrackExport(raw: unknown, path: string): RenderedCueExport | undefined {
  if (raw === undefined || raw === null) return undefined
  const o = expectObject(raw, path)
  // Legacy .smap files written before `preludeOffsetSec` existed are dropped
  // here — without an explicit offset we'd risk misaligning the .als clip.
  // The next render will repopulate the field.
  if (typeof o.preludeOffsetSec !== 'number') return undefined
  const fingerprint = reqString(o.fingerprint, `${path}.fingerprint`)
  const durationSec = reqNum(o.durationSec, `${path}.durationSec`)
  const sampleRate = reqNum(o.sampleRate, `${path}.sampleRate`)
  const generatedAt = reqString(o.generatedAt, `${path}.generatedAt`)
  const preludeOffsetSec = reqNum(o.preludeOffsetSec, `${path}.preludeOffsetSec`)
  const relativePath = optString(o.relativePath)
  if (!(durationSec > 0)) {
    throw new SongMapParseError(`${path}.durationSec must be > 0`, `${path}.durationSec`)
  }
  if (!(sampleRate > 0)) {
    throw new SongMapParseError(`${path}.sampleRate must be > 0`, `${path}.sampleRate`)
  }
  if (!(preludeOffsetSec >= 0)) {
    throw new SongMapParseError(
      `${path}.preludeOffsetSec must be ≥ 0`,
      `${path}.preludeOffsetSec`,
    )
  }
  return { fingerprint, durationSec, sampleRate, generatedAt, preludeOffsetSec, relativePath }
}

function parseCueAnchor(raw: unknown, path: string): CueAnchor {
  const o = expectObject(raw, path)
  const kind = reqString(o.kind, `${path}.kind`)
  const offsetSec = optNum(o.offsetSec)
  if (kind === 'bar') {
    return {
      kind,
      barId: reqString(o.barId, `${path}.barId`),
      leadBars: optNum(o.leadBars),
      leadBeats: optNum(o.leadBeats),
      offsetSec,
    }
  }
  if (kind === 'beat') {
    return {
      kind,
      beatId: reqString(o.beatId, `${path}.beatId`),
      leadBars: optNum(o.leadBars),
      leadBeats: optNum(o.leadBeats),
      offsetSec,
    }
  }
  if (kind === 'time') {
    return {
      kind,
      timeSec: reqNum(o.timeSec, `${path}.timeSec`),
      leadBars: optNum(o.leadBars),
      leadBeats: optNum(o.leadBeats),
      offsetSec,
    }
  }
  throw new SongMapParseError('cue anchor kind must be bar, beat, or time', `${path}.kind`)
}

function parseCueEvent(raw: unknown, path: string): CueEvent {
  const o = expectObject(raw, path)
  const event: CueEvent = {
    id: reqString(o.id, `${path}.id`),
    kind: reqString(o.kind, `${path}.kind`) as CueEvent['kind'],
    enabled: typeof o.enabled === 'boolean' ? o.enabled : true,
    anchor: parseCueAnchor(o.anchor, `${path}.anchor`),
  }
  const text = optString(o.text)
  if (text !== undefined) event.text = text
  const generatedKey = optString(o.generatedKey)
  if (generatedKey !== undefined) event.generatedKey = generatedKey
  if (o.generatedSource !== undefined && o.generatedSource !== null) {
    const src = expectObject(o.generatedSource, `${path}.generatedSource`)
    const kind = reqString(src.kind, `${path}.generatedSource.kind`)
    if (kind === 'section') {
      event.generatedSource = {
        kind,
        sectionId: reqString(src.sectionId, `${path}.generatedSource.sectionId`),
        leadBars: optNum(src.leadBars),
        leadBeats: optNum(src.leadBeats),
      }
    }
  }
  const source = optString(o.source)
  if (source !== undefined) event.source = source as CueEvent['source']
  if (typeof o.edited === 'boolean') event.edited = o.edited
  if (typeof o.stale === 'boolean') event.stale = o.stale
  return event
}

/**
 * A performer's per-song monitor mix override.
 *
 * Defensive by design: an unreadable level is treated as NOT SET, so it falls
 * back to the performer's project default rather than to silence. A parser that
 * turns rubbish into zero would silently mute someone mid-set.
 */
function parsePerformerMixOverride(raw: unknown): CueTrack['mix'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const clamp = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined
  const stems: Record<string, number> = {}
  if (o.stems && typeof o.stems === 'object') {
    for (const [name, value] of Object.entries(o.stems as Record<string, unknown>)) {
      const v = clamp(value)
      if (v !== undefined) stems[name] = v
    }
  }
  const out: NonNullable<CueTrack['mix']> = { stems }
  for (const key of ['original', 'click', 'cue', 'fallback'] as const) {
    const v = clamp(o[key])
    if (v !== undefined) out[key] = v
  }
  return out
}

function parseCueTrack(raw: unknown, path: string): CueTrack {
  const o = expectObject(raw, path)
  return {
    id: reqString(o.id, `${path}.id`),
    name: reqString(o.name, `${path}.name`),
    enabled: typeof o.enabled === 'boolean' ? o.enabled : true,
    voiceId: optString(o.voiceId),
    // WHICH PERFORMER THIS TRACK BELONGS TO, and whether it speaks the count.
    //
    // Both were missing here. Serialization writes the whole track object, so
    // they reached disk perfectly — and were then dropped on the very next
    // load. A field that saves and does not load is worse than one that does
    // neither: the app shows the link working right up until you reopen the
    // project, and then it is simply gone with nothing to point at.
    //
    // This is the same defect that silently ate the performer roster through
    // the sidecar's manifest whitelist. An explicit object literal is a
    // whitelist whether or not it is called one, and every field added to the
    // type has to be added here too. Locked by a round-trip test.
    performerId: optString(o.performerId),
    // The per-song monitor mix. Read here or it saves and never loads — the
    // same trap that ate `performerId`. Locked by a round-trip test.
    mix: parsePerformerMixOverride(o.mix),
    spokenCountIn: typeof o.spokenCountIn === 'boolean' ? o.spokenCountIn : undefined,
    events: Array.isArray(o.events) ? o.events.map((event, i) => parseCueEvent(event, `${path}.events[${i}]`)) : [],
    suppressedGeneratedKeys: Array.isArray(o.suppressedGeneratedKeys)
      ? o.suppressedGeneratedKeys.flatMap((key) => (typeof key === 'string' ? [key] : []))
      : [],
    renderExport:
      o.renderExport !== undefined && o.renderExport !== null
        ? parseCueTrackExport(o.renderExport, `${path}.renderExport`)
        : undefined,
  }
}

function parseCueTracks(raw: unknown): CueTrack[] {
  if (!Array.isArray(raw)) return []
  return raw.map((track, i) => parseCueTrack(track, `cueTracks[${i}]`))
}

function migrateLegacyCueTracks(opts: {
  cues: CueSettings
  cueTrackExport?: RenderedCueExport
}): CueTrack[] {
  const spokenIntroText = opts.cues.spokenIntroText?.trim()
  if (!spokenIntroText && !opts.cueTrackExport) return []
  const track = createDefaultCueTrack()
  const events: CueEvent[] = []
  if (spokenIntroText) {
    events.push({
      id: 'cue_legacy_intro',
      kind: 'intro',
      enabled: true,
      anchor: { kind: 'time', timeSec: 0 },
      text: spokenIntroText,
      source: 'imported',
    })
  }
  return [
    {
      ...track,
      events,
      renderExport: opts.cueTrackExport,
    },
  ]
}

const DRUM_CLASSES = new Set(['kick', 'snare', 'hihat', 'tom', 'cymbal', 'ride'])
const DRUM_QUANTIZE = new Set(['off', '1/8', '1/16', '1/16T'])

/**
 * Defensive like `parseChordHints`: malformed events are dropped rather than
 * failing the whole song; velocity clamps to [0,1]; unknown kit ids pass
 * through (forward compat with future kits).
 */
const DRUM_STYLE_IDS = new Set(['rock', 'pop', 'funk', 'disco', 'ballad', 'halfTime'])

/** 0..1 knob, or undefined when absent/garbage (caller falls back). */
function optUnit(v: unknown): number | undefined {
  const n = optNum(v)
  return n === undefined ? undefined : Math.max(0, Math.min(1, n))
}

const DRUM_PULSE_VOICES = new Set(['hihat', 'ride', 'none'])

/** Kit-piece switches. Only `false` is meaningful — absent means "plays". */
function parseVoiceToggles(raw: unknown): import('./types').DrumVoiceToggles | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: import('./types').DrumVoiceToggles = {}
  for (const [cls, v] of Object.entries(raw as Record<string, unknown>)) {
    if (DRUM_CLASSES.has(cls) && typeof v === 'boolean') {
      out[cls as import('./types').DrumClass] = v
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseDrumMachineSection(raw: unknown): import('./types').DrumMachineSection | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const out: import('./types').DrumMachineSection = {}
  if (typeof o.style === 'string' && DRUM_STYLE_IDS.has(o.style)) {
    out.style = o.style as import('./types').DrumStyleId
  }
  if (typeof o.pulse === 'string' && DRUM_PULSE_VOICES.has(o.pulse)) {
    out.pulse = o.pulse as import('./types').DrumPulseVoice
  }
  const secVoices = parseVoiceToggles(o.voices)
  if (secVoices) out.voices = secVoices
  const complexity = optUnit(o.complexity)
  if (complexity !== undefined) out.complexity = complexity
  const loudness = optUnit(o.loudness)
  if (loudness !== undefined) out.loudness = loudness
  const fills = optUnit(o.fills)
  if (fills !== undefined) out.fills = fills
  if (typeof o.muted === 'boolean') out.muted = o.muted
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * The programmed drum track. Events are DERIVED, never stored, so this only
 * carries settings — an unreadable style falls back to 'rock' rather than
 * dropping the whole track and losing the user's arrangement.
 */
function parseDrumMachine(raw: unknown): import('./types').DrumMachine | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const style =
    typeof o.style === 'string' && DRUM_STYLE_IDS.has(o.style)
      ? (o.style as import('./types').DrumStyleId)
      : 'rock'
  const out: import('./types').DrumMachine = {
    enabled: o.enabled !== false,
    style,
  }
  const complexity = optUnit(o.complexity)
  if (complexity !== undefined) out.complexity = complexity
  const loudness = optUnit(o.loudness)
  if (loudness !== undefined) out.loudness = loudness
  const fills = optUnit(o.fills)
  if (fills !== undefined) out.fills = fills
  if (typeof o.crashOnSectionStart === 'boolean') out.crashOnSectionStart = o.crashOnSectionStart
  if (typeof o.pulse === 'string' && DRUM_PULSE_VOICES.has(o.pulse)) {
    out.pulse = o.pulse as import('./types').DrumPulseVoice
  }
  const voices = parseVoiceToggles(o.voices)
  if (voices) out.voices = voices
  const kit = optString(o.kit)
  if (kit !== undefined) out.kit = kit
  if (o.perSection && typeof o.perSection === 'object' && !Array.isArray(o.perSection)) {
    const perSection: Record<string, import('./types').DrumMachineSection> = {}
    for (const [id, v] of Object.entries(o.perSection as Record<string, unknown>)) {
      const parsed = parseDrumMachineSection(v)
      if (parsed) perSection[id] = parsed
    }
    if (Object.keys(perSection).length > 0) out.perSection = perSection
  }
  return out
}

const BASS_STYLE_IDS = new Set(['roots', 'rootFifth', 'octaves', 'eighths', 'walking', 'pedal'])

function parseBassMachineSection(raw: unknown): import('./types').BassMachineSection | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const out: import('./types').BassMachineSection = {}
  if (typeof o.style === 'string' && BASS_STYLE_IDS.has(o.style)) {
    out.style = o.style as import('./types').BassStyleId
  }
  const complexity = optUnit(o.complexity)
  if (complexity !== undefined) out.complexity = complexity
  const loudness = optUnit(o.loudness)
  if (loudness !== undefined) out.loudness = loudness
  const octave = optNum(o.octave)
  if (octave !== undefined) out.octave = Math.max(-2, Math.min(2, Math.round(octave)))
  if (typeof o.muted === 'boolean') out.muted = o.muted
  return Object.keys(out).length > 0 ? out : undefined
}

/** The programmed bass track — settings only; notes are derived from chords. */
function parseBassMachine(raw: unknown): import('./types').BassMachine | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const style =
    typeof o.style === 'string' && BASS_STYLE_IDS.has(o.style)
      ? (o.style as import('./types').BassStyleId)
      : 'roots'
  const out: import('./types').BassMachine = { enabled: o.enabled !== false, style }
  const complexity = optUnit(o.complexity)
  if (complexity !== undefined) out.complexity = complexity
  const loudness = optUnit(o.loudness)
  if (loudness !== undefined) out.loudness = loudness
  const octave = optNum(o.octave)
  if (octave !== undefined) out.octave = Math.max(-2, Math.min(2, Math.round(octave)))
  // The voice. Normalized on read, so a partial or hand-edited tone still
  // renders instead of failing.
  const sound = optString(o.sound)
  if (sound !== undefined) out.sound = sound
  if (o.tone && typeof o.tone === 'object' && !Array.isArray(o.tone)) {
    out.tone = normalizeBassTone(o.tone as Partial<import('$lib/audio/bassTone').BassTone>)
  }
  if (o.perSection && typeof o.perSection === 'object' && !Array.isArray(o.perSection)) {
    const perSection: Record<string, import('./types').BassMachineSection> = {}
    for (const [id, v] of Object.entries(o.perSection as Record<string, unknown>)) {
      const parsed = parseBassMachineSection(v)
      if (parsed) perSection[id] = parsed
    }
    if (Object.keys(perSection).length > 0) out.perSection = perSection
  }
  return out
}

function parseDrumMidi(raw: unknown, path: string): import('./types').DrumMidi | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  if (typeof o.analyzedAt !== 'string' || typeof o.audioFingerprint !== 'string') return undefined
  const analyzerVersion = optNum(o.analyzerVersion)
  if (analyzerVersion === undefined) return undefined
  const events: import('./types').DrumMidiEvent[] = []
  if (Array.isArray(o.events)) {
    for (const ev of o.events) {
      if (!ev || typeof ev !== 'object') continue
      const e = ev as Record<string, unknown>
      const t = optNum(e.timeSec)
      const v = optNum(e.velocity)
      const cls = typeof e.cls === 'string' && DRUM_CLASSES.has(e.cls) ? e.cls : null
      if (t === undefined || t < 0 || cls === null) continue
      events.push({
        timeSec: t,
        cls: cls as import('./types').DrumClass,
        velocity: Math.max(0, Math.min(1, v ?? 1)),
      })
    }
  }
  const out: import('./types').DrumMidi = {
    events,
    analyzedAt: o.analyzedAt,
    analyzerVersion,
    sourceStem: typeof o.sourceStem === 'string' ? o.sourceStem : '',
    audioFingerprint: o.audioFingerprint,
  }
  const kit = optString(o.kit)
  if (kit) out.kit = kit
  const quantize = optString(o.quantize)
  if (quantize && DRUM_QUANTIZE.has(quantize)) {
    out.quantize = quantize as import('./types').DrumMidi['quantize']
  }
  const style = optString(o.style)
  if (style === 'steady' || style === 'detected') out.style = style
  const renderExport = parseCueTrackExport(o.renderExport, `${path}.renderExport`)
  if (renderExport) out.renderExport = renderExport
  return out
}

/** `parseDrumMidi`'s sibling: drop malformed notes, clamp velocity, round-trip the rest. */
function parseBassMidi(raw: unknown, path: string): import('./types').BassMidi | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  if (typeof o.analyzedAt !== 'string' || typeof o.audioFingerprint !== 'string') return undefined
  const analyzerVersion = optNum(o.analyzerVersion)
  if (analyzerVersion === undefined) return undefined
  const events: import('./types').BassMidiEvent[] = []
  if (Array.isArray(o.events)) {
    for (const ev of o.events) {
      if (!ev || typeof ev !== 'object') continue
      const e = ev as Record<string, unknown>
      const t = optNum(e.timeSec)
      const d = optNum(e.durationSec)
      const midi = optNum(e.midi)
      const v = optNum(e.velocity)
      if (t === undefined || t < 0) continue
      if (d === undefined || !(d > 0)) continue
      if (midi === undefined || !Number.isInteger(midi) || midi < 0 || midi > 127) continue
      events.push({
        timeSec: t,
        durationSec: d,
        midi,
        velocity: Math.max(0, Math.min(1, v ?? 1)),
      })
    }
  }
  const out: import('./types').BassMidi = {
    events,
    analyzedAt: o.analyzedAt,
    analyzerVersion,
    sourceStem: typeof o.sourceStem === 'string' ? o.sourceStem : '',
    audioFingerprint: o.audioFingerprint,
  }
  const quantize = optString(o.quantize)
  if (quantize && DRUM_QUANTIZE.has(quantize)) {
    out.quantize = quantize as import('./types').BassMidi['quantize']
  }
  const style = optString(o.style)
  if (style === 'steady' || style === 'detected') out.style = style
  // The voice — same fields and same normalization as the bass machine, so
  // the two sound identical when set identically.
  const sound = optString(o.sound)
  if (sound !== undefined) out.sound = sound
  if (o.tone && typeof o.tone === 'object' && !Array.isArray(o.tone)) {
    out.tone = normalizeBassTone(o.tone as Partial<import('$lib/audio/bassTone').BassTone>)
  }
  const kickFollow = optUnit(o.kickFollow)
  if (kickFollow !== undefined) out.kickFollow = kickFollow
  const renderExport = parseCueTrackExport(o.renderExport, `${path}.renderExport`)
  if (renderExport) out.renderExport = renderExport
  return out
}

function parseChordHints(raw: unknown, path: string): import('./types').ChordHints | undefined {
  if (raw === undefined || raw === null) return undefined
  const o = expectObject(raw, path)
  const rawChroma = o.beatChroma
  if (!Array.isArray(rawChroma)) return undefined
  // Coerce defensively — sidecar always emits 12 floats per row, but
  // historic caches or partial writes could surface garbage. Anything
  // that doesn't look like a 12-d vector gets dropped silently.
  const beatChroma: number[][] = []
  for (const row of rawChroma) {
    if (!Array.isArray(row) || row.length !== 12) continue
    const vec: number[] = []
    for (const v of row) {
      const n = Number(v)
      vec.push(Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0)
    }
    beatChroma.push(vec)
  }

  let detectedKey: import('./types').ChordHints['detectedKey'] = null
  const rawKey = o.detectedKey
  if (rawKey && typeof rawKey === 'object') {
    const k = rawKey as Record<string, unknown>
    const mode = k.mode === 'minor' ? 'minor' : k.mode === 'major' ? 'major' : null
    const root = typeof k.root === 'string' ? (k.root as SongKey['root']) : null
    const confidence = Number(k.confidence)
    if (mode && root && Number.isFinite(confidence)) {
      detectedKey = {
        root,
        ...(typeof k.accidental === 'string'
          ? { accidental: k.accidental as SongKey['accidental'] }
          : {}),
        mode,
        confidence: Math.max(0, Math.min(1, confidence)),
      }
    }
  }

  const audioFingerprint = reqString(o.audioFingerprint, `${path}.audioFingerprint`)
  const generatedAt = reqString(o.generatedAt, `${path}.generatedAt`)
  const analyzerVersion = reqNum(o.analyzerVersion, `${path}.analyzerVersion`)
  const analyzerSource =
    o.analyzerSource === 'stems-other' || o.analyzerSource === 'mix'
      ? o.analyzerSource
      : undefined

  return {
    beatChroma,
    detectedKey,
    audioFingerprint,
    generatedAt,
    analyzerVersion,
    ...(analyzerSource ? { analyzerSource } : {}),
  }
}

function parseMetadata(raw: unknown, path: string): SongMetadata {
  const o = expectObject(raw, path)
  const keyDetail =
    o.keyDetail !== undefined && o.keyDetail !== null
      ? parseSongKey(o.keyDetail, `${path}.keyDetail`)
      : undefined
  const analyzedRaw = o.analyzed
  const analyzed = typeof analyzedRaw === 'boolean' ? analyzedRaw : undefined
  return {
    title: reqString(o.title, `${path}.title`),
    artist: optString(o.artist),
    composer: optString(o.composer),
    arranger: optString(o.arranger),
    key: optString(o.key),
    keyDetail,
    bpm: optNum(o.bpm),
    notes: optString(o.notes),
    createdAt: reqString(o.createdAt, `${path}.createdAt`),
    updatedAt: reqString(o.updatedAt, `${path}.updatedAt`),
    analyzed,
  }
}

function parseApp(raw: unknown, path: string): SongMapAppInfo | undefined {
  if (raw === undefined || raw === null) return undefined
  const o = expectObject(raw, path)
  const name = reqString(o.name, `${path}.name`)
  if (name !== 'BarBro') throw new SongMapParseError('app.name must be BarBro', `${path}.name`)
  return {
    name: 'BarBro',
    appVersion: optString(o.appVersion),
  }
}

function parseTimeline(raw: unknown, path: string): SongMapTimeline {
  if (raw === undefined || raw === null) return { bars: [], beats: [] }
  const o = expectObject(raw, path)
  const barsRaw = o.bars
  const beatsRaw = o.beats
  const bars = Array.isArray(barsRaw) ? barsRaw.map((b, i) => parseBar(b, `${path}.bars[${i}]`)) : []
  const beats = Array.isArray(beatsRaw) ? beatsRaw.map((b, i) => parseBeat(b, `${path}.beats[${i}]`)) : []
  const timeline: SongMapTimeline = { bars, beats }
  // The "Reset grid" baseline snapshot persists in the `.smap` (types.ts) — it
  // MUST round-trip, or every save→load silently drops it (and the collab
  // fingerprint then sees a phantom change and pushes the stripped map).
  if (o.original !== undefined && o.original !== null) {
    const orig = expectObject(o.original, `${path}.original`)
    const origBars = Array.isArray(orig.bars)
      ? orig.bars.map((b, i) => parseBar(b, `${path}.original.bars[${i}]`))
      : []
    const origBeats = Array.isArray(orig.beats)
      ? orig.beats.map((b, i) => parseBeat(b, `${path}.original.beats[${i}]`))
      : []
    timeline.original = { bars: origBars, beats: origBeats }
  }
  return timeline
}

function extractSongMap(raw: Record<string, unknown>): SongMap {
  const formatVersion = raw.formatVersion
  const isLegacyV1 = formatVersion === SONGMAP_LEGACY_FORMAT_VERSION
  const isLegacyV2 = formatVersion === SONGMAP_CUE_TRACK_FORMAT_VERSION
  const isLegacyV3 = formatVersion === SONGMAP_TRANSPOSE_FORMAT_VERSION
  const isLegacyV4 = formatVersion === SONGMAP_LYRICS_FORMAT_VERSION
  const isLegacyV5 = formatVersion === SONGMAP_CHORD_LAYERS_FORMAT_VERSION
  const isLegacyV6 = formatVersion === SONGMAP_DRAFTS_FORMAT_VERSION
  if (
    formatVersion !== SONGMAP_FORMAT_VERSION &&
    !isLegacyV1 &&
    !isLegacyV2 &&
    !isLegacyV3 &&
    !isLegacyV4 &&
    !isLegacyV5
    && !isLegacyV6
  ) {
    // A file from a NEWER build (formatVersion above what we understand) gets a
    // user-facing "update BarBro" message wherever this error surfaces, instead
    // of a cryptic version number. Older/unknown versions keep the raw message.
    const n = typeof formatVersion === 'number' ? formatVersion : NaN
    const msg =
      Number.isFinite(n) && n > SONGMAP_FORMAT_VERSION
        ? 'This song was saved by a newer version of BarBro. Update BarBro to open it.'
        : `Unsupported formatVersion: ${String(formatVersion)}`
    throw new SongMapParseError(msg, 'formatVersion')
  }
  const metadata = parseMetadata(raw.metadata, 'metadata')
  const timeline = parseTimeline(raw.timeline, 'timeline')
  // Backward compat: legacy .smap files have no `analyzed` field but always had analysis run.
  if (metadata.analyzed === undefined) {
    metadata.analyzed = timeline.bars.length > 0
  }
  const legacyCues =
    isLegacyV1 && raw.cues !== undefined && raw.cues !== null
      ? parseCues(raw.cues, 'cues')
      : defaultCueSettings()
  const legacyCueTrackExport =
    isLegacyV1 && raw.cueTrackExport !== undefined && raw.cueTrackExport !== null
      ? parseCueTrackExport(raw.cueTrackExport, 'cueTrackExport')
      : undefined
  const countInBeats =
    optNum(raw.countInBeats) ??
    (isLegacyV1 && legacyCues.mode === 'countIn' ? legacyCues.countInBeats : undefined)

  const sections = Array.isArray(raw.sections)
    ? raw.sections.map((s, i) => parseSection(s, `sections[${i}]`))
    : []
  const harmony = parseHarmonyArray(raw.harmony, 'harmony')
  const lyrics = parseLyrics(raw.lyrics, 'lyrics')
  const needsLiveRoutingMigration =
    isLegacyV1 ||
    isLegacyV2 ||
    isLegacyV3 ||
    isLegacyV4 ||
    isLegacyV5 ||
    isLegacyV6 ||
    raw.liveRouting === undefined

  // v6 drafts. Anything older (v1–v5) is folded up from the v5 layer stacks —
  // for v1–v4 those are simply absent, which yields no stored drafts and just
  // names the active one. See `draftsMigrate.ts` for why this is deterministic.
  const storedDrafts = parseDrafts(raw.drafts, 'drafts')
  const draftState =
    storedDrafts !== undefined || optString(raw.activeDraftId) !== undefined
      ? {
          drafts: storedDrafts,
          activeDraftId: optString(raw.activeDraftId) ?? MIGRATED_ACTIVE_DRAFT_ID,
          activeDraftName: optString(raw.activeDraftName) ?? DEFAULT_DRAFT_NAME,
        }
      : migrateLayersToDrafts({
          sections,
          harmony,
          lyrics,
          chordLayers: parseChordLayers(raw.chordLayers, 'chordLayers'),
          sectionLayers: parseSectionLayers(raw.sectionLayers, 'sectionLayers'),
          activeChordLayerName: optString(raw.activeChordLayerName),
          activeSectionLayerName: optString(raw.activeSectionLayerName),
        })

  const map: SongMap = {
    formatVersion: SONGMAP_FORMAT_VERSION,
    app: parseApp(raw.app, 'app'),
    metadata,
    transpose: parseTranspose(raw.transpose, 'transpose'),
    lyrics,
    audio: raw.audio !== undefined && raw.audio !== null ? parseAudio(raw.audio, 'audio') : undefined,
    timeline,
    sections,
    harmony,
    drafts: draftState.drafts,
    activeDraftId: draftState.activeDraftId,
    activeDraftName: draftState.activeDraftName,
    activeDraftCreatedAt: optString(raw.activeDraftCreatedAt),
    cueTracks: isLegacyV1
      ? migrateLegacyCueTracks({ cues: legacyCues, cueTrackExport: legacyCueTrackExport })
      : parseCueTracks(raw.cueTracks),
    countInBeats,
    startBeatId: optString(raw.startBeatId),
    projectFolder: typeof raw.projectFolder === 'string' ? raw.projectFolder : undefined,
    stemRefs: parseStemRefs(raw.stemRefs),
    liveStemRefs: parseStemRefs(raw.liveStemRefs),
    clickExport: isLegacyV1
      ? raw.clickTrackExport !== undefined && raw.clickTrackExport !== null
        ? parseCueTrackExport(raw.clickTrackExport, 'clickTrackExport')
        : undefined
      : raw.clickExport !== undefined && raw.clickExport !== null
        ? parseCueTrackExport(raw.clickExport, 'clickExport')
        : undefined,
    mixState: parseMixState(raw.mixState, 'mixState'),
    liveRouting:
      needsLiveRoutingMigration
        ? { version: 1, sources: [], mixerChannels: [], sumGroups: [] }
        : parseLiveRouting(raw.liveRouting, 'liveRouting'),
    expectedAudio: parseExpectedAudio(raw.expectedAudio, 'expectedAudio'),
    chordHints:
      raw.chordHints !== undefined && raw.chordHints !== null
        ? parseChordHints(raw.chordHints, 'chordHints')
        : undefined,
    drumMidi: parseDrumMidi(raw.drumMidi, 'drumMidi'),
    drumMachine: parseDrumMachine(raw.drumMachine),
    bassMachine: parseBassMachine(raw.bassMachine),
    effectBusses: normalizeEffectBusses(raw.effectBusses),
    bassMidi: parseBassMidi(raw.bassMidi, 'bassMidi'),
  }
  if (needsLiveRoutingMigration) {
    map.liveRouting = migrateLegacyLiveRouting(map)
    map.liveStemRefs = migrateLegacyLiveStemRefs(map)
  }
  return map
}

/**
 * Parse JSON string into `SongMap`. Unknown keys are ignored when `stripUnknown` is true (default).
 */
export function parseSongMap(json: string, options: ParseSongMapOptions = {}): SongMap {
  const { stripUnknown = true, validate = true } = options
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    throw new SongMapParseError('Invalid JSON', undefined, e)
  }
  const root = expectObject(parsed, '')
  if (!stripUnknown && Object.keys(root).some((k) => !KNOWN_TOP_KEYS.has(k))) {
    throw new SongMapParseError('Unknown top-level keys present (stripUnknown is false)', '')
  }
  const map = extractSongMap(root)
  if (validate) {
    const v = validateSongMap(map)
    if (!v.ok) {
      throw new SongMapParseError(v.errors[0] ?? 'Validation failed')
    }
  }
  return map
}

const KNOWN_TOP_KEYS = new Set([
  'formatVersion',
  'app',
  'metadata',
  'transpose',
  'lyrics',
  'audio',
  'timeline',
  'sections',
  'harmony',
  // v5 layer stacks: still read so legacy files migrate (see draftsMigrate.ts).
  'chordLayers',
  'activeChordLayerName',
  'sectionLayers',
  'activeSectionLayerName',
  // v6 drafts.
  'drafts',
  'activeDraftId',
  'activeDraftName',
  'cueTracks',
  'cues',
  'countInBeats',
  'startBeatId',
  'projectFolder',
  'stemRefs',
  'liveStemRefs',
  'clickExport',
  'cueTrackExport',
  'clickTrackExport',
  'mixState',
  'liveRouting',
  'expectedAudio',
  'sectionBorderHints',
  'chordHints',
  'drumMidi',
  'bassMidi',
  'drumMachine',
  'bassMachine',
  'effectBusses',
])
