#!/usr/bin/env python3
"""
BarBro Piper TTS — write spoken text to a mono WAV via ONNX voice model.

Invoked only by the Electron sidecar (`desktop/electron/main.mjs`), not the web app.
"""
from __future__ import annotations

import argparse
import sys
import wave
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser(description="Synthesize text to WAV using Piper.")
    p.add_argument("--model", required=True, help="Path to voice .onnx (config: same name + .json)")
    p.add_argument("--output", required=True, help="Output .wav path")
    p.add_argument("--text", default=None, help="UTF-8 text to speak (or use --text-file)")
    p.add_argument(
        "--text-file",
        type=Path,
        default=None,
        help="UTF-8 file to read text from (avoids argv length limits)",
    )
    args = p.parse_args()

    if args.text_file is not None:
        tf = Path(args.text_file)
        if not tf.is_file():
            print(f"MISSING_TEXT_FILE:{tf}", file=sys.stderr)
            return 2
        text = tf.read_text(encoding="utf-8").strip()
    elif args.text is not None:
        text = (args.text or "").strip()
    else:
        print("Provide --text or --text-file", file=sys.stderr)
        return 2

    if not text:
        print("EMPTY_TEXT", file=sys.stderr)
        return 2

    model = Path(args.model)
    if not model.is_file():
        print(f"MISSING_MODEL:{model}", file=sys.stderr)
        return 2

    try:
        from piper import PiperVoice
    except ImportError as e:
        print(f"IMPORT_ERROR:{e}", file=sys.stderr)
        return 3

    outp = Path(args.output)
    outp.parent.mkdir(parents=True, exist_ok=True)

    voice = PiperVoice.load(str(model))
    with wave.open(str(outp), "wb") as wav_file:
        voice.synthesize_wav(text, wav_file)

    print(outp.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
