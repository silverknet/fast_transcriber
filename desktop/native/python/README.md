# Desktop-native Python (isolated from BarBro web app)

These scripts live **only** under `desktop/native/python/`. They are **not** imported by `src/` (SvelteKit).

| Folder | Role | Origin |
|--------|------|--------|
| `beats/` | Downbeat JSON (`madmom`) | Logic aligned with BarBro server [`analyze_downbeats.py`](../../../src/lib/server/analysis/python/analyze_downbeats.py) — maintained here for desktop spawn |
| `stems/` | Demucs CLI wrapper | Derived from the sibling **frequency_domain** repo (`stem_splitter.py`) separation logic (no Tk UI) |
| `piper_tts/` | Piper ONNX TTS (`piper-tts` wheel) | Isolated venv + `synthesize_wav.py`; voice files downloaded to userData by the sidecar — see [`piper_tts/README.md`](piper_tts/README.md) |

## Virtual environments (recommended)

Two separate venvs avoid torch vs madmom conflicts:

```bash
# Beats (madmom)
bash desktop/native/python/beats/install-deps.sh

# Stems (demucs — heavy; install torch per Demucs docs for your platform)
python3 -m venv desktop/.venv-stems
desktop/.venv-stems/bin/pip install -U pip
desktop/.venv-stems/bin/pip install -r desktop/native/python/stems/requirements.txt
```

Set **`BARBRO_PYTHON`** / **`BARBRO_PYTHON_STEMS`** env vars when launching Electron if you want explicit interpreters (see `desktop/README.md`).

## Manual CLI smoke tests

```bash
./desktop/.venv-beats/bin/python3 desktop/native/python/beats/analyze_downbeats.py /path/to/audio.wav

./desktop/.venv-stems/bin/python3 desktop/native/python/stems/demucs_separate.py /path/to/song.wav --out-dir /tmp/stems-out
```
