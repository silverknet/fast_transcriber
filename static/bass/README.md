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
LIB="$HOME/Music/Logic Pro Library.bundle/Samples/z_Legacy/Bass/Upright Jazz Bass"
```

The source filenames encode pitch (`KBLONS1E1X01` → E1), so the extractor
parses note+octave, keeps the earliest take per pitch for a consistent tone,
and writes `<midi>.wav`. `Fingerstyle Electric Bass` in the same folder is NOT
usable this way — its names (`5IFNFX1X05`) carry no pitch.
