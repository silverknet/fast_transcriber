import { describe, expect, it } from 'vitest'
import { cleanLyricsText } from '$lib/lyrics/clean'
import { parseStrictChordToken, isDecorationToken } from './chordToken'
import { parseChordSheet } from './parseChordSheet'

// ── Strict token parsing ────────────────────────────────────────────────────

describe('parseStrictChordToken', () => {
  it('parses plain and rich chords with verbatim displayRaw', () => {
    const cases: Array<[string, { root: string; quality: string; bass?: string }]> = [
      ['A', { root: 'A', quality: 'major' }],
      ['Am', { root: 'A', quality: 'minor' }],
      ['Am7', { root: 'A', quality: 'min7' }],
      ['Am9', { root: 'A', quality: 'min7' }], // NOT A major — the lenient-parser trap
      ['GM7', { root: 'G', quality: 'maj7' }],
      ['Gmaj7', { root: 'G', quality: 'maj7' }],
      ['FM9', { root: 'F', quality: 'maj7' }],
      ['C/D', { root: 'C', quality: 'major', bass: 'D' }],
      ['Am7/G', { root: 'A', quality: 'min7', bass: 'G' }],
      ['Bdim7', { root: 'B', quality: 'dim' }],
      ['E7b9', { root: 'E', quality: '7' }],
      ['E7', { root: 'E', quality: '7' }],
      ['D7', { root: 'D', quality: '7' }],
      ['EbM9', { root: 'E', quality: 'maj7' }],
      ['F#m7b5', { root: 'F', quality: 'min7' }],
      ['G7sus4', { root: 'G', quality: 'sus4' }],
      ['Dsus2', { root: 'D', quality: 'sus2' }],
      ['Cadd9', { root: 'C', quality: 'add9' }],
      ['Bb', { root: 'B', quality: 'major' }],
      ['Bbm', { root: 'B', quality: 'minor' }],
      ['C6/9', { root: 'C', quality: 'major' }],
      ['Caug', { root: 'C', quality: 'aug' }],
      ['C+', { root: 'C', quality: 'aug' }],
      ['C°7', { root: 'C', quality: 'dim' }],
      ['A♭m7', { root: 'A', quality: 'min7' }],
    ]
    for (const [tok, want] of cases) {
      const r = parseStrictChordToken(tok)
      expect(r.ok, `${tok} should parse`).toBe(true)
      if (!r.ok) continue
      expect(r.chord.root, tok).toBe(want.root)
      expect(r.chord.quality, tok).toBe(want.quality)
      if (want.bass) expect(r.chord.bass, tok).toBe(want.bass)
      expect(r.chord.displayRaw, tok).toBe(tok)
    }
  })

  it('keeps extensions for 9/11/13 families', () => {
    const r = parseStrictChordToken('Am9')
    expect(r.ok && r.chord.extensions).toEqual(['9'])
    const d = parseStrictChordToken('C13')
    expect(d.ok && d.chord.extensions).toEqual(['13'])
  })

  it('rejects English words and junk the lenient parser accepts', () => {
    for (const tok of ['Baby', 'And', 'Are', 'Been', 'Go', 'Do', 'Ends', 'Cmxyz', 'A/', 'C//G', 'Amaybe', 'B-side', 'Dont', 'Gonna', 'me', 'a']) {
      expect(parseStrictChordToken(tok).ok, `${tok} must NOT parse`).toBe(false)
    }
  })

  it('rejects lowercase roots (sheet chords are uppercase)', () => {
    expect(parseStrictChordToken('am7').ok).toBe(false)
    expect(parseStrictChordToken('c').ok).toBe(false)
  })
})

describe('isDecorationToken', () => {
  it('accepts separators, repeats, N.C.', () => {
    for (const t of ['|', '||', '%', 'x2', 'X3', '(x2)', '[x4]', 'N.C.', 'NC', '--']) {
      expect(isDecorationToken(t), t).toBe(true)
    }
  })
  it('does not swallow chords or words', () => {
    for (const t of ['A', 'Am', 'x', 'not', '(hey)']) {
      expect(isDecorationToken(t), t).toBe(false)
    }
  })
})

// ── Sheet parsing ───────────────────────────────────────────────────────────

const SHEET = [
  '[Intro]',
  'GM7   Am7/G   GM7   Am7/G (x2)',
  '',
  '[Verse 1]',
  'Am9  C/D              GM7',
  'Baby, love never felt so good',
  '     Bdim7            E7b9',
  'And I doubt if it ever could',
  '',
  '[Pre-Chorus]',
  '      Bdim7                    E7b9',
  'And the night is gonna be just fine',
].join('\n')

describe('parseChordSheet', () => {
  it('parses the Love Never Felt So Good fixture', () => {
    const sheet = parseChordSheet(SHEET)
    expect(sheet.sections.map((s) => s.label)).toEqual(['Intro', 'Verse 1', 'Pre-Chorus'])
    // Intro line carries (x2) → its 4 chords play twice = 8.
    expect(sheet.chordCount).toBe(8 + 3 + 2 + 2)

    // Intro chords are instrumental (no lyric anchors), repeated by the tag.
    const intro = sheet.anchoredChords.filter((c) => c.sectionIdx === 0)
    expect(intro).toHaveLength(8)
    expect(intro.every((c) => c.wordIdx === null && c.lineIdx === null)).toBe(true)
    expect(intro.map((c) => c.rawToken)).toEqual([
      'GM7', 'Am7/G', 'GM7', 'Am7/G', 'GM7', 'Am7/G', 'GM7', 'Am7/G',
    ])

    // Verse line 1: Am9 over "Baby," (word 0), C/D over "love" (word 1),
    // GM7 near "good" (last word).
    const verse = sheet.anchoredChords.filter((c) => c.sectionIdx === 1)
    expect(verse.map((c) => c.rawToken)).toEqual(['Am9', 'C/D', 'GM7', 'Bdim7', 'E7b9'])
    expect(verse[0]).toMatchObject({ lineIdx: 0, wordIdx: 0 })
    expect(verse[1]).toMatchObject({ lineIdx: 0, wordIdx: 1 })
    expect(verse[2]!.lineIdx).toBe(0)
    expect(verse[2]!.wordIdx).toBeGreaterThanOrEqual(4) // "so" or "good"
    // Second verse line: Bdim7 (col 5, just past "I") anchors to "doubt".
    expect(verse[3]).toMatchObject({ lineIdx: 1, wordIdx: 2 })

    // Lyric text: chord lines + markers gone, stanza breaks kept.
    expect(sheet.lyricsText).toBe(
      [
        'Baby, love never felt so good',
        'And I doubt if it ever could',
        '',
        'And the night is gonna be just fine',
      ].join('\n'),
    )
  })

  it('lyricsText byte-equals cleanLyricsText of the sheet minus chord lines', () => {
    const sheet = parseChordSheet(SHEET)
    const withoutChordLines = SHEET.split('\n')
      .filter((l) => {
        const toks = l.split(/\s+/).filter(Boolean)
        return !(toks.length > 0 && toks.every((t) => isDecorationToken(t) || parseStrictChordToken(t).ok))
      })
      .join('\n')
    expect(sheet.lyricsText).toBe(cleanLyricsText(withoutChordLines).text)
  })

  it('plain lyrics (no chord lines) pass through identically to cleanLyricsText', () => {
    const plain = '[Verse 1]\nHello darkness my old friend\n\nI came to talk (x2)\n'
    expect(parseChordSheet(plain).chordCount).toBe(0)
    expect(parseChordSheet(plain).lyricsText).toBe(cleanLyricsText(plain).text)
  })

  it('does not classify word-lines as chords ("Am I wrong" stays lyric)', () => {
    const s = parseChordSheet('Am I wrong\nA me you\n')
    expect(s.chordCount).toBe(0)
    expect(s.lyricsText).toBe('Am I wrong\nA me you')
  })

  it('resolves lone-A ambiguity by neighbors and indentation', () => {
    // Flush-left "A" surrounded by lyric lines → lyric.
    const lyricCase = parseChordSheet('I said\nA\nlittle prayer\n')
    expect(lyricCase.chordCount).toBe(0)

    // Indented "  A" → chord (column positioning).
    const indented = parseChordSheet('[Verse]\n  A\nHold me now\n')
    expect(indented.chordCount).toBe(1)
    expect(indented.anchoredChords[0]).toMatchObject({ lineIdx: 0, wordIdx: 0 })

    // Flush-left "A" whose neighbor is a definite chord line → chord.
    const neighbor = parseChordSheet('D7  G\nA\nHold me now\n')
    expect(neighbor.chordCount).toBe(3)
  })

  it('anchors chords past the end of the lyric line to the last word', () => {
    const s = parseChordSheet('C                            G\nShort line\n')
    expect(s.anchoredChords[1]).toMatchObject({ wordIdx: 1 })
  })

  it('handles CRLF, decorations, and trailing repeat tags', () => {
    const s = parseChordSheet('[Chorus]\r\nC | G | Am x2\r\nSing it loud (x2)\r\n')
    expect(s.anchoredChords.map((c) => c.rawToken)).toEqual(['C', 'G', 'Am'])
    expect(s.lyricsText).toBe('Sing it loud')
    // Repeat tag dropped from the lyric line → last-word anchors clamp.
    expect(s.anchoredChords.every((c) => (c.wordIdx ?? 0) <= 2)).toBe(true)
  })

  it('decoration-only lines (N.C., x2) vanish from the lyrics', () => {
    const s = parseChordSheet('N.C.\nHello world\nx2\nGoodbye moon\n')
    expect(s.lyricsText).toBe('Hello world\nGoodbye moon')
    expect(s.chordCount).toBe(0)
  })

  it('chords before any marker land in an implicit head section', () => {
    const s = parseChordSheet('C  G\nHello world\n')
    expect(s.sections).toEqual([{ label: '' }])
    expect(s.anchoredChords).toHaveLength(2)
    expect(s.anchoredChords[0]!.sectionIdx).toBe(0)
  })

  it('honors (x2) repeats on instrumental lines', () => {
    const s = parseChordSheet('[Intro]\nGM7   Am7/G   GM7   Am7/G (x2)\n')
    expect(s.chordCount).toBe(8)
    expect(s.anchoredChords.map((c) => c.rawToken)).toEqual([
      'GM7', 'Am7/G', 'GM7', 'Am7/G', 'GM7', 'Am7/G', 'GM7', 'Am7/G',
    ])
    // Each chord its own bar group (no pipes) — 8 distinct groups.
    expect(new Set(s.anchoredChords.map((c) => c.barGroup)).size).toBe(8)
  })

  it('| pipes group instrumental chords into shared bars', () => {
    const s = parseChordSheet('[Intro]\n| Am7 D/E Eb/F F/G |\n')
    expect(s.chordCount).toBe(4)
    expect(new Set(s.anchoredChords.map((c) => c.barGroup)).size).toBe(1)
    const two = parseChordSheet('[Intro]\n| Am7 D/E | Eb/F F/G |\n')
    expect(new Set(two.anchoredChords.map((c) => c.barGroup)).size).toBe(2)
  })

  it('repeat tags and pipes are ignored on chords-over-lyrics lines', () => {
    const s = parseChordSheet('[Verse]\nAm | C (x2)\nHold me now tonight\n')
    expect(s.chordCount).toBe(2)
    expect(s.anchoredChords.every((c) => c.barGroup === null)).toBe(true)
  })

  it('consecutive chord lines (instrumental) stay unanchored', () => {
    const s = parseChordSheet('[Instrumental]\nFM9   Em7\nEbM9      Dm9\nFM7  E7  Am7  D7\n')
    expect(s.chordCount).toBe(8)
    expect(s.anchoredChords.every((c) => c.wordIdx === null)).toBe(true)
  })
})
