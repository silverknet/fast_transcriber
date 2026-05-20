# Piper TTS provenance

- **Runtime:** [`piper-tts`](https://pypi.org/project/piper-tts/) (Python bindings + synthesis).
- **Voices:** [`rhasspy/piper-voices`](https://huggingface.co/rhasspy/piper-voices) — default debug voice **en_US-lessac-medium** (v1.0.0 medium quality).
- **Upstream project:** [`rhasspy/piper`](https://github.com/rhasspy/piper).

BarBro does not fork Piper; we only ship a thin `synthesize_wav.py` wrapper and sidecar install/download glue.
