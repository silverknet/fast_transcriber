/**
 * Shared SongMap fixtures for the Phase 2 `Y.Doc` round-trip proofs.
 *
 * Lives outside a `.test.ts` file so the cross-process determinism check
 * (`ydocSeedProbe.ts`, run under a real second node process) can import the
 * exact same song the in-process tests use.
 */
import { AUDIO_FINGERPRINT_VERSION } from '$lib/audio/audioFingerprint'
import type { SongMap } from './types'
import { SONGMAP_FORMAT_VERSION } from './version'

/**
 * A song that exercises every v6 field worth round-tripping: drafts, chord
 * `alterations`, the audio recording `fingerprint`, lyrics, cue tracks with
 * generated + custom events, transpose, count-in, `startBeatId`, the
 * "Reset grid" snapshot, drum/bass MIDI, and every local-only field (which
 * must NOT survive into the document).
 */
export function richSongMap(): SongMap {
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    app: { name: 'BarBro', appVersion: '1.2.3' },
    metadata: {
      title: 'Valerie',
      artist: 'The Zutons',
      composer: 'Dave McCabe',
      arranger: 'M',
      key: 'Eb major',
      keyDetail: { root: 'E', accidental: 'flat', mode: 'major' },
      bpm: 128,
      notes: 'Live arrangement',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-02T00:00:00.000Z',
      analyzed: true,
    },
    transpose: { baseSemitones: -2 },
    lyrics: {
      words: [
        { text: 'Well', startSec: 1.0, endSec: 1.2, line: 0, aligned: true },
        { text: 'sometimes', startSec: 1.2, endSec: 1.7, line: 0 },
      ],
      sourceText: 'Well sometimes\nI go out by myself',
      alignedAt: '2026-02-01T00:00:00.000Z',
      transcriberVersion: 3,
    },
    audio: {
      fileName: 'valerie.wav',
      mimeType: 'audio/wav',
      durationSec: 213.5,
      sampleRate: 48000,
      channels: 2,
      fileSize: 41_000_000,
      trim: { startSec: 0.25, endSec: 210.75 },
      sha256: 'a'.repeat(64),
      originalSha256: 'b'.repeat(64),
      fingerprint: { version: AUDIO_FINGERPRINT_VERSION, durationSec: 213.5, envelope: [12, 200, 173, 4] },
      // Local-only — must be stripped by `toCollabSongMap` before seeding.
      originalPath: 'audio/valerie.wav',
      source: 'upload',
    },
    timeline: {
      bars: [
        {
          id: 'bar-1',
          index: 0,
          startSec: 0.5,
          endSec: 2.5,
          meter: { numerator: 4, denominator: 4 },
          beatCount: 4,
          beatIds: ['beat-1', 'beat-2', 'beat-3', 'beat-4'],
        },
        {
          id: 'bar-2',
          index: 1,
          startSec: 2.5,
          endSec: 4.0,
          meter: { numerator: 3, denominator: 4 },
          beatCount: 3,
          beatIds: ['beat-5', 'beat-6', 'beat-7'],
        },
      ],
      beats: [
        { id: 'beat-1', barId: 'bar-1', indexInBar: 0, timeSec: 0.5, strength: 1, confidence: 0.9, source: 'detected' },
        { id: 'beat-2', barId: 'bar-1', indexInBar: 1, timeSec: 1.0, source: 'detected' },
        { id: 'beat-3', barId: 'bar-1', indexInBar: 2, timeSec: 1.5, source: 'manual' },
        { id: 'beat-4', barId: 'bar-1', indexInBar: 3, timeSec: 2.0 },
        { id: 'beat-5', barId: 'bar-2', indexInBar: 0, timeSec: 2.5, source: 'imported' },
        { id: 'beat-6', barId: 'bar-2', indexInBar: 1, timeSec: 3.0 },
        { id: 'beat-7', barId: 'bar-2', indexInBar: 2, timeSec: 3.5 },
      ],
      original: {
        bars: [
          {
            id: 'bar-1',
            index: 0,
            startSec: 0.5,
            endSec: 2.5,
            meter: { numerator: 4, denominator: 4 },
            beatCount: 4,
            beatIds: ['beat-1', 'beat-2', 'beat-3', 'beat-4'],
          },
        ],
        beats: [{ id: 'beat-1', barId: 'bar-1', indexInBar: 0, timeSec: 0.5, source: 'detected' }],
      },
    },
    sections: [
      { id: 'sec-intro', kind: 'intro', label: 'Intro', barRange: { startBarIndex: 0, endBarIndex: 0 } },
      { id: 'sec-verse', kind: 'verse', label: 'Verse 1', barRange: { startBarIndex: 1, endBarIndex: 1 }, color: '#ff8800' },
    ],
    harmony: [
      {
        id: 'h-1',
        barId: 'bar-1',
        beatId: 'beat-1',
        startSec: 0.5,
        endSec: 2.5,
        chord: {
          root: 'B',
          quality: 'min7',
          alterations: ['b5'],
          displayRaw: 'Bm7b5',
        },
        beatAnchor: { indexInBar: 0 },
      },
      {
        id: 'h-2',
        barId: 'bar-2',
        beatId: 'beat-5',
        startSec: 2.5,
        endSec: 4.0,
        chord: {
          root: 'E',
          accidental: 'flat',
          quality: 'maj7',
          extensions: ['9'],
          alterations: ['#11'],
          bass: 'G',
          bassAccidental: 'natural',
          displayRaw: 'Ebmaj9#11/G',
        },
      },
    ],
    drafts: [
      {
        id: 'draft-sheet',
        name: 'Sheet import',
        source: 'sheet-import',
        createdAt: '2026-01-05T00:00:00.000Z',
        sections: [
          { id: 'sec-alt', kind: 'chorus', label: 'Chorus', barRange: { startBarIndex: 0, endBarIndex: 1 } },
        ],
        harmony: [
          {
            id: 'h-alt',
            barId: 'bar-1',
            startSec: 0.5,
            endSec: 4.0,
            chord: { root: 'A', quality: 'sus4', displayRaw: 'Asus4' },
          },
        ],
        lyrics: { words: [], sourceText: 'alt lyrics' },
      },
      {
        id: 'draft-manual',
        name: 'Another take',
        source: 'manual',
        sections: [],
        harmony: [],
      },
    ],
    activeDraftId: 'draft-migrated-active',
    activeDraftName: 'My draft',
    cueTracks: [
      {
        id: 'cue-main',
        name: 'Main',
        enabled: true,
        voiceId: 'voice-en-1',
        spokenCountIn: true,
        events: [
          {
            id: 'ev-intro',
            kind: 'intro',
            enabled: true,
            anchor: { kind: 'time', timeSec: 0, offsetSec: -1.5 },
            text: 'Valerie.',
            source: 'custom',
            edited: true,
          },
          {
            id: 'ev-sec',
            kind: 'section',
            enabled: true,
            anchor: { kind: 'bar', barId: 'bar-2', leadBars: 1, leadBeats: 2 },
            generatedKey: 'section:sec-verse:verse:1',
            generatedSource: { kind: 'section', sectionId: 'sec-verse', leadBars: 1 },
            source: 'generated',
            stale: false,
          },
          {
            id: 'ev-beat',
            kind: 'count',
            enabled: false,
            anchor: { kind: 'beat', beatId: 'beat-4', offsetSec: 0.1 },
            source: 'generated',
          },
        ],
        suppressedGeneratedKeys: ['section:sec-intro:intro:0'],
        renderExport: {
          fingerprint: 'cue-fp-1',
          durationSec: 214,
          sampleRate: 48000,
          generatedAt: '2026-02-02T00:00:00.000Z',
          preludeOffsetSec: 2.5,
          // Local-only — stripped before seeding.
          relativePath: 'cue/tracks/main/cue-track.wav',
        },
      },
    ],
    countInBeats: 4,
    startBeatId: 'beat-2',
    clickExport: {
      fingerprint: 'click-fp-1',
      durationSec: 214,
      sampleRate: 48000,
      generatedAt: '2026-02-02T00:00:00.000Z',
      preludeOffsetSec: 2.5,
      relativePath: 'cue/click.wav',
    },
    expectedAudio: {
      fileName: 'valerie.wav',
      durationSec: 213.5,
      sha256: 'a'.repeat(64),
    },
    drumMidi: {
      events: [
        { timeSec: 0.5, cls: 'kick', velocity: 0.9 },
        { timeSec: 1.0, cls: 'snare', velocity: 0.7 },
      ],
      analyzedAt: '2026-02-01T00:00:00.000Z',
      analyzerVersion: 4,
      sourceStem: 'stems/drums.wav',
      audioFingerprint: 'a'.repeat(64),
      kit: 'studio',
      quantize: '1/16',
      style: 'steady',
      renderExport: {
        fingerprint: 'drum-fp',
        durationSec: 214,
        sampleRate: 48000,
        generatedAt: '2026-02-02T00:00:00.000Z',
        preludeOffsetSec: 0,
        relativePath: 'render/drums.wav',
      },
    },
    bassMidi: {
      events: [{ timeSec: 0.5, durationSec: 0.45, midi: 28, velocity: 0.8 }],
      analyzedAt: '2026-02-01T00:00:00.000Z',
      analyzerVersion: 2,
      sourceStem: 'stems/bass.wav',
      audioFingerprint: 'a'.repeat(64),
      style: 'detected',
      quantize: 'off',
    },

    // ── Local-only. None of these may appear in the document. ──
    projectFolder: 'ValerieProject',
    // Deliberately distinct strings from `drumMidi.sourceStem` / `bassMidi.sourceStem`,
    // which are provenance labels that DO sync — the leak test greps the encoded
    // bytes for these and would otherwise match the wrong field.
    stemRefs: { Drums: 'local-only/drums-path.wav', Bass: 'local-only/bass-path.wav' },
    sectionBorderHints: {
      borders: [{ bar: 1, confidence: 0.8 }],
      audioFingerprint: 'a'.repeat(64),
      generatedAt: '2026-02-01T00:00:00.000Z',
      analyzerVersion: 2,
    },
    chordHints: {
      beatChroma: [[0.1, 0.2, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0.4]],
      detectedKey: { root: 'E', accidental: 'flat', mode: 'major', confidence: 0.66 },
      audioFingerprint: 'a'.repeat(64),
      generatedAt: '2026-02-01T00:00:00.000Z',
      analyzerVersion: 3,
      analyzerSource: 'stems-other',
    },
    mixState: {
      tracks: [{ key: 'original', volume: 0.8, muted: false, soloed: true }],
      master: 0.95,
    },
  }
}

/** The minimum a SongMap can be: no audio, no drafts, empty everything. */
export function minimalSongMap(): SongMap {
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: {
      title: 'Untitled',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      analyzed: false,
    },
    timeline: { bars: [], beats: [] },
    sections: [],
    harmony: [],
    cueTracks: [],
  }
}
