/**
 * Shared realistic song fixture for the Song Edit design exploration
 * (`/debug/song-editor/*`). Built from the REAL `SongMap` data model so the
 * prototypes render against production-shaped data — not an invented model.
 *
 * A full-length pop song: 96 bars @ 122 BPM in 4/4 (~3:09), eight sections,
 * a chord per bar, multi-verse timed lyrics, and a cue track. Plus a set of
 * pre-derived, view-friendly helpers so each prototype can pull exactly what it
 * needs (bar cells, chord row, lyric lines, section bands, mixer lanes,
 * waveform sections) without re-deriving from scratch.
 *
 * Debug/design only — never imported by production routes.
 */
import type {
  SongMap,
  Section,
  SectionKind,
  HarmonyEvent,
  ChordSymbol,
  Bar,
  Beat,
  LyricWord,
  CueTrack,
  CueEvent,
  NoteName,
} from '$lib/songmap/types'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import { sectionKindColor } from '$lib/songmap/sectionColors'

const BPM = 122
const BEATS_PER_BAR = 4
const BEAT_SEC = 60 / BPM
const BAR_SEC = BEAT_SEC * BEATS_PER_BAR
const BAR_COUNT = 96
export const DURATION_SEC = +(BAR_COUNT * BAR_SEC).toFixed(3) // ~188.9s

// ── Sections (bar ranges are 0-based inclusive, like the real model) ──
type SectionSpec = { kind: SectionKind; label: string; from: number; to: number } // 1-based bars
const SECTION_SPEC: SectionSpec[] = [
  { kind: 'intro', label: 'Intro', from: 1, to: 8 },
  { kind: 'verse', label: 'Verse 1', from: 9, to: 24 },
  { kind: 'preChorus', label: 'Pre-chorus', from: 25, to: 32 },
  { kind: 'chorus', label: 'Chorus', from: 33, to: 48 },
  { kind: 'verse', label: 'Verse 2', from: 49, to: 64 },
  { kind: 'chorus', label: 'Chorus', from: 65, to: 80 },
  { kind: 'bridge', label: 'Bridge', from: 81, to: 88 },
  { kind: 'outro', label: 'Outro', from: 89, to: 96 },
]

// ── Chords ──
const CHORD_LIB: Record<string, ChordSymbol> = {
  G: { root: 'G', quality: 'major', displayRaw: 'G' },
  D: { root: 'D', quality: 'major', displayRaw: 'D' },
  Em: { root: 'E', quality: 'minor', displayRaw: 'Em' },
  C: { root: 'C', quality: 'major', displayRaw: 'C' },
  Am: { root: 'A', quality: 'minor', displayRaw: 'Am' },
  D7: { root: 'D', quality: '7', displayRaw: 'D7' },
}
const PROGRESSION: Record<SectionKind, string[]> = {
  intro: ['G', 'D'],
  verse: ['G', 'D', 'Em', 'C'],
  preChorus: ['C', 'D', 'C', 'D7'],
  chorus: ['G', 'D', 'Em', 'C'],
  bridge: ['Am', 'C', 'G', 'D'],
  solo: ['G', 'C'],
  riff: ['G', 'C'],
  break: ['G'],
  outro: ['C', 'G', 'C', 'G'],
  custom: ['G'],
}

const barId = (i: number) => `bar-${i + 1}`
const beatId = (bar: number, beat: number) => `beat-${bar + 1}-${beat + 1}`
const sectionKindForBar = (barNo: number): SectionKind =>
  SECTION_SPEC.find((s) => barNo >= s.from && barNo <= s.to)?.kind ?? 'custom'

// ── Timeline (bars + beats) ──
const bars: Bar[] = []
const beats: Beat[] = []
for (let i = 0; i < BAR_COUNT; i++) {
  const start = +(i * BAR_SEC).toFixed(3)
  const ids: string[] = []
  for (let b = 0; b < BEATS_PER_BAR; b++) {
    const id = beatId(i, b)
    ids.push(id)
    beats.push({
      id,
      barId: barId(i),
      indexInBar: b,
      timeSec: +(start + b * BEAT_SEC).toFixed(3),
      strength: b === 0 ? 1 : 0.4,
      source: 'detected',
    })
  }
  bars.push({
    id: barId(i),
    index: i,
    startSec: start,
    endSec: +((i + 1) * BAR_SEC).toFixed(3),
    meter: { numerator: 4, denominator: 4 },
    beatCount: BEATS_PER_BAR,
    beatIds: ids,
  })
}

const sections: Section[] = SECTION_SPEC.map((s, i) => ({
  id: `sec-${i}-${s.kind}`,
  kind: s.kind,
  label: s.label,
  barRange: { startBarIndex: s.from - 1, endBarIndex: s.to - 1 },
  color: sectionKindColor(s.kind),
}))

// ── Harmony: one chord per bar, cycling the section's progression ──
const harmony: HarmonyEvent[] = bars.map((bar, i) => {
  const kind = sectionKindForBar(i + 1)
  const prog = PROGRESSION[kind]
  const secStartBar = (SECTION_SPEC.find((s) => s.kind === kind && i + 1 >= s.from && i + 1 <= s.to)?.from ?? 1) - 1
  const chord = CHORD_LIB[prog[(i - secStartBar) % prog.length]!]!
  return {
    id: `h-${i + 1}`,
    barId: bar.id,
    beatId: bar.beatIds[0]!,
    startSec: bar.startSec,
    endSec: bar.endSec,
    chord,
    beatAnchor: { indexInBar: 0 },
  }
})

// ── Lyrics: representative multi-verse lines mapped onto the sung bars ──
// Original placeholder lyric lines (invented filler — realistic length/shape
// for layout testing, deliberately NOT any real song's words).
const LYRIC_LINES: string[] = [
  'Solen faller sakta över taken',
  'och gatan andas långsamt in en dag',
  'vi räknar sekunder tills det ljusnar',
  'och orden hittar aldrig riktigt fram',
  'Ett fönster öppet mot en tyst april',
  'en radio som spelar för sig själv',
  'jag minns en färg jag aldrig kan förklara',
  'en känsla utan namn men ändå min',
  'Och vinden bär oss vidare i natten',
  'förbi allt det som en gång kändes stort',
  'vi lämnar spår som ingen annan ser',
  'och morgonen tar tillbaka vad den gav',
  'Håll kvar den där sekunden lite till',
  'innan allt går sönder eller läks',
  'vi bygger något litet av det tomma',
  'och kallar det för hem så länge det står',
  'Och vinden bär oss vidare i natten',
  'förbi allt det som en gång kändes stort',
  'vi lämnar spår som ingen annan ser',
  'och morgonen tar tillbaka vad den gav',
  'och morgonen tar tillbaka vad den gav',
  'tills bara ljuset står kvar',
]
// Lines are sung across bars 9..88 (skip intro + outro), ~3.6 bars/line.
const SUNG_FROM_BAR = 9
const SUNG_TO_BAR = 88
const words: LyricWord[] = []
LYRIC_LINES.forEach((line, li) => {
  const span = (SUNG_TO_BAR - SUNG_FROM_BAR) / LYRIC_LINES.length
  const lineStartBar = SUNG_FROM_BAR + li * span
  const lineStartSec = (lineStartBar - 1) * BAR_SEC + 0.3
  const toks = line.split(/\s+/)
  const per = (span * BAR_SEC * 0.72) / toks.length
  toks.forEach((t, wi) => {
    const start = +(lineStartSec + wi * per).toFixed(3)
    words.push({ text: t, startSec: start, endSec: +(start + per * 0.85).toFixed(3), line: li, aligned: li % 2 === 0 })
  })
})

// ── Cue track: a spoken cue at each section start + a spoken count-in ──
const cueEvents: CueEvent[] = sections.map((s, i) => ({
  id: `cue-${i}`,
  kind: 'section',
  enabled: i % 4 !== 3,
  anchor: { kind: 'bar', barId: barId(s.barRange.startBarIndex), leadBeats: 2 },
  text: s.label,
  generatedKey: `section:${s.id}`,
  generatedSource: { kind: 'section', sectionId: s.id, leadBeats: 2 },
  source: 'generated',
}))
const cueTracks: CueTrack[] = [
  {
    id: 'cue-lead',
    name: 'Lead cues',
    enabled: true,
    voiceId: 'en_US-lessac-medium',
    events: cueEvents,
    suppressedGeneratedKeys: [],
    spokenCountIn: true,
  },
]

// ── The SongMap (real type) ──
export const songEditorFixture: SongMap = {
  formatVersion: SONGMAP_FORMAT_VERSION,
  app: { name: 'BarBro', appVersion: '1.2.3' },
  metadata: {
    title: 'Dum av dig',
    artist: 'Håkan Hellström',
    key: 'G major',
    keyDetail: { root: 'G', mode: 'major' },
    bpm: BPM,
    notes: 'Live arrangement — spring tour',
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-07-20T18:30:00.000Z',
    analyzed: true,
  },
  transpose: { baseSemitones: 0 },
  lyrics: { words, sourceText: LYRIC_LINES.join('\n'), alignedAt: '2026-07-19T12:00:00.000Z', transcriberVersion: 4 },
  audio: {
    fileName: 'dum-av-dig.wav',
    mimeType: 'audio/wav',
    durationSec: DURATION_SEC,
    sampleRate: 48000,
    channels: 2,
    fileSize: 36_200_000,
    trim: { startSec: 0, endSec: DURATION_SEC },
    sha256: 'c'.repeat(64),
    source: 'upload',
  },
  timeline: { bars, beats },
  sections,
  harmony,
  cueTracks,
  countInBeats: 4,
  activeDraftId: 'draft-main',
  activeDraftName: 'Main',
  activeDraftCreatedAt: '2026-03-01T10:00:00.000Z',
}

// ══════════════════════════════════════════════════════════════════════════
// View-friendly derived helpers (so prototypes don't re-derive)
// ══════════════════════════════════════════════════════════════════════════

export const meta = {
  title: songEditorFixture.metadata.title,
  artist: songEditorFixture.metadata.artist ?? '',
  bpm: BPM,
  keyLabel: songEditorFixture.metadata.key ?? 'G major',
  bars: BAR_COUNT,
  beatsPerBar: BEATS_PER_BAR,
  durationSec: DURATION_SEC,
  durationLabel: fmtTime(DURATION_SEC),
  timeSignature: '4/4',
  draftLabel: 'Main',
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Sections shaped for the interactive `DebugSharedWaveform` (1-based bars). */
export const waveformSections = SECTION_SPEC.map((s) => ({ kind: s.kind, label: s.label, from: s.from, to: s.to }))

/** Section rows with 1-based bar ranges + colour, for lists/inspectors. */
export const sectionRows = SECTION_SPEC.map((s, i) => ({
  id: sections[i]!.id,
  kind: s.kind,
  label: s.label,
  fromBar: s.from,
  toBar: s.to,
  bars: s.to - s.from + 1,
  color: sectionKindColor(s.kind),
}))

/** One display chord per bar (the harmony above, as labels). */
export const chordRow: string[] = harmony.map((h) => h.chord.displayRaw)

/** Bar cells for grid/bar-strip UIs. */
export const barCells = bars.map((bar, i) => {
  const kind = sectionKindForBar(i + 1)
  const spec = SECTION_SPEC.find((s) => i + 1 >= s.from && i + 1 <= s.to)
  return {
    number: i + 1,
    kind,
    color: sectionKindColor(kind),
    isSectionStart: spec ? spec.from === i + 1 : false,
    sectionLabel: spec?.label ?? '',
    chord: harmony[i]!.chord.displayRaw,
    startSec: bar.startSec,
  }
})

/** Lyric lines with their first-word time. */
export const lyricLines = LYRIC_LINES.map((text, i) => {
  const first = words.find((w) => w.line === i)
  return { index: i, text, startSec: first?.startSec ?? 0, timeLabel: fmtTime(first?.startSec ?? 0) }
})

/** Prototype mixer lanes (stems + generated tracks), for the Overview mixer. */
export const mixerLanes = [
  { key: 'original', label: 'Original mix', color: '#71717a', db: 0, muted: false, solo: false },
  { key: 'drums', label: 'Drums', color: sectionKindColor('chorus'), db: -3, muted: false, solo: false },
  { key: 'bass', label: 'Bass', color: sectionKindColor('bridge'), db: -4, muted: false, solo: false },
  { key: 'other', label: 'Other', color: sectionKindColor('verse'), db: -6, muted: true, solo: false },
  { key: 'barbro-drums', label: 'BarBro Drums', color: sectionKindColor('solo'), db: -16, muted: false, solo: false },
  { key: 'barbro-bass', label: 'BarBro Bass', color: sectionKindColor('intro'), db: -18, muted: true, solo: false },
]

/** Cue rows per section (for the Cue tab). */
export const cueRows = sectionRows.map((s, i) => ({
  ...s,
  spoken: cueEvents[i]?.enabled ?? false,
  countIn: i === 0,
}))

/** The tab set, matching the real /edit `editMode` union + order. */
export const EDIT_TABS = [
  { id: 'overview', label: 'Overview', usesWaveform: false },
  { id: 'grid', label: 'Grid', usesWaveform: true },
  { id: 'sections', label: 'Sections', usesWaveform: true },
  { id: 'chords', label: 'Chords', usesWaveform: true },
  { id: 'cue', label: 'Cue', usesWaveform: false },
  { id: 'lyrics', label: 'Lyrics', usesWaveform: false },
  { id: 'leadsheet', label: 'Lead sheet', usesWaveform: false },
] as const
export type EditTabId = (typeof EDIT_TABS)[number]['id']
