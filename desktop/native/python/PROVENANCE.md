# Provenance

- **`beats/analyze_downbeats.py`** — Desktop-sidecar madmom analyzer. Earlier versions mirrored a server analyzer; the current app runs beat analysis through the desktop sidecar.

- **`stems/demucs_separate.py`** — New headless CLI inspired by **frequency_domain** `stem_splitter.py` (Demucs invocation, PATH/env patterns). The original Tkinter UI is not copied; only the subprocess workflow is reflected here.

- **`youtube/`** — `yt-dlp` via the PyPI package and `imageio-ffmpeg` for a managed ffmpeg executable. BarBro uses them only for source acquisition: best available YouTube audio is converted to a normal PCM WAV artifact before entering the app.

- **`piper_tts/`** — [Piper](https://github.com/rhasspy/piper) via the `piper-tts` PyPI wheel; voice ONNX files from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) (downloaded at setup time into Electron userData). See [`piper_tts/PROVENANCE.md`](piper_tts/PROVENANCE.md).
