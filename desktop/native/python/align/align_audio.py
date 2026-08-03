#!/usr/bin/env python3
"""
High-precision audio alignment between two recordings of the SAME performance.

Reads two absolute audio paths:

    align_audio.py <refPath> <targetPath>

`refPath` is the recording whose timeline is authoritative (the song already in
BarBro — its beat grid, chords and sections are pinned to this audio).
`targetPath` is the newly-uploaded audio we want to place on that timeline (a
with-vocals version to source a vocal stem from, or a higher-quality master to
swap in without disturbing the existing annotations).

Prints ONE JSON object to stdout:

```json
{
  "ok": true,
  "offsetSec": 0.01234,        // see sign contract below
  "confidence": 0.0..1.0,      // how sure we are it's the same recording
  "sameRecording": true,       // heuristic recommendation
  "driftSec": 0.0007,          // spread of per-window offsets (tempo/speed drift)
  "durationRefSec": 231.0,
  "durationTargetSec": 231.4,
  "sampleRate": 22050,
  "perWindow": [               // local offset probed across the song
    { "centerSec": 20.0, "offsetSec": 0.0121, "confidence": 0.91 }, ...
  ]
}
```
(or `{ "ok": false, "error": "..." }` on failure.)

Sign contract (the SINGLE source of truth every consumer must honour):

    t_ref = t_target + offsetSec

i.e. a musical event at time `t` in the TARGET lands at `t + offsetSec` on the
REF (BarBro) timeline. So to place the target onto the ref timeline:
  - offsetSec > 0 : the target starts EARLIER (less leading silence) → DELAY it,
                    pad `offsetSec` seconds of silence at the front.
  - offsetSec < 0 : the target starts LATER → TRIM `-offsetSec` seconds off the
                    front.

Pipeline:
  1. Load both mono @ 22050 Hz.
  2. Coarse: onset-strength envelopes (shared percussive skeleton survives even
     when one side has/omits vocals) → normalized cross-correlation. Peak lag =
     coarse offset; peak height = coarse confidence.
  3. Fine: GCC-PHAT (phase-transform cross-correlation) on the raw waveforms
     over the overlap, with parabolic interpolation → sub-sample refinement.
  4. Drift: probe a local GCC-PHAT offset in several windows across the song.
     A same-master pair holds one constant offset (drift ~0). A different-speed
     version drifts — that would smear any remapped annotation, so we surface it.

Dependencies: numpy (BSD-3), scipy (BSD-3), librosa (ISC). No GPL/AGPL.
"""

from __future__ import annotations

import json
import sys
import traceback

import numpy as np
import librosa
from fractions import Fraction
from scipy.signal import correlate, resample_poly
from scipy.fft import rfft, irfft, next_fast_len


# ----- Tunables -----------------------------------------------------------

SR = 22050
ONSET_HOP = 256                 # 11.61 ms/frame — fine coarse resolution
# Phase-transform exponent. ρ=1 is pure PHAT (sharpest peak, but amplifies
# empty/noisy bands equally); ρ<1 keeps some magnitude weighting so energy-rich
# bands dominate — markedly more robust on sparse/ambient material while staying
# sub-millisecond on real music.
PHAT_RHO = 0.75
FINE_MAX_SEC = 90.0             # cap the GCC-PHAT window (center of overlap)
DRIFT_WINDOWS = 7               # local probes across the song
DRIFT_WIN_SEC = 8.0             # each local probe span
DRIFT_SEARCH_SEC = 0.75         # how far a local probe may wander from global
SAME_REC_MIN_CONF = 0.55        # coarse-XC confidence to call it the same song
SAME_REC_MAX_DRIFT = 0.040      # >40 ms drift ⇒ not a clean constant offset

# ----- Harmonic (chroma) stage -------------------------------------------
#
# Why a second stage exists at all. The onset/GCC-PHAT pair above compares
# WAVEFORMS, so it only recognises two copies of one master. Two real cases
# break it while the recordings genuinely are the same performance:
#
#   1. KARAOKE / instrumental copies. These are usually made by cancelling the
#      centre channel, which removes the vocal AND the centred kick, snare and
#      bass. The onset envelope is mostly kick+snare, so the two envelopes stop
#      resembling each other and the correlation collapses into noise — the
#      peak then lands wherever the noise happens to be highest.
#   2. SPEED-SHIFTED uploads. Video sites are full of copies played ~0.5-1%
#      fast to dodge content matching. Over three minutes that is a second or
#      more of progressive slip, which smears every waveform correlation flat.
#
# Chroma (pitch-class energy) survives both: it follows the CHORDS, which are
# identical no matter what was removed from the mix, and a linear time-warp
# shows up as a straight line through the per-window offsets — measurable, and
# therefore correctable, instead of being reported as "different recording".
CHROMA_HOP = 2048
SPEED_WINDOWS = 9               # probes spread across the target
SPEED_WIN_SEC = 20.0            # each probe's span
CHROMA_MIN_DOMINANCE = 1.6      # peak vs best rival: below this it is noise
MAX_SPEED_DEVIATION = 0.06      # ±6% — beyond this it is a different version
MAX_WARP_RESIDUAL = 0.25        # s, after removing the linear warp


def _load(path: str) -> np.ndarray:
    y, _ = librosa.load(path, sr=SR, mono=True)
    return np.asarray(y, dtype=np.float64)


def _duration(y: np.ndarray) -> float:
    return len(y) / SR


def _norm(x: np.ndarray) -> np.ndarray:
    """Zero-mean, unit-L2. Cross-correlation of two such vectors peaks at the
    Pearson correlation coefficient (∈ [-1, 1]) — a clean confidence read."""
    x = x - x.mean()
    n = np.linalg.norm(x)
    return x / n if n > 0 else x


def _coarse_offset(ref: np.ndarray, tgt: np.ndarray):
    """Onset-envelope cross-correlation → (offsetSec, confidence 0..1)."""
    env_r = librosa.onset.onset_strength(y=ref, sr=SR, hop_length=ONSET_HOP)
    env_t = librosa.onset.onset_strength(y=tgt, sr=SR, hop_length=ONSET_HOP)
    a = _norm(env_r)
    b = _norm(env_t)
    xc = correlate(a, b, mode="full", method="fft")
    k = int(np.argmax(xc))
    lag_frames = k - (len(b) - 1)            # ref = tgt shifted by lag_frames
    conf = float(np.clip(xc[k], 0.0, 1.0))
    offset_sec = lag_frames * ONSET_HOP / SR
    return offset_sec, conf


def _gcc_phat(a: np.ndarray, b: np.ndarray, max_lag: int | None = None):
    """GCC-PHAT delay of `a` relative to `b`, sub-sample via parabolic interp.

    Returns (delay_samples_float, sharpness). Positive delay ⇒ `a` lags `b`
    (a[n] ≈ b[n - delay]). `sharpness` is peak / RMS of the correlation, a
    scale-free confidence in the fine estimate."""
    n = next_fast_len(len(a) + len(b))
    A = rfft(a, n)
    B = rfft(b, n)
    R = A * np.conj(B)
    R /= np.abs(R) ** PHAT_RHO + 1e-12        # soft phase-transform weighting
    cc = irfft(R, n)
    # Re-center so index 0 is zero lag: lags run [-n/2 .. +n/2).
    half = n // 2
    cc = np.concatenate((cc[-half:], cc[:half]))
    zero = half
    if max_lag is not None:
        lo, hi = zero - max_lag, zero + max_lag + 1
        window = cc[lo:hi]
        base = lo
    else:
        window = cc
        base = 0
    i = int(np.argmax(window))
    peak = window[i]
    idx = base + i
    # Parabolic interpolation around the peak for sub-sample precision.
    frac = 0.0
    if 0 < idx < len(cc) - 1:
        y0, y1, y2 = cc[idx - 1], cc[idx], cc[idx + 1]
        denom = (y0 - 2 * y1 + y2)
        if denom != 0:
            frac = 0.5 * (y0 - y2) / denom
    delay = (idx - zero) + frac
    rms = float(np.sqrt(np.mean(cc ** 2))) or 1e-12
    sharpness = float(peak / rms)
    return delay, sharpness


def _overlap_slices(ref, tgt, offset_sec, span_sec=None):
    """Return equal-length ref/tgt slices that cover the same musical span,
    given the current offset estimate (t_ref = t_tgt + offset)."""
    off = int(round(offset_sec * SR))
    # ref[i] corresponds to tgt[i - off]
    start_ref = max(0, off)
    start_tgt = max(0, -off)
    length = min(len(ref) - start_ref, len(tgt) - start_tgt)
    if span_sec is not None:
        span = int(span_sec * SR)
        if length > span:
            # center the window
            mid = length // 2
            h = span // 2
            start_ref += mid - h
            start_tgt += mid - h
            length = span
    if length <= 0:
        return None
    return (ref[start_ref:start_ref + length], tgt[start_tgt:start_tgt + length])


def _fine_offset(ref, tgt, coarse_sec):
    sl = _overlap_slices(ref, tgt, coarse_sec, FINE_MAX_SEC)
    if sl is None:
        return coarse_sec, 0.0
    a, b = sl
    # Residual delay within the already-aligned window (small search band).
    max_lag = int(0.5 * SR)
    delay, sharp = _gcc_phat(a, b, max_lag=max_lag)
    return coarse_sec + delay / SR, sharp


def _drift(ref, tgt, offset_sec):
    """Probe local offsets across the song. Returns (per_window, drift_sec)."""
    off = int(round(offset_sec * SR))
    start_ref = max(0, off)
    start_tgt = max(0, -off)
    length = min(len(ref) - start_ref, len(tgt) - start_tgt)
    per = []
    if length <= int(DRIFT_WIN_SEC * SR):
        return per, 0.0
    win = int(DRIFT_WIN_SEC * SR)
    search = int(DRIFT_SEARCH_SEC * SR)
    for w in range(DRIFT_WINDOWS):
        frac = (w + 0.5) / DRIFT_WINDOWS
        c = int(frac * (length - win))
        a = ref[start_ref + c: start_ref + c + win]
        b = tgt[start_tgt + c: start_tgt + c + win]
        if len(a) < win or len(b) < win:
            continue
        delay, sharp = _gcc_phat(a, b, max_lag=search)
        local_off = offset_sec + delay / SR
        center = (start_ref + c + win / 2) / SR
        per.append({
            "centerSec": round(center, 3),
            "offsetSec": round(local_off, 5),
            "confidence": round(float(min(1.0, sharp / 30.0)), 3),
        })
    if len(per) >= 2:
        offs = np.array([p["offsetSec"] for p in per])
        # robust spread: median-centered max deviation
        drift = float(np.max(np.abs(offs - np.median(offs))))
    else:
        drift = 0.0
    return per, drift


def _resample(y: np.ndarray, ratio: float) -> np.ndarray:
    """Stretch `y` by `ratio` — the exact correction `shift_audio.py` applies,
    so what the refinement measures is what the import will produce."""
    frac = Fraction(ratio).limit_denominator(2000)
    return np.asarray(resample_poly(y, frac.numerator, frac.denominator), dtype=np.float64)


def _chroma(y: np.ndarray) -> np.ndarray:
    return np.asarray(
        librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=CHROMA_HOP), dtype=np.float64
    )


def _chroma_xcorr(a_ch: np.ndarray, b_ch: np.ndarray):
    """Cross-correlate two chroma-grams, summed over the 12 pitch classes.

    Returns (lags_sec, corr) where `corr[i]` is the similarity when `b` is
    placed at `lags_sec[i]` on `a`'s timeline. Normalised so the values are
    comparable between calls."""
    a = a_ch - a_ch.mean(axis=1, keepdims=True)
    b = b_ch - b_ch.mean(axis=1, keepdims=True)
    n = next_fast_len(a.shape[1] + b.shape[1])
    corr = np.zeros(n)
    for k in range(12):
        corr += irfft(rfft(a[k], n) * np.conj(rfft(b[k], n)), n)
    corr = np.concatenate((corr[-(b.shape[1] - 1):], corr[: a.shape[1]]))
    fps = SR / CHROMA_HOP
    lags = (np.arange(len(corr)) - (b.shape[1] - 1)) / fps
    denom = float(np.linalg.norm(a) * np.linalg.norm(b)) or 1e-12
    return lags, corr / denom


def _peak_dominance(lags: np.ndarray, corr: np.ndarray, guard_sec: float = 5.0):
    """(lag_of_peak, peak_value, dominance) — dominance being peak / best rival
    outside a guard band. A true match towers over its rivals; noise does not."""
    i = int(np.argmax(corr))
    peak = float(corr[i])
    mask = np.abs(lags - lags[i]) > guard_sec
    rival = float(corr[mask].max()) if mask.any() else 0.0
    dom = peak / rival if rival > 1e-9 else float("inf")
    return float(lags[i]), peak, dom


def _theil_sen(xs, ys):
    """Median-of-pairwise-slopes fit — immune to a couple of bad probes, which
    matters because one window landing on a repeated chorus would otherwise
    tilt a least-squares line."""
    slopes = [
        (ys[j] - ys[i]) / (xs[j] - xs[i])
        for i in range(len(xs))
        for j in range(i + 1, len(xs))
        if xs[j] != xs[i]
    ]
    if not slopes:
        return 0.0, float(np.median(ys)) if len(ys) else 0.0
    b = float(np.median(slopes))
    a = float(np.median([y - b * x for x, y in zip(xs, ys)]))
    return b, a


def _harmonic_align(ref: np.ndarray, tgt: np.ndarray) -> dict:
    """Chord-based alignment that also measures a linear speed difference.

    Model: `t_ref = offsetSec + speedRatio * t_target`, i.e. stretch the target
    by `speedRatio` and then delay it by `offsetSec`."""
    ref_ch = _chroma(ref)
    tgt_ch = _chroma(tgt)
    fps = SR / CHROMA_HOP

    whole_lag, whole_peak, whole_dom = _peak_dominance(*_chroma_xcorr(ref_ch, tgt_ch))

    n_tgt = tgt_ch.shape[1]
    win = int(SPEED_WIN_SEC * fps)
    xs, ys, doms = [], [], []
    per = []
    if n_tgt > win:
        for w in range(SPEED_WINDOWS):
            start = int(w * (n_tgt - win) / max(1, SPEED_WINDOWS - 1))
            lags, corr = _chroma_xcorr(ref_ch, tgt_ch[:, start: start + win])
            lag, peak, dom = _peak_dominance(lags, corr)
            t_tgt = start / fps
            xs.append(t_tgt)
            ys.append(lag - t_tgt)
            doms.append(dom)
            per.append({
                "centerSec": round(t_tgt + SPEED_WIN_SEC / 2, 3),
                "offsetSec": round(float(lag - t_tgt), 5),
                "confidence": round(float(min(1.0, dom / 3.0)), 3),
            })

    slope, intercept = _theil_sen(xs, ys) if len(xs) >= 3 else (0.0, whole_lag)
    speed_ratio = 1.0 + slope
    residual = 0.0
    if xs:
        residual = float(np.max(np.abs(np.array(ys) - (intercept + slope * np.array(xs)))))

    # REFINE. Chroma finds the speed but its frame is ~93 ms, far too coarse to
    # place a vocal. Once the speed is matched the waveforms resemble each other
    # again — measured on a real karaoke/upload pair, onset correlation went
    # from 0.008 to 0.53 — so hand the corrected pair back to the precise
    # machinery for the constant offset, and report ITS confidence, which means
    # something to a person, rather than a peak-dominance ratio.
    if abs(slope) > 1e-6 and abs(slope) <= MAX_SPEED_DEVIATION:
        stretched = _resample(tgt, speed_ratio)
        r_coarse, r_conf = _coarse_offset(ref, stretched)
        if r_conf > 0.25:  # the refinement itself must be believable
            r_fine, _sharp = _fine_offset(ref, stretched, r_coarse)
            r_per, r_drift = _drift(ref, stretched, r_fine)
            return {
                "offsetSec": round(float(r_fine), 5),
                "speedRatio": round(float(speed_ratio), 8),
                "confidence": round(float(r_conf), 4),
                "sameRecording": bool(r_conf >= 0.35 and r_drift <= MAX_WARP_RESIDUAL),
                "driftSec": round(float(r_drift), 5),
                "perWindow": r_per or per,
                "method": "harmonic",
            }

    plausible_speed = abs(slope) <= MAX_SPEED_DEVIATION
    # The peak must stand out SOMEWHERE: either the whole-song correlation is
    # dominant, or a majority of the probes agree on a line. Both being weak
    # means we genuinely cannot tell — and then we must not claim a match.
    strong_windows = sum(1 for d in doms if d >= CHROMA_MIN_DOMINANCE)
    convincing = whole_dom >= CHROMA_MIN_DOMINANCE or strong_windows >= max(3, len(doms) // 2)
    same = bool(convincing and plausible_speed and residual <= MAX_WARP_RESIDUAL)

    return {
        "offsetSec": round(float(intercept), 5),
        "speedRatio": round(float(speed_ratio), 8),
        "confidence": round(float(min(1.0, whole_dom / 3.0)), 4),
        "sameRecording": same,
        "driftSec": round(float(residual), 5),
        "perWindow": per,
        "method": "harmonic",
    }


def align(ref_path: str, tgt_path: str) -> dict:
    ref = _load(ref_path)
    tgt = _load(tgt_path)
    if len(ref) == 0 or len(tgt) == 0:
        return {"ok": False, "error": "one of the inputs decoded to empty audio"}

    common = {
        "ok": True,
        "durationRefSec": round(_duration(ref), 3),
        "durationTargetSec": round(_duration(tgt), 3),
        "sampleRate": SR,
    }

    # Stage 1 — WAVEFORM. Two copies of one master align to the sample here,
    # and that is the common case, so it stays the fast path.
    coarse_sec, coarse_conf = _coarse_offset(ref, tgt)
    offset_sec, _fine_sharp = _fine_offset(ref, tgt, coarse_sec)
    per_window, drift_sec = _drift(ref, tgt, offset_sec)
    if coarse_conf >= SAME_REC_MIN_CONF and drift_sec <= SAME_REC_MAX_DRIFT:
        return {
            **common,
            "offsetSec": round(float(offset_sec), 5),
            "speedRatio": 1.0,
            "confidence": round(float(coarse_conf), 4),
            "sameRecording": True,
            "driftSec": round(float(drift_sec), 5),
            "perWindow": per_window,
            "method": "waveform",
        }

    # Stage 2 — HARMONY. The waveforms disagree, which does NOT mean the
    # recordings differ: a karaoke cut has had its centred drums removed, and a
    # sped-up upload slips progressively. Both keep the chord progression, so
    # ask the chords instead — and measure the speed difference rather than
    # reporting it as unexplained drift.
    harmonic = _harmonic_align(ref, tgt)
    if harmonic["sameRecording"]:
        return {**common, **harmonic}

    # Neither stage is convinced. Return whichever looked stronger, still
    # flagged as unverified, so the caller can offer "use it anyway" with the
    # best estimate rather than a nonsense one.
    if harmonic["confidence"] >= coarse_conf:
        return {**common, **harmonic}
    return {
        **common,
        "offsetSec": round(float(offset_sec), 5),
        "speedRatio": 1.0,
        "confidence": round(float(coarse_conf), 4),
        "sameRecording": False,
        "driftSec": round(float(drift_sec), 5),
        "perWindow": per_window,
        "method": "waveform",
    }


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: align_audio.py <refPath> <targetPath>"}))
        return 2
    try:
        result = align(sys.argv[1], sys.argv[2])
        print(json.dumps(result))
        return 0 if result.get("ok") else 1
    except Exception as e:  # noqa: BLE001 — report everything as JSON
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
