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
  template?: string
  language?: string
}

export type AudioSource = 'upload' | 'import' | 'unknown'

export type AudioReference = {
  fileName: string
  mimeType?: string
  /** Duration of the full (untrimmed) reference audio file in seconds. */
  durationSec?: number
  /** Selected playback region within the full reference audio. */
  trim: { startSec: number; endSec: number }
  /** SHA-256 of the stored reference (compressed) audio file. */
  sha256?: string
  /** SHA-256 of the original HQ uploaded file — used to verify re-uploads for full-quality re-analysis. */
  originalSha256?: string
  source: AudioSource
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
}

export type SongMap = SongMapV1

/** Partial timeline + optional confidence from `/api/analyze` (merge into SongMap). */
export type SongMapAnalysisFragment = {
  bars?: Bar[]
  beats?: Beat[]
  /** Overall or per-pipeline confidence 0–1 */
  confidence?: number
}
