#!/usr/bin/env python3
"""
Place one recording onto another's timeline by a known constant offset.

    shift_audio.py <srcPath> <dstPath> <offsetSec> [targetDurationSec]

Applies the offset from `align_audio.py` (same sign contract:
`t_ref = t_src + offsetSec`) so the OUTPUT lives on the REF timeline:

    out[t] = src[t - offsetSec]

  - offsetSec > 0 : src starts earlier → PAD `offsetSec` of silence at the front.
  - offsetSec < 0 : src starts later  → TRIM `-offsetSec` off the front.

Sample-accurate (rounds the offset to the nearest sample; sub-sample residual is
< one sample ≈ 23 µs @ 44.1 kHz — far below any perceptual or grid tolerance).
Preserves the source's sample rate and channel count — no resampling, no
re-mastering. If `targetDurationSec` is given, the tail is zero-padded or
truncated to that exact length so the output drops straight onto the timeline.

Prints `{"ok": true, "dst": ..., "sampleRate": ..., "channels": ..., "durationSec": ...}`
(or `{"ok": false, "error": ...}`).

Dependencies: numpy (BSD-3), soundfile (BSD-3).
"""

from __future__ import annotations

import json
import sys
import traceback

import numpy as np
import soundfile as sf


def shift(src_path: str, dst_path: str, offset_sec: float, target_dur_sec: float | None):
    data, sr = sf.read(src_path, always_2d=True)  # (frames, channels), float64/native
    n, ch = data.shape
    off = int(round(offset_sec * sr))

    if off > 0:
        out = np.concatenate([np.zeros((off, ch), dtype=data.dtype), data], axis=0)
    elif off < 0:
        s = min(-off, n)
        out = data[s:]
    else:
        out = data

    if target_dur_sec is not None:
        target_n = int(round(target_dur_sec * sr))
        if out.shape[0] < target_n:
            pad = np.zeros((target_n - out.shape[0], ch), dtype=out.dtype)
            out = np.concatenate([out, pad], axis=0)
        elif out.shape[0] > target_n:
            out = out[:target_n]

    # 16-bit PCM WAV: universally decodable (Demucs, browsers, ffmpeg) and the
    # stems this feeds are lossy-separated anyway, so 16-bit is transparent here.
    sf.write(dst_path, out, sr, subtype="PCM_16")
    return {
        "ok": True,
        "dst": dst_path,
        "sampleRate": int(sr),
        "channels": int(ch),
        "durationSec": round(out.shape[0] / sr, 4),
    }


def main() -> int:
    if len(sys.argv) < 4:
        print(json.dumps({"ok": False, "error": "usage: shift_audio.py <src> <dst> <offsetSec> [targetDurationSec]"}))
        return 2
    try:
        src, dst = sys.argv[1], sys.argv[2]
        offset = float(sys.argv[3])
        target_dur = float(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] not in ("", "null") else None
        result = shift(src, dst, offset, target_dur)
        print(json.dumps(result))
        return 0
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
