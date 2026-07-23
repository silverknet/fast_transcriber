import {
  SONGMAP_CHORD_LAYERS_FORMAT_VERSION,
  SONGMAP_CUE_TRACK_FORMAT_VERSION,
  SONGMAP_FORMAT_VERSION,
  SONGMAP_LEGACY_FORMAT_VERSION,
  SONGMAP_LYRICS_FORMAT_VERSION,
  SONGMAP_TRANSPOSE_FORMAT_VERSION,
} from './version'
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
    harmony: Array.isArray(o.harmony)
      ? o.harmony.map((h, i) => parseHarmony(h, `${path}.harmony[${i}]`))
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
    harmony: Array.isArray(o.harmony)
      ? o.harmony.map((h, i) => parseHarmony(h, `${path}.harmony[${i}]`))
      : [],
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
    tracks.push(entry)
  }
  const out: import('./types').MixState = { tracks }
  if (typeof o.master === 'number' && o.master >= 0) out.master = o.master
  return out
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

function parseCueTrack(raw: unknown, path: string): CueTrack {
  const o = expectObject(raw, path)
  return {
    id: reqString(o.id, `${path}.id`),
    name: reqString(o.name, `${path}.name`),
    enabled: typeof o.enabled === 'boolean' ? o.enabled : true,
    voiceId: optString(o.voiceId),
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

const DRUM_CLASSES = new Set(['kick', 'snare', 'hihat', 'tom', 'cymbal'])
const DRUM_QUANTIZE = new Set(['off', '1/8', '1/16', '1/16T'])

/**
 * Defensive like `parseChordHints`: malformed events are dropped rather than
 * failing the whole song; velocity clamps to [0,1]; unknown kit ids pass
 * through (forward compat with future kits).
 */
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
  return { bars, beats }
}

function extractSongMap(raw: Record<string, unknown>): SongMap {
  const formatVersion = raw.formatVersion
  const isLegacyV1 = formatVersion === SONGMAP_LEGACY_FORMAT_VERSION
  const isLegacyV2 = formatVersion === SONGMAP_CUE_TRACK_FORMAT_VERSION
  const isLegacyV3 = formatVersion === SONGMAP_TRANSPOSE_FORMAT_VERSION
  const isLegacyV4 = formatVersion === SONGMAP_LYRICS_FORMAT_VERSION
  const isLegacyV5 = formatVersion === SONGMAP_CHORD_LAYERS_FORMAT_VERSION
  if (
    formatVersion !== SONGMAP_FORMAT_VERSION &&
    !isLegacyV1 &&
    !isLegacyV2 &&
    !isLegacyV3 &&
    !isLegacyV4 &&
    !isLegacyV5
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
  const harmony = Array.isArray(raw.harmony)
    ? raw.harmony.map((h, i) => parseHarmony(h, `harmony[${i}]`))
    : []
  const lyrics = parseLyrics(raw.lyrics, 'lyrics')

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

  return {
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
    clickExport: isLegacyV1
      ? raw.clickTrackExport !== undefined && raw.clickTrackExport !== null
        ? parseCueTrackExport(raw.clickTrackExport, 'clickTrackExport')
        : undefined
      : raw.clickExport !== undefined && raw.clickExport !== null
        ? parseCueTrackExport(raw.clickExport, 'clickExport')
        : undefined,
    mixState: parseMixState(raw.mixState, 'mixState'),
    expectedAudio: parseExpectedAudio(raw.expectedAudio, 'expectedAudio'),
    chordHints:
      raw.chordHints !== undefined && raw.chordHints !== null
        ? parseChordHints(raw.chordHints, 'chordHints')
        : undefined,
    drumMidi: parseDrumMidi(raw.drumMidi, 'drumMidi'),
    bassMidi: parseBassMidi(raw.bassMidi, 'bassMidi'),
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
  const map = extractSongMap(root)
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
  'clickExport',
  'cueTrackExport',
  'clickTrackExport',
  'mixState',
  'expectedAudio',
  'sectionBorderHints',
  'chordHints',
  'drumMidi',
  'bassMidi',
])
