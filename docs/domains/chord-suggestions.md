# Chord Suggestions

The detailed working note lives next to the implementation:
[`../../src/lib/chords/SUGGESTIONS_README.md`](../../src/lib/chords/SUGGESTIONS_README.md).

Use this file as the stable entrypoint and keep implementation experiments in
the local chord README.

## Current Shape

- Python sidecar extracts beat-aligned chroma in
  [`../../desktop/native/python/sections/chord_chroma.py`](../../desktop/native/python/sections/chord_chroma.py).
  When a demucs "other" (harmonic) stem is on disk the analyzer reads
  that clean stem instead of the full mix (`ANALYZER_VERSION` 3,
  input-only change). Cache records `chordHints.analyzerSource`.
- Cached analyzer output lives in `SongMapV1.chordHints`.
- Client-side suggestion ranking lives in
  [`../../src/lib/chords/suggestFromChroma.ts`](../../src/lib/chords/suggestFromChroma.ts):
  triad-only chroma fit × 1.15 diatonic bias × 1.40 same-kind-section
  bias (the section bias copies an earlier same-kind section's
  user-placed chord). Each bias is toggleable via `SuggestOptions`.
- Suggestions are surfaced in the timeline and chord radial picker
  (primary + up to 4 alternates + a 7th-variants row).
- [`/debug/chord-bias`](../../src/routes/debug/chord-bias/+page.svelte)
  is an A/B harness scoring each bias config against user-placed chords.

## Known Product Truth

The current system is useful but not high-confidence enough for bulk silent
acceptance. Treat it as a manual chord placement accelerator:

- ghost suggestions should remain visibly tentative
- commit paths should be explicit
- future batch/section acceptance needs preview-first UX

## Highest-Value Next Work

Done since last revision: stem-aware chroma, same-kind-section bias,
7th *variants* in the radial, and the `/debug/chord-bias` A/B harness.
Remaining:

1. Detect half-bar two-chord cases.
2. Add one-click ghost commit affordances.
3. Add maj7/min7/dom7/sus templates **to the matcher** (the radial only
   offers variants of the suggested root; the model can't detect a 7th).
4. Revisit section-level accept with clear preview.
5. Per-section key fit / modulation detection (the section bias reuses
   patterns but does not detect modulation).

Do not depend on private local plan files such as `~/.claude/...`; copy any
still-useful decision history into tracked docs.
