#!/usr/bin/env python3
"""Download the best YouTube audio stream and convert it to browser-safe WAV.

Protocol: newline-delimited JSON on stdout. The Electron sidecar owns job
queueing, target paths, and cancellation; this script only handles source
acquisition and conversion inside a sidecar-owned work directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import wave
from pathlib import Path
from typing import Any

import imageio_ffmpeg
import yt_dlp
from yt_dlp.utils import DownloadError


def emit(obj: dict[str, Any]) -> None:
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def fail(code: str, msg: str) -> int:
    emit({"type": "error", "code": code, "msg": msg})
    return 1


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def wav_info(path: Path) -> dict[str, Any]:
    with wave.open(str(path), "rb") as w:
        frames = w.getnframes()
        sample_rate = w.getframerate()
        channels = w.getnchannels()
        duration = frames / sample_rate if sample_rate > 0 else 0
    return {
        "durationSec": duration,
        "sampleRate": sample_rate,
        "channels": channels,
        "fileSize": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def classify_download_error(msg: str) -> str:
    m = msg.lower()
    if "unsupported url" in m:
        return "UNSUPPORTED_URL"
    if "no video formats found" in m or "requested format is not available" in m:
        return "NO_AUDIO_STREAM"
    if "network" in m or "timed out" in m or "temporary failure" in m or "http error" in m:
        return "NETWORK_FAILURE"
    return "NETWORK_FAILURE"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--work-dir", required=True)
    ap.add_argument("--output-wav", required=True)
    args = ap.parse_args()

    work_dir = Path(args.work_dir)
    output_wav = Path(args.output_wav)
    work_dir.mkdir(parents=True, exist_ok=True)

    emit({"type": "progress", "phase": "metadata", "label": "Reading audio link", "current": 0, "overall": 5})

    downloaded_paths: list[Path] = []

    def hook(d: dict[str, Any]) -> None:
        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            current = int(max(0, min(100, (done / total) * 100))) if total else 0
            emit({
                "type": "progress",
                "phase": "download",
                "label": "Getting audio",
                "current": current,
                "overall": 10 + int(current * 0.55),
            })
        elif status == "finished":
            filename = d.get("filename")
            if filename:
                downloaded_paths.append(Path(filename))
            emit({"type": "progress", "phase": "download", "label": "Audio downloaded", "current": 100, "overall": 65})

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": str(work_dir / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [hook],
        "retries": 3,
        "fragment_retries": 3,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(args.url, download=True)
            if not info:
                return fail("NO_AUDIO_STREAM", "No audio stream found.")
            requested = info.get("requested_downloads")
            if isinstance(requested, list):
                for item in requested:
                    if isinstance(item, dict) and item.get("filepath"):
                        downloaded_paths.append(Path(str(item["filepath"])))
    except DownloadError as e:
        msg = str(e)
        return fail(classify_download_error(msg), msg)
    except Exception as e:
        return fail("NETWORK_FAILURE", str(e))

    source_path = next((p for p in downloaded_paths if p.exists()), None)
    if source_path is None:
        candidates = [p for p in work_dir.glob("source.*") if p.is_file()]
        source_path = candidates[0] if candidates else None
    if source_path is None or not source_path.exists():
        return fail("NO_AUDIO_STREAM", "Downloaded audio file was not created.")

    emit({"type": "progress", "phase": "convert", "label": "Preparing audio", "current": 0, "overall": 70})
    try:
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as e:
        return fail("FFMPEG_MISSING", str(e))
    if not ffmpeg or not os.path.exists(ffmpeg):
        return fail("FFMPEG_MISSING", "Audio conversion tool is missing.")

    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(source_path),
        "-vn",
        "-acodec",
        "pcm_s16le",
        str(output_wav),
    ]
    proc = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        return fail("CONVERSION_FAILED", proc.stderr.strip() or f"Conversion failed with exit {proc.returncode}.")

    try:
        info_out = wav_info(output_wav)
    except Exception as e:
        return fail("CONVERSION_FAILED", f"Could not read converted WAV: {e}")
    if not (info_out["durationSec"] > 0):
        return fail("CONVERSION_FAILED", "Converted audio has zero duration.")

    title = info.get("title") if isinstance(info, dict) else None
    video_id = info.get("id") if isinstance(info, dict) else None
    emit({"type": "progress", "phase": "finalize", "label": "Audio ready", "current": 100, "overall": 100})
    emit({
        "type": "done",
        "artifact": {
            "titleHint": title if isinstance(title, str) else None,
            "videoId": video_id if isinstance(video_id, str) else None,
            "mimeType": "audio/wav",
            "source": "import",
            **info_out,
        },
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
