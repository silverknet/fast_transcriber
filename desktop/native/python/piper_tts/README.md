# Piper TTS (`piper_tts/`)

Self-contained **text-to-speech** module for the BarBro desktop sidecar. Uses [Piper](https://github.com/rhasspy/piper) (`piper-tts` on PyPI) and ONNX voice files under Electron **userData** (not bundled in the repo).

## Layout

| Path | Role |
|------|------|
| `requirements.txt` | `piper-tts` wheel (pulls `onnxruntime` etc.) |
| `synthesize_wav.py` | CLI: `--model`, `--output`, `--text` or `--text-file` |
| `PROVENANCE.md` | Upstream pointers |

## Endpoints (sidecar)

- `GET /native/setup/piper-tts/status` — venv + default voice files present?
- `POST /native/setup/piper-tts` — NDJSON stream: create venv, `pip install`, download **en_US-lessac-medium** from Hugging Face.
- `GET /native/tts/hello-world` — returns `audio/wav` saying **“Hello world.”** (debug).
- `POST /native/tts/synthesize` — JSON `{ "text": "…" }` → WAV (cue speech; sidecar writes text to a temp file for Piper).

## Manual test (after venv + model exist)

```bash
# Use the same venv the sidecar creates, or a local venv:
python3 -m venv /tmp/piper-venv && /tmp/piper-venv/bin/pip install -r requirements.txt
/tmp/piper-venv/bin/python synthesize_wav.py \
  --model "$HOME/Library/Application Support/BarBro Desktop/python/piper-tts/models/en_US-lessac-medium.onnx" \
  --output /tmp/hi.wav \
  --text "Hello world."
```

Replace the model path with your OS’s `userData` folder (see sidecar logs on startup).
