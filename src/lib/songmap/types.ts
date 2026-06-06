/**
 * SongMap v1 — persistent musical model only (no editor / transport state).
 * Bar times use half-open intervals [startSec, endSec) on the master audio timeline.
 */

import { SONGMAP_FORMAT_VERSION } from './version'

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

export type HarmonyEvent = {
  id: string
  barId: string
  /** Timeline beat this chord starts on (preferred; required for new editor entries). */
  beatId?: string
  startSec: number
  endSec: number
  chord: ChordSymbol
  beatAnchor?: { indexInBar: number }
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
 * Last exported spoken-cue WAV (see `cueTrackFingerprint.ts` + `renderCueTrack.ts`).
 * Cleared automatically when timeline/trim/cues no longer match `fingerprint`.
 */
export type CueTrackExport = {
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
   * setlist export) can offset playback without re-deriving from `sm.cues`.
   */
  preludeOffsetSec: number
  /** Set when written under a project song folder, e.g. `cue/cue-track.wav`. */
  relativePath?: string
}

/**
 * Last exported click-only WAV. Same render path and fingerprint as
 * `CueTrackExport` — every field has the same semantics, but the on-disk
 * file is `cue/click-track.wav` and contains only clicks (no spoken
 * cues). Tracked separately from `cueTrackExport` so the two layers can
 * be regenerated independently.
 */
export type ClickTrackExport = CueTrackExport

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
 *  - `"cue"`                   — `cue/cue-track.wav` if present
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
}

export type SongMapV1 = {
  formatVersion: typeof SONGMAP_FORMAT_VERSION
  app?: SongMapAppInfo
  metadata: SongMetadata
  audio?: AudioReference
  timeline: SongMapTimeline
  sections: Section[]
  harmony: HarmonyEvent[]
  cues: CueSettings
  /**
   * Count-in beats before the song start, independent of `cues.mode`. When
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
  /** Optional rendered spoken-cue WAV aligned to trim + count-in prepend. */
  cueTrackExport?: CueTrackExport
  /** Optional rendered click-only WAV aligned to trim + count-in prepend. */
  clickTrackExport?: ClickTrackExport
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
}

export type SongMap = SongMapV1

/** Partial timeline + optional confidence from `/api/analyze` (merge into SongMap). */
export type SongMapAnalysisFragment = {
  bars?: Bar[]
  beats?: Beat[]
  /** Overall or per-pipeline confidence 0–1 */
  confidence?: number
}
