A way to improve lyrics detection is that a lot of words fall away because lyrics spell words a little bit different, so this a problem in two parts, the first engineering problem is matching the same word with different spelling, this could be done with nearest neighbor or some other more sophisticated approach, or some simple heuristic.
after we have this we can get lyrics matchin much much better.

---

## Findings after measuring this on your whole library (2026-07-25)

I tested your idea directly on all 16 songs in `test1234` (re-transcribed every
vocal stem, ran the real aligner). Full writeup: `docs/domains/lyrics-alignment.md`.

**Your instinct is right that words fall away — but the spelling matcher is only a
small part of it.** Measured split of every word that fails to land:
- **4.7%** are "matching-limited" — the engine heard a close-enough word but the
  matcher didn't use it (this is your spelling idea; real but small).
- **38.9%** are "recognition-limited" — the engine never heard a matchable word at
  all. ~8× bigger.

So better spelling-matching alone gets +0.4% overall. The big wins are on the
*recognition* side:
1. **Give the recognizer the language, read from your lyrics.** It was guessing the
   language from the singing and getting it wrong — "Den första" was detected as
   *Norwegian*, which is why it was so bad (7%). Reading the language off your
   imported lyrics fixes it → **7% → 56%** on that song. (Built + tested:
   `src/lib/lyrics/detectLyricsLanguage.ts`, correct on all 16 songs.)
2. **Use a bigger voice model** (large-v3-turbo). Corpus **54% → 65%** word match,
   e.g. Sommartider 54→71, Diggiloo 58→73, Dangerous 84→97. You said slower is fine,
   so this is the single biggest lever.
3. Two songs stay bad no matter what (Leva livet, Dance with somebody) because their
   *vocal stems are 10 dB too quiet* — the separation lost the vocals. That needs
   re-separating or the "upload a version with vocals" path, not a matcher/model change.

A conservative version of your spelling matcher is safe to add as polish (it made only
correct matches like trubbel↔truppel, blod↔blåd), but pushing it harder starts creating
*wrong* matches — so it's not where the quality is hiding. Recognition is.

