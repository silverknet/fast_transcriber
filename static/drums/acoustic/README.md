# Acoustic drum kit samples (drop-in)

The "Acoustic kit" for BarBro's generated drum track looks here for five
mono/stereo WAV one-shots:

    kick.wav  snare.wav  hihat.wav  tom.wav  cymbal.wav

Any file that exists is used; any that's missing falls back to a built-in
acoustic-style synthesized voice, so the kit always works.

## Licensing contract (strict)

Only commit samples whose license permits redistribution inside the app
with certainty — in practice **CC0 / public-domain only** (freesound.org
has a CC0 license filter). "Free download" packs with custom terms
(99Sounds, SampleRadar, etc.) do NOT qualify.

For every committed file, record in `LICENSE.md` next to this README:
source URL, file/sound ID, uploader, license (CC0), and retrieval date.

## Processing guidelines

Trim to the onset, short fade-out, 44.1 kHz, 16-bit PCM, peak around
−6 dBFS, mono preferred. Keep the whole kit under ~1 MB (the crash is the
big one — 1.5 s is plenty).
