/**
 * End-to-end coverage for "paste a chord sheet → get a new song draft".
 *
 * The individual steps (parse, place, derive, addDraftAndActivate) each have
 * their own tests; nothing covered the SEQUENCE until this file. That sequence
 * is where v5 broke: chords and sections were written as two independent
 * layers paired by a name string, the names drifted, and a user ended up with
 * five chord layers against three section layouts. The rewrite's promise is
 * that one import produces exactly ONE draft holding both — so these tests
 * assert the pairing, not just the arithmetic.
 */
import { describe, expect, it } from 'vitest'
import { activeDraftName, listDrafts, switchToDraft } from '$lib/songmap/drafts'
import { createEmptySongMap } from '$lib/songmap/factory'
import { upsertHarmonyAtBeat } from '$lib/songmap/harmonyEdit'
import { validateSongMap } from '$lib/songmap/validate'
import type { Bar, Beat, LyricWord, SongMap } from '$lib/songmap/types'
import { parseChordSheet } from './parseChordSheet'
import { applySheetImport, prepareSheetImport } from './importAsDraft'

let idCounter = 0
const newId = (): string => `id${++idCounter}`

// ── Fixture: 16 bars of 4/4 at 120 BPM (bar = 2 s, beat = 0.5 s) ────────────

const BAR_SEC = 2
const BEAT_SEC = 0.5
const BAR_COUNT = 16

function timeline(): { bars: Bar[]; beats: Beat[] } {
  const bars: Bar[] = []
  const beats: Beat[] = []
  for (let i = 0; i < BAR_COUNT; i++) {
    bars.push({
      id: `bar${i}`,
      index: i,
      startSec: i * BAR_SEC,
      endSec: (i + 1) * BAR_SEC,
      meter: { numerator: 4, denominator: 4 },
      beatCount: 4,
      beatIds: [0, 1, 2, 3].map((j) => `b${i}_${j}`),
    })
    for (let j = 0; j < 4; j++) {
      beats.push({ id: `b${i}_${j}`, barId: `bar${i}`, indexInBar: j, timeSec: i * BAR_SEC + j * BEAT_SEC })
    }
  }
  return { bars, beats }
}

/**
 * A lazy-but-typical Ultimate-Guitar paste: bracketed markers, piped
 * instrumental bars for the intro, chords positioned by column over the words
 * they land on, and a repeated chorus written out only once.
 */
const SHEET = [
  '[Intro]',
  '| C  G | Am  F |',
  '',
  '[Verse 1]',
  'C               G',
  'Hold me now tonight',
  'Am              F',
  'Never let you go',
  '',
  '[Chorus]',
  'C               G',
  'This is the fire',
  'Am              F',
  'Burning in my soul',
  '',
  '[Verse 2]',
  'C               G',
  'Hold me down again',
  'Am              F',
  'Never let you know',
].join('\n')

/**
 * Fitted lyrics as `fitLyricsToSong` would leave them: every word carries an
 * `aligned` ASR timestamp. Each sheet lyric line occupies two bars, with the
 * third word landing in the second of them — so a correctly-placed sheet puts
 * its two chords per line on two DIFFERENT bar downbeats. Line L starts at
 * bar 4 + 2L, which leaves bars 0–3 for the instrumental intro.
 */
function fittedLyrics(lyricsText: string): { sourceText: string; words: LyricWord[] } {
  const offsets = [0, 0.6, 2.2, 2.8] // within-line word offsets, seconds
  const words: LyricWord[] = []
  const lines = lyricsText.split('\n').filter((l) => l.length > 0)
  lines.forEach((line, lineIdx) => {
    const startSec = (4 + lineIdx * 2) * BAR_SEC
    line.split(/\s+/).forEach((text, wordIdx) => {
      const t = startSec + (offsets[wordIdx] ?? 3.4)
      words.push({ text, startSec: t, endSec: t + 0.3, line: lineIdx, aligned: true })
    })
  })
  return { sourceText: lyricsText, words }
}

/**
 * The song as it looks BEFORE the import: hand-made sections, a hand-placed
 * chord, and the fitted lyrics the sheet will be anchored against.
 */
function songBeforeImport(lyricsText: string): SongMap {
  idCounter = 0
  const base: SongMap = {
    ...createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' }),
    metadata: {
      title: 'Test Song',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    timeline: timeline(),
    sections: [
      { id: 'my-verse', kind: 'verse', label: 'My verse', barRange: { startBarIndex: 0, endBarIndex: 7 } },
      { id: 'my-chorus', kind: 'chorus', label: 'My chorus', barRange: { startBarIndex: 8, endBarIndex: 15 } },
    ],
    lyrics: fittedLyrics(lyricsText),
  }
  const withChord = upsertHarmonyAtBeat(base, 'b0_0', { root: 'D', quality: 'maj', displayRaw: 'D' }, () => 'my-chord')
  if (!withChord.ok) throw new Error(withChord.error)
  return withChord.map
}

/** Run the exact sequence the editor's import button runs. */
function importSheet(map: SongMap, sheetText = SHEET) {
  const sheet = parseChordSheet(sheetText)
  const prep = prepareSheetImport(sheet, map, newId)
  if (!prep.ok) throw new Error(prep.error)
  return { map: applySheetImport(map, prep.prepared, newId), prepared: prep.prepared }
}

/** `[displayRaw, barIndex, indexInBar]` for every chord at the root, in time order. */
function chordsAt(map: SongMap): Array<[string, number, number]> {
  const beatById = new Map(map.timeline.beats.map((b) => [b.id, b]))
  const barById = new Map(map.timeline.bars.map((b) => [b.id, b]))
  return [...map.harmony]
    .sort((a, b) => a.startSec - b.startSec)
    .map((h) => {
      const beat = beatById.get(h.beatId ?? '')
      return [h.chord.displayRaw, barById.get(h.barId)?.index ?? -1, beat?.indexInBar ?? -1] as [
        string,
        number,
        number,
      ]
    })
}

function sectionsAt(map: SongMap): Array<[string, number, number]> {
  return map.sections.map((s) => [s.label, s.barRange.startBarIndex, s.barRange.endBarIndex])
}

describe('chord sheet import — placement', () => {
  it('lands each chord on the bar its anchor word is sung in', () => {
    const before = songBeforeImport(parseChordSheet(SHEET).lyricsText)
    const { map, prepared } = importSheet(before)

    // Two chords per lyric line, on the two bars that line spans. The intro is
    // instrumental, so it has no words to anchor to: its two piped bars spread
    // over the four bars ahead of the first sung word, each pipe group staying
    // inside ONE bar (`| C  G |` is a two-chord bar, not two bars).
    expect(chordsAt(map)).toEqual([
      ['C', 1, 0],
      ['G', 1, 2],
      ['Am', 3, 0],
      ['F', 3, 2],
      ['C', 4, 0],
      ['G', 5, 0],
      ['Am', 6, 0],
      ['F', 7, 0],
      ['C', 8, 0],
      ['G', 9, 0],
      ['Am', 10, 0],
      ['F', 11, 0],
      ['C', 12, 0],
      ['G', 13, 0],
      ['Am', 14, 0],
      ['F', 15, 0],
    ])
    // All six sung lines found their stored counterpart — spelled out rather
    // than compared to `totalLines`, which would also pass if the sheet's
    // lyric anchoring collapsed and every chord fell back to a spread.
    expect(prepared.plan.stats).toMatchObject({
      matchedLines: 6,
      totalLines: 6,
      unplaceable: 0,
      collisions: 0,
      placed: 16,
    })
  })

  it('replaces the previous chords rather than merging into them', () => {
    // An import is a fresh take on the song. The hand-placed D on bar 0 must
    // not survive INTO the new draft (it survives as its own draft — below).
    const before = songBeforeImport(parseChordSheet(SHEET).lyricsText)
    const { map } = importSheet(before)
    expect(map.harmony.some((h) => h.chord.displayRaw === 'D')).toBe(false)
  })
})

describe('chord sheet import — one draft holds chords AND sections', () => {
  it('derives sections from where the sheet chords actually landed', () => {
    const before = songBeforeImport(parseChordSheet(SHEET).lyricsText)
    const { map } = importSheet(before)

    expect(sectionsAt(map)).toEqual([
      ['Intro', 0, 3],
      ['Verse 1', 4, 7],
      ['Chorus', 8, 11],
      ['Verse 2', 12, 15],
    ])
    // Every section after the first starts on a bar that actually carries an
    // imported chord — that is what "derived from the placement" means, and it
    // is why the two can never be out of step. (The first section is pinned
    // back to bar 0 so the sections tile the whole song.)
    const chordBars = new Set(chordsAt(map).map(([, barIndex]) => barIndex))
    for (const s of map.sections.slice(1)) {
      expect(chordBars.has(s.barRange.startBarIndex), s.label).toBe(true)
    }
    expect(map.sections[0]!.barRange.startBarIndex).toBe(0)
  })

  it('keeps chords and sections together when switching drafts', () => {
    // THE regression test for the v5 bug: chords and sections were separate
    // stacks, so switching could leave one side's sections over the other
    // side's chords. They now move as one unit, in both directions.
    const before = songBeforeImport(parseChordSheet(SHEET).lyricsText)
    const { map: imported } = importSheet(before)
    const importedChords = chordsAt(imported)
    const importedSections = sectionsAt(imported)
    // The active draft really is the sheet's arrangement, not the old layout
    // wearing the sheet's chords.
    expect(importedSections.map(([label]) => label)).toEqual(['Intro', 'Verse 1', 'Chorus', 'Verse 2'])

    const previous = listDrafts(imported).find((d) => !d.active)!
    const back = switchToDraft(imported, previous.id, newId)
    expect(back.ok).toBe(true)
    if (!back.ok) return

    // Switching away takes BOTH the sheet's chords and its sections with it.
    expect(chordsAt(back.map)).toEqual([['D', 0, 0]])
    expect(sectionsAt(back.map)).toEqual([
      ['My verse', 0, 7],
      ['My chorus', 8, 15],
    ])

    const forwardId = listDrafts(back.map).find((d) => d.name === 'Sheet import')!.id
    const forward = switchToDraft(back.map, forwardId, newId)
    expect(forward.ok).toBe(true)
    if (!forward.ok) return
    expect(chordsAt(forward.map)).toEqual(importedChords)
    expect(sectionsAt(forward.map)).toEqual(importedSections)
  })
})

describe('chord sheet import — nothing is ever lost', () => {
  it('makes the import active and stores the previous work as one draft', () => {
    const before = songBeforeImport(parseChordSheet(SHEET).lyricsText)
    const { map } = importSheet(before)

    expect(activeDraftName(map)).toBe('Sheet import')
    expect(map.drafts).toHaveLength(1)

    const stored = map.drafts![0]!
    expect(stored.name).toBe('My draft')
    expect(stored.harmony.map((h) => h.chord.displayRaw)).toEqual(['D'])
    expect(stored.sections.map((s) => s.label)).toEqual(['My verse', 'My chorus'])
    // Lyrics belong to the draft too — the old take keeps the words it was
    // written against, and so does the new one.
    expect(stored.lyrics?.words.length).toBe(before.lyrics!.words.length)
    expect(map.lyrics?.words.length).toBe(before.lyrics!.words.length)
  })

  it('a second import adds a second draft without touching the first', () => {
    // Re-pasting a corrected sheet is normal. Both takes have to survive with
    // distinct names, or the user silently loses the one they preferred.
    const before = songBeforeImport(parseChordSheet(SHEET).lyricsText)
    const { map: once } = importSheet(before)
    const shorterSheet = SHEET.split('\n').slice(0, 8).join('\n') // Intro + Verse 1
    const { map: twice } = importSheet(once, shorterSheet)

    expect(activeDraftName(twice)).toBe('Sheet import 2')
    expect(listDrafts(twice).map((d) => d.name).sort()).toEqual([
      'My draft',
      'Sheet import',
      'Sheet import 2',
    ])

    // The first import is untouched — same chords, same sections, still paired.
    const firstImport = twice.drafts!.find((d) => d.name === 'Sheet import')!
    expect(firstImport.harmony.map((h) => h.chord.displayRaw)).toEqual(
      once.harmony
        .slice()
        .sort((a, b) => a.startSec - b.startSec)
        .map((h) => h.chord.displayRaw),
    )
    expect(firstImport.sections.map((s) => s.label)).toEqual(['Intro', 'Verse 1', 'Chorus', 'Verse 2'])

    // ...and the second import is a genuinely different take, not a copy.
    expect(twice.sections.map((s) => s.label)).toEqual(['Intro', 'Verse 1'])
    expect(twice.activeDraftId).not.toBe(once.activeDraftId)
  })

  it('refuses the import instead of creating an empty draft', () => {
    // The editor shows `prepare`'s error and stops. If a failure ever created
    // a draft anyway, the user would be switched onto an empty take of their
    // song — so the failure has to happen before anything is written.
    const noLyrics = songBeforeImport(parseChordSheet(SHEET).lyricsText)
    const prep = prepareSheetImport(parseChordSheet(SHEET), { ...noLyrics, lyrics: undefined }, newId)
    expect(prep.ok).toBe(false)
    if (prep.ok) return
    expect(prep.error).toMatch(/lyrics/i)

    const noGrid = prepareSheetImport(
      parseChordSheet(SHEET),
      { ...noLyrics, timeline: { bars: [], beats: [] } },
      newId,
    )
    expect(noGrid.ok).toBe(false)
  })

  it('leaves everything outside the draft alone', () => {
    // Timeline, cues and count-in are shared by ALL drafts — an import that
    // touched them would move the grid under the drafts you can switch back to.
    const before = songBeforeImport(parseChordSheet(SHEET).lyricsText)
    const { map } = importSheet(before)
    expect(map.timeline).toEqual(before.timeline)
    expect(map.cueTracks).toEqual(before.cueTracks)
    expect(map.metadata.title).toBe(before.metadata.title)
  })

  it('produces a SongMap the editor will accept', () => {
    const before = songBeforeImport(parseChordSheet(SHEET).lyricsText)
    const { map: once } = importSheet(before)
    const { map: twice } = importSheet(once)
    for (const [label, m] of [
      ['first import', once],
      ['second import', twice],
    ] as const) {
      const res = validateSongMap(m)
      expect(res.errors, label).toEqual([])
      expect(res.ok, label).toBe(true)
    }
  })
})
