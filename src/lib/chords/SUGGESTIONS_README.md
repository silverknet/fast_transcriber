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
  templates (12 major + 12 minor) with Pearson, then applies up to two
  multiplicative biases:
  - **1.15× diatonic bonus** when a song key is set;
  - **1.40× same-kind-section bonus** — copies the chord the user
    placed at the matching beat of an *earlier* same-kind section
    (`sameKindChordAtMatchingBeat` in [`autoFill.ts`](./autoFill.ts)).
    Exploits the pop convention that Verse 2 reuses Verse 1's pattern.
- `proposeChordSuggestions(songMap, opts?) → Map<downbeatId, ChordSuggestion>`
  is `$derived` in `+page.svelte` (no caching — recomputes on songMap
  changes). Returns primary + up to 4 alternates per bar
  (`SUGGESTION_TOP_N = 5`). The optional `SuggestOptions`
  (`useDiatonicBias` / `useSectionBias`) toggle each bias for the A/B
  harness; production passes none → both on.
- Ghost chord text in
  [`TimelineBeatGrid.svelte`](../components/TimelineBeatGrid.svelte) at
  each bar's downbeat where confidence ≥ `MIN_SUGGESTION_CONFIDENCE`
  (0.02). Tier styling: high (≥0.10) semi-bold/55%, medium (≥0.05)
  italic/40%, low italic/30%+"?".
- [`ChordRadialQuickSelect.svelte`](../components/ChordRadialQuickSelect.svelte)
  shows a "✨ Suggested" panel above the clock when the selected beat
  has a suggestion: prominent primary commit button + up to 4 alternates
  + a **7th-variants row** (maj7/7 for a major root, m7 for a minor
  root) so the right quality is one click away despite triad-only
  matching. Reuses the existing `commitChord` path (no new writer).

### Phase 2.5 — stem-aware chroma + bias A/B harness (shipped)

- **Stem-aware input.** When a demucs "other" (harmonic) stem is on
  disk for the song, the analyzer reads that clean stem instead of the
  full mix — the biggest single accuracy unlock. `resolveOtherStemAbsPath`
  in `+page.svelte` resolves it via `selectBestStemSet`; the sidecar
  validates the path (absolute + readable) and feeds it to the
  *unchanged* Python. `chord_chroma.py` `ANALYZER_VERSION` bumped 2→3
  (input-only, no algorithm change) to invalidate v2 caches; the cache
  records `chordHints.analyzerSource: 'stems-other' | 'mix'`.
- **A/B harness.** [`/debug/chord-bias`](../../routes/debug/chord-bias/+page.svelte)
  scores each bias config (chroma-only → +diatonic → +section →
  production) against the user's hand-placed chords on the loaded song.
  Caveat baked into the page: the section column is partly
  self-referential (it reads user chords), so read it as "how much does
  pattern-reuse help", not acoustic-model quality.

## Known weaknesses (the "pretty bad" part)

### 1. The suggestions just aren't very good

Several stacked weaknesses, not yet diagnosed in isolation:

- **The chroma is crude.** We hand-rolled STFT-magnitude → pitch-class
  binning with 1/f weighting and an 80–4000 Hz pass band because
  `librosa.feature.chroma_stft` and `chroma_cqt` both SIGKILL'd
  natively on Apple Silicon. A real CQT or HPSS-preprocessed chroma
  would likely be much sharper.
- **Triads only (matcher).** The chroma matcher still ranks 24
  triad templates, so `Cmaj7` audio fits "C major triad" best — correct
  *root*, often wrong *quality*. **Partially mitigated** by the radial's
  7th-variants row (one-click maj7/7/m7 of the suggested root), but the
  *acoustic model* still can't detect a 7th. Real 7th/sus templates in
  the matcher remain open.
- **Harmonic separation — addressed (Phase 2.5).** When a demucs
  "other" stem is on disk the analyzer reads it instead of the full mix,
  isolating harmonic content. Songs without stems still fall back to the
  muddy full-mix path.
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
| [`suggestFromChroma.ts`](./suggestFromChroma.ts) | Per-bar chord matching, diatonic + section bias, `SuggestOptions`, Map output |
| [`suggestFromChroma.test.ts`](./suggestFromChroma.test.ts) | Unit tests (bias direction + section bias, aggregation, floor, flats) |
| [`autoFill.ts`](./autoFill.ts) | `sameKindChordAtMatchingBeat` (section-bias source) + auto-fill proposals |
| [`autoFill.test.ts`](./autoFill.test.ts) | Unit tests for section-match lookup + auto-fill |
| [`../../routes/debug/chord-bias/+page.svelte`](../../routes/debug/chord-bias/+page.svelte) | Bias A/B harness — scores each config vs user-placed chords |
| [`keyDetect.ts`](./keyDetect.ts) | K-K key fit + tonic→note spelling. `pearson()` lives here |
| [`pitchClass.ts`](./pitchClass.ts) | `NoteName + Accidental` ↔ 0–11 pitch class |
| [`diatonic.ts`](./diatonic.ts) | `MAJOR_SCALE` / `MINOR_SCALE`, `songKeyPreferFlats` |
| [`../songmap/types.ts`](../songmap/types.ts) | `ChordHints` cache shape on `SongMapV1` |
| [`../../../desktop/native/python/sections/chord_chroma.py`](../../../desktop/native/python/sections/chord_chroma.py) | Sidecar STFT → chroma → key fit |
| [`../components/TimelineBeatGrid.svelte`](../components/TimelineBeatGrid.svelte) | Ghost text render in the chord strip |
| [`../components/ChordRadialQuickSelect.svelte`](../components/ChordRadialQuickSelect.svelte) | "✨ Suggested" panel above the clock |
| [`../../routes/edit/+page.svelte`](../../routes/edit/+page.svelte) | `chordSuggestions`, `chordSuggestionByBeatId`, `activeBeatSuggestion` derived state + wiring |

## Suggested next moves (by impact ÷ effort)

> Done since the last revision: stem-aware chroma (was #1), 7th
> *variants* in the radial (a partial take on the old #4), the
> same-kind-section bias, and the `/debug/chord-bias` A/B harness.
> The four below are what genuinely remains.

1. **Half-bar slicing for high-confidence "this bar has 2 chords"
   detection** — split each bar into two windows, fit both, only emit
   the half-bar pair if both halves are confident *and* clearly
   different. Falls back to bar-level otherwise. Doubles the
   2-chord-per-bar coverage without doubling noise.
2. **1-click ghost commit affordance** — small ✓ badge next to each
   ghost; click commits without opening the radial. The user has
   flagged the current pace as too slow. Cheapest UX win.
3. **maj7 / min7 / dom7 / sus templates in the matcher** — +templates
   so the *acoustic model* can detect a 7th, not just offer it as a
   variant. The radial variant-row mitigates this for the suggested
   root but can't surface a 7th the chroma actually implies elsewhere.
4. **Reconsider section accept with preview** — bring back to the
   user with the ghosts in place as the preview surface. The original
   objection ("auto-fill") doesn't apply when the user can see exactly
   what would land before clicking.
5. **Per-section key fit / modulation detection** — Phase 3 in the
   plan file. Needed for any song that doesn't stay in one key. The
   same-kind-section bias helps reuse but does not detect modulation.

## Documentation entrypoint

The stable agent-facing entrypoint is
[`docs/domains/chord-suggestions.md`](../../../docs/domains/chord-suggestions.md).
Keep any future decision history in tracked docs rather than private local
planning files.
