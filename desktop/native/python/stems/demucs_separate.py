#!/usr/bin/env python3
"""
CLI stem separation via Demucs — headless counterpart to frequency_domain/stem_splitter.py.

Default mode (no --stream-progress):
  Outputs a single JSON object on stdout on success:
    {"outputDir": "...", "files": ["vocals.wav", ...]}

Streaming mode (--stream-progress):
  Emits newline-delimited JSON events as Demucs runs. Consumers (Electron
  loopback HTTP) forward these straight to the BarBro web client.
  Event shapes:
    {"type": "log",      "msg":   "..."}
    {"type": "progress", "label": "Separating — pass 1 of 5", "current": 42, "overall": 8}
    {"type": "done",     "outputDir": "...", "files": ["vocals.wav", ...]}
    {"type": "error",    "msg":   "..."}

Requires: ffmpeg on PATH, pip install demucs (see stems/requirements.txt).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


STEMS_DEFAULT = ["vocals", "drums", "bass", "other"]


def subprocess_env() -> dict[str, str]:
    env = os.environ.copy()
    if sys.platform == "darwin":
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + env.get("PATH", "")
    try:
        import certifi

        ca = certifi.where()
        env.setdefault("SSL_CERT_FILE", ca)
        env.setdefault("REQUESTS_CA_BUNDLE", ca)
    except ImportError:
        pass
    return env


def emit(event: dict) -> None:
    """Write one NDJSON event to stdout immediately (flush each line)."""
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def assert_deps(streaming: bool) -> None:
    env = subprocess_env()
    r = subprocess.run([sys.executable, "-m", "demucs", "--help"], capture_output=True, env=env)
    if r.returncode != 0:
        if streaming:
            emit({"type": "error", "msg": "Demucs not installed. pip install demucs"})
        else:
            print("Demucs not installed. pip install demucs", file=sys.stderr)
        sys.exit(1)
    # ffmpeg is optional for WAV inputs (torchaudio reads them directly). Warn
    # but don't bail — Demucs will surface its own error if it actually needs
    # ffmpeg for a non-standard input format.
    r = subprocess.run(["ffmpeg", "-version"], capture_output=True, env=env)
    if r.returncode != 0:
        msg = "ffmpeg not on PATH — fine for WAV inputs; install via `brew install ffmpeg` if other formats fail."
        if streaming:
            emit({"type": "log", "msg": msg})
        else:
            print(msg, file=sys.stderr)


def find_song_dir(tmp: Path, model: str) -> Path:
    for search_dir in [tmp / model, tmp]:
        if not search_dir.exists():
            continue
        dirs = [d for d in search_dir.iterdir() if d.is_dir()]
        if dirs:
            return max(dirs, key=lambda d: d.stat().st_mtime)
    raise FileNotFoundError(f"No Demucs output found in {tmp}")


# Matches a tqdm progress line like "  42%|██  |  3/10 [00:05<00:08...]"
_TQDM_PCT = re.compile(r"^\s*(\d+)%\|")


def run_demucs(input_file: Path, tmp: Path, model: str, shifts: int, overlap: float) -> None:
    """Run Demucs and wait for completion. Captures output (non-streaming mode)."""
    device = detect_torch_device()
    cmd = [
        sys.executable,
        "-m",
        "demucs",
        "--name",
        model,
        "--shifts",
        str(shifts),
        "--overlap",
        str(overlap),
        "--device",
        device,
        "--out",
        str(tmp),
        str(input_file),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, env=subprocess_env())
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        print(err or "demucs failed", file=sys.stderr)
        sys.exit(proc.returncode)


def model_bag_size(model: str) -> int:
    """
    Number of internal sub-models the named Demucs model ensembles.

    The `_ft` fine-tuned models are bags of 4 checkpoints; Demucs runs each
    one per `--shifts` and averages, so the tqdm progress emits `shifts × 4`
    bars in practice. Plain single-model variants emit `shifts` bars.

    Source: facebookresearch/demucs README and the model registry in
    `demucs.pretrained` — `htdemucs_ft` is documented as a bag of 4.
    """
    return 4 if model.endswith("_ft") else 1


def detect_torch_device() -> str:
    """
    Pick the fastest available compute backend Demucs will accept.

    Priority: CUDA → MPS (Apple Silicon GPU) → CPU. On a typical M-series
    Mac, switching from CPU to MPS is ~5–10× faster with no quality
    difference — the same neural net, just running on the Metal backend.
    """
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        if sys.platform == "darwin" and getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def run_demucs_streaming(input_file: Path, tmp: Path, model: str, shifts: int, overlap: float) -> None:
    """
    Stream Demucs output, emitting NDJSON `log` and `progress` events.
    Mirrors the pass-tracking logic from frequency_domain/stem_splitter.py so
    the web UI's two progress bars stay aligned with what the Tkinter shows.
    """
    device = detect_torch_device()
    cmd = [
        sys.executable,
        "-m",
        "demucs",
        "--name",
        model,
        "--shifts",
        str(shifts),
        "--overlap",
        str(overlap),
        "--device",
        device,
        "--out",
        str(tmp),
        str(input_file),
    ]
    emit({"type": "log", "msg": f"Device: {device}"})
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=subprocess_env(),
    )

    # `htdemucs_ft` and other `_ft` bags ensemble 4 sub-models per shift.
    # Without accounting for this the overall % bar wraps around 4× during
    # the run and looks like the job is stuck.
    bag_size = model_bag_size(model)
    total_passes = max(1, shifts * bag_size)
    completed_passes = 0
    last_was_high = False
    is_downloading = False

    assert proc.stdout is not None
    # Keep a tail of every non-progress line so a failure can include the
    # actual error context (the previous version silently dropped anything
    # that wasn't a tqdm progress line, leaving the web side with a bare
    # "exited code N" and no clue why).
    recent_log: list[str] = []
    for raw in proc.stdout:
        line = raw.strip()
        if not line:
            continue

        if "Downloading:" in line:
            is_downloading = True
        elif "Separating track" in line:
            is_downloading = False

        m = _TQDM_PCT.search(line)
        if m:
            pct = int(m.group(1))
            if is_downloading:
                emit({"type": "progress", "label": "Downloading model…", "current": pct, "overall": 0})
            else:
                # Pass rollover: high% → low% means a new pass started.
                if last_was_high and pct < 5:
                    completed_passes += 1
                last_was_high = pct > 80
                overall = min(99, int((completed_passes + pct / 100) / total_passes * 100))
                emit({
                    "type": "progress",
                    "label": f"Separating — pass {completed_passes + 1} of {total_passes}",
                    "current": pct,
                    "overall": overall,
                })
        else:
            # Forward every non-progress line as a log event. Demucs writes
            # tracebacks, "Selected model is …", warnings, and crash messages
            # here — all useful when the run fails.
            emit({"type": "log", "msg": line})
            recent_log.append(line)
            if len(recent_log) > 40:
                recent_log.pop(0)

    proc.wait()
    if proc.returncode != 0:
        tail = "\n".join(recent_log[-12:]) if recent_log else "(no output captured)"
        emit({
            "type": "error",
            "msg": f"Demucs exited with code {proc.returncode}. Last output:\n{tail}",
        })
        sys.exit(proc.returncode)


def main() -> None:
    p = argparse.ArgumentParser(description="Demucs stem separation (CLI)")
    p.add_argument("input", type=Path, help="Input audio file")
    p.add_argument("--out-dir", type=Path, required=True, help="Directory for exported WAV stems")
    p.add_argument("--model", default="htdemucs_ft", help="Demucs model name")
    p.add_argument("--shifts", type=int, default=5)
    p.add_argument("--overlap", type=float, default=0.25)
    p.add_argument(
        "--stems",
        default=",".join(STEMS_DEFAULT),
        help="Comma-separated: vocals,drums,bass,other",
    )
    p.add_argument("--keep-temp", action="store_true", help="Do not delete Demucs temp dir")
    p.add_argument(
        "--stream-progress",
        action="store_true",
        help="Emit NDJSON progress/log events on stdout instead of a single final JSON",
    )
    args = p.parse_args()

    want = [s.strip().lower() for s in args.stems.split(",") if s.strip()]
    if not want:
        if args.stream_progress:
            emit({"type": "error", "msg": "No stems selected"})
        else:
            print("No stems selected", file=sys.stderr)
        sys.exit(2)

    inp = args.input.resolve()
    if not inp.is_file():
        if args.stream_progress:
            emit({"type": "error", "msg": f"Not a file: {inp}"})
        else:
            print(f"Not a file: {inp}", file=sys.stderr)
        sys.exit(2)

    assert_deps(args.stream_progress)

    tmp = Path(tempfile.mkdtemp(prefix="barbro_demucs_"))
    try:
        if args.stream_progress:
            emit({"type": "log", "msg": f"Model: {args.model}, shifts: {args.shifts}"})
            run_demucs_streaming(inp, tmp, args.model, args.shifts, args.overlap)
        else:
            run_demucs(inp, tmp, args.model, args.shifts, args.overlap)

        song_dir = find_song_dir(tmp, args.model)
        out_dir = args.out_dir.resolve()
        out_dir.mkdir(parents=True, exist_ok=True)

        exported: list[str] = []
        for stem in want:
            src = song_dir / f"{stem}.wav"
            if src.exists():
                dest = out_dir / f"{stem}.wav"
                shutil.copy2(src, dest)
                exported.append(dest.name)
                if args.stream_progress:
                    emit({"type": "log", "msg": f"  ✓  {stem}.wav"})
            else:
                if args.stream_progress:
                    emit({"type": "log", "msg": f"  ⚠  missing {stem}.wav"})
                else:
                    print(f"warning: missing {stem}.wav in Demucs output", file=sys.stderr)

        result = {"outputDir": str(out_dir), "files": exported}
        if args.stream_progress:
            emit({"type": "done", **result})
        else:
            print(json.dumps(result))
    finally:
        if not args.keep_temp:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
