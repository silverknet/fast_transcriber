import { describe, expect, it } from 'vitest'
import {
  alignLyricsToTranscription,
  normalizeWord,
  tokenizeLyrics,
  type AsrWord,
  type LyricToken,
} from './align'

/** Build ASR words from a phrase at a steady cadence starting at t0. */
function asrFrom(phrase: string, t0 = 10, wordDur = 0.3, gap = 0.1): AsrWord[] {
  const out: AsrWord[] = []
  let t = t0
  for (const w of phrase.split(/\s+/).filter(Boolean)) {
    out.push({ text: w, startSec: t, endSec: t + wordDur })
    t += wordDur + gap
  }
  return out
}

function tokensFrom(lines: string[]): LyricToken[] {
  return tokenizeLyrics(lines.join('\n'))
}

function assertMonotone(words: { startSec: number; endSec: number }[]) {
  for (let i = 0; i < words.length; i++) {
    expect(words[i]!.endSec).toBeGreaterThan(words[i]!.startSec)
    expect(words[i]!.startSec).toBeGreaterThanOrEqual(0)
    if (i > 0) expect(words[i]!.startSec).toBeGreaterThanOrEqual(words[i - 1]!.startSec)
  }
}

describe('normalizeWord', () => {
  it('lowercases and strips punctuation, keeps letters/digits', () => {
    expect(normalizeWord("Don't!")).toBe('dont')
    expect(normalizeWord('Hey,')).toBe('hey')
    expect(normalizeWord('24-7')).toBe('247')
  })
})

describe('tokenizeLyrics', () => {
  it('assigns line indices per cleaned line', () => {
    const tokens = tokenizeLyrics('Hello world\n\nSecond line here')
    expect(tokens.map((t) => t.line)).toEqual([0, 0, 1, 1, 1])
    expect(tokens[0]!.text).toBe('Hello')
  })
})

describe('alignLyricsToTranscription', () => {
  it('perfect recognition anchors every word with exact times', () => {
    const tokens = tokensFrom(['well you done done me', 'and you bet I felt it'])
    const asr = asrFrom('well you done done me and you bet I felt it', 12)
    const { words, matchedRatio } = alignLyricsToTranscription(tokens, asr)
    expect(matchedRatio).toBe(1)
    expect(words[0]!.startSec).toBeCloseTo(12, 5)
    expect(words[0]!.aligned).toBe(true)
    expect(words.at(-1)!.aligned).toBe(true)
    // Line indices survive.
    expect(words[0]!.line).toBe(0)
    expect(words.at(-1)!.line).toBe(1)
    assertMonotone(words)
  })

  it('interpolates words the recognizer dropped, between their neighbors', () => {
    const tokens = tokensFrom(['I will not hesitate no more'])
    // ASR missed "not" and "no".
    const asr = asrFrom('I will hesitate more', 20)
    const { words, matchedRatio } = alignLyricsToTranscription(tokens, asr)
    expect(matchedRatio).toBeCloseTo(4 / 6, 5)
    const not = words[2]!
    const will = words[1]!
    const hesitate = words[3]!
    expect(not.aligned).toBeUndefined()
    expect(not.startSec).toBeGreaterThanOrEqual(will.endSec)
    expect(not.endSec).toBeLessThanOrEqual(hesitate.startSec + 1e-9)
    assertMonotone(words)
  })

  it('skips extra recognized ad-libs without derailing anchors', () => {
    const tokens = tokensFrom(['baby hold on to me'])
    const asr = asrFrom('yeah baby uh hold on woo to me', 5)
    const { words, matchedRatio } = alignLyricsToTranscription(tokens, asr)
    expect(matchedRatio).toBe(1)
    // "baby" is the 2nd ASR word (t = 5 + 0.4).
    expect(words[0]!.startSec).toBeCloseTo(5.4, 5)
    assertMonotone(words)
  })

  it('an entirely missed line interpolates across the gap and stays monotone', () => {
    const tokens = tokensFrom(['first line here', 'ghost line missing', 'third line again'])
    const asr = [...asrFrom('first line here', 10), ...asrFrom('third line again', 30)]
    const { words, matchedRatio } = alignLyricsToTranscription(tokens, asr)
    expect(matchedRatio).toBeCloseTo(6 / 9, 5)
    const ghost = words.filter((w) => w.line === 1)
    expect(ghost).toHaveLength(3)
    for (const w of ghost) {
      expect(w.aligned).toBeUndefined()
      expect(w.startSec).toBeGreaterThanOrEqual(10)
      expect(w.endSec).toBeLessThanOrEqual(30 + 1e-9)
    }
    assertMonotone(words)
  })

  it('repeated chorus lines land on successive occurrences in time order', () => {
    const tokens = tokensFrom(['valerie valerie', 'something different', 'valerie valerie'])
    const asr = [
      ...asrFrom('valerie valerie', 10),
      ...asrFrom('something different', 20),
      ...asrFrom('valerie valerie', 40),
    ]
    const { words, matchedRatio } = alignLyricsToTranscription(tokens, asr)
    expect(matchedRatio).toBe(1)
    const firstChorus = words.filter((w) => w.line === 0)
    const secondChorus = words.filter((w) => w.line === 2)
    expect(firstChorus[0]!.startSec).toBeCloseTo(10, 5)
    expect(secondChorus[0]!.startSec).toBeCloseTo(40, 5)
    assertMonotone(words)
  })

  it('instrumental intro: first word lands at the recognized time, not 0', () => {
    const tokens = tokensFrom(['hello darkness my old friend'])
    const asr = asrFrom('hello darkness my old friend', 34.5)
    const { words } = alignLyricsToTranscription(tokens, asr)
    expect(words[0]!.startSec).toBeCloseTo(34.5, 5)
  })

  it('fuzzy-matches 2-char inflection differences on 5+ letter words (Swedish endings)', () => {
    const tokens = tokensFrom(['solen skiner alltid'])
    // Recognizer garbled "solen" → "sulan" (lev 2) and "skiner" → "skinner" (lev 1).
    const asr = asrFrom('sulan skinner alltid', 3)
    const { words, matchedRatio } = alignLyricsToTranscription(tokens, asr)
    expect(matchedRatio).toBe(1)
    expect(words[0]!.aligned).toBe(true)
    expect(words[0]!.startSec).toBeCloseTo(3, 5)
  })

  it('fuzzy-matches near misses but never short words', () => {
    const tokens = tokensFrom(['colour of a mind'])
    // Recognizer heard "color" (lev 1) and "mine" (lev 1 of "mind");
    // "a" misheard as "uh" must NOT fuzzy-anchor (short word).
    const asr = asrFrom('color of uh mine', 8)
    const { words } = alignLyricsToTranscription(tokens, asr)
    expect(words[0]!.aligned).toBe(true) // colour ← color
    expect(words[3]!.aligned).toBe(true) // mind ← mine
    expect(words[2]!.aligned).toBeUndefined() // "a" interpolated
    assertMonotone(words)
  })

  it('empty lyrics → empty result; empty ASR → nominal cadence, ratio 0', () => {
    expect(alignLyricsToTranscription([], asrFrom('hey', 1)).words).toEqual([])
    const { words, matchedRatio } = alignLyricsToTranscription(tokensFrom(['la la la']), [])
    expect(matchedRatio).toBe(0)
    expect(words).toHaveLength(3)
    assertMonotone(words)
  })

  it('rejects a wrong-occurrence anchor that stretches a row (the stuck-"hej" case)', () => {
    // One row: "sommartider hej hej sommartider". The recognizer's words for
    // the FIRST chorus lost the final word, and the aligner's last anchor
    // grabbed the SECOND chorus 14s later. Row consensus must reject it and
    // interpolate the last word next to its rowmates instead of holding a
    // 10-second word.
    const tokens = tokensFrom(['sommartider hej hej sommartider'])
    const asr: AsrWord[] = [
      { text: 'sommartider', startSec: 2.0, endSec: 2.6 },
      { text: 'hej', startSec: 2.7, endSec: 2.9 },
      { text: 'hej', startSec: 3.0, endSec: 3.2 },
      // …instrumental… second chorus far away:
      { text: 'sommartider', startSec: 16.0, endSec: 16.6 },
    ]
    const { words } = alignLyricsToTranscription(tokens, asr)
    const last = words[3]!
    // Without rejection this word sat at 16s; with row consensus it must sit
    // right after its rowmates.
    expect(last.startSec).toBeLessThan(6)
    // And no word in the row may last for seconds.
    for (const w of words) expect(w.endSec - w.startSec).toBeLessThan(2)
    assertMonotone(words)
  })

  it('interpolated words hug their own row across a long between-row gap', () => {
    // Row 0 anchored only at its first word; row 1 anchored only at its last.
    // The 10s gap belongs BETWEEN the rows: row 0's missing words chain right
    // after its anchor, row 1's missing words chain right before its anchor.
    const tokens = tokensFrom(['alpha beta gamma', 'delta epsilon zeta'])
    const asr: AsrWord[] = [
      { text: 'alpha', startSec: 2.0, endSec: 2.4 },
      { text: 'zeta', startSec: 14.0, endSec: 14.4 },
    ]
    const { words } = alignLyricsToTranscription(tokens, asr)
    const beta = words[1]!
    const gamma = words[2]!
    const delta = words[3]!
    const epsilon = words[4]!
    // Row 0 stays together near 2s…
    expect(gamma.endSec).toBeLessThan(5)
    expect(beta.startSec).toBeGreaterThanOrEqual(2.4)
    // …row 1 stays together near 14s.
    expect(delta.startSec).toBeGreaterThan(11)
    expect(epsilon.endSec).toBeLessThanOrEqual(14.0 + 1e-9)
    assertMonotone(words)
  })

  it('sparse anchors in one row scaffold the rest ("Where … when … you")', () => {
    const tokens = tokensFrom(['where are you now when i need you'])
    const asr: AsrWord[] = [
      { text: 'where', startSec: 5.0, endSec: 5.3 },
      { text: 'when', startSec: 6.6, endSec: 6.9 },
      { text: 'you', startSec: 7.6, endSec: 7.9 },
    ]
    const { words } = alignLyricsToTranscription(tokens, asr)
    // "are you now" interpolate between where(5.3) and when(6.6)…
    for (const w of words.slice(1, 4)) {
      expect(w.startSec).toBeGreaterThanOrEqual(5.3)
      expect(w.endSec).toBeLessThanOrEqual(6.6 + 1e-9)
    }
    // …"i need" between when(6.9) and the final you(7.6).
    for (const w of words.slice(5, 7)) {
      expect(w.startSec).toBeGreaterThanOrEqual(6.9)
      expect(w.endSec).toBeLessThanOrEqual(7.6 + 1e-9)
    }
    assertMonotone(words)
  })

  it('ad-lib intro words do not steal the first line (Love Never Felt So Good case)', () => {
    // The vocal track opens with ad-libs NOT in the lyrics ("uh let me see
    // you movin uh…") that exact-match common lyric words. The real first
    // line is sung later and matches as a full run — the line must anchor
    // THERE, not spread into the ad-libs.
    const tokens = tokensFrom(['love never felt so good', 'and I doubt it ever could'])
    const asr: AsrWord[] = [
      // ad-libs at 1-4s — "so" and "good" appear but isolated/out of context
      { text: 'uh', startSec: 1.0, endSec: 1.2 },
      { text: 'let', startSec: 1.4, endSec: 1.6 },
      { text: 'me', startSec: 1.7, endSec: 1.85 },
      { text: 'see', startSec: 2.0, endSec: 2.2 },
      { text: 'you', startSec: 2.3, endSec: 2.5 },
      { text: 'movin', startSec: 2.6, endSec: 2.9 },
      { text: 'so', startSec: 3.4, endSec: 3.55 },
      { text: 'uh', startSec: 3.8, endSec: 3.95 },
      // the real first line at 12s, sung as a run
      ...asrFrom('love never felt so good', 12),
      ...asrFrom('and I doubt it ever could', 16),
    ]
    const { words, matchedRatio } = alignLyricsToTranscription(tokens, asr)
    // Every word of line 0 must sit at the sung occurrence (≥ 11s), none in
    // the ad-lib zone.
    for (const w of words.filter((w) => w.line === 0)) {
      expect(w.startSec).toBeGreaterThan(11)
    }
    expect(words[0]!.startSec).toBeCloseTo(12, 1)
    expect(matchedRatio).toBeGreaterThan(0.9)
    assertMonotone(words)
  })

  it('recovers a row whose words the recognizer garbled (multi-pass lift)', () => {
    // Row 2's words are all near-misses — the global pass may anchor only
    // some; the row-local recovery pass must lift the rest from the window.
    const tokens = tokensFrom(['clean opening line here', 'muddy middle words sung', 'clean closing line too'])
    const asr: AsrWord[] = [
      ...asrFrom('clean opening line here', 5),
      // garbled middle: each word lev-distance ≤ 2 from the lyric
      { text: 'muddi', startSec: 9.0, endSec: 9.3 },
      { text: 'midle', startSec: 9.4, endSec: 9.7 },
      { text: 'words', startSec: 9.8, endSec: 10.1 },
      { text: 'sang', startSec: 10.2, endSec: 10.5 },
      ...asrFrom('clean closing line too', 13),
    ]
    const { words, matchedRatio } = alignLyricsToTranscription(tokens, asr)
    expect(matchedRatio).toBeGreaterThan(0.8)
    const middle = words.filter((w) => w.line === 1)
    for (const w of middle) {
      expect(w.startSec).toBeGreaterThanOrEqual(8.5)
      expect(w.endSec).toBeLessThanOrEqual(11)
    }
    assertMonotone(words)
  })

  it('property: random word drops keep output monotone and in-bounds', () => {
    const line = 'one two three four five six seven eight nine ten eleven twelve'
    const tokens = tokensFrom([line, line, line])
    // Deterministic pseudo-random drop of every 3rd word from the ASR.
    const full = asrFrom([line, line, line].join(' '), 15, 0.25, 0.08)
    const asr = full.filter((_, i) => i % 3 !== 2)
    const { words, matchedRatio } = alignLyricsToTranscription(tokens, asr)
    expect(matchedRatio).toBeGreaterThan(0.5)
    expect(words).toHaveLength(36)
    assertMonotone(words)
    expect(words[0]!.startSec).toBeGreaterThanOrEqual(0)
  })
})
