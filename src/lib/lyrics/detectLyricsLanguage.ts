/**
 * Detect the language of imported lyrics text, to hand Whisper a language hint.
 *
 * Why this exists: faster-whisper auto-detects language from the (sung, noisy)
 * vocal stem and gets it wrong on hard audio — a real Swedish song
 * ("Den första är alltid gratis") was detected as Norwegian Nynorsk (`nn`),
 * which halved the recognized-word count and wrecked the fit (7% → 56% word
 * anchor once forced to `sv`). The user's *imported lyrics* are a clean,
 * noise-free language signal we already have; use them.
 *
 * Deliberately high-precision, low-recall: return a code only when the evidence
 * is decisive, otherwise `undefined` so the caller falls back to Whisper's
 * auto-detect (today's behaviour). A wrong hint is worse than no hint.
 *
 * Pure module — no I/O. Returns an ISO-639-1 code Whisper accepts.
 */

/** Languages we can confidently tell apart from lyric text. */
export type DetectedLyricsLanguage = 'sv' | 'en' | 'no' | 'da' | 'de'

/**
 * Frequent function words, chosen to be distinctive between these languages.
 * Kept small on purpose — these carry almost all the discriminating power in
 * running lyric text.
 */
const STOPWORDS: Record<DetectedLyricsLanguage, readonly string[]> = {
  sv: ['och', 'att', 'jag', 'är', 'det', 'som', 'på', 'för', 'inte', 'med', 'har', 'vi', 'så', 'men', 'när', 'här', 'där', 'från', 'mig', 'dig', 'än', 'över', 'också', 'aldrig'],
  en: ['the', 'and', 'you', 'are', 'that', 'with', 'this', 'for', 'was', 'have', 'your', 'not', 'but', 'all', 'when', 'where', 'they', 'she', 'out', 'know', 'never', 'because', 'about', 'would'],
  no: ['og', 'jeg', 'ikke', 'det', 'som', 'på', 'har', 'meg', 'deg', 'ikkje', 'eg', 'kva', 'noko', 'berre', 'ei'],
  da: ['og', 'jeg', 'ikke', 'det', 'som', 'på', 'har', 'mig', 'dig', 'men', 'hvad', 'ikke', 'kun', 'nogen'],
  de: ['und', 'ich', 'nicht', 'das', 'die', 'der', 'ist', 'mit', 'für', 'auf', 'wir', 'dich', 'mich', 'aber', 'wenn', 'noch', 'schon', 'immer'],
}

/** Diacritic → languages it points toward (weak, additive signal). */
const DIACRITIC_HINTS: { re: RegExp; langs: DetectedLyricsLanguage[] }[] = [
  { re: /[äö]/, langs: ['sv', 'de'] },
  { re: /å/, langs: ['sv', 'no', 'da'] },
  { re: /[æø]/, langs: ['no', 'da'] },
  { re: /ß|ü/, langs: ['de'] },
]

const WORD_RE = /[\p{L}']+/gu

/**
 * Detect the lyrics language, or `undefined` when not confident enough to
 * override Whisper's own detection.
 *
 * @param sourceText cleaned lyrics text (any casing/lines).
 * @param opts.minWords  minimum words required to attempt a guess (default 12).
 * @param opts.minMargin winner's stopword hits must exceed the runner-up by at
 *   least this factor (default 1.5) AND by ≥3 absolute hits.
 */
export function detectLyricsLanguage(
  sourceText: string,
  opts: { minWords?: number; minMargin?: number } = {},
): DetectedLyricsLanguage | undefined {
  const minWords = opts.minWords ?? 12
  const minMargin = opts.minMargin ?? 1.5
  const text = (sourceText || '').toLowerCase()
  const words = text.match(WORD_RE) ?? []
  if (words.length < minWords) return undefined

  const wordSet = words // keep duplicates: frequency matters
  const scores: Record<DetectedLyricsLanguage, number> = { sv: 0, en: 0, no: 0, da: 0, de: 0 }

  const stopSets = Object.fromEntries(
    (Object.keys(STOPWORDS) as DetectedLyricsLanguage[]).map((l) => [l, new Set(STOPWORDS[l])]),
  ) as Record<DetectedLyricsLanguage, Set<string>>

  for (const w of wordSet) {
    for (const lang of Object.keys(scores) as DetectedLyricsLanguage[]) {
      if (stopSets[lang].has(w)) scores[lang] += 1
    }
  }

  // Diacritics: a small additive nudge (never decisive on their own).
  for (const { re, langs } of DIACRITIC_HINTS) {
    if (re.test(text)) for (const l of langs) scores[l] += 1.5
  }
  // Absence of any Scandinavian/German diacritic is weak evidence for English.
  if (!/[äöåæøüß]/.test(text)) scores.en += 1.5

  const ranked = (Object.keys(scores) as DetectedLyricsLanguage[])
    .map((lang) => ({ lang, score: scores[lang] }))
    .sort((a, b) => b.score - a.score)

  const top = ranked[0]!
  const second = ranked[1]!
  // Need a real, decisive win: enough absolute evidence AND a clear margin.
  if (top.score < 3) return undefined
  if (top.score < second.score * minMargin && top.score - second.score < 3) return undefined
  return top.lang
}
