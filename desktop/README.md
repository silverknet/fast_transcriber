# BarBro Desktop (headless sidecar)

This folder is **intentionally isolated** from the SvelteKit app at the repo root:

- No imports from `../src`.
- Own `package.json`, dependencies, and build lifecycle.
- **Native Python** lives under `native/python/` only (beat detection + Demucs + Piper TTS). See [`native/python/README.md`](native/python/README.md).
- **No user-facing UI.** All UI lives in the BarBro web app; this process runs in the background and is reachable only over loopback HTTP.

## Scripts

```bash
cd desktop
npm install
npm run dev
```

The process exits to the OS dock/taskbar only (no window). Watch the terminal for startup banner and per-job logs. Quit with `Cmd+Q` (macOS) or by closing the terminal.

`electron` downloads its binary during `npm install`; run that on your machine (normal terminal, not a restricted sandbox) so it can write its cache under your user directory.

### Python env vars (optional)

| Env | Purpose |
|-----|---------|
| `BARBRO_PYTHON` | Interpreter for **madmom** beat script (`desktop/.venv-beats/bin/python3` after install-deps) |
| `BARBRO_PYTHON_STEMS` | Interpreter for **demucs** (defaults to `BARBRO_PYTHON` then `python3`) |
| `BARBRO_PYTHON_PIPER_TTS` | Interpreter for **Piper** (defaults to sidecar `piper-tts-venv` then `BARBRO_PYTHON` / `python3`) |

### Packaged build (Apple Silicon, unsigned dev)

On an **Apple Silicon Mac**, from `desktop/`:

```bash
npm run dist:mac-arm64
```

Artifacts land in **`desktop/release/`** (gitignored):

- `BarBro Desktop-<version>-arm64.dmg`
- `BarBro Desktop-<version>-arm64-mac.zip`

`CSC_IDENTITY_AUTO_DISCOVERY=false` skips Developer ID lookup; the app is **ad-hoc signed** only — fine for dev; Gatekeeper may still prompt users until you add notarization later.

**Intel Mac / CI:** add a separate target or run the same project on an x64 runner with `--x64` when you need it.

**Serve the DMG from the BarBro web app (same server):** from repo root run **`npm run desktop:dist-mac-sync`** — copies into `static/releases/` and refreshes `static/desktop-downloads.json`. Deploy after that so `/releases/barbro-desktop-<version>-arm64.dmg` exists on the host.

## Layout

| Path | Role |
|------|------|
| `electron/main.mjs` | Headless main process: loopback HTTP server + Python spawning. No window. |
| `electron/nativePython.mjs` | Resolve `native/python` paths (packaged `asar.unpacked`), spawn helpers |
| `native/python/beats/` | `analyze_downbeats.py` (madmom) — twin of server script |
| `native/python/stems/` | `demucs_separate.py` — headless Demucs (derived from **frequency_domain** workflow) |
| `native/python/piper_tts/` | Piper TTS — `synthesize_wav.py` + `requirements.txt` (separate venv from stems) |

## Loopback HTTP

The main process listens on **`127.0.0.1:47842`** with `Access-Control-Allow-Origin: *` so the BarBro web app can call it directly from the browser.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/ping` | Health check — returns `{ ok, name: 'barbro-desktop', version }`. Drives the **Monitor** chip in the web header. |
| `POST` | `/native/analyze-downbeats` | Body = WAV bytes; returns `{ ok, data: { beats: [...] } }`. |
| `POST` | `/native/separate-stems?model=…&shifts=…&overlap=…&stems=…` | Body = audio bytes; response is **NDJSON** event stream (`log` / `progress` / `done` / `job` / `error` lines). Stems live in a temp dir for 30 min after `done`. |
| `GET` | `/native/stems/:jobId/:filename` | Stream one exported stem WAV. |
| `DELETE` | `/native/stems/:jobId` | Wipe the temp dir for a finished job. |
| `GET` | `/native/setup/piper-tts/status` | `{ ready, venvDir, modelPath, modelPresent, … }` — Piper venv + default voice. |
| `POST` | `/native/setup/piper-tts` | NDJSON stream: create venv, `pip install -r piper_tts/requirements.txt`, download **en_US-lessac-medium**. |
| `GET` | `/native/tts/hello-world` | Returns `audio/wav` saying “Hello world.” (web debug: `/texttospeech`). |
| `POST` | `/native/tts/synthesize` | JSON `{ "text": "…" }` → WAV (cue-track speech via Piper). |

**Browsers:** pages served over **HTTPS** may block or warn on **`http://127.0.0.1`** (mixed content). Chromium typically allows loopback; verify **Safari / Firefox** for your production URL. Local dev on `http://localhost:5173` is fine.

## Relationship to other work

- **BarBro web / `src/`** stays separate; the desktop app does not import it.
- **`frequency_domain`** Tk stem GUI is not bundled — Demucs logic is reflected in `native/python/stems/demucs_separate.py`; the web app's Stem Splitter UI mirrors the Tkinter shape (`StemSplitter.svelte`).
