#!/usr/bin/env python3
"""
Bass-note transcription from an ISOLATED bass stem (demucs output).

Contract (mirrors transcribe_drums.py):
  argv[1]  audio path — the bass stem. Output times are seconds into THIS
           FILE (untrimmed source timeline, same base as Beat.timeSec).
  stdout   single JSON object:
             {
               "notes": [{"timeSec": 12.3, "durationSec": 0.42,
                          "midi": 40, "velocity": 0.8}],
               "noteCount": 412, "midiLow": 33, "midiHigh": 55,
               "durationSec": 214.2, "analyzerVersion": 1, "note": "?"
             }
  stderr   breadcrumbs.

Method: the bass stem is MONOPHONIC, so classic YIN pitch tracking works:
  1. librosa.yin f0 track (fmin 34 Hz ≈ C#1, fmax 400 Hz).
  2. RMS envelope gates silence (< -42 dB rel. P95).
  3. Median-smoothed midi track; segments split on pitch change (≥1 semitone
     held for a few frames) or on gated silence.
  4. Velocity from segment RMS, P95-normalized per song.

Allowed API surface: librosa.load / librosa.yin / numpy / scipy (yin is
numpy-only in librosa 0.10 — no librosa.feature.*, per the SIGKILL note in
chord_chroma.py).

Exit codes: 2 usage, 5 audio failure, 1 unhandled.
"""

from __future__ import annotations

import json
import sys

import numpy as np

# ── Tunables ─────────────────────────────────────────────────────────────────

SAMPLE_RATE = 22050
FRAME = 2048
HOP = 256  # 11.6 ms

FMIN = 34.0  # ~C#1
FMAX = 400.0  # top of bass-guitar tessitura

SILENCE_DB_REL = -42.0  # below this (rel. P95 RMS) = no note
MIN_NOTE_SEC = 0.06
PITCH_MEDIAN_FRAMES = 5
PITCH_CHANGE_HOLD_FRAMES = 3  # semitone change must persist this long

# Post-pass cleanup: YIN wobbles during note attacks, spitting out a short
# far-away "flake" right before the real note settles (e.g. 80 ms of F3
# before a half-second G1). A flake is short AND a big leap from both
# neighbors; real ghost notes repeat a nearby pitch, so they survive.
FLAKE_MAX_SEC = 0.10
FLAKE_MIN_LEAP = 7  # semitones from BOTH neighbors
MERGE_GAP_SEC = 0.04  # same pitch, gap below this → one sustained note

MIDI_MIN = 24  # C1
MIDI_MAX = 64  # E4 — anything above is bleed/harmonics

# Bump when the algorithm changes enough to invalidate cached notes.
# v1: YIN + RMS gate + median smoothing.
ANALYZER_VERSION = 1


def _log(msg: str) -> None:
    print(f"[bass] {msg}", file=sys.stderr, flush=True)


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: transcribe_bass.py <bass_stem_audio>", file=sys.stderr)
        sys.exit(2)
    path = sys.argv[1]

    _log("importing librosa")
    import librosa
    from scipy.ndimage import median_filter

    try:
        _log(f"loading {path}")
        y, sr = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    except Exception as exc:  # noqa: BLE001
        print(f"Could not read audio: {exc}", file=sys.stderr)
        sys.exit(5)

    duration = float(len(y)) / SAMPLE_RATE
    if duration < 1.0 or float(np.max(np.abs(y)) if len(y) else 0.0) < 1e-4:
        json.dump(
            {
                "notes": [],
                "noteCount": 0,
                "durationSec": round(duration, 2),
                "analyzerVersion": ANALYZER_VERSION,
                "note": "The bass recording is empty or silent.",
            },
            sys.stdout,
        )
        return

    _log(f"yin f0 track ({duration:.1f}s)")
    f0 = librosa.yin(y, fmin=FMIN, fmax=FMAX, sr=SAMPLE_RATE, frame_length=FRAME, hop_length=HOP)

    # Frame RMS for gating + velocity.
    n_frames = len(f0)
    rms = np.zeros(n_frames)
    for i in range(n_frames):
        a = i * HOP
        b = min(len(y), a + FRAME)
        seg = y[a:b]
        rms[i] = np.sqrt(np.mean(seg * seg)) if len(seg) else 0.0
    p95 = float(np.percentile(rms, 95)) + 1e-12
    gate = rms > p95 * (10 ** (SILENCE_DB_REL / 20))

    midi = 69.0 + 12.0 * np.log2(np.maximum(f0, 1e-6) / 440.0)
    midi = median_filter(midi, size=PITCH_MEDIAN_FRAMES)
    midi_round = np.round(midi).astype(int)

    frame_dt = HOP / SAMPLE_RATE
    notes: list[dict] = []
    cur_start: int | None = None
    cur_midi = 0
    cur_rms: list[float] = []

    def close_note(end_frame: int) -> None:
        nonlocal cur_start, cur_rms
        if cur_start is None:
            return
        dur = (end_frame - cur_start) * frame_dt
        if dur >= MIN_NOTE_SEC and MIDI_MIN <= cur_midi <= MIDI_MAX:
            notes.append(
                {
                    "timeSec": round(cur_start * frame_dt, 3),
                    "durationSec": round(dur, 3),
                    "midi": int(cur_midi),
                    "velocity": float(np.median(cur_rms)) if cur_rms else 0.5,
                }
            )
        cur_start = None
        cur_rms = []

    pending_change = 0
    for i in range(n_frames):
        if not gate[i]:
            close_note(i)
            pending_change = 0
            continue
        m = int(midi_round[i])
        if cur_start is None:
            cur_start = i
            cur_midi = m
            cur_rms = [float(rms[i])]
            pending_change = 0
            continue
        if m != cur_midi:
            pending_change += 1
            if pending_change >= PITCH_CHANGE_HOLD_FRAMES:
                # The change is real — close the old note where it started.
                close_note(i - pending_change + 1)
                cur_start = i - pending_change + 1
                cur_midi = m
                cur_rms = [float(rms[i])]
                pending_change = 0
        else:
            pending_change = 0
        cur_rms.append(float(rms[i]))
    close_note(n_frames)

    # Merge same-pitch notes split by a gate flicker.
    merged: list[dict] = []
    for n in notes:
        prev = merged[-1] if merged else None
        if (
            prev is not None
            and prev["midi"] == n["midi"]
            and n["timeSec"] - (prev["timeSec"] + prev["durationSec"]) < MERGE_GAP_SEC
        ):
            prev["durationSec"] = round(n["timeSec"] + n["durationSec"] - prev["timeSec"], 3)
            prev["velocity"] = max(prev["velocity"], n["velocity"])
        else:
            merged.append(n)
    notes = merged

    # Drop attack flakes (short + far from both neighbors).
    kept: list[dict] = []
    for i, n in enumerate(notes):
        if n["durationSec"] <= FLAKE_MAX_SEC:
            prev_m = notes[i - 1]["midi"] if i > 0 else None
            next_m = notes[i + 1]["midi"] if i + 1 < len(notes) else None
            leaps = [abs(n["midi"] - m) for m in (prev_m, next_m) if m is not None]
            if leaps and all(l >= FLAKE_MIN_LEAP for l in leaps):
                continue
        kept.append(n)
    notes = kept

    # Velocity: P95-normalize per song (same convention as drums).
    if notes:
        vp95 = float(np.percentile([n["velocity"] for n in notes], 95)) + 1e-12
        for n in notes:
            n["velocity"] = round(float(np.clip(n["velocity"] / vp95, 0.05, 1.0)), 2)

    midis = [n["midi"] for n in notes]
    _log(f"notes: {len(notes)} range {min(midis) if midis else '-'}..{max(midis) if midis else '-'}")
    json.dump(
        {
            "notes": notes,
            "noteCount": len(notes),
            "midiLow": min(midis) if midis else None,
            "midiHigh": max(midis) if midis else None,
            "durationSec": round(duration, 2),
            "analyzerVersion": ANALYZER_VERSION,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as exc:  # noqa: BLE001
        print(f"Unhandled error: {exc}", file=sys.stderr)
        sys.exit(1)
