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
        "--out",
        str(tmp),
        str(input_file),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, env=subprocess_env())
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        print(err or "demucs failed", file=sys.stderr)
        sys.exit(proc.returncode)


def run_demucs_streaming(input_file: Path, tmp: Path, model: str, shifts: int, overlap: float) -> None:
    """
    Stream Demucs output, emitting NDJSON `log` and `progress` events.
    Mirrors the pass-tracking logic from frequency_domain/stem_splitter.py so
    the web UI's two progress bars stay aligned with what the Tkinter shows.
    """
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
        "--out",
        str(tmp),
        str(input_file),
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=subprocess_env(),
    )

    total_passes = max(1, shifts)
    completed_passes = 0
    last_was_high = False
    is_downloading = False

    assert proc.stdout is not None
    for raw in proc.stdout:
        line = raw.strip()
        if not line:
            continue

        if "Downloading:" in line:
            is_downloading = True
        elif "Separating track" in line:
            is_downloading = False
            emit({"type": "log", "msg": line})

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
        elif any(k in line for k in ("Separated", "Selected model")):
            emit({"type": "log", "msg": line})

    proc.wait()
    if proc.returncode != 0:
        emit({"type": "error", "msg": f"Demucs exited with code {proc.returncode}"})
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
