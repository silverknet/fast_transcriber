# Modern 707 kit (local samples, not committed)

The "Modern 707" entry in the drum kit dropdown looks here for five WAV
one-shots, same contract as the acoustic kit:

    kick.wav  snare.wav  hihat.wav  tom.wav  cymbal.wav  ride.wav

Any file that exists is used; any that's missing falls back to the
synthesized **Electronic kit** voice (not the acoustic one — a drum machine
should degrade to a drum machine).

## Why the WAVs aren't in git

These are sourced from Apple's Logic Pro Sound Library ("Modern TR-707",
`~/Music/Logic Pro Library.bundle/Samples/Drums & Percussion/Electronic
Drums/Modern TR-707/`). Apple's licence covers using those sounds in your
own productions; it does not cover redistributing them inside an app we
ship. So `static/drums/tr707/*.wav` is gitignored — the kit works on a
machine that has Logic installed, and degrades to the synth kit elsewhere.

This is deliberately different from `static/drums/acoustic/`, which is
CC0-only precisely so it *can* be committed and shipped.

## Regenerating them

With Logic's Sound Library installed:

```bash
SRC="$HOME/Music/Logic Pro Library.bundle/Samples/Drums & Percussion/Electronic Drums/Modern TR-707"
DST="static/drums/tr707"
conv() { afconvert -f WAVE -d LEI16@44100 -c 1 "$SRC/$1 - TR-707 Processed.aif" "$DST/$2.wav"; }
conv "Kick 1" kick; conv "Snare 1" snare; conv "Hi-Hat" hihat
conv "Tom Mid" tom; conv "Crash" cymbal; conv "Ride" ride
```

`cymbal` is the CRASH and `ride` is the ride — separate voices, because
the drum machine can move its pulse layer onto the ride.

Alternates in that folder if you want a different character: `Kick 2`
(longer), `Snare 2` (softer), `Hi-Hat Open`, `Tom Low`/`Tom High`, plus
`Rim`, `Cowbell`, `Clap 1`/`Clap 2` and `Tambourine`, which BarBro's
`DrumClass` voices have nowhere to put.

## Known caveat

These are the raw library samples. Logic's *patch* plays them through Quick
Sampler plus Space Designer and Stereo Delay auxes, so Logic sounds fuller
than these files do. To match Logic exactly, bounce the one-shots out of
Logic and drop them in here instead — the filenames are all that matter.
