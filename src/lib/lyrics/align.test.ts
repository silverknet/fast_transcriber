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
