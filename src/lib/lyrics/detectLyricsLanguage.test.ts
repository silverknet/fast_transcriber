import { describe, expect, it } from 'vitest'
import { detectLyricsLanguage } from './detectLyricsLanguage'

describe('detectLyricsLanguage', () => {
  it('detects Swedish from real lyric text', () => {
    // "Sommartider" opening — the song Whisper handles fine, sv.
    const sv = `Sommartider, hej hej, sommartider
Jag känner det är nå'nting på gång
Kom och stanna ute natten lång
och jag vet att du är här`
    expect(detectLyricsLanguage(sv)).toBe('sv')
  })

  it('detects Swedish for the song Whisper mis-detected as Nynorsk', () => {
    // "Den första är alltid gratis" — auto-detect said `nn`; the fix is to
    // read the language off the (correct) imported lyrics instead.
    const sv = `Är född med trubbel i mitt blod
Gör sånt jag inte borde
Kan aldrig bara stå bredvid
det är inte som att jag inte har försökt`
    expect(detectLyricsLanguage(sv)).toBe('sv')
  })

  it('detects English from real lyric text', () => {
    const en = `You sit there in your heartache
Waiting on some beautiful boy to
To save you from your old ways
and you know that I would never leave`
    expect(detectLyricsLanguage(en)).toBe('en')
  })

  it('detects English even with no diacritics and few stopwords', () => {
    const en = `Well, sometimes I go out by myself
And I look across the water
And I think of all the things, what you're doin'`
    expect(detectLyricsLanguage(en)).toBe('en')
  })

  it('detects German', () => {
    const de = `Und ich weiß nicht was das ist
mit dir und mir für immer
aber wenn ich dich sehe
ist das immer noch schön`
    expect(detectLyricsLanguage(de)).toBe('de')
  })

  it('returns undefined for too-short input (falls back to auto)', () => {
    expect(detectLyricsLanguage('hej hej')).toBeUndefined()
    expect(detectLyricsLanguage('')).toBeUndefined()
    expect(detectLyricsLanguage('la la la la')).toBeUndefined()
  })

  it('returns undefined when nothing is decisive (proper-noun heavy)', () => {
    // No function words to latch onto → do not guess, let Whisper decide.
    const ambiguous = 'Barcelona Madrid Lisboa Paris Roma Berlin Tokyo Rio'
    expect(detectLyricsLanguage(ambiguous)).toBeUndefined()
  })

  it('is case-insensitive and tolerates punctuation', () => {
    const sv = `OCH JAG ÄR HÄR, MEN DU ÄR DÄR!
Inte som att det spelar någon roll för mig`
    expect(detectLyricsLanguage(sv)).toBe('sv')
  })
})
