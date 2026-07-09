#!/usr/bin/env python3
"""Word-level speech transcription for lyrics alignment.

Contract (mirrors sections/chord_chroma.py + demucs streaming):
  argv[1]              audio path (vocals stem preferred; any decodable file).
  --stream-progress    emit NDJSON lines on stdout:
                         {"type":"log","msg":...}
                         {"type":"progress","ratio":0..1}
                         {"type":"done", ...result}
                         {"type":"error","msg":...}
                       Without the flag: single JSON result object on stdout.
  stdin JSON           {"modelDir": str, "model": "small", "language": str?}

Result object:
  {"words": [{"text","startSec","endSec","conf"}...],
   "language": "en", "transcriberVersion": 1}

Times are seconds into the INPUT FILE (original audio time when the input is
a stem/original mix — stems share the source timeline).

Exit codes: 2 usage, 3 bad stdin JSON, 4 missing dependency, 5 audio/model
failure, 1 unhandled.
"""
from __future__ import annotations

import json
import sys

# Bump when transcription params change enough to invalidate cached results.
TRANSCRIBER_VERSION = 1

DEFAULT_MODEL = "small"


def _log(msg: str) -> None:
    print(f"[transcribe] {msg}", file=sys.stderr, flush=True)


def _read_params() -> dict:
    payload = sys.stdin.read()
    if not payload.strip():
        return {}
    obj = json.loads(payload)
    return obj if isinstance(obj, dict) else {}


def main() -> None:
    _log(f"starting (python {sys.version.split()[0]}, argv={sys.argv[1:]})")
    args = [a for a in sys.argv[1:] if a != "--stream-progress"]
    stream = "--stream-progress" in sys.argv[1:]

    def emit(obj: dict) -> None:
        if stream:
            print(json.dumps(obj), flush=True)

    if len(args) < 1:
        print("Usage: transcribe.py <audio_path> [--stream-progress]", file=sys.stderr)
        sys.exit(2)
    audio_path = args[0]

    try:
        params = _read_params()
    except json.JSONDecodeError as exc:
        print(f"Invalid params JSON on stdin: {exc}", file=sys.stderr)
        emit({"type": "error", "msg": f"Invalid params JSON: {exc}"})
        sys.exit(3)

    model_name = str(params.get("model") or DEFAULT_MODEL)
    model_dir = params.get("modelDir")
    language = params.get("language")

    _log("importing faster_whisper")
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        print(
            f"Missing dependency ({getattr(exc, 'name', exc)}). "
            "The lyrics venv should auto-install via the setup endpoint; "
            "it is managed by the bundled uv (Astral).",
            file=sys.stderr,
        )
        emit({"type": "error", "msg": "Speech engine not installed yet."})
        sys.exit(4)

    try:
        _log(f"loading model '{model_name}' (dir={model_dir})")
        emit({"type": "log", "msg": "loading speech model (downloads on first use)"})
        model = WhisperModel(
            model_name,
            device="cpu",
            compute_type="int8",
            download_root=str(model_dir) if model_dir else None,
        )
    except Exception as exc:  # noqa: BLE001 — model/download failures
        print(f"Could not load speech model: {exc}", file=sys.stderr)
        emit({"type": "error", "msg": f"Could not load speech model: {exc}"})
        sys.exit(5)

    try:
        _log(f"transcribing: {audio_path}")
        # VAD is mandatory: without it Whisper hallucinates words in
        # instrumental sections, which poisons the alignment.
        segments, info = model.transcribe(
            audio_path,
            word_timestamps=True,
            vad_filter=True,
            language=str(language) if language else None,
            beam_size=5,
        )
        duration = float(getattr(info, "duration", 0.0) or 0.0)
        words = []
        for seg in segments:
            for w in seg.words or []:
                text = (w.word or "").strip()
                if not text:
                    continue
                words.append(
                    {
                        "text": text,
                        "startSec": round(float(w.start), 3),
                        "endSec": round(float(w.end), 3),
                        "conf": round(float(w.probability), 3),
                    }
                )
            if duration > 0:
                emit({"type": "progress", "ratio": min(1.0, float(seg.end) / duration)})
        _log(f"done: {len(words)} words, language={info.language}")
        result = {
            "words": words,
            "language": info.language,
            "transcriberVersion": TRANSCRIBER_VERSION,
        }
        if stream:
            emit({"type": "done", **result})
        else:
            print(json.dumps(result))
    except Exception as exc:  # noqa: BLE001 — audio decode / runtime failures
        print(f"Transcription failed: {exc}", file=sys.stderr)
        emit({"type": "error", "msg": f"Transcription failed: {exc}"})
        sys.exit(5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as exc:  # noqa: BLE001
        print(f"Unhandled error: {exc}", file=sys.stderr)
        sys.exit(1)
