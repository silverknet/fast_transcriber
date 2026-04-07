import { SONGMAP_FORMAT_VERSION } from './version'
import type {
  AudioReference,
  Bar,
  Beat,
  ChordSymbol,
  CueSettings,
  HarmonyEvent,
  Meter,
  Section,
  SongKey,
  SongMap,
  SongMapAppInfo,
  SongMetadata,
  SongMapTimeline,
} from './types'
import { defaultCueSettings } from './defaults'
import { validateSongMap } from './validate'

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
  return {
    id: reqString(o.id, `${path}.id`),
    barId: reqString(o.barId, `${path}.barId`),
    beatId: optString(o.beatId),
    startSec: reqNum(o.startSec, `${path}.startSec`),
    endSec: reqNum(o.endSec, `${path}.endSec`),
    chord: parseChord(o.chord, `${path}.chord`),
    beatAnchor,
  }
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

function parseAudio(raw: unknown, path: string): AudioReference {
  const o = expectObject(raw, path)
  const trim = expectObject(o.trim, `${path}.trim`)
  return {
    fileName: reqString(o.fileName, `${path}.fileName`),
    mimeType: optString(o.mimeType),
    durationSec: optNum(o.durationSec),
    trim: {
      startSec: reqNum(trim.startSec, `${path}.trim.startSec`),
      endSec: reqNum(trim.endSec, `${path}.trim.endSec`),
    },
    sha256: optString(o.sha256),
    source: reqString(o.source, `${path}.source`) as AudioReference['source'],
  }
}

function parseCues(raw: unknown, path: string): CueSettings {
  const o = expectObject(raw, path)
  return {
    mode: reqString(o.mode, `${path}.mode`) as CueSettings['mode'],
    countInBeats: reqNum(o.countInBeats, `${path}.countInBeats`),
    useSectionLabels: Boolean(o.useSectionLabels),
    template: optString(o.template),
    language: optString(o.language),
  }
}

function parseMetadata(raw: unknown, path: string): SongMetadata {
  const o = expectObject(raw, path)
  const keyDetail =
    o.keyDetail !== undefined && o.keyDetail !== null
      ? parseSongKey(o.keyDetail, `${path}.keyDetail`)
      : undefined
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
  return { bars, beats }
}

function extractSongMapV1(raw: Record<string, unknown>): SongMap {
  const formatVersion = raw.formatVersion
  if (formatVersion !== SONGMAP_FORMAT_VERSION) {
    throw new SongMapParseError(`Unsupported formatVersion: ${String(formatVersion)}`, 'formatVersion')
  }
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    app: parseApp(raw.app, 'app'),
    metadata: parseMetadata(raw.metadata, 'metadata'),
    audio: raw.audio !== undefined && raw.audio !== null ? parseAudio(raw.audio, 'audio') : undefined,
    timeline: parseTimeline(raw.timeline, 'timeline'),
    sections: Array.isArray(raw.sections)
      ? raw.sections.map((s, i) => parseSection(s, `sections[${i}]`))
      : [],
    harmony: Array.isArray(raw.harmony)
      ? raw.harmony.map((h, i) => parseHarmony(h, `harmony[${i}]`))
      : [],
    cues:
      raw.cues !== undefined && raw.cues !== null ? parseCues(raw.cues, 'cues') : defaultCueSettings(),
  }
}

/**
 * Parse JSON string into `SongMap`. Unknown keys are ignored when `stripUnknown` is true (default).
 */
export function parseSongMap(json: string, options: ParseSongMapOptions = {}): SongMap {
  const { stripUnknown = true } = options
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
  const map = extractSongMapV1(root)
  const v = validateSongMap(map)
  if (!v.ok) {
    throw new SongMapParseError(v.errors[0] ?? 'Validation failed')
  }
  return map
}

const KNOWN_TOP_KEYS = new Set([
  'formatVersion',
  'app',
  'metadata',
  'audio',
  'timeline',
  'sections',
  'harmony',
  'cues',
])
