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
import threading

# Bump when transcription params change enough to invalidate cached results.
# v2: condition_on_previous_text=False (whisper skips REPEATED lyric lines
#     when conditioning — fatal for choruses) + softer VAD threshold so quiet
#     opening phrases over the intro aren't dropped.
# v3: temperature=0.0 (NO fallback ladder). The fallback resamples failed
#     segments with randomness — on singing, many segments fail thresholds,
#     making every run produce different words (user saw fit quality swing
#     17→30→17 rows on identical audio). Determinism beats marginal quality.
# v4: default model = large-v3-turbo + a language hint passed from the caller
#     (derived from the imported lyrics). Recognition — not word matching — was
#     the fit bottleneck; measured 54%→65% word-anchor across the library.
TRANSCRIBER_VERSION = 4

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

    keepalive_stop = None
    keepalive_thread = None
    try:
        _log(f"loading model '{model_name}' (dir={model_dir})")
        emit({"type": "log", "msg": "loading speech model (downloads on first use)"})
        if stream:
            keepalive_stop = threading.Event()

            def _download_keepalive() -> None:
                while keepalive_stop is not None and not keepalive_stop.is_set():
                    emit({"type": "log", "msg": "downloading speech model…"})
                    keepalive_stop.wait(5.0)

            keepalive_thread = threading.Thread(target=_download_keepalive, daemon=True)
            keepalive_thread.start()
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
    finally:
        if keepalive_stop is not None:
            keepalive_stop.set()
        if keepalive_thread is not None:
            keepalive_thread.join(timeout=1.0)

    try:
        _log(f"transcribing: {audio_path}")
        # VAD is mandatory: without it Whisper hallucinates words in
        # instrumental sections, which poisons the alignment.
        segments, info = model.transcribe(
            audio_path,
            word_timestamps=True,
            vad_filter=True,
            # Softer than the 0.5 default: sung vocals over an intro bed are
            # quieter than speech, and the default drops short opening phrases
            # ("Sommartider, hej hej" at 0:01 vanished entirely).
            vad_parameters={
                "threshold": 0.35,
                "min_silence_duration_ms": 500,
                "speech_pad_ms": 400,
            },
            # CRITICAL for lyrics: with conditioning on, whisper deduplicates
            # repeated lines (choruses!) and can skip whole occurrences.
            condition_on_previous_text=False,
            # Deterministic decoding — the default temperature fallback ladder
            # RESAMPLES failed segments randomly, so hard (sung) audio produced
            # different words on every run and alignment quality see-sawed.
            # Loop-breaking must then be deterministic too: without it, greedy
            # decoding gets stuck emitting "uh, uh, uh…" through entire verses
            # (observed). The n-gram ban still allows real lyric repeats like
            # "hold me, hold me" (a first 4-gram is always allowed).
            temperature=0.0,
            repetition_penalty=1.15,
            no_repeat_ngram_size=4,
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
