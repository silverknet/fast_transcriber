#!/usr/bin/env python3
"""
Lightweight section-border suggester.

Reads an audio file path on argv[1] and a JSON `{ "bars": [{ "startSec": ... }, ...] }`
from stdin. Prints `{ "borders": [{ "bar": <int>, "confidence": <float> }, ...] }`
to stdout. Borders are bar indices where a *new* section likely starts.

Pipeline (deliberately simple):
  1. Load mono audio (22050 Hz).
  2. Compute frame-level features (RMS, MFCC-13, onset strength).
  3. Aggregate features per bar by averaging frames within each bar's span.
  4. Z-score normalise each feature dimension, then concatenate per-bar vectors.
  5. Novelty per bar = euclidean distance between mean(features[i-K:i])
     and mean(features[i:i+K]) — captures past-vs-future change.
  6. Smooth with a small moving average.
  7. Adaptive peak detection: prominence floor = median + K * MAD of the
     novelty curve itself, so the threshold scales with the song's own
     variability rather than a fixed magic number.

No snap-to-grid: peaks report at the bar they actually fall on. Tunable
constants live at the top.

Dependencies: librosa (ISC), numpy (BSD-3), scipy (BSD-3). No GPL/AGPL.
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import List


# ----- Tunables -----------------------------------------------------------

SAMPLE_RATE = 22050
HOP_LENGTH = 512

# Half-width (in bars) of the past/future windows used to detect change.
# At each bar position we compare mean(features[i-K:i]) to mean(features[i:i+K]).
# Larger K = smoother novelty, slower to react. 4 fits typical pop sections;
# bump for songs with very long sections, drop for very short ones.
WINDOW_K = 4

# Moving-average window (bars) applied to the raw novelty curve before
# peak detection. Smooths out single-bar spikes.
SMOOTH_WINDOW = 3

# Number of MFCC coefficients. 13 is the music-IR standard — captures
# timbre + instrumentation in mostly-independent dimensions.
N_MFCC = 13

# Minimum number of bars between adjacent suggested borders. Prevents the
# same transition triggering two adjacent peaks.
MIN_PEAK_DISTANCE_BARS = 4

# Target one border roughly every `BARS_PER_BORDER` bars. A 128-bar pop
# song typically has ~7 transitions; a 64-bar song ~4. Floor at 3 borders,
# ceiling at 12 so we don't overwhelm the UI on very long songs.
BARS_PER_BORDER = 18
MIN_BORDERS = 3
MAX_BORDERS = 12


# ----- Implementation ----------------------------------------------------


def _read_bars_json() -> List[dict]:
    """Parse `{ "bars": [...] }` from stdin. Each bar must have `startSec`."""
    payload = sys.stdin.read()
    if not payload.strip():
        return []
    obj = json.loads(payload)
    bars = obj.get("bars") or []
    out = []
    for b in bars:
        if not isinstance(b, dict):
            continue
        start = b.get("startSec")
        if start is None:
            continue
        out.append({"startSec": float(start)})
    return out


def _empty(reason: str = "") -> None:
    payload = {"borders": []}
    if reason:
        payload["note"] = reason
    print(json.dumps(payload))


def _log(msg: str) -> None:
    """Stderr breadcrumbs, flushed immediately so they survive a signal-kill."""
    print(f"[border_suggest] {msg}", file=sys.stderr, flush=True)


def main() -> None:
    _log(f"starting (python {sys.version.split()[0]}, argv={sys.argv[1:]})")
    if len(sys.argv) < 2:
        print("Usage: border_suggest.py <audio_path>", file=sys.stderr)
        sys.exit(2)

    audio_path = sys.argv[1]

    try:
        bars = _read_bars_json()
    except json.JSONDecodeError as exc:
        print(f"Invalid bars JSON on stdin: {exc}", file=sys.stderr)
        sys.exit(3)
    _log(f"read {len(bars)} bars from stdin")

    # Need at least a handful of bars to detect anything meaningful.
    if len(bars) < WINDOW_K + 2:
        _empty("too few bars for border analysis")
        return

    _log("importing numpy + librosa + scipy")
    try:
        import numpy as np
        import librosa
        from scipy.signal import find_peaks
    except ImportError as exc:
        print(
            f"Missing dependency ({exc.name}). "
            "The sections venv should auto-install on first Sections-mode entry; "
            "it is managed by the bundled uv (Astral). If you see this error, "
            "trigger a re-install from the editor's Sections tab toolbar.",
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
        _empty("empty audio")
        return

    # -- frame-level features --------------------------------------------
    #
    # MFCCs are the music-IR standard for timbre / instrumentation. 13
    # mostly-independent dimensions, robust, no native crashes. We pair
    # them with:
    #   - RMS  : volume change (independent of timbre)
    #   - flux : onset density (independent of timbre, captures drum-pattern shifts)
    #
    # We deliberately avoid `chroma_stft` — it allocates the full complex
    # STFT matrix and has crashed on Apple Silicon with newer numpy/librosa
    # builds. MFCCs do their own log-mel spectrogram which is well-tested.
    _log("computing rms")
    rms = librosa.feature.rms(y=y, hop_length=HOP_LENGTH)[0]
    _log(f"computing mfcc ({N_MFCC} coefficients)")
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=N_MFCC, hop_length=HOP_LENGTH)  # (n_mfcc, T)
    _log("computing onset strength")
    flux = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_LENGTH)
    # NB: we don't compute chroma here. Both `chroma_stft` and `chroma_cqt`
    # have crashed natively (SIGKILL, not a Python exception) on Apple
    # Silicon with this librosa/numpy stack, and we can't catch native
    # crashes. MFCC alone misses harmonic-only transitions but the song
    # structure usually shows up in timbre/energy changes too.
    _log("features computed")

    frames_per_sec = sr / HOP_LENGTH
    total_frames = rms.size

    # -- aggregate per bar -----------------------------------------------
    n_bars = len(bars)
    # Append an implicit end at audio duration so the last bar has a span.
    audio_dur = y.size / sr
    bar_edges_sec = [b["startSec"] for b in bars] + [audio_dur]

    rms_b = np.zeros(n_bars)
    flux_b = np.zeros(n_bars)
    mfcc_b = np.zeros((n_bars, N_MFCC))

    for i in range(n_bars):
        f0 = int(max(0, bar_edges_sec[i]) * frames_per_sec)
        f1 = int(max(0, bar_edges_sec[i + 1]) * frames_per_sec)
        if f1 <= f0:
            f1 = min(f0 + 1, total_frames)
        f0 = min(f0, total_frames - 1)
        f1 = min(max(f1, f0 + 1), total_frames)
        rms_b[i] = float(np.mean(rms[f0:f1])) if f1 > f0 else 0.0
        # Flux: use mean rather than sum so longer bars don't dominate.
        flux_b[i] = float(np.mean(flux[f0:f1])) if f1 > f0 else 0.0
        mfcc_b[i] = mfcc[:, f0:f1].mean(axis=1) if f1 > f0 else np.zeros(N_MFCC)

    # -- z-score each column, then concatenate ---------------------------
    def _zscore(col: "np.ndarray") -> "np.ndarray":
        m, s = float(col.mean()), float(col.std())
        if s < 1e-9:
            return np.zeros_like(col)
        return (col - m) / s

    rms_z = _zscore(rms_b)
    flux_z = _zscore(flux_b)
    mfcc_z = np.zeros_like(mfcc_b)
    for k in range(N_MFCC):
        mfcc_z[:, k] = _zscore(mfcc_b[:, k])

    # shape (n_bars, 15): rms + 13 MFCC + flux
    features = np.concatenate([rms_z[:, None], mfcc_z, flux_z[:, None]], axis=1)
    _log(f"feature matrix: shape {features.shape}")

    # -- novelty: past-window vs future-window euclidean distance --------
    #
    # At each bar position `i`, compare the mean feature vector of the
    # previous `WINDOW_K` bars to the mean of the next `WINDOW_K` bars.
    # When the song transitions between sections, the two means diverge —
    # i.e., the SAME bar reads very different "before" and "after."
    #
    # This is symmetric (vs. the older "this bar vs. past chunk" which
    # peaked one bar late), and it's invariant to the absolute level of
    # any single bar — only the chunk-level shift matters.
    novelty = np.zeros(n_bars)
    for i in range(n_bars):
        if i < WINDOW_K or i > n_bars - WINDOW_K:
            continue  # not enough context on one side; leave as 0
        past = features[i - WINDOW_K : i].mean(axis=0)
        future = features[i : i + WINDOW_K].mean(axis=0)
        novelty[i] = float(np.linalg.norm(past - future))
    _log(f"novelty range: [{novelty.min():.3f}, {novelty.max():.3f}]")

    # Diagnostic dump of the top-20 novelty values (raw, pre-smoothing).
    # Used to verify the algorithm against user expectations: if your
    # song has section changes at bars 16/32/48/64 and the top values
    # here are at very different positions, the *features* aren't
    # detecting your transitions — algorithm-level issue, not threshold.
    top_idx = np.argsort(novelty)[::-1][:20]
    top_pairs = [(int(i), float(novelty[i])) for i in sorted(top_idx)]
    _log("top-20 raw novelty bars: " + ", ".join(f"{i}={v:.3f}" for i, v in top_pairs))

    # -- smooth ----------------------------------------------------------
    if SMOOTH_WINDOW > 1 and n_bars >= SMOOTH_WINDOW:
        kernel = np.ones(SMOOTH_WINDOW) / SMOOTH_WINDOW
        smoothed = np.convolve(novelty, kernel, mode="same")
    else:
        smoothed = novelty

    if float(smoothed.max()) < 1e-9:
        _empty("no novelty signal")
        return

    # -- find ALL local maxima, then pick top-N by height ----------------
    #
    # Previous versions used a prominence threshold tied to the novelty
    # curve's MAD. That works mathematically but produces wildly
    # inconsistent border counts: songs with one giant outlier got 1-2
    # borders, evenly-mixed songs got 30. Switch to a predictable
    # target: ~1 border per BARS_PER_BORDER bars, clamped to
    # [MIN_BORDERS, MAX_BORDERS], picked by descending novelty height.
    #
    # `distance=MIN_PEAK_DISTANCE_BARS` still prevents adjacent peaks
    # from clustering (e.g. one transition causing two ticks one bar
    # apart).
    target_n = max(MIN_BORDERS, min(MAX_BORDERS, n_bars // BARS_PER_BORDER))
    peaks, _props = find_peaks(smoothed, distance=MIN_PEAK_DISTANCE_BARS)
    _log(f"target border count = {target_n} (n_bars={n_bars}); raw maxima = {len(peaks)}")
    _log(
        "all maxima: "
        + ", ".join(f"{int(p)}={smoothed[int(p)]:.3f}" for p in peaks[:40])
    )

    # Rank maxima by their (smoothed) novelty, keep the top target_n.
    if len(peaks) > target_n:
        peaks_sorted_by_value = sorted(
            peaks.tolist(), key=lambda i: float(smoothed[int(i)]), reverse=True
        )
        peaks_kept = sorted(peaks_sorted_by_value[:target_n])
    else:
        peaks_kept = sorted(peaks.tolist())

    _log("kept peaks: " + ", ".join(f"bar={int(p)} n={smoothed[int(p)]:.3f}" for p in peaks_kept))

    # -- confidence ------------------------------------------------------
    # Confidence = novelty at peak normalised against the strongest peak.
    nov_max = float(smoothed.max())
    borders = []
    for p in peaks_kept:
        bar_idx = int(p)
        raw = float(smoothed[bar_idx]) / nov_max if nov_max > 0 else 0.0
        conf = max(0.0, min(1.0, raw))
        borders.append({"bar": bar_idx, "confidence": round(conf, 3)})

    print(json.dumps({"borders": borders}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Last-chance trap so the sidecar gets a structured error rather than
        # a Python stack on stdout.
        print(f"border_suggest: unhandled error: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
