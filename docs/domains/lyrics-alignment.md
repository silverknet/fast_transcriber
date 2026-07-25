# Lyrics fit — detection & alignment (investigation + how it works)

**Status:** measured 2026-07-25 against the real `test1234` library (16 songs with
imported lyrics + vocal stems). This doc is the authoritative writeup of *why*
lyrics-fit quality is what it is and *which levers actually move it*.

> TL;DR — **Recognition is the bottleneck, not matching.** Of every unanchored
> lyric word, ~8× more are lost because the recognizer never produced a nearby
> word than because the matcher failed on a spelling variant. The two changes
> that move the needle are both on the *recognition* side: **pass a language
> hint derived from the imported lyrics**, and **use a bigger Whisper model**.
> Loosening the word matcher (phonetic / contraction maps) adds <0.5 pts and
> risks false anchors — the row-DP guards exist to prevent exactly that.

---

## 1. How the pipeline works today

"Fit to song" is three stages ([edit/+page.svelte `fitLyricsToSong`](../../src/routes/edit/+page.svelte)):

1. **Transcribe** the vocal stem with faster-whisper (Python sidecar,
   [transcribe.py](../../desktop/native/python/lyrics/transcribe.py)) → recognized
   words with timestamps. Model is hardcoded **`small`**, **no language hint**
   ([main.mjs:5376](../../desktop/electron/main.mjs)).
2. **Tokenize** the pasted lyrics into line-preserving tokens ([clean.ts](../../src/lib/lyrics/clean.ts)).
3. **Align** lyric tokens against recognized words with a row-based DP
   ([align.ts](../../src/lib/lyrics/align.ts)) → each lyric word gets start/end
   times. Matched words anchor to the recognized timestamp; the rest interpolate.

**Invariant (confirmed with the user):** the *displayed* text is always the
user's imported lyrics. The ASR is used **only for timing**. So "waddap" (sheet)
stays "waddap" even if the engine heard "what is up" — all the aligner needs is
the *moment* those words were sung.

Quality is reported two ways:
- **word-anchor %** = lyric words anchored to a real recognized word ÷ total.
- **row-cover %** = rows with ≥1 real anchor ÷ total rows. This is the honest
  display-quality metric: an anchored row is *placed by evidence*; an anchorless
  row is interpolated (fine when few, guesswork when most).

---

## 2. The measurement (16 songs, real `align.ts`)

Method: re-transcribed each song's `stems/best/vocals.wav` with faster-whisper
under several configs, then ran the **shipped** `align.ts` offline against each.
Harness + cached ASR live in the scratchpad (see §7). Numbers are corpus micro
totals (Σwords), so long songs weigh more.

| Config | word-anchor | row-cover |
|---|---:|---:|
| `small`, auto-language, shipped matcher **(what ships today)** | **54.2%** | **65.5%** |
| `small`, auto-language, phonetic matcher | 54.6% | 66.1% |
| `small`, **language from lyrics** | 56.1% | 68.3% |
| `small`, language from lyrics, phonetic matcher | 56.4% | 68.8% |
| **`large-v3-turbo`, language from lyrics** | **65.1%** | **72.4%** |
| `large-v3-turbo`, language from lyrics, phonetic matcher | 65.4% | 72.8% |

**Recognition levers: +10.9 pts word / +6.9 pts row. Matching lever: +0.4 pt.**

### The recognition-vs-matching split (the key diagnostic)

Ran the aligner on the best-recognition ASR, then classified every *unanchored*
lyric word: is there a phonetically-close ASR word within ±1.6 s of where it
should be?

| Category | Share of all lyric words |
|---|---:|
| Anchored | 56.4% |
| **Matching-limited** — a near ASR word IS nearby, matcher missed it | **4.7%** |
| **Recognition-limited** — no ASR word near = recognizer never got it | **38.9%** |

The recognizer failing to emit a matchable word outnumbers matcher misses **~8:1**.
This is the whole story: you cannot phonetically match a word the ASR never produced.

---

## 3. The levers, in priority order

### Lever A — language hint from the imported lyrics ⭐ (cheap, safe, big for some songs)

Whisper auto-detects language from the (sung, noisy) vocal stem and **gets it
wrong** on hard audio. Observed detections: **"Den första" → `nn` (Norwegian
Nynorsk)**, "Kom så ska vi" → `en`. A mis-detected language wrecks recognition:
Den första produced 79 badly-garbled words on auto vs **161** when forced to `sv`.

We already hold a perfect language signal: **the user's imported lyrics text.**
A trivial stopword + diacritic classifier separates the whole library cleanly
(Swedish songs: 54–150 Swedish stopwords, 0–1 English; English songs the mirror).

Impact (small model, just the language fix): **Den första 7% → 56% word / 10% →
81% row.** Songs already detected correctly are unchanged (expected). This alone
rescues the worst song without touching the model.

Implement: detect language from `lyrics.sourceText`, thread it through
`enqueueLyricsTranscription` → `/native/transcribe-lyrics` → the stdin JSON at
[main.mjs:5376](../../desktop/electron/main.mjs) (`transcribe.py` already accepts
`language`). Building block shipped: [`detectLyricsLanguage.ts`](../../src/lib/lyrics/detectLyricsLanguage.ts).
If not confident, pass nothing (keep today's auto-detect).

### Lever B — bigger Whisper model ⭐⭐ (the biggest mover; user confirmed speed is fine)

`large-v3-turbo` (already cached in the lyrics models dir) over `small`, both with
the language hint, on the full corpus: **54.2% → 65.1% word / 65.5% → 72.4% row.**
Per-song, holding language fixed, the jumps are large and consistent:

| Song | small→large word-anchor |
|---|---|
| Sommartider | 54% → 71% |
| Diggiloo Diggiley | 58% → 73% |
| Can't tame her | 50% → 66% |
| Den första | 56% → 69% |
| Dangerous | 84% → 97% |
| Från och med Du | 72% → 85% |
| Dum av dig | 59% → 70% |

Cost: `large-v3-turbo` is ~1.6 GB (one-time download; the setup endpoint currently
only fetches `small`) and slower on CPU. The user has confirmed slower is fine
("voice reco is super fast so a slower model is no problem"). Bump
`TRANSCRIBER_VERSION` when changing the model so cached fits re-run.

### Lever C — the word matcher (phonetic / relaxed fuzzy) — low value, keep it conservative

A conservative phonetic-key pass (fold `å/ä/ö`, `ck→k`, `ph→f`, sibilant/tje
classes, collapse doubles, drop silent h) on top of the shipped Levenshtein caps
gains **+0.4 pt** corpus-wide. Spot-checked matches are correct
(`trubbel~truppel`, `blod~blåd`, `saknar~saknade`, `längre~länge`) — but the gain
is marginal because most misses are recognition-limited, and the row-DP already
requires a *distinctive run* to accept a candidate, which throttles isolated
fuzzy wins.

⚠️ **Do not loosen `wordScore` aggressively.** An aggressive phonetic fold or a
`gonna→going to` contraction map *lowers* quality by adding **false anchors** (a
separate agent measured −2.0 / −1.0 pts). The `acceptCandidate` distinctiveness
guard and the monotone row-DP exist precisely to stop short/common words from
anchoring rows into the wrong place; a looser matcher fights them. If a phonetic
pass is added, keep it (a) gated behind the existing distinctiveness guard and
(b) length-limited (≥3 chars), and treat it as polish, not the fix.

### Not recommended — Whisper `hotwords`/`initial_prompt` from the lyrics

Biasing the decode toward the known lyric vocabulary sounds ideal but measured
**inconsistent**: on a 6-song subset it helped Can't tame her (+17) and
Sommartider (+6) but regressed Den första, Dance, Love never, Diggiloo (net
+2.9, high variance). Whisper over-commits to the primed words and hallucinates
repeats. Not safe as a default. (Might be worth revisiting as an *opt-in* "the
fit is bad, try harder" retry, combined with Lever B.)

---

## 4. What no model can fix — buried vocal stems

Two songs stay broken even with `large-v3-turbo`:

| Song | word-anchor (large) | vocal stem mean loudness |
|---|---:|---:|
| (Kom så ska vi) Leva livet | 0% | **-30.6 dB** |
| Dance with somebody | 23% | **-33.1 dB** |
| (healthy: Den första / killers / Hell Yeah / Sommartider) | 69–97% | -18 to -22 dB |

Their Demucs vocal stems are 8–12 dB quieter than healthy ones — the recognizer
has almost nothing to hear. This is a **stem-separation / source problem**, not a
model or matcher problem. Remedies: re-separate stems, or use the existing
"upload a version with vocals" path, or simply *tell the user* via the new
[`fitConfidence.ts`](../../src/lib/lyrics/fitConfidence.ts) diagnosis
("quiet-vocals") instead of showing a silently bad fit.

---

## 5. Per-song baseline (shipped `small`/auto) vs `large`+language

| Song | shipped word% | large+lang word% | note |
|---|---:|---:|---|
| Den första är alltid gratis | 7 | 69 | language mis-detect (`nn`) + weak model |
| Sommartider | 54 | 71 | model |
| Diggiloo Diggiley | 58 | 73 | model |
| Can't tame her | ~49 | 66 | model |
| Dangerous | 84 | 97 | model |
| Från och med Du | 72 | 85 | model |
| Tur att vi lever samtidigt | 74 | 84 | model |
| Dum av dig | 59 | 70 | model |
| When we were young | 85 | 88 | already good |
| Valerie | 60 | 73 | model |
| Hell Yeah Norrtälje | 65 | 80 | model |
| Ramlar | 62 | 64 | model (small gain) |
| Calleth You, Cometh i | 57 | 63 | model |
| Love never felt so good | 43 | 43 | sheet vs sung gap (ad-libs/repeats) |
| Dance with somebody | 24 | 23 | **buried vocal stem** |
| (Kom så ska vi) Leva livet | 1 | 0 | **buried vocal stem** |

(`Dangerous` intentionally has no real lyrics-vocal case per the user — ignore.)

---

## 6. Recommended change set (in order)

1. **Language hint from lyrics** — [`detectLyricsLanguage.ts`](../../src/lib/lyrics/detectLyricsLanguage.ts)
   (shipped here, pure + tested); thread it from `fitLyricsToSong` →
   `enqueueLyricsTranscription` → `/native/transcribe-lyrics` → stdin at
   [main.mjs:5376](../../desktop/electron/main.mjs). Zero risk (falls back to
   auto when unsure).
2. **Switch the model to `large-v3-turbo`** at [main.mjs:5376](../../desktop/electron/main.mjs)
   (make the setup endpoint fetch it; bump `TRANSCRIBER_VERSION`). Biggest mover.
3. **Surface the diagnosis** with [`fitConfidence.ts`](../../src/lib/lyrics/fitConfidence.ts)
   so buried-vocal / weak-recognition songs tell the user what to do instead of
   showing a bad fit silently.
4. *(optional, low priority)* a conservative phonetic pass in `wordScore`, gated
   by the existing distinctiveness guard. Polish only.

⚠️ `main.mjs` is being edited by a concurrent agent (test-harness refactor,
uncommitted). **Re-read it fresh before editing** and coordinate in
[AGENT_NOTES.md](../../AGENT_NOTES.md).

---

## 7. Reproducing / extending

Cached ASR + harness (scratchpad, not committed):
`…/df45ce69-…/scratchpad/` — `harness.ts` (corpus run), `diag.ts` (recognition
vs matching split), `compare.ts` (config A/B), `inspect.ts` (per-song anchor
pairs), `align_exp.ts` (shipped aligner + `SCHEME=base|relax|phon` scorer),
`transcribe_exp.py` (model/language/hotwords), `asr/<folder>.<tag>.json` (cached
transcriptions: `small`, `flang`, `large`, `smallhot`).

Run one config: `vite-node harness.ts -- large align_exp.ts` (env `SCHEME=phon`).
Whisper venv: `~/Library/Application Support/barbro-desktop/python/lyrics-venv`.
Models cached: `…/python/lyrics/models` (`small`, `large-v3-turbo`).
