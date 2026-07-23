# AI Chord / Section Pipeline

A guide for an AI agent adding chords and sections to an **already-analyzed**
song (one that has a beat grid, and ideally fitted lyrics + chroma).

**Read this scope statement first — it is the whole point.** It was written
from five failed and semi-failed experiments on one song (Gyllene Tider's
"Sommartider"), and it exists to stop the next agent repeating them.

---

## The finding that shapes everything

**The bass stem is the strongest chord signal, and it beats both chroma and the
agent's own musical assumptions.** A separated bass track is near-monophonic and
plays the chord root, so detecting its pitch right after each beat gives the
root unambiguously. On Sommartider this produced a clean, musically coherent
chart in one pass — `A` verse vamp, `Bm E` build, `D E A D Bm E A` chorus (all
four choruses consistent because the bass plays them the same), and even the
`F#m` (vi) in verse two — where six prior attempts with chroma and hand-built
charts had failed.

By contrast, **bar-level chroma is a 12-note blur of the whole mix** (vocals,
guitar, cymbals) and reliably resolves only the *dominant* chord — the tonic and
the one or two chords a bar sits on longest. Passing chords (`E`, `Bm`, `F#m`)
sat at Pearson 0.02–0.25 with the wrong chord often within 0.03 of the right
one. An agent **cannot** transcribe a full chart from chroma alone; every
attempt jittered or collapsed to a thin `A`/`D` skeleton.

The order of trust for CHORD IDENTITY, established by experiment:

1. **Bass-stem root detection** — strongest for the bass NOTE under each beat.
   Autocorrelation pitch on the bass stem in a ~90 ms window ~15 ms after each
   beat → pitch class. But the bass note is **not** always the chord root (see
   the inversion rule below) — it is the input to chord identity, not the answer.
2. **A real Ultimate Guitar tab** — supplies the two things the bass and the key
   cannot: the chord **vocabulary** (which chords the song actually uses) and
   chord **quality** beyond the diatonic default (7ths, sus, borrowed chords). A
   hand-transcribed or summarized tab is NOT reliable — on Sommartider the
   agent's own tab guessed a `D/A E/A` verse that both the bass and the guitar
   stem proved was just `A`.
3. **Chroma** — for confirming the dominant chord and as a confidence/flagging
   signal. Not a transcriber, and (below) not a trustworthy key detector.

### The trinity: KEY + BASS + TAB, used together

The single biggest quality jump comes from combining three signals, none of
which is sufficient alone:

- **KEY** tells you the 7-note scale and each degree's default quality.
- **BASS** tells you, beat by beat, which note is in the low end and when it
  changes — i.e. timing and the *candidate* root.
- **TAB** tells you the actual chord vocabulary, so an ambiguous bass note
  resolves to a real chord the song uses.

**Bass note ≠ chord root (the inversion rule).** On a descending or oscillating
bassline the bass plays chord *inversions*, and mapping each bass note straight
to a root chord is simply wrong. On The Ark's "Calleth You, Cometh I" the intro
riff bass walks C→B→A→B; the naive root map produced `C Bm Am Bm`, but the real
chords are `C G/B Am G/B` — the **B is the 3rd of G**, a `G/B` slash, and `Bm`
is not in the song at all. The fix: reconcile every bass note against the tab's
**chord vocabulary** — if the note is a vocabulary chord's root, use root
position; if it is a vocabulary chord's **3rd or 5th**, use that chord as a
slash (`G/B`, `D/F#`); break ties toward the stronger diatonic function (for the
note B in C major, `G` (V) beats `Em` (iii)). Two red flags that you are forcing
roots instead of reading inversions: a chord that is **not in the tab**, or a
chord that is **not diatonic to the key**. Both were true of that `Bm`.

The agent's music theory supplies **quality** (in a detected key, map each bass
root to its diatonic chord: in A major, A/D/E major, B/F#/C# minor) and
**structure/consistency** (repeated choruses get the same chords). Aligned
lyrics supply **timing**. That combination — key + bass root + tab vocabulary +
inversion reconciliation + lyric timing — is the strong pipeline.

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
`rankTriadFitsForChroma` (`suggestFromChroma.ts`, `CHORD_IN_KEY_BIAS 1.22`) and
determines every chord's default quality. Get it wrong and the whole chart is a
semitone off on three degrees.

**Detect the key from the BASS, not the mix chroma.** The mix-chroma detectors
are unreliable on real recordings: `chordHints.detectedKey` (Krumhansl on the
mix) and `fitKeyFromChroma` both called Sommartider **A minor at 0.01–0.02
confidence when it is plainly A major**, and forcing the minor scale produces
junk. The bass roots ARE the chord roots, so the reliable method is:

1. Histogram the detected bass pitch classes over the whole song.
2. Find the major-scale root **R** whose scale best *contains* that histogram —
   maximize in-scale mass, penalise out-of-scale mass (`inMass − 1.6·outMass`),
   with a Krumhansl-major correlation as a tiebreak. This picks the right
   7-note SET; because relative major/minor share that set (and therefore the
   same diatonic triads), the chords are correct regardless of the tonic label.
   Label it as the relative minor when that root carries more bass mass — purely
   cosmetic.

**The tab is the arbiter of the true key.** Scale-from-bass is fooled by
chromatic chords: a song in C major that uses a `D` (secondary dominant, V/V)
injects an F#, which dragged "Calleth You, Cometh I" one step to a wrong G-major
detection. The song is functionally C major (it resolves to C, and the tab is in
C). So: detect from bass, but when the tab's stated key disagrees, **trust the
tab** and check whether the extra accidental is just a secondary-dominant note.

Fallback priority when there is no bass stem: existing `keyDetail` →
`chordHints.detectedKey` only if `confidence ≥ 0.15` (rare) → the tab's stated
key → `fitKeyFromChroma` (`keyDetect.ts`). Record which source was used.

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

### Stage 4a — Bass-driven chords (the primary path when a bass stem exists)
If the song has a separated bass stem (`stemRefs.Bass`, e.g.
`stems/best/bass.wav`), derive chords from it directly — this was the single
biggest quality jump found. There is no client-side `bassMidi` unless the
sidecar analysed it, but the stem WAV can be read and pitch-detected in a
script:

1. Decode the bass WAV to mono PCM.
2. For each beat, take a ~90 ms window ~15 ms after `beat.timeSec`, Hann-window
   it, autocorrelate, and pick the lag peak in the 38–330 Hz range → frequency →
   MIDI → pitch class. Skip windows below an RMS floor (silence).
3. Take the **per-bar mode** of the beat pitch classes (a bass walk within a
   chord must not trigger a chord change), giving one bass note per bar; place a
   chord only where it changes, on the downbeat.
4. **Turn the bass note into a chord by reconciling it against the tab's
   vocabulary + key — do NOT map it straight to a diatonic root.** For each of
   the song's vocabulary chords (from Stage 2), score the bass note: it is the
   chord's root (best), its 5th, or its 3rd (both = an inversion / slash), or no
   fit. Pick the best-scoring chord; render root position plainly (`Am`) and an
   inversion as a slash (`G/B`, `D/F#`); break ties toward the stronger diatonic
   function. This is what produced `C G/B Am G/B` instead of the wrong
   `C Bm Am Bm` on "Calleth You, Cometh I". When there is genuinely no tab, fall
   back to the plain diatonic map of the key (`A major: A Bm C#m D E F#m`), but
   know that this fallback cannot see inversions and will mis-call descending
   basslines.

Two calibrations that mattered: per-BAR mode over per-beat placement (passing
notes jitter otherwise), and vocabulary/inversion reconciliation over a raw
diatonic-root map (descending basslines break the raw map). A quality
cross-check from the guitar/`other` stem (compare the major-third vs minor-third
chroma bin at the root) was tested and is **too noisy to trust** (2 of 9 known
chords wrong) — the tab's vocabulary is the right source for quality and for
inversions, not the guitar stem.

### Stage 4b — Sheet placement (when there is no bass stem, or for extensions)
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
`toCollabSongMap` for a cloud push. **Use fresh unique ids for every chord**
(e.g. `crypto.randomUUID()`); a script that resets or reuses chord ids across
runs will collide and the by-id merge will silently drop content.

**The AI draft's id is the exception — keep it STABLE across re-runs.** Draft
merge is by id and union-biased. If you regenerate and push the "AI chords"
draft with a *fresh* id each time, a client that already pulled the previous one
will merge the two as separate drafts and rename yours "AI chords 2" — then
autosave that duplicate back to the cloud (observed live). So on a re-run:
strip every existing draft whose name starts with "AI chords" and re-add with a
**stable id reused across runs** (or overwrite the currently-active AI draft in
place, keeping its id). That makes a re-push an in-place update, not a duplicate.
Note a watching client may still show the stale copy until it reloads, because
the pull merge will not delete a draft the client still holds locally.

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
