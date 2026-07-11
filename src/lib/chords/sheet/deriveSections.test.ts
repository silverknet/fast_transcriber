import { describe, expect, it } from 'vitest'
import { SONGMAP_FORMAT_VERSION } from '$lib/songmap/version'
import type { Bar, Beat, LyricWord, Section, SongMap } from '$lib/songmap/types'
import { parseChordSheet } from './parseChordSheet'
import { placeChords } from './placeChords'
import { deriveSectionsFromSheet, sectionKindFromSheetLabel } from './deriveSections'

function buildMap(opts: { barCount?: number; sections?: Section[]; lyrics?: { sourceText: string; words: LyricWord[] } }): SongMap {
  const barCount = opts.barCount ?? 12
  const bars: Bar[] = []
  const beats: Beat[] = []
  for (let i = 0; i < barCount; i++) {
    bars.push({
      id: `bar${i}`,
      index: i,
      startSec: i,
      endSec: i + 1,
      meter: { numerator: 4, denominator: 4 },
      beatCount: 4,
      beatIds: [0, 1, 2, 3].map((j) => `b${i}_${j}`),
    })
    for (let j = 0; j < 4; j++) {
      beats.push({ id: `b${i}_${j}`, barId: `bar${i}`, indexInBar: j, timeSec: i + j / 4 })
    }
  }
  return {
    formatVersion: SONGMAP_FORMAT_VERSION,
    metadata: { title: 't' },
    timeline: { bars, beats },
    harmony: [],
    sections: opts.sections ?? [],
    cueTracks: [],
    lyrics: opts.lyrics,
  } as unknown as SongMap
}

let n = 0
const newId = () => `sec${n++}`

describe('sectionKindFromSheetLabel', () => {
  it('maps common UG labels', () => {
    const table: Array<[string, string]> = [
      ['Intro', 'intro'],
      ['Verse 1', 'verse'],
      ['Verse 2', 'verse'],
      ['Pre-Chorus', 'preChorus'],
      ['PreChorus 2', 'preChorus'],
      ['Chorus', 'chorus'],
      ['Hook', 'chorus'],
      ['Refrain', 'chorus'],
      ['Bridge', 'bridge'],
      ['Guitar Solo', 'solo'],
      ['Instrumental', 'break'],
      ['Interlude', 'break'],
      ['Outro', 'outro'],
      ['Weird Thing', 'custom'],
    ]
    for (const [label, kind] of table) expect(sectionKindFromSheetLabel(label), label).toBe(kind)
  })
})

describe('deriveSectionsFromSheet', () => {
  const SHEET = [
    '[Intro]',
    'G  Am',
    '',
    '[Verse 1]',
    'C',
    'Hold me now tonight',
    '',
    '[Verse 2]',
    'C',
    'Feel me now tonight',
  ].join('\n')

  function fit(sheet = SHEET) {
    const parsed = parseChordSheet(sheet)
    const map = buildMap({
      lyrics: {
        sourceText: parsed.lyricsText,
        words: [
          { text: 'Hold', startSec: 4.0, endSec: 4.2, line: 0, aligned: true },
          { text: 'me', startSec: 4.3, endSec: 4.4, line: 0, aligned: true },
          { text: 'now', startSec: 4.5, endSec: 4.6, line: 0, aligned: true },
          { text: 'tonight', startSec: 5.0, endSec: 5.2, line: 0, aligned: true },
          { text: 'Feel', startSec: 8.0, endSec: 8.2, line: 1, aligned: true },
          { text: 'me', startSec: 8.3, endSec: 8.4, line: 1, aligned: true },
          { text: 'now', startSec: 8.5, endSec: 8.6, line: 1, aligned: true },
          { text: 'tonight', startSec: 9.0, endSec: 9.2, line: 1, aligned: true },
        ],
      },
    })
    const r = placeChords(parsed, map)
    if (!r.ok) throw new Error(r.error)
    return { parsed, map, plan: r.plan }
  }

  it('tiles the song; adjacent same-kind sections stay separate', () => {
    const { parsed, map, plan } = fit()
    const sections = deriveSectionsFromSheet(parsed, plan, map, newId)
    expect(sections.map((s) => [s.label, s.barRange.startBarIndex, s.barRange.endBarIndex])).toEqual([
      ['Intro', 0, 3],
      ['Verse 1', 4, 7],
      ['Verse 2', 8, 11],
    ])
    expect(sections.map((s) => s.kind)).toEqual(['intro', 'verse', 'verse'])
    // Ranges tile the whole song without gaps.
    expect(sections[0]!.barRange.startBarIndex).toBe(0)
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i]!.barRange.startBarIndex).toBe(sections[i - 1]!.barRange.endBarIndex + 1)
    }
    expect(sections[sections.length - 1]!.barRange.endBarIndex).toBe(11)
  })

  it('returns nothing when the song already has sections', () => {
    const { parsed, plan } = fit()
    const mapWithSections = buildMap({
      sections: [{ id: 's', kind: 'verse', label: 'V', barRange: { startBarIndex: 0, endBarIndex: 3 } }],
    })
    expect(deriveSectionsFromSheet(parsed, plan, mapWithSections, newId)).toEqual([])
  })

  it('skips sheet sections whose chords all failed to place', () => {
    // Sheet with a chordless [Breakdown] between verses — no chords, no section.
    const sheet = ['[Verse 1]', 'C', 'Hold me now tonight', '', '[Breakdown]', 'just talking here', '', '[Verse 2]', 'C', 'Feel me now tonight'].join('\n')
    const { parsed, map, plan } = (() => {
      const parsed = parseChordSheet(sheet)
      const map = buildMap({
        lyrics: {
          sourceText: parsed.lyricsText,
          words: [
            { text: 'Hold', startSec: 1.0, endSec: 1.2, line: 0, aligned: true },
            { text: 'me', startSec: 1.3, endSec: 1.4, line: 0, aligned: true },
            { text: 'now', startSec: 1.5, endSec: 1.6, line: 0, aligned: true },
            { text: 'tonight', startSec: 2.0, endSec: 2.2, line: 0, aligned: true },
            { text: 'just', startSec: 4.0, endSec: 4.2, line: 1, aligned: true },
            { text: 'talking', startSec: 4.3, endSec: 4.5, line: 1, aligned: true },
            { text: 'here', startSec: 4.6, endSec: 4.8, line: 1, aligned: true },
            { text: 'Feel', startSec: 8.0, endSec: 8.2, line: 2, aligned: true },
            { text: 'me', startSec: 8.3, endSec: 8.4, line: 2, aligned: true },
            { text: 'now', startSec: 8.5, endSec: 8.6, line: 2, aligned: true },
            { text: 'tonight', startSec: 9.0, endSec: 9.2, line: 2, aligned: true },
          ],
        },
      })
      const r = placeChords(parsed, map)
      if (!r.ok) throw new Error(r.error)
      return { parsed, map, plan: r.plan }
    })()
    const sections = deriveSectionsFromSheet(parsed, plan, map, newId)
    expect(sections.map((s) => s.label)).toEqual(['Verse 1', 'Verse 2'])
  })
})
