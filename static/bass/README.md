# Sampled basses (local samples, not committed)

Each folder is one instrument: WAV files named `<midi>.wav`, where the number
is the note the sample was recorded at. The player picks the nearest root and
shifts it, so gaps are fine — you don't need every semitone.

    static/bass/upright/28.wav   # E1
    static/bass/upright/40.wav   # E2   …

## Why the WAVs aren't in git

`upright/` comes from Apple's Logic Sound Library (`z_Legacy/Bass/Upright Jazz
Bass`). Apple's licence covers using those sounds in your own productions, not
redistributing them inside an app we ship — so the audio is gitignored and the
sound simply doesn't appear on a machine without Logic. Same contract as
`static/drums/tr707/`.

## Regenerating

```bash
node scripts/extract-logic-bass.mjs electric   # Fingerstyle Electric Bass
node scripts/extract-logic-bass.mjs upright    # Upright Jazz Bass
```

Both sets encode pitch in their filenames (`KBLONS1E1X01` → E1,
`IBFILA1A1X03` → A1, scientific notation so A1 is MIDI 33). The extractor
parses note+octave, keeps the earliest take per pitch so neighbouring notes
sound like one instrument, and writes mono 44.1 kHz `<midi>.wav`.

`Fingerstyle Electric Bass` was previously written off as unusable because its
folder also holds 22 short unpitched files (`5IFNFX1X05` — slides and fret
noise) whose names carry nothing. The 94 `IBFIL*` files beside them are the
actual notes: 19 distinct pitches, E1–E4. Every filename was verified against
pitch detection before trusting it, and the extracted WAVs measure spectrally
identical to Logic's originals.
