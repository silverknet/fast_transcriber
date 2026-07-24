/**
 * SongMap v3 — persistent musical model only (no editor / transport state).
 * Bar times use half-open intervals [startSec, endSec) on the master audio timeline.
 */

import { SONGMAP_FORMAT_VERSION } from './version'
import type { AudioFingerprint } from '$lib/audio/audioFingerprint'

export type NoteName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'

export type Accidental = 'sharp' | 'flat' | 'natural'

/**
 * Canonical chord (absolute pitch + quality). Parser/formatter vocabulary (v1 “pop common”):
 * - **quality**: `major` | `minor` | `dim` | `aug` | `7` | `maj7` | `min7` | `sus2` | `sus4` | `add9` | …
 * - **extensions**: `9` | `11` | `13` when not covered by quality alone; slash bass uses `bass` / `bassAccidental`.
 * Roman numerals are **not** stored — derive from `SongKey` + `ChordSymbol` when needed.
 */
export type ChordSymbol = {
  root: NoteName
  accidental?: Accidental
  quality?: string
  extensions?: string[]
  /**
   * Colour tones that refine the quality without changing it (v6): `b5`, `#5`,
   * `b9`, `#9`, `#11`, `b13`, plus bare `6` / `5` and the `7` of a `dim7`.
   * Rendered verbatim after the quality suffix, so `min7` + `['b5']` prints
   * `m7b5`.
   *
   * These MUST live in the structure rather than only in `displayRaw`: the
   * lead sheet and the mixer chord rail both render via `formatChordSymbol()`,
   * which rebuilds the label from these fields, and `transposeChord()` does the
   * same. Colour kept only in `displayRaw` was invisible to both — an imported
   * `Bm7b5` displayed as `Bm7` and transposed to `C#m7`.
   */
  alterations?: string[]
  bass?: NoteName
  bassAccidental?: Accidental
  /** Original symbol string for display / round-trip UI */
  displayRaw: string
}

/** Tonal center for diatonic suggestions, enharmonic spelling, and derived numerals. */
export type SongKeyMode = 'major' | 'minor'

export type SongKey = {
  root: NoteName
  accidental?: Accidental
  mode: SongKeyMode
}

export type SongTranspose = {
  /**
   * Shared song-level transpose in semitones. Source audio/harmony stay
   * untransposed; playback/display derive the sounding key/chords from this.
   */
  baseSemitones: number
}

export type LyricWord = {
  /** Display text as imported (original casing/punctuation). */
  text: string
  /** ORIGINAL audio time (same base as `Beat.timeSec`). Convert at display boundaries only. */
  startSec: number
  endSec: number
  /** 0-based line index into the cleaned lyrics (`Lyrics.sourceText`). */
  line: number
  /** True = timed from a matched recognized word; false/absent = interpolated between anchors. */
  aligned?: boolean
}

export type Lyrics = {
  /**
   * Word-level timing. Empty until "Fit to song" has run — `sourceText` alone
   * means "imported but not aligned yet".
   */
  words: LyricWord[]
  /** Cleaned, line-preserving lyrics text (display fallback + re-align input). */
  sourceText: string
  /** ISO timestamp of the last successful alignment. */
  alignedAt?: string
  /** Version of the transcriber whose output produced `words`. */
  transcriberVersion?: number
}

export type HarmonyEvent = {
  id: string
  barId: string
  /** Timeline beat this chord starts on (preferred; required for new editor entries). */
  beatId?: string
  startSec: number
  endSec: number
  chord: ChordSymbol
  beatAnchor?: { indexInBar: number }
  /**
   * EDGE CASE (opt-in): position within the bar as a fraction [0,1), used
   * INSTEAD of `beatId` so a chord can sit OFF the beat grid — e.g. 3 chords
   * evenly across a 4-beat bar (fractions 0, 1/3, 2/3). The click/beat grid is
   * untouched; only this chord's timing comes from `barId` + `barFraction`.
   * When set, `beatId` is absent.
   */
  barFraction?: number
}

/**
 * LEGACY (v5, read-only). A stored, inactive alternative chord track, paired
 * with its `SectionLayer` twin only by a matching `name` string. Superseded by
 * `SongDraft` in v6 — kept so the v5 parser can read old `.smap` files.
 */
export type ChordLayer = {
  id: string
  /** User-facing track name, e.g. `My chords`, `Sheet import`. */
  name: string
  /** What produced this layer (display hint only). */
  source?: 'manual' | 'sheet-import' | 'suggestions'
  createdAt?: string
  harmony: HarmonyEvent[]
}

/**
 * LEGACY (v5, read-only) — the sections twin of `ChordLayer`. Superseded by
 * `SongDraft` in v6.
 */
export type SectionLayer = {
  id: string
  name: string
  source?: 'manual' | 'sheet-import' | 'suggestions'
  createdAt?: string
  sections: Section[]
}

/** What produced a draft (display hint only). */
export type DraftSource = 'manual' | 'sheet-import' | 'suggestions'

/**
 * A stored, INACTIVE song draft (v6) — one complete take on the song's
 * arrangement: its sections, its chords, and its lyrics as ONE unit.
 *
 * The ACTIVE draft is never in this array. Its content lives at the SongMap
 * root (`sections` / `harmony` / `lyrics`), identified by `activeDraftId` /
 * `activeDraftName`. That keeps every consumer — grid, lead sheet, mixer rail,
 * live mode, Ableton export — reading the same three root fields it always
 * has, with no knowledge of drafts at all. Switching swaps all three fields
 * with a stored draft in one atomic, lossless step (see `songmap/drafts.ts`).
 *
 * Replaces v5's `chordLayers` + `sectionLayers`, which were two independent
 * stacks paired only by a matching name string — a pairing that silently broke
 * whenever the two sides disambiguated duplicate names differently.
 *
 * The song's beat grid, audio, cues and count-in are NOT part of a draft: they
 * are shared by every draft, so the timeline can never fork and the editor
 * stays in lockstep with the exported `.als` across all drafts.
 */
export type SongDraft = {
  id: string
  /** User-facing draft name, e.g. `My draft`, `Sheet import`. */
  name: string
  source?: DraftSource
  createdAt?: string
  sections: Section[]
  harmony: HarmonyEvent[]
  /** Word-level lyrics for this draft; absent means "no lyrics imported". */
  lyrics?: Lyrics
}

export type SectionKind =
  | 'intro'
  | 'verse'
  | 'preChorus'
  | 'chorus'
  | 'bridge'
  | 'solo'
  | 'riff'
  | 'break'
  | 'outro'
  | 'custom'

/** barRange indices are inclusive and align with `Bar.index`. */
export type Section = {
  id: string
  kind: SectionKind
  label: string
  barRange: { startBarIndex: number; endBarIndex: number }
  color?: string
}

export type CueMode = 'off' | 'spoken' | 'click' | 'countIn'

/**
 * Legacy v1 cue settings. Runtime code receives migrated `cueTracks[]`;
 * this type remains only so the v1 parser can read old `.smap` files.
 */
export type CueSettings = {
  mode: CueMode
  countInBeats: number
  useSectionLabels: boolean
  /** Seconds of audio to prepend before the file start so the count-in lands before bar 1. */
  prependSec?: number
  template?: string
  language?: string
  /**
   * Optional override for the spoken pre-song announcement. When the cue
   * mode is `'spoken'` (or a count-in is active and a spoken title plays),
   * this string is what the TTS says. An empty / missing value falls back
   * to `metadata.title`, preserving today's behaviour.
   *
   * Use case: the song's display title is `"Valerie (Amy Winehouse cover) — live"`
   * but the announcement should just be `"Valerie."`. Independent field so
   * editing the announcement doesn't rename the song everywhere else (project
   * list, lead sheet, Ableton track names, etc.).
   *
   * Single source of truth for the speech text the user hears. Resolved at
   * read time via `resolvedSpokenIntroText(sm)` in `cueTrackSpeechSchedule.ts`.
   */
  spokenIntroText?: string
}

/**
 * Last exported cue/click WAV (see `cueTrackFingerprint.ts` + `renderCueTrack.ts`).
 * Cleared automatically when timeline/trim/cues no longer match `fingerprint`.
 */
export type RenderedCueExport = {
  /** Same value as `fingerprintCueTrackInputs()` at generation time. */
  fingerprint: string
  durationSec: number
  sampleRate: number
  generatedAt: string
  /**
   * Silence + count-in clicks at the start of the WAV before the first
   * song-aligned sample, in seconds. Equals
   * `titleCuePreludeSec(sm) + computeCountIn(sm, …)?.prependSec ?? 0`
   * at render time. Stored explicitly so consumers (e.g. the Ableton
   * setlist export) can offset playback without re-deriving renderer timing.
   */
  preludeOffsetSec: number
  /** Set when written under a project song folder, e.g. `cue/tracks/main/cue-track.wav`. */
  relativePath?: string
}

export type CueTrackExport = RenderedCueExport

// ── Drum track (drum stem → detected hits → rendered BarBro kit) ─────────────

export type DrumClass = 'kick' | 'snare' | 'hihat' | 'tom' | 'cymbal'

export type DrumMidiEvent = {
  /** ORIGINAL audio time — same base as `Beat.timeSec` (stems are untrimmed). */
  timeSec: number
  cls: DrumClass
  /** 0..1 — per-song relative (P95-normalized per class at analysis time). */
  velocity: number
}

/** Render-time grid snapping. Events are always stored raw ("as played"). */
export type DrumQuantize = 'off' | '1/8' | '1/16' | '1/16T'

/**
 * Detected drum hits + the settings BarBro renders its own drum track with.
 * Events sync between collaborators (whole-field LWW, like `lyrics`);
 * `renderExport.relativePath` is per-machine and stripped, like cue renders.
 */
export type DrumMidi = {
  events: DrumMidiEvent[]
  analyzedAt: string
  /** Mirror of the sidecar analyzer's version — older results are stale. */
  analyzerVersion: number
  /** Song-relative path of the stem the events came from (provenance label). */
  sourceStem: string
  /** Fingerprint of the audio analyzed: sha256 if present, else `<name>:<size>`. */
  audioFingerprint: string
  /** Drum kit id (see `$lib/audio/drumKits`); absent = default kit. */
  kit?: string
  quantize?: DrumQuantize
  /**
   * 'steady' (default): play the INFERRED groove — per-section patterns,
   * misses filled, flukes dropped (see `songmap/drumGroove.ts`).
   * 'detected': play the raw detected hits.
   */
  style?: 'steady' | 'detected'
  /** Saved render of the drum track, when written into the project. */
  renderExport?: RenderedCueExport
}

// ── Bass track (bass stem → detected notes → rendered BarBro bass) ───────────

export type BassMidiEvent = {
  /** ORIGINAL audio time — same base as `Beat.timeSec` (stems are untrimmed). */
  timeSec: number
  /** Sounding length; the renderer sustains the voice for this long. */
  durationSec: number
  /** MIDI note number (open E on a bass guitar = E1 = 28). */
  midi: number
  /** 0..1 — per-song relative (P95-normalized at analysis time). */
  velocity: number
}

/**
 * Detected bass notes + render settings — `drumMidi`'s sibling, same
 * lifecycle: events sync whole-field LWW, `renderExport.relativePath` is
 * per-machine and stripped. Quantize snaps ONSETS only; durations are kept.
 */
export type BassMidi = {
  events: BassMidiEvent[]
  analyzedAt: string
  /** Mirror of the sidecar analyzer's version — older results are stale. */
  analyzerVersion: number
  /** Song-relative path of the stem the events came from (provenance label). */
  sourceStem: string
  /** Fingerprint of the audio analyzed: sha256 if present, else `<name>:<size>`. */
  audioFingerprint: string
  /** Only applies to 'detected' style; 'steady' is grid-locked already. */
  quantize?: DrumQuantize
  /**
   * 'steady' (default): the CONFIDENT-BASSIST pass — register-folded,
   * grid-locked, legato phrasing, flattened dynamics (`songmap/bassGroove.ts`).
   * 'detected': play the raw detected notes.
   */
  style?: 'steady' | 'detected'
  /** Saved render of the bass track, when written into the project. */
  renderExport?: RenderedCueExport
}
export type ClickTrackExport = RenderedCueExport

export type CueAnchor =
  | {
      kind: 'bar'
      barId: string
      leadBars?: number
      leadBeats?: number
      offsetSec?: number
    }
  | {
      kind: 'beat'
      beatId: string
      leadBars?: number
      leadBeats?: number
      offsetSec?: number
    }
  | {
      kind: 'time'
      timeSec: number
      leadBars?: number
      leadBeats?: number
      offsetSec?: number
    }

export type CueEventKind =
  | 'section'
  | 'count'
  | 'intro'
  | 'custom-text'
  | 'recorded-audio-placeholder'

export type CueEventSource = 'generated' | 'custom' | 'imported' | 'recorded'

export type CueEvent = {
  id: string
  kind: CueEventKind
  enabled: boolean
  anchor: CueAnchor
  text?: string
  generatedKey?: string
  generatedSource?: {
    kind: 'section'
    sectionId: string
    leadBars?: number
    leadBeats?: number
  }
  source?: CueEventSource
  edited?: boolean
  stale?: boolean
}

export type CueTrack = {
  id: string
  name: string
  enabled: boolean
  voiceId?: string
  /** Links this cue track to a project `Performer` (their cues). Absent for
   *  standalone/legacy tracks. In live mode a performer's cues route to their
   *  own output channel. */
  performerId?: string
  events: CueEvent[]
  suppressedGeneratedKeys: string[]
  renderExport?: RenderedCueExport
  /**
   * Speak the count-in before the song: announce the intro (title or custom
   * text) + the count length, then count the beats in time — e.g.
   * "Valerie … 8 … one, two, …, eight". Derived at render time from
   * `countInBeats` (not stored as events). Off/absent = click-only count-in.
   */
  spokenCountIn?: boolean
}

export type AudioSource = 'upload' | 'import' | 'unknown'

export type AudioReference = {
  fileName: string
  mimeType?: string
  /** Duration of the full (untrimmed) reference audio file in seconds. */
  durationSec?: number
  /**
   * Sample rate of the stored audio in Hz (e.g. 44100, 48000). Persisted at
   * relink / import time alongside `sha256` so collaborators on a different
   * machine can match audio by content identity rather than path.
   */
  sampleRate?: number
  /** Channel count (1 = mono, 2 = stereo). Identity field; see `sampleRate`. */
  channels?: number
  /** File size in bytes on disk. Identity field; see `sampleRate`. */
  fileSize?: number
  /** Selected playback region within the full reference audio. */
  trim: { startSec: number; endSec: number }
  /** SHA-256 of the stored reference (compressed) audio file. */
  sha256?: string
  /** SHA-256 of the original HQ uploaded file — used to verify re-uploads for full-quality re-analysis. */
  originalSha256?: string
  /**
   * Recording identity: a coarse loudness envelope of the decoded audio (v6).
   *
   * Answers "is this the same performance?" where `sha256` only answers "is
   * this the same file". Two collaborators holding the same master as a WAV
   * and an MP3 have different shas but the same fingerprint — and the same
   * bar/beat grid fits both. A different edit, or the same music shifted by a
   * few seconds of head silence, does NOT match, because every stored
   * `Bar.startSec` would then be wrong.
   *
   * See `$lib/audio/audioFingerprint.ts`.
   */
  fingerprint?: AudioFingerprint
  /**
   * POSIX-style path to the original audio file, **relative to the `.smap` file's directory**.
   * Typical value: `"audio/<fileName>"`. Resolves to `<projectPath>/<songFolder>/audio/<fileName>`
   * in project mode and to a sibling `audio/` folder when a single-song bundle is shared.
   * Absent on legacy/web-only `.smap` files; the app shows a relink banner in that case.
   * **Local-only** — stripped from the collaborative SongMap on cloud push.
   */
  originalPath?: string
  source: AudioSource
}

/**
 * Cloud's claim about which audio file belongs to a song. Written by the
 * server on `joinCloudProject` / pull; read by the local reconciler when
 * the project opens. Phase 5 matches the local `<song>/audio/` contents
 * against this bundle (strict by sha256, loose by duration+sr+ch+size).
 */
export type ExpectedAudio = {
  fileName: string
  mimeType?: string
  durationSec?: number
  sampleRate?: number
  channels?: number
  fileSize?: number
  sha256?: string
  originalSha256?: string
  /** Recording identity — see `AudioReference.fingerprint` (v6). */
  fingerprint?: AudioFingerprint
}

export type Meter = { numerator: number; denominator: number }

export type Bar = {
  id: string
  /** 0-based sequence in song */
  index: number
  startSec: number
  endSec: number
  meter: Meter
  beatCount: number
  beatIds: string[]
}

export type BeatSource = 'manual' | 'detected' | 'imported'

/** Flat list; each beat belongs to exactly one bar (`barId`). */
export type Beat = {
  id: string
  barId: string
  indexInBar: number
  timeSec: number
  strength?: number
  confidence?: number
  source?: BeatSource
}

export type SongMetadata = {
  title: string
  artist?: string
  composer?: string
  arranger?: string
  /** Legacy display string; keep in sync with `keyDetail` when both set. */
  key?: string
  /**
   * One global tonal reference for spelling, diatonic UI, and derived numerals.
   * `harmony[].chord` stays absolute; changing key does not transpose existing chords.
   */
  keyDetail?: SongKey
  bpm?: number
  notes?: string
  createdAt: string
  updatedAt: string
  /**
   * True once beat/bar analysis has completed. False (or absent in legacy files) means
   * the project has audio but no timeline yet — route to import page, not editor.
   * Legacy .smap files without this field are inferred as analyzed when bars are present.
   */
  analyzed?: boolean
}

export type SongMapAppInfo = {
  name: 'BarBro'
  appVersion?: string
}

export type SongMapTimeline = {
  bars: Bar[]
  beats: Beat[]
  /**
   * Snapshot of `{ bars, beats }` captured the last time a full
   * analysis fragment was merged into this song. Provides a "Reset
   * grid" affordance for users who edit the timeline and want to undo
   * back to the analyzed baseline. Survives reloads (lives in `.smap`).
   * Absent on legacy files that pre-date this field; the UI hides the
   * Reset action when no snapshot is present.
   *
   * Intentionally NOT a full undo history — that lands later. For now
   * this is a single revert point per song.
   */
  original?: {
    bars: Bar[]
    beats: Beat[]
  }
}

/**
 * Relative paths (from the project folder) to each stem audio file.
 * Key = stem name (e.g. "Drums"), value = relative path (e.g. "drums.wav" or "stems/drums.wav").
 */
export type StemRefs = Record<string, string>

/**
 * Per-track mixer state used by the in-browser DAW view (`/edit` mix mode).
 *
 * Tracks identified by stable `key`:
 *  - `"original"`              — the song.smap audio chunk (full reference)
 *  - `"cue"`                   — rendered cue track if present
 *  - `"stem:<filename>"`       — one of `stemsOnDisk` (e.g. `"stem:vocals.wav"`)
 *
 * Tracks not listed get sensible defaults (volume 1, not muted, not soloed).
 * Unknown keys are tolerated — they may appear after stems get added/removed
 * on disk between edits.
 */
export interface MixTrackState {
  /** Stable identifier — see top of doc for the schema. */
  key: string
  /** Linear gain 0..1.5 (1 = unity, >1 boosts). */
  volume: number
  muted?: boolean
  soloed?: boolean
}

export interface MixState {
  tracks: MixTrackState[]
  /** Master gain 0..1.5. Defaults to 1 when absent. */
  master?: number
}

/**
 * Cached output of the Python section-border suggester
 * (`desktop/native/python/sections/border_suggest.py`). Persisted so we don't
 * re-analyze on every song open. Invalidated when the audio fingerprint or
 * `analyzerVersion` no longer matches; old `.smap` files (no hints) trigger
 * a one-time analysis on first sections-mode entry.
 */
export type SectionBorderHints = {
  borders: { bar: number; confidence: number }[]
  /** Fingerprint of the audio used: sha256 if present, else `<name>:<size>`. */
  audioFingerprint: string
  generatedAt: string
  /** Bump when `border_suggest.py` algorithm changes to force re-analysis. */
  analyzerVersion: number
}

/**
 * Cached output of the Python chord-chroma analyzer
 * (`desktop/native/python/sections/chord_chroma.py`). Per-beat 12-dim chroma
 * vectors + a derived song-level key. Persisted so we don't re-analyze on
 * every song open. Invalidated when the audio fingerprint, beat count, or
 * `analyzerVersion` no longer matches; old `.smap` files (no hints) trigger
 * a one-time analysis on first chords-mode entry.
 *
 * The raw `beatChroma` is the foundation for future per-beat chord-template
 * matching and modulation detection — keep it stored even after the key is
 * derived so phase 2/3 features can build on it without a second audio pass.
 */
export type ChordHints = {
  /**
   * 12-dim chroma per beat, in the same order as `sortBeatsByTime(beats)`.
   * Each value 0–1, L1-normalized per beat. Length must equal beats.length;
   * mismatch → treat as stale.
   */
  beatChroma: number[][]
  /** Krumhansl–Kessler best fit over song-average chroma. Null if too flat. */
  detectedKey: {
    root: NoteName
    accidental?: Accidental
    mode: SongKeyMode
    /** Top-vs-runner-up margin, clipped to [0, 1]. */
    confidence: number
  } | null
  /** Fingerprint of the audio used: sha256 if present, else `<name>:<size>`. */
  audioFingerprint: string
  generatedAt: string
  /** Bump when `chord_chroma.py` algorithm changes to force re-analysis. */
  analyzerVersion: number
  /**
   * Which audio source produced this cache. Lets the debug UI tell at a
   * glance whether the cached chroma came from a clean harmonic stem or
   * the muddy full mix. Absent on legacy v2 caches.
   */
  analyzerSource?: 'stems-other' | 'mix'
}

export type SongMapV3 = {
  formatVersion: typeof SONGMAP_FORMAT_VERSION
  app?: SongMapAppInfo
  metadata: SongMetadata
  transpose?: SongTranspose
  /**
   * Imported lyrics + word-level timing aligned to the audio (v4). Belongs to
   * the ACTIVE draft (v6) — switching drafts swaps this field too.
   */
  lyrics?: Lyrics
  audio?: AudioReference
  timeline: SongMapTimeline
  /** Sections of the ACTIVE draft (v6). */
  sections: Section[]
  /** Chords of the ACTIVE draft (v6). */
  harmony: HarmonyEvent[]
  /**
   * Stored INACTIVE drafts (v6). The active draft is NOT in here — its content
   * is `sections` / `harmony` / `lyrics` above. See `songmap/drafts.ts`.
   */
  drafts?: SongDraft[]
  /** Stable id of the ACTIVE draft, whose content lives at the root. */
  activeDraftId?: string
  /** Display name of the ACTIVE draft. */
  activeDraftName?: string
  /**
   * ISO creation time of the ACTIVE draft. Stored drafts carry their own
   * `createdAt`; this is the equivalent for the one living at the root, so the
   * draft switcher can show every draft's date. Preserved across switches (a
   * draft keeps its original creation time when it moves active↔stored).
   */
  activeDraftCreatedAt?: string
  cueTracks: CueTrack[]
  /**
   * Count-in beats before the song start, independent of cue speech. When
   * absent or `0`, no count-in is rendered. Decoupled from cue speech so a
   * song can have both spoken cues AND a count-in.
   */
  countInBeats?: number
  /**
   * Optional override of the song-start anchor. References an id from
   * `timeline.beats`. When absent, the song start is bar 1 beat 1 (the
   * first beat with `indexInBar === 0` on bar 1) — the historical default.
   */
  startBeatId?: string
  /**
   * Display hint for the project folder name (e.g. "DangerousSong").
   * Not a full path — used to show "not found" messaging on a different machine.
   */
  projectFolder?: string
  /** Relative paths within the project folder to each stem audio file. */
  stemRefs?: StemRefs
  /** Optional rendered click-only WAV aligned to trim + count-in prepend. */
  clickExport?: RenderedCueExport
  /** Optional saved mixer state for the in-browser DAW view. */
  mixState?: MixState
  /**
   * For cloud-linked songs: the server's claim about which audio file
   * belongs here, by content identity. Absent on standalone / local-only
   * songs. Phase 5 reconciliation uses this to match a local audio file
   * even if it was renamed or copied from a different folder.
   */
  expectedAudio?: ExpectedAudio
  /** Cached audio-derived section-border hints (display-only). */
  sectionBorderHints?: SectionBorderHints
  /** Cached per-beat chroma + detected key (display-only / hint source). */
  chordHints?: ChordHints
  /** Detected drum hits + BarBro's rendered drum-track settings. */
  drumMidi?: DrumMidi
  /** Detected bass notes + BarBro's rendered bass-track settings. */
  bassMidi?: BassMidi
}

/** Current persistent shape (formatVersion 4). Name kept from the v3 era to
 * avoid churn; the `formatVersion` literal tracks `SONGMAP_FORMAT_VERSION`. */
export type SongMapV4 = SongMapV3

/** @deprecated Persistent runtime shape is v4; kept for older imports. */
export type SongMapV1 = SongMapV3
/** @deprecated Persistent runtime shape is v4; kept for older imports. */
export type SongMapV2 = SongMapV3

export type SongMap = SongMapV3

/** Partial timeline + optional confidence from `/api/analyze` (merge into SongMap). */
export type SongMapAnalysisFragment = {
  bars?: Bar[]
  beats?: Beat[]
  /** Overall or per-pipeline confidence 0–1 */
  confidence?: number
}
