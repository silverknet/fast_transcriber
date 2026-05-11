# Provenance

- **`beats/analyze_downbeats.py`** — Logic maintained in parallel with BarBro server [`src/lib/server/analysis/python/analyze_downbeats.py`](../../../src/lib/server/analysis/python/analyze_downbeats.py). Merge fixes both sides when madmom / NumPy patches change.

- **`stems/demucs_separate.py`** — New headless CLI inspired by **frequency_domain** `stem_splitter.py` (Demucs invocation, PATH/env patterns). The original Tkinter UI is not copied; only the subprocess workflow is reflected here.

- **`piper_tts/`** — [Piper](https://github.com/rhasspy/piper) via the `piper-tts` PyPI wheel; voice ONNX files from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) (downloaded at setup time into Electron userData). See [`piper_tts/PROVENANCE.md`](piper_tts/PROVENANCE.md).
