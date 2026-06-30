# Desktop-native Python (isolated from BarBro web app)

These scripts live **only** under `desktop/native/python/`. They are **not** imported by `src/` (SvelteKit).

| Folder | Role | Origin |
|--------|------|--------|
| `beats/` | Downbeat JSON (`madmom`) | Desktop-sidecar analyzer used by `/native/analyze-downbeats` |
| `stems/` | Demucs CLI wrapper | Derived from the sibling **frequency_domain** repo (`stem_splitter.py`) separation logic (no Tk UI) |
| `youtube/` | YouTube audio import | `yt-dlp` + managed ffmpeg wrapper; downloads best audio and converts it to PCM WAV |
| `piper_tts/` | Piper ONNX TTS (`piper-tts` wheel) | Isolated venv + `synthesize_wav.py`; voice files downloaded to userData by the sidecar — see [`piper_tts/README.md`](piper_tts/README.md) |

## Virtual environments (recommended)

Two separate venvs avoid torch vs madmom conflicts:

**In production, the sidecar auto-installs these venvs at first boot** —
no manual `install-deps.sh` step needed. See
[`docs/python-auto-setup.md`](../../../docs/python-auto-setup.md) for
the architecture.

The shell scripts below remain as legacy / dev-only convenience for
contributors who want to point Electron at a hand-built venv via
`BARBRO_PYTHON_*` env vars (see `desktop/README.md`):

```bash
# Beats (madmom) — only needed if you don't want the sidecar's managed
# beats venv. Most contributors should let auto-setup handle this.
bash desktop/native/python/beats/install-deps.sh

# Stems (demucs — heavy; install torch per Demucs docs for your platform).
# Not auto-installed at boot because it's ~1 GB; the Stems dialog handles
# its own setup on demand.
python3 -m venv desktop/.venv-stems
desktop/.venv-stems/bin/pip install -U pip
desktop/.venv-stems/bin/pip install -r desktop/native/python/stems/requirements.txt
```

## Manual CLI smoke tests

```bash
./desktop/.venv-beats/bin/python3 desktop/native/python/beats/analyze_downbeats.py /path/to/audio.wav

./desktop/.venv-stems/bin/python3 desktop/native/python/stems/demucs_separate.py /path/to/song.wav --out-dir /tmp/stems-out

python3 desktop/native/python/youtube/import_audio.py 'https://www.youtube.com/watch?v=VIDEO_ID' --work-dir /tmp/barbro-youtube --output-wav /tmp/barbro-youtube/audio.wav
```
