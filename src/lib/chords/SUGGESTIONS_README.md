# Chord suggestion system — state of play

> Heads-up for the next agent: **the system works end-to-end but the
> quality and the per-chord-click UX are both weak**. This doc captures
> where things stand, what's been tried, and the obvious follow-ups so
> you don't re-derive the context from scratch.

## What's built

Two phases shipped, both gated behind chords mode in the editor.

### Phase 1 — chroma extraction + whole-song key detection

- Python sidecar (`desktop/native/python/sections/chord_chroma.py`)
  loads audio, runs a **custom STFT-based pitch-class binning** (NOT
  librosa chroma — see "Failed attempts" below), aggregates per beat,
  and fits 24 Krumhansl–Kessler templates via Pearson correlation.
- Output cached in `.smap` as `chordHints.beatChroma: number[][]`
  (12-d L1-normalized vector per beat) + `chordHints.detectedKey`.
  Same fingerprint/version invalidation pattern as
  [`SectionBorderHints`](../songmap/types.ts).
- Auto-triggers on first chords-mode entry (mirroring section-border
  analysis); cache hit on subsequent visits.
- Detected key surfaced as an inline hint next to the manual key picker
  in [`src/routes/edit/+page.svelte`](../../routes/edit/+page.svelte);
  cold-start auto-fills the key picker at confidence ≥ 0.15.

### Phase 2 — per-bar chord suggestions (current file)

- [`suggestFromChroma.ts`](./suggestFromChroma.ts) — pure, client-side.
  Averages each bar's beat chromas, fits against 24 **triad-only**
  templates (12 major + 12 minor) with Pearson + a **1.15× diatonic
  bonus** when a song key is set.
- `proposeChordSuggestions(songMap) → Map<downbeatId, ChordSuggestion>`
  is `$derived` in `+page.svelte` (no caching — recomputes on songMap
  changes). Returns primary + 2 alternates per bar.
- Ghost chord text in
  [`TimelineBeatGrid.svelte`](../components/TimelineBeatGrid.svelte) at
  each bar's downbeat where confidence ≥ `MIN_SUGGESTION_CONFIDENCE`
  (0.02). Tier styling: high (≥0.10) semi-bold/55%, medium (≥0.05)
  italic/40%, low italic/30%+"?".
- [`ChordRadialQuickSelect.svelte`](../components/ChordRadialQuickSelect.svelte)
  shows a "✨ Suggested" panel above the clock when the selected beat
  has a suggestion: prominent primary commit button + 2 alternates.
  Reuses the existing `commitChord` path (no new writer).

## Known weaknesses (the "pretty bad" part)

### 1. The suggestions just aren't very good

Several stacked weaknesses, not yet diagnosed in isolation:

- **The chroma is crude.** We hand-rolled STFT-magnitude → pitch-class
  binning with 1/f weighting and an 80–4000 Hz pass band because
  `librosa.feature.chroma_stft` and `chroma_cqt` both SIGKILL'd
  natively on Apple Silicon. A real CQT or HPSS-preprocessed chroma
  would likely be much sharper.
- **Triads only.** Real pop / R&B leans on maj7, min7, dom7, sus4.
  Right now `Cmaj7` audio fits "C major triad" best — correct *root*,
  often wrong *quality*.
- **No harmonic separation.** Drums + vocals dominate the chroma in
  most mixes. HPSS or stem-aware analysis (we already have htdemucs
  stems!) would isolate the harmonic content first.
- **Per-bar only.** Songs with two chords per bar (very common —
  "F | G | Am C | …") get the wrong second chord guaranteed because
  the bar-averaged chroma blends them.
- **No tuning correction.** Songs recorded at A=442 or with vinyl
  pitch drift end up with chroma energy split across adjacent pitch
  classes. librosa's tuning estimator exists; we don't use it.

### 2. The UX is one-chord-at-a-time, which is slow

The user explicitly rejected bulk acceptance (their words: "this is a
manual chord placement tool with suggestions"). So we render ghost
text + offer 2-click commit via the radial. That's the speed ceiling
for 150 bars per song = 300 clicks.

This was a deliberate choice but **the user themselves has flagged it
as too slow.** Future work should revisit the model:

- 1-click ghost acceptance (small ✓ affordance next to each ghost,
  distinct hit-target from the cell click). Already noted as a follow-up
  in the plan file.
- Section-level "Accept all" with a *preview* (ghost text already
  shown — banner just commits them). User rejected this once but might
  reconsider once they see how slow per-bar is in practice.
- Keyboard mode: arrow keys to advance bars, Enter to accept ghost,
  letter keys for manual entry. Fastest model for power users.

### 3. Confidence calibration is guessed, not tuned

The 0.10 / 0.05 / 0.02 confidence tiers (high / medium / low / hidden)
were picked from the K-K key-detection margins observed during
debugging. Per-bar triad fits may have a different margin
distribution. If you see lots of low-conf "?" tags on a song that's
actually unambiguous, the tiers need recalibration.

### 4. Out-of-key songs

The 15% diatonic bias helps pop in C major but penalizes modal /
modulating music. Per-section key (Phase 3 in the plan file) would
help. Right now: if your song modulates, you'll get systematically
wrong suggestions in the new key. Workaround: change the song key
manually before working on that section.

## Failed attempts / why

- **librosa `chroma_stft` and `chroma_cqt`**: both SIGKILL'd natively
  on macOS arm64 with our librosa/numpy stack. Can't `try/except` a
  SIGKILL from Python. Hand-rolled FFT binning was the workaround.
  Retest if you ever upgrade librosa or move to a different arch.
- **Cosine similarity (Phase 1 v1)**: produced margins so tight that
  nearly every song fell below the confidence floor. Pearson
  correlation (which is what Krumhansl–Schmuckler originally used)
  is much sharper. See the v1→v2 bump in
  [`chord_chroma.py`](../../../desktop/native/python/sections/chord_chroma.py)
  and [`keyDetect.ts`](./keyDetect.ts).
- **Header-based JSON payload for beats**: HTTP 431 (request header
  too large) on songs with >~400 beats. Switched to length-prefixed
  binary body in the sidecar endpoint.
- **Per-beat suggestions**: ruled out during planning. ~1200 ghost
  cells overwhelm the UI and per-beat chroma is noisier than per-bar.
  Per-bar still feels correct as a default; per-half-bar is the
  natural refinement for songs that change mid-bar.

## Files at a glance

| File | What it does |
|---|---|
| [`suggestFromChroma.ts`](./suggestFromChroma.ts) | Per-bar chord matching, diatonic bias, Map output |
| [`suggestFromChroma.test.ts`](./suggestFromChroma.test.ts) | 12 unit tests (bias direction, aggregation, floor, flats) |
| [`keyDetect.ts`](./keyDetect.ts) | K-K key fit + tonic→note spelling. `pearson()` lives here |
| [`pitchClass.ts`](./pitchClass.ts) | `NoteName + Accidental` ↔ 0–11 pitch class |
| [`diatonic.ts`](./diatonic.ts) | `MAJOR_SCALE` / `MINOR_SCALE`, `songKeyPreferFlats` |
| [`../songmap/types.ts`](../songmap/types.ts) | `ChordHints` cache shape on `SongMapV1` |
| [`../../../desktop/native/python/sections/chord_chroma.py`](../../../desktop/native/python/sections/chord_chroma.py) | Sidecar STFT → chroma → key fit |
| [`../components/TimelineBeatGrid.svelte`](../components/TimelineBeatGrid.svelte) | Ghost text render in the chord strip |
| [`../components/ChordRadialQuickSelect.svelte`](../components/ChordRadialQuickSelect.svelte) | "✨ Suggested" panel above the clock |
| [`../../routes/edit/+page.svelte`](../../routes/edit/+page.svelte) | `chordSuggestions`, `chordSuggestionByBeatId`, `activeBeatSuggestion` derived state + wiring |

## Suggested next moves (by impact ÷ effort)

1. **HPSS or stem-aware chroma** — we already separate stems via
   demucs in mix mode. Feeding only the harmonic stems (or the "other"
   stem, which is usually guitar/piano) to the chroma analyzer should
   give a dramatically cleaner signal with no library risk. Probably
   the single biggest accuracy win available.
2. **Half-bar slicing for high-confidence "this bar has 2 chords"
   detection** — split each bar into two windows, fit both, only emit
   the half-bar pair if both halves are confident *and* clearly
   different. Falls back to bar-level otherwise. Doubles the
   2-chord-per-bar coverage without doubling noise.
3. **1-click ghost commit affordance** — small ✓ badge next to each
   ghost; click commits without opening the radial. The user has
   flagged the current pace as too slow. Cheapest UX win.
4. **maj7 / min7 / dom7 templates** — +24 templates (~36 total with
   weights). Detect when chroma supports a 7th. Worth it for any
   song with even mild jazz / R&B leanings.
5. **Reconsider section accept with preview** — bring back to the
   user with the ghosts in place as the preview surface. The original
   objection ("auto-fill") doesn't apply when the user can see exactly
   what would land before clicking.
6. **Per-section key fit / modulation detection** — Phase 3 in the
   plan file. Needed for any song that doesn't stay in one key.

## Plan-file reference

The full design history is in
`~/.claude/plans/ok-next-up-is-iridescent-hummingbird.md`. It's been
overwritten as planning has progressed; current contents are the
Phase 2 plan. Earlier phases (Phase 1 + chord auto-fill from earlier
sessions) live only in git history.
