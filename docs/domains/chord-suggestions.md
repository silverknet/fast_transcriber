# Chord Suggestions

The detailed working note lives next to the implementation:
[`../../src/lib/chords/SUGGESTIONS_README.md`](../../src/lib/chords/SUGGESTIONS_README.md).

Use this file as the stable entrypoint and keep implementation experiments in
the local chord README.

## Current Shape

- Python sidecar extracts beat-aligned chroma in
  [`../../desktop/native/python/sections/chord_chroma.py`](../../desktop/native/python/sections/chord_chroma.py).
- Cached analyzer output lives in `SongMapV1.chordHints`.
- Client-side suggestion ranking lives in
  [`../../src/lib/chords/suggestFromChroma.ts`](../../src/lib/chords/suggestFromChroma.ts).
- Suggestions are surfaced in the timeline and chord radial picker.

## Known Product Truth

The current system is useful but not high-confidence enough for bulk silent
acceptance. Treat it as a manual chord placement accelerator:

- ghost suggestions should remain visibly tentative
- commit paths should be explicit
- future batch/section acceptance needs preview-first UX

## Highest-Value Next Work

1. Use harmonic/stem-aware audio before chroma ranking.
2. Detect half-bar two-chord cases.
3. Add one-click ghost commit affordances.
4. Add maj7/min7/dom7/sus templates.
5. Revisit section-level accept with clear preview.

Do not depend on private local plan files such as `~/.claude/...`; copy any
still-useful decision history into tracked docs.
