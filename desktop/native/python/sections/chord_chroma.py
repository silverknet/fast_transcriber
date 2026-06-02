#!/usr/bin/env python3
"""
Per-beat chroma analyzer + song-level key detection.

Reads an audio file path on argv[1] and a JSON
`{ "beats": [{ "startSec": ... }, ...] }` from stdin (beat times in the
file-absolute timeline — caller should pre-apply any trim offset).

Prints to stdout:

```json
{
  "beatChroma": [[12 floats], [12 floats], ...],   // one per beat
  "detectedKey": { "tonic": 0-11, "mode": "major"|"minor", "confidence": 0.XX }
                 | null
}
```

Pipeline:
  1. Load mono audio (22050 Hz).
  2. STFT magnitude (librosa.stft — well-tested, no native crashes).
  3. Custom pitch-class binning: each FFT bin → its nearest semitone → 1 of
     12 pitch classes. Avoids `librosa.feature.chroma_*` which has SIGKILL'd
     on Apple Silicon with this librosa/numpy stack — and SIGKILL can't be
     caught from Python, so we just don't go there.
  4. For each beat: slice ±150 ms of chroma frames, average, L1-normalize.
  5. Average all per-beat chromas → fit 24 Krumhansl–Kessler templates
     (12 major + 12 minor, rotated). Top match with margin = detectedKey.

Dependencies: librosa (ISC), numpy (BSD-3). No GPL/AGPL.
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import List


# ----- Tunables -----------------------------------------------------------

SAMPLE_RATE = 22050
HOP_LENGTH = 512
N_FFT = 2048

# Half-width of the audio window centered on each beat used to average chroma
# frames. ±150 ms covers most beat durations at typical tempos and bridges the
# inevitable few-ms timing wobble between the user's beat grid and the audio.
BEAT_WINDOW_SEC = 0.15

# Pitch-class binning range. Below 80 Hz the FFT bin resolution is too coarse
# (a 2048-pt FFT at 22050 Hz has 10.8 Hz/bin — that's almost a whole semitone
# at low E). Above 5 kHz is mostly cymbals + noise. The 80–4000 Hz window
# corresponds roughly to the fundamental range of most chord-bearing
# instruments (guitar, piano, bass-heavy mixes still light up via harmonics).
MIN_BIN_HZ = 80.0
MAX_BIN_HZ = 4000.0

# Per-bin weighting: emphasize the middle pitch range where chord tones
# dominate over drum/noise energy. A simple 1/f weighting (so 200 Hz counts
# more per-magnitude-unit than 2000 Hz) is enough to suppress cymbal hash.
USE_INVERSE_FREQ_WEIGHTING = True

# Confidence floor: below this, we return detectedKey=null. Krumhansl–Schmuckler
# correlations on real music typically produce best-vs-runner-up margins of
# 0.05–0.20; the floor catches "two keys tied" cases (atonal / very modal
# / extremely loud drums drowning out tonal content).
KEY_CONFIDENCE_FLOOR = 0.02

# Bump when the algorithm changes meaningfully (window size, chroma binning,
# K-K templates, similarity metric, etc.) so cached `chordHints.analyzerVersion`
# mismatches and clients re-run analysis. Keep in sync with CHORD_ANALYZER_VERSION
# in src/routes/edit/+page.svelte.
#   v1: cosine similarity. Too flat — almost everything fell below the floor.
#   v2: Pearson correlation (the original K-S formulation) + lower floor +
#       aggressive bass cut + harmonic weighting; diagnostic logging.
ANALYZER_VERSION = 2


# Krumhansl–Kessler probe-tone profiles (Kostka–Payne corrected). Indexed
# starting at C; rotate to align with other tonics.
KK_MAJOR = (
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
)
KK_MINOR = (
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
)


# ----- Implementation ----------------------------------------------------


def _read_beats_json() -> List[dict]:
    """Parse `{ "beats": [...] }` from stdin. Each beat must have `startSec`."""
    payload = sys.stdin.read()
    if not payload.strip():
        return []
    obj = json.loads(payload)
    beats = obj.get("beats") or []
    out = []
    for b in beats:
        if not isinstance(b, dict):
            continue
        start = b.get("startSec")
        if start is None:
            continue
        out.append({"startSec": float(start)})
    return out


def _empty(reason: str = "", beat_count: int = 0) -> None:
    payload = {
        "beatChroma": [[0.0] * 12 for _ in range(beat_count)],
        "detectedKey": None,
    }
    if reason:
        payload["note"] = reason
    print(json.dumps(payload))


def _log(msg: str) -> None:
    """Stderr breadcrumbs, flushed immediately so they survive a signal-kill."""
    print(f"[chord_chroma] {msg}", file=sys.stderr, flush=True)


def main() -> None:
    _log(f"starting (python {sys.version.split()[0]}, argv={sys.argv[1:]})")
    if len(sys.argv) < 2:
        print("Usage: chord_chroma.py <audio_path>", file=sys.stderr)
        sys.exit(2)

    audio_path = sys.argv[1]

    try:
        beats = _read_beats_json()
    except json.JSONDecodeError as exc:
        print(f"Invalid beats JSON on stdin: {exc}", file=sys.stderr)
        sys.exit(3)
    _log(f"read {len(beats)} beats from stdin")

    if not beats:
        _empty("no beats")
        return

    _log("importing numpy + librosa")
    try:
        import numpy as np
        import librosa
    except ImportError as exc:
        print(
            f"Missing dependency ({exc.name}). "
            "The sections venv should auto-install on first chords-mode entry; "
            "it is managed by the bundled uv (Astral).",
            file=sys.stderr,
        )
        sys.exit(4)
    _log(f"imports OK (librosa {librosa.__version__}, numpy {np.__version__})")

    _log(f"loading audio: {audio_path}")
    try:
        y, sr = librosa.load(audio_path, sr=SAMPLE_RATE, mono=True)
    except Exception as exc:
        print(f"Failed to load audio: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(5)
    _log(f"audio loaded: {y.size} samples @ {sr} Hz ({y.size / sr:.1f}s)")

    if y.size == 0:
        _empty("empty audio", len(beats))
        return

    # -- STFT magnitude --------------------------------------------------
    #
    # librosa.stft works (it's a thin wrapper around numpy FFT). It's
    # `librosa.feature.chroma_stft` / `chroma_cqt` that have crashed
    # natively (SIGKILL, uncatchable from Python). We do the pitch-class
    # binning by hand below.
    _log(f"computing STFT (n_fft={N_FFT}, hop={HOP_LENGTH})")
    S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP_LENGTH))  # (n_bins, T)
    n_bins, n_frames = S.shape
    _log(f"STFT shape {S.shape}")

    # -- pitch-class binning --------------------------------------------
    #
    # Each FFT bin has a center frequency. Convert to MIDI pitch
    # (12*log2(f/440)+69), take mod 12, and accumulate magnitude into the
    # corresponding pitch class. Bins outside [MIN_BIN_HZ, MAX_BIN_HZ] are
    # skipped (sub/cymbal noise that doesn't carry chord information).
    freqs = np.fft.rfftfreq(N_FFT, d=1.0 / sr)
    chroma = np.zeros((12, n_frames), dtype=np.float32)
    accumulated = 0
    for k in range(n_bins):
        f = freqs[k]
        if f < MIN_BIN_HZ or f > MAX_BIN_HZ:
            continue
        midi = 12.0 * np.log2(f / 440.0) + 69.0
        pc = int(round(midi)) % 12
        weight = (200.0 / f) if (USE_INVERSE_FREQ_WEIGHTING and f > 0) else 1.0
        chroma[pc] += S[k] * weight
        accumulated += 1
    _log(f"chroma binned ({accumulated} bins accumulated)")

    if float(chroma.max()) <= 0:
        _empty("silent / no spectral energy", len(beats))
        return

    # -- per-beat chroma -------------------------------------------------
    frames_per_sec = sr / HOP_LENGTH
    window_frames = max(1, int(BEAT_WINDOW_SEC * frames_per_sec))

    beat_chroma_out: List[List[float]] = []
    for beat in beats:
        t = beat["startSec"]
        center = int(t * frames_per_sec)
        f0 = max(0, center - window_frames)
        f1 = min(n_frames, center + window_frames + 1)
        if f1 <= f0:
            beat_chroma_out.append([0.0] * 12)
            continue
        window = chroma[:, f0:f1].mean(axis=1)  # (12,)
        s = float(window.sum())
        if s > 0:
            window = window / s
        beat_chroma_out.append([float(round(v, 4)) for v in window])

    _log(f"computed per-beat chroma for {len(beat_chroma_out)} beats")

    # -- key detection (Krumhansl–Schmuckler / Pearson correlation) -----
    avg = np.array(beat_chroma_out, dtype=np.float64).mean(axis=0)  # (12,)
    avg_l1 = avg.sum()
    if avg_l1 > 0:
        avg_norm = avg / avg_l1  # display normalization (sums to 1)
    else:
        avg_norm = avg
    _log(
        "avg chroma (C..B): "
        + ", ".join(f"{v:.3f}" for v in avg_norm)
    )
    detected_key, scoreboard = _fit_key(np, avg)
    top3 = scoreboard[:3]
    _log(
        "top-3 key candidates: "
        + ", ".join(
            f"{_pitch_name(t)}{'M' if m == 'major' else 'm'}={s:.3f}"
            for (t, m, s) in top3
        )
    )
    if detected_key is not None:
        _log(
            f"detected key: tonic={detected_key['tonic']} "
            f"mode={detected_key['mode']} "
            f"confidence={detected_key['confidence']:.3f}"
        )
    else:
        _log("no key passed confidence floor")

    print(
        json.dumps(
            {
                "beatChroma": beat_chroma_out,
                "detectedKey": detected_key,
            }
        )
    )


_PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _pitch_name(tonic):
    return _PITCH_NAMES[int(tonic) % 12]


def _fit_key(np_mod, avg_chroma):
    """
    Fit `avg_chroma` (12-d, any non-negative scale) against the 24 K-K
    templates with Pearson correlation — the original Krumhansl–Schmuckler
    formulation. Correlation centers each vector by its mean, so it
    rewards "matches the SHAPE of the template" rather than overall
    magnitude — much sharper than cosine here.

    Returns `(detected_key | None, scoreboard)` where scoreboard is a list
    of (tonic, mode, score) sorted descending by score (for diagnostic
    logging).
    """
    empty_board: list = []
    avg = np_mod.asarray(avg_chroma, dtype=np_mod.float64)
    if avg.shape[0] != 12 or avg.sum() <= 0:
        return None, empty_board
    avg_centered = avg - avg.mean()
    avg_std = float(np_mod.sqrt(np_mod.sum(avg_centered ** 2)))
    if avg_std <= 0:
        return None, empty_board

    major = np_mod.asarray(KK_MAJOR, dtype=np_mod.float64)
    minor = np_mod.asarray(KK_MINOR, dtype=np_mod.float64)

    scoreboard: list = []
    for tonic in range(12):
        for mode_name, profile in (("major", major), ("minor", minor)):
            template = np_mod.roll(profile, tonic)
            t_centered = template - template.mean()
            t_std = float(np_mod.sqrt(np_mod.sum(t_centered ** 2)))
            if t_std <= 0:
                continue
            r = float(np_mod.sum(avg_centered * t_centered) / (avg_std * t_std + 1e-12))
            scoreboard.append((int(tonic), mode_name, r))

    if not scoreboard:
        return None, empty_board
    scoreboard.sort(key=lambda x: x[2], reverse=True)
    best_tonic, best_mode, best_score = scoreboard[0]
    second_score = scoreboard[1][2] if len(scoreboard) > 1 else -1.0

    if best_score <= 0:
        return None, scoreboard
    margin = best_score - second_score
    confidence = max(0.0, min(1.0, margin))
    if confidence < KEY_CONFIDENCE_FLOOR:
        return None, scoreboard
    return (
        {
            "tonic": int(best_tonic),
            "mode": best_mode,
            "confidence": round(confidence, 4),
        },
        scoreboard,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"chord_chroma: unhandled error: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
