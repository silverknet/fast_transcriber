#!/usr/bin/env python3
"""
Beat / downbeat detection via madmom (stdout = JSON only on success).

Setup:
  python3 -m venv .venv && source .venv/bin/activate
  pip install -r src/lib/server/analysis/python/requirements.txt

Leading beats before the first downbeat (beatInBar == 1) are dropped so bar splits stay stable.
"""

from __future__ import annotations

import collections
import collections.abc
import json
import sys
import traceback

# madmom 0.16 predates Python 3.10+ collections.abc and recent NumPy aliases — patch before import.
collections.MutableSequence = collections.abc.MutableSequence  # type: ignore[attr-defined]

import numpy as np

np.float = np.float64  # type: ignore[attr-defined]
np.int = np.int64  # type: ignore[attr-defined]
np.bool = np.bool_  # type: ignore[attr-defined]


def _patch_dbn_process_for_numpy() -> None:
    """
    madmom 0.16 uses np.asarray(results)[:, 1] on viterbi outputs; NumPy 1.26+
    rejects ragged/object sequences. Take log-probs explicitly instead.
    """
    import itertools as it

    from madmom.features.downbeats import DBNDownBeatTrackingProcessor, _process_dbn

    def process(self, activations, **kwargs):  # noqa: ANN001
        first = 0
        if self.threshold:
            idx = np.nonzero(activations >= self.threshold)[0]
            if idx.any():
                first = max(first, np.min(idx))
                last = min(len(activations), np.max(idx) + 1)
            else:
                last = first
            activations = activations[first:last]
        if not activations.any():
            return np.empty((0, 2))
        results = list(self.map(_process_dbn, zip(self.hmms, it.repeat(activations))))
        log_probs = np.array([float(r[1]) for r in results], dtype=np.float64)
        best = int(np.argmax(log_probs))
        path, _ = results[best]
        st = self.hmms[best].transition_model.state_space
        om = self.hmms[best].observation_model
        positions = st.state_positions[path]
        beat_numbers = positions.astype(int) + 1
        if self.correct:
            beats = np.empty(0, dtype=np.int64)
            beat_range = om.pointers[path] >= 1
            idx = np.nonzero(np.diff(beat_range.astype(np.int64)))[0] + 1
            if beat_range[0]:
                idx = np.r_[0, idx]
            if beat_range[-1]:
                idx = np.r_[idx, beat_range.size]
            if idx.any():
                for left, right in idx.reshape((-1, 2)):
                    peak = np.argmax(activations[left:right]) // 2 + left
                    beats = np.hstack((beats, peak))
        else:
            beats = np.nonzero(np.diff(beat_numbers))[0] + 1
        return np.vstack(((beats + first) / float(self.fps), beat_numbers[beats])).T

    DBNDownBeatTrackingProcessor.process = process  # type: ignore[assignment]


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: analyze_downbeats.py <audio.wav>", file=sys.stderr)
        sys.exit(2)

    audio_path = sys.argv[1]

    try:
        from madmom.features.downbeats import (
            DBNDownBeatTrackingProcessor,
            RNNDownBeatProcessor,
        )
    except ImportError as e:
        print(f"madmom import failed: {e}", file=sys.stderr)
        sys.exit(1)

    _patch_dbn_process_for_numpy()

    try:
        rnn = RNNDownBeatProcessor()
        # Must match RNNDownBeatProcessor frame rate (see madmom: FramedSignalProcessor fps=100).
        dbn = DBNDownBeatTrackingProcessor(beats_per_bar=[4], fps=100)
        activations = rnn(audio_path)
        beats_arr = dbn(activations)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    out: list[dict[str, float | int]] = []
    if beats_arr is None or len(beats_arr) == 0:
        print(json.dumps({"beats": out}))
        return

    # Columns: time (s), beat index within bar (1 .. beats_per_bar)
    for row in beats_arr:
        t = float(row[0])
        pos = int(round(float(row[1])))
        if pos < 1:
            pos = 1
        out.append({"time": t, "beatInBar": pos})

    # Drop beats before first downbeat so every bar starts at beatInBar == 1
    first = next((i for i, b in enumerate(out) if b["beatInBar"] == 1), None)
    if first is not None and first > 0:
        out = out[first:]

    print(json.dumps({"beats": out}))


if __name__ == "__main__":
    main()
