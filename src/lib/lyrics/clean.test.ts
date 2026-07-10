import { describe, expect, it } from 'vitest'
import { cleanLyricsText, lyricLinesFromSource, lyricWordsOfLine } from './clean'

describe('cleanLyricsText', () => {
  it('strips section-marker lines but keeps lyric lines', () => {
    const raw = `[Verse 1]
Well you done done me and you bet I felt it
[Chorus]
I won't hesitate no more

(Bridge)
Open up your mind`
    const { lines } = cleanLyricsText(raw)
    expect(lines).toEqual([
      'Well you done done me and you bet I felt it',
      "I won't hesitate no more",
      'Open up your mind',
    ])
  })

  it('strips markers with attribution like [Verse 2: Artist]', () => {
    const { lines } = cleanLyricsText('[Verse 2: Amy Winehouse]\nSome line here')
    expect(lines).toEqual(['Some line here'])
  })

  it('removes trailing repeat tags but keeps the line', () => {
    const { lines } = cleanLyricsText('Valerie (x2)\nWhy dont you come on over [X3]\nStop x2')
    expect(lines).toEqual(['Valerie', 'Why dont you come on over', 'Stop'])
  })

  it('keeps in-line parenthesized ad-libs', () => {
    const { lines } = cleanLyricsText('Baby (ooh baby) hold on')
    expect(lines).toEqual(['Baby (ooh baby) hold on'])
  })

  it('collapses blank-line runs to single stanza separators, trims edges', () => {
    const raw = `\n\nLine one\n\n\n\nLine two\n\n`
    const { text } = cleanLyricsText(raw)
    expect(text).toBe('Line one\n\nLine two')
  })

  it('a marker line between stanzas does not create double blanks', () => {
    const raw = `Line one\n\n[Chorus]\n\nLine two`
    const { text } = cleanLyricsText(raw)
    expect(text).toBe('Line one\n\nLine two')
  })

  it('empty input yields empty output', () => {
    expect(cleanLyricsText('')).toEqual({ text: '', lines: [] })
    expect(cleanLyricsText('[Chorus]\n\n')).toEqual({ text: '', lines: [] })
  })
})

describe('lyricLinesFromSource / lyricWordsOfLine', () => {
  it('round-trips lines through sourceText', () => {
    const { text, lines } = cleanLyricsText('A b c\n\nD e')
    expect(lyricLinesFromSource(text)).toEqual(lines)
  })

  it('tokenizes words on whitespace', () => {
    expect(lyricWordsOfLine("I won't  hesitate")).toEqual(['I', "won't", 'hesitate'])
  })
})
