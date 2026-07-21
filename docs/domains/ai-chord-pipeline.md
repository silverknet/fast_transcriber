# AI Chord / Section Pipeline

A guide for an AI agent adding chords and sections to an **already-analyzed**
song (one that has a beat grid, and ideally fitted lyrics + chroma).

**Read this scope statement first — it is the whole point.** It was written
from five failed and semi-failed experiments on one song (Gyllene Tider's
"Sommartider"), and it exists to stop the next agent repeating them.

---

## The finding that shapes everything

Bar-level chroma reliably identifies a bar's **dominant** chord (the tonic and
the other one or two chords the bar sits on longest) but is **too noisy to
resolve passing chords** — the quick `E`, `Bm`, `F#m` that give a progression
its character. Measured on Sommartider: pooled/aggregated chroma scored the
dominant chord at Pearson 0.5–0.69, but individual passing bars sat at
0.02–0.25 with the "wrong" chord often within 0.03 of the "right" one.

Consequence: **an AI agent cannot reliably transcribe a full chord chart from
chroma alone.** Every attempt to do so produced either jitter or a harmonically
thin skeleton. What chroma IS reliable for: the **key**, the **dominant chord
per bar**, and a **confidence signal** for flagging. Treat it as those three
things, not as a transcriber.

Chord *identity* — the actual progression, including passing chords — should
come from a **real chord sheet**, placed against the song's own audio-aligned
lyrics. BarBro already has the tool for this: the sheet-import flow. The AI's
value-add is everything AROUND chord identity: setting the key, detecting
sections, and flagging where the audio disagrees with the sheet.

---

## Reliable pipeline

### Stage 0 — Prereqs & branch
Require `timeline.bars` / `timeline.beats`. Check chroma freshness: consumers
refuse `chordHints` unless `analyzerVersion === 4` (`CHORD_ANALYZER_VERSION`),
`beatChroma.length === beats.length`, and the audio fingerprint matches. Note
`chordHints` is **local-only** — it is stripped on cloud push
(`LOCAL_ONLY_TOP_LEVEL` in `collab.ts`), so read it from the on-disk `.smap`,
not a cloud copy. Branch:
- **aligned lyrics + fresh chroma** → full pipeline below (best case).
- **fresh chroma, no lyrics** → key + dominant-chord skeleton + flags only. Say
  so; the result is a scaffold, not a chart.
- **no chroma** → sheet placement only, no verification. Weakest.

### Stage 1 — Establish the key (load-bearing)
Setting `metadata.keyDetail` unlocks the diatonic bias in
`rankTriadFitsForChroma` (`suggestFromChroma.ts`, `CHORD_IN_KEY_BIAS 1.22`).
Without it, chord suggestion is materially worse — keyless Sommartider guessed
A-minor at 0.01 confidence and produced junk; setting A-major made the output
usable. Priority: existing `keyDetail` → `chordHints.detectedKey` if
`confidence ≥ 0.15` → the reference chart's stated key → `fitKeyFromChroma`
(`keyDetect.ts`). Record which source was used.

### Stage 2 — Reference chart (the chord identity source)
Search the web for the song's chord sheet. Extract the **key**, the **chord
vocabulary** (the set the song uses), and **chord-over-word placements**. Note:
web pages often will not return lyrics verbatim, and that is fine — the song's
OWN aligned lyrics are the anchor; the web only supplies which chord sits over
which word. **The accuracy of these anchors is the pipeline's real bottleneck.**
A clean, accurate tab beats everything else here; a summarized or
hand-transcribed one caps the result's quality no matter how good the tools are.

### Stage 3 — Sections (from lyrics, not audio)
`sectionBorderHints` is a sidecar-only signal present on almost no songs (1 of
16 in the test project), so do NOT rely on it. Detect structure from the
audio-aligned lyrics instead:
- **Chorus** = the most-repeated normalized lyric line (a trivial normalizer —
  lowercase, strip punctuation — found the hook reliably). Merge consecutive
  hook lines into one chorus.
- **Verse** = the first sung line after the intro gap, and after each chorus.
- Label sections using the reference chart's names; place boundaries at the
  timed lyric-line starts. Cross-check kinds with `predictNextSection`
  (`sections/predictNext.ts`).

When using the sheet-import path, `deriveSectionsFromSheet` does the equivalent
automatically from where chords landed.

### Stage 4 — Place chords (use the existing tool, don't reinvent)
Build a chord sheet from the song's OWN aligned lyrics + the Stage-2 anchors,
then call `prepareSheetImport(sheet, map, newId)` (`sheet/importAsDraft.ts`).
It runs `placeChords`, which fuzzy-matches sheet lines to stored lyric lines
(Dice ≥ 0.6, monotone), anchors each chord to its word's `startSec`, and runs a
small DP that uses a **capped** chroma vote (never a veto) to choose between the
word's bar and its neighbours. Record `stats`:
`placed / estimated / collisions / unplaceable`, `matchedLines / totalLines`.

`stats.estimated` counts placements with `origin !== 'word'` — either a chord on
an `aligned:false` (interpolated-time) word, or an instrumental `spread`. These
drift ~a bar and are the least trustworthy placements.

### Stage 5 — Verify against audio, and **flag** — do NOT override per bar
For each placed chord: `aggregateBarChroma` → `chordChromaFitScore` for the
placed chord and each vocabulary chord (`suggestFromChroma.ts`). Then:
- **Flag**, don't correct, any bar where the audio's best-fit chord differs
  from the placed chord. Report it for human review with both fit scores.
- The ONE case where overriding identity is defensible is a pure `spread` chord
  (instrumental, no lyric anchor at all) where an in-vocabulary alternative wins
  by a large margin (≥ 0.15) — because there the sheet had no word-level
  opinion to begin with. Even this is optional.

**Anti-patterns, each observed to make the result worse:**
- *Per-bar override of anchored chords.* Trusting the audio to replace chords
  bar-by-bar reintroduced chorus jitter — the repeated choruses stopped agreeing
  with each other (`F#m` bled into the chorus; `A↔D↔E` flipped differently each
  time). A word-anchored chord's identity is trustworthy; only its position may
  drift.
- *Phase-pooled loop fitting.* Averaging chroma across repeated choruses at a
  fixed loop length denoises the dominant chords beautifully but **washes out
  the passing chords** (the loop collapsed to "D A A A"), because chord changes
  do not fall on a clean fixed-phase grid.

### Stage 6 — Assemble
`addDraftAndActivate(map, content, name, newId)` (`drafts.ts`) — this preserves
existing drafts and makes the new one active. `validateSongMap` before writing.
`toCollabSongMap` for a cloud push. **Use fresh unique ids** (e.g.
`crypto.randomUUID()`) for every chord and draft; a script that reuses or resets
ids across runs will collide and the by-id draft merge will silently drop a
draft (this happened during development and cost a draft).

### Stage 7 — Honesty report (required)
State plainly: chords placed, % audio-confirmed, the list of audio-corrected and
low-confidence bars for the human to check, and — if the reference anchors were
weak or hand-approximated — that the result is a **draft to correct by ear, not
a transcription**. Do not present guesses as fact.

---

## When to route to the human instead

If a clean, accurate tab is not available, the honest move is to say so and let
the user paste a real tab into the Chords tab (the sheet-import UI is exactly
this pipeline with a trustworthy Stage-2). The AI-driven path is worth running
when: the key is unset (Stage 1 alone is a real improvement), the song has no
sections yet (Stage 3), or you want the audio-confidence flags to guide manual
correction. It is not a substitute for an accurate source chart.

## Key functions (all existing; compose, don't reimplement)
- `fitKeyFromChroma` — `src/lib/chords/keyDetect.ts`
- `proposeChordSuggestions`, `chordChromaFitScore`, `aggregateBarChroma`,
  `rankTriadFitsForChroma` — `src/lib/chords/suggestFromChroma.ts`
- `parseChordSheet` — `src/lib/chords/sheet/parseChordSheet.ts`
- `placeChords` — `src/lib/chords/sheet/placeChords.ts`
- `prepareSheetImport`, `applySheetImport` — `src/lib/chords/sheet/importAsDraft.ts`
- `deriveSectionsFromSheet` — `src/lib/chords/sheet/deriveSections.ts`
- `predictNextSection` — `src/lib/sections/predictNext.ts`
- `addDraftAndActivate` — `src/lib/songmap/drafts.ts`
- `validateSongMap` — `src/lib/songmap/validate.ts`; `toCollabSongMap` — `src/lib/songmap/collab.ts`
