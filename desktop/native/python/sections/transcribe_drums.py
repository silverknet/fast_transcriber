#!/usr/bin/env python3
"""
Drum-hit transcription from an ISOLATED drum stem (demucs output).

Contract (mirrors chord_chroma.py):
  argv[1]  audio path — the drum stem (WAV/MP3). Times in the output are
           seconds into THIS FILE, which demucs guarantees is the full
           untrimmed source timeline (same base as Beat.timeSec).
  stdout   single JSON object:
             {
               "events": [{"timeSec": 12.345, "cls": "kick", "velocity": 0.82}],
               "classCounts": {"kick": 132, ...},
               "durationSec": 214.2,
               "analyzerVersion": 1,
               "note": "optional caveat"
             }
  stderr   breadcrumbs (flushed) for the sidecar log.

Method: band-split half-wave spectral flux + peak picking. This is NOT a
neural transcription — it works because the input is a SOLO drum stem:
  kick   = onset in 30–120 Hz
  snare  = onset in the wire-noise band (1–4 kHz) WITH a coincident tone
           rise at 150–400 Hz (separates snare from toms/kick harmonics)
  tom    = 150–400 Hz onset with NO wire noise and not hugging a kick
  hihat  = high-band (6 kHz+) onset with fast decay
  cymbal = high-band onset that still rings 250–600 ms later

Known v1 limits (documented for honesty): toms are the weakest class;
open hi-hats often classify as cymbal; rolls faster than 20 Hz merge.

IMPORTANT — allowed API surface: `librosa.load` + `librosa.stft` + numpy +
scipy only. `librosa.feature.*` / HPSS have SIGKILL'd on the shipped
librosa/numpy stack (see chord_chroma.py); do not reintroduce them.

Exit codes: 2 usage, 5 audio failure, 1 unhandled.
"""

from __future__ import annotations

import json
import sys

import numpy as np

# ── Tunables ─────────────────────────────────────────────────────────────────

SAMPLE_RATE = 22050
N_FFT = 1024
HOP = 256  # 11.6 ms frame rate — adequate onset resolution for rehearsal drums

BANDS = {
    "kick": (30.0, 120.0),
    "snareTone": (150.0, 400.0),
    "snareNoise": (1000.0, 4000.0),
    "high": (6000.0, 11025.0),
}

# Peak prominence = K × std(flux) per band.
PROMINENCE_K = {"kick": 1.5, "snareNoise": 1.5, "high": 1.2, "snareTone": 1.2}
MIN_DISTANCE_SEC = 0.05  # two hits of one class closer than this merge

SNARE_TONE_COINCIDENCE_FRAMES = 1  # ±frames for the tone-rise check
TOM_KICK_SUPPRESS_SEC = 0.03  # tone peak this close to a kick = kick harmonic
CYMBAL_SUSTAIN_WINDOW = (0.1, 0.35)  # seconds after the hit
CYMBAL_SUSTAIN_RATIO = 0.15  # mean(env in window)/peak above this = cymbal

VELOCITY_FLOOR = 0.05

GHOST_KICK_MAX_VELOCITY = 0.45  # kicks quieter than this, coincident with a snare, are bleed
GHOST_KICK_WINDOW_SEC = 0.02

# Bump when the algorithm changes enough to invalidate stored events.
# v1: initial band-flux transcriber.
ANALYZER_VERSION = 1


def _log(msg: str) -> None:
    print(f"[drums] {msg}", file=sys.stderr, flush=True)


def band_mask(freqs: np.ndarray, lo: float, hi: float) -> np.ndarray:
    return (freqs >= lo) & (freqs < hi)


def half_wave_flux(band_mag: np.ndarray) -> np.ndarray:
    """Σ over bins of max(0, S[t] − S[t−1]) — classic onset flux."""
    d = np.diff(band_mag, axis=1, prepend=band_mag[:, :1])
    return np.maximum(d, 0.0).sum(axis=0)


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: transcribe_drums.py <drum_stem_audio>", file=sys.stderr)
        sys.exit(2)
    path = sys.argv[1]

    _log("importing librosa")
    import librosa  # deferred so usage errors don't pay the import
    from scipy.signal import find_peaks

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
                "events": [],
                "classCounts": {},
                "durationSec": round(duration, 2),
                "analyzerVersion": ANALYZER_VERSION,
                "note": "The drum recording is empty or silent.",
            },
            sys.stdout,
        )
        return

    _log(f"stft ({duration:.1f}s)")
    S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP))
    freqs = np.fft.rfftfreq(N_FFT, d=1.0 / SAMPLE_RATE)
    frame_dt = HOP / SAMPLE_RATE
    min_dist_frames = max(1, int(MIN_DISTANCE_SEC / frame_dt))

    envs: dict[str, np.ndarray] = {}
    fluxes: dict[str, np.ndarray] = {}
    for name, (lo, hi) in BANDS.items():
        mag = S[band_mask(freqs, lo, hi)]
        envs[name] = mag.sum(axis=0)
        flux = half_wave_flux(mag)
        flux = flux / (np.median(flux) + 1e-9)  # loudness-adaptive
        fluxes[name] = flux

    def peaks_of(band: str) -> np.ndarray:
        flux = fluxes[band]
        prom = PROMINENCE_K[band] * float(np.std(flux))
        idx, _ = find_peaks(flux, distance=min_dist_frames, prominence=prom)
        return idx

    kick_peaks = peaks_of("kick")
    noise_peaks = peaks_of("snareNoise")
    tone_peaks = peaks_of("snareTone")
    high_peaks = peaks_of("high")
    _log(
        f"raw peaks: kick={len(kick_peaks)} noise={len(noise_peaks)} "
        f"tone={len(tone_peaks)} high={len(high_peaks)}"
    )

    def frame_time(f: int) -> float:
        # One-hop lag compensation: flux peaks one frame after the true onset.
        return round(max(0.0, (f - 1) * frame_dt), 3)

    def velocities(band: str, frames: np.ndarray) -> np.ndarray:
        flux = fluxes[band]
        heights = flux[frames]
        p95 = float(np.percentile(heights, 95)) if len(heights) else 1.0
        v = heights / (p95 + 1e-9)
        return np.clip(v, VELOCITY_FLOOR, 1.0)

    events: list[dict] = []

    # kick — its band speaks for itself on a solo stem.
    for f, v in zip(kick_peaks, velocities("kick", kick_peaks)):
        events.append({"timeSec": frame_time(int(f)), "cls": "kick", "velocity": round(float(v), 2)})

    # snare — wire noise + coincident tone rise.
    tone_flux = fluxes["snareTone"]
    tone_set = set(int(f) for f in tone_peaks)
    snare_frames: list[int] = []
    for f in noise_peaks:
        f = int(f)
        lo, hi = f - SNARE_TONE_COINCIDENCE_FRAMES, f + SNARE_TONE_COINCIDENCE_FRAMES
        tone_rise = tone_flux[max(0, f)] > 0.5 * float(np.std(tone_flux)) or any(
            t in tone_set for t in range(lo, hi + 1)
        )
        if tone_rise:
            snare_frames.append(f)
    for f, v in zip(snare_frames, velocities("snareNoise", np.array(snare_frames, dtype=int))):
        events.append({"timeSec": frame_time(int(f)), "cls": "snare", "velocity": round(float(v), 2)})

    # tom — tone without wire noise, not hugging a kick.
    kick_times = np.array([frame_time(int(f)) for f in kick_peaks])
    noise_set = set(int(f) for f in noise_peaks)
    tom_frames: list[int] = []
    for f in tone_peaks:
        f = int(f)
        if any(t in noise_set for t in range(f - 2, f + 3)):
            continue  # that's a snare (already counted)
        t = frame_time(f)
        if len(kick_times) and float(np.min(np.abs(kick_times - t))) < TOM_KICK_SUPPRESS_SEC:
            continue  # kick harmonic
        tom_frames.append(f)
    for f, v in zip(tom_frames, velocities("snareTone", np.array(tom_frames, dtype=int))):
        events.append({"timeSec": frame_time(int(f)), "cls": "tom", "velocity": round(float(v), 2)})

    # hihat vs cymbal — decay length in the high band.
    env_high = envs["high"]
    w_lo = int(CYMBAL_SUSTAIN_WINDOW[0] / frame_dt)
    w_hi = int(CYMBAL_SUSTAIN_WINDOW[1] / frame_dt)
    high_v = velocities("high", high_peaks)
    # Crashes are loud outliers in the high band as well as sustained —
    # require both, or a dense open-hat groove floods the class.
    high_heights = fluxes["high"][high_peaks] if len(high_peaks) else np.array([])
    height_gate = float(np.percentile(high_heights, 85)) if len(high_heights) else 0.0
    for f, v in zip(high_peaks, high_v):
        f = int(f)
        loud_enough = float(fluxes["high"][f]) >= height_gate
        peak_e = float(env_high[f]) + 1e-9
        tail = env_high[min(len(env_high) - 1, f + w_lo) : min(len(env_high), f + w_hi)]
        # MIN of the tail, not mean: at fast tempos the window contains the
        # NEXT hat hits, which inflate a mean and made everything "cymbal".
        # A ringing crash keeps the envelope floor up; discrete hats drop to
        # near-zero between hits.
        sustain = float(np.min(tail)) / peak_e if len(tail) else 0.0
        cls = "cymbal" if (sustain > CYMBAL_SUSTAIN_RATIO and loud_enough) else "hihat"
        events.append({"timeSec": frame_time(f), "cls": cls, "velocity": round(float(v), 2)})

    # Ghost-kick suppression: a snare hit leaks low-end energy that reads as
    # a weak kick at the same instant. A real doubled kick+snare hit has a
    # confident kick velocity; the bleed sits well below it.
    snare_times = np.array([e["timeSec"] for e in events if e["cls"] == "snare"])
    if len(snare_times):
        events = [
            e
            for e in events
            if not (
                e["cls"] == "kick"
                and e["velocity"] < GHOST_KICK_MAX_VELOCITY
                and float(np.min(np.abs(snare_times - e["timeSec"]))) < GHOST_KICK_WINDOW_SEC
            )
        ]

    events.sort(key=lambda e: (e["timeSec"], e["cls"]))
    counts: dict[str, int] = {}
    for e in events:
        counts[e["cls"]] = counts.get(e["cls"], 0) + 1
    _log(f"events: {counts}")

    json.dump(
        {
            "events": events,
            "classCounts": counts,
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
