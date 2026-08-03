# Python auto-setup (sidecar)

Why this exists, how it works, and how to extend it. Last meaningful
change: 2026-06-04 — added the `beats` venv and the auto-setup orchestrator
that runs at sidecar boot.

## The problem

The desktop sidecar shells out to Python for every analysis task — madmom
for beats, librosa for sections, demucs for stems, piper-tts for spoken
cues. None of these are installable as a single `pip install` and ship
inside a `.app`; each needs its own venv with carefully pinned versions.
Until this change, three of the four venvs were **user-installed via
in-app "Set up dependencies" buttons** and the fourth (beats) had **no
managed venv at all** — `pythonBeatsExe()` returned plain system
`python3`, so unless the user happened to have madmom + numpy installed
system-wide, beats analysis silently failed with "numpy not found".

The web app couldn't distinguish "sidecar not running" from "sidecar
running but its Python is broken," so users hit cryptic 500s when they
clicked Analyze.

## Architecture

Two cooperating pieces:

### 1. Health endpoint (`GET /native/health`)

Runs `python -c "import <modules>"` against each venv's interpreter,
returns `{ ok, installing, checks: [...] }`. Cached for 60 s so the web
app's 12 s poll cadence only spawns Python ~once per minute. Per-check
timeout = 5 s.

The `installing: true` flag is set when the auto-setup orchestrator is
in flight; the web app uses it to show a progress UI instead of the
generic "broken" lock.

Code: [`desktop/electron/main.mjs`](../desktop/electron/main.mjs)
`getHealthStatus()` / `handleHealth()`.

### 2. Auto-setup orchestrator (`runAutoSetup()`)

Fires at sidecar boot, **right after the loopback listener is up**
(scheduled inside the `beaconServer.listen()` callback). Walks each
managed venv:

1. **Probe** whether it's already ready (`<name>VenvIsReady()` +
   `<name><Module>Ready()` smoke test).
2. **If not**, POST `/native/setup/<name>` (the sidecar's own endpoint,
   via loopback fetch). Parse the NDJSON event stream the setup handler
   emits, pipe each event into the global `autoSetupState`.
3. Move on to the next stage.

Reuses the existing setup handlers verbatim — no duplicated install
logic. The aggregator state is exposed at
`GET /native/setup/status` for the web app to poll.

Code: [`desktop/electron/main.mjs`](../desktop/electron/main.mjs)
`autoSetupState`, `runAutoSetup()`, `runAutoSetupOne()`.

### Which venvs auto-install at boot

| venv | auto-install? | reason |
|---|---|---|
| `beats` | yes | madmom + numpy — required for downbeat analysis |
| `sections` | yes | librosa + numpy — required for section borders |
| `stems` | **no** | demucs + torch is ~1 GB. Auto-pulling would balloon first-launch to 5+ minutes. Lazy-installed via the Stems dialog on demand. |
| `piper-tts` | no (yet) | Optional feature; not required for analyze flow. Currently triggered when the user opens the Cues panel. |

This list is encoded in `runAutoSetup()` — change it there if the policy
changes.

## How the venvs are structured

Each managed venv follows the same pattern under
`<userData>/python/<name>-venv/`:

- `<name>VenvIsReady()` — cheap `existsSync(venvPython)` check
- `<name><Module>Ready()` — full smoke test (`python -c "import …"`),
  cached for 30 s, invalidated after setup
- `getNativePythonRoot()/<name>/requirements.txt` — what gets installed
- Marker file `<venvDir>/.barbro-reqs-hash` — sha256 prefix of
  `requirements.txt`, written after successful setup, checked by the
  `Ready()` probe so an edit to requirements forces a rebuild

The **beats** venv has an extra step the others don't: after installing
`requirements.txt`, the handler runs
`pip install --no-build-isolation madmom==0.16.1` as a **second pass**.
This is non-negotiable — madmom 0.16's `setup.py` imports
`numpy.get_include()` at build time, so numpy must already be in the
venv before madmom's compile step starts. PEP 517 build isolation would
hide that numpy, which is why `--no-build-isolation` is required.

The beats venv also pins **Python 3.10** (`uv venv --python 3.10`):
madmom 0.16.1's Cython extensions were built against the pre-1.24
numpy ABI, so we pin `numpy<1.24` in `requirements.txt` (uv resolves
to 1.23.5). numpy 1.23 ships no Python 3.12+ wheels; 3.10 is the
sweet spot where every pin lines up cleanly.

`madmom==0.16.1` itself was last released in 2018 and is broken on
Python 3.10+ at import time (`from collections import MutableSequence`
plus the removed `np.float` / `np.int` / `np.bool` aliases). We don't
fork or rebuild — `analyze_downbeats.py` applies the missing shims at
runtime before any madmom symbol is touched. The same shims are
applied in `beatsMadmomReady()` (the health probe in
`desktop/electron/nativePython.mjs`) and in `BEATS_HEALTH_PROBE`
(`desktop/electron/main.mjs`) so a working venv is correctly reported
as `ok`. We deliberately do **not** use madmom's `main` branch, which
has churned past 0.16.1 in ways that break against numpy 1.22+
(`numpy.AxisError: axis 1 is out of bounds` from `np.delete` in
madmom's array code) — that was the field bug that drove this pinning.

## Web app integration

- [`src/lib/client/desktopBeacon.ts`](../src/lib/client/desktopBeacon.ts):
  `probeDesktopPythonHealth()` and `probeDesktopSetupStatus()`.
- [`src/lib/stores/desktopCompanionStatus.ts`](../src/lib/stores/desktopCompanionStatus.ts):
  `pythonHealth: 'unknown' | 'installing' | 'ok' | 'broken'` +
  `setup: { running, overall, stages, lastError } | null`.
- [`src/routes/+layout.svelte`](../src/routes/+layout.svelte):
  `pollDesktopCompanion()` fetches both. The redirect effect locks the
  user to `/download` when health is `broken` OR `installing`.
- [`src/routes/download/+page.svelte`](../src/routes/download/+page.svelte):
  4 hero states — sidecar unreachable, **installing (with progress bar +
  per-stage rows)**, broken (with stderr from each failing check),
  running (continue CTA).

## Debugging

If a user reports "stuck on Setting up the audio engine":

1. Check `~/Library/Logs/BarBro Desktop/main.log` (Electron app logs).
   Look for `auto-setup:` lines — each stage logs success/failure.
2. Hit `http://127.0.0.1:47842/native/setup/status` directly in the
   user's browser — returns the live `autoSetupState`. Shows which
   stage is stuck, what `label` it's on, and the recorded `error`.
3. Hit `http://127.0.0.1:47842/native/health` — returns the per-venv
   import-test results with stderr from the failing imports.

If you need to force a re-setup (e.g. requirements edit didn't
auto-invalidate the marker): delete
`~/Library/Application Support/BarBro Desktop/python/<name>-venv/` and
restart the sidecar. The auto-setup will see the venv missing and rerun
from scratch.

## Windows (win-x64)

Same architecture, same uv bootstrap — differences only where the platform
forces them:

- **Paths**: everything lives under `%APPDATA%\BarBro Desktop\python\`
  (`bin\uv.exe`, `bin\ffmpeg.exe`, `<feature>-venv\Scripts\python.exe`).
- **No system Python required anywhere**: every venv (including stems,
  youtube-import and piper, which historically used `python3 -m venv`) is
  created by uv, which downloads a sealed CPython itself.
- **Stems + GPU**: on Windows the stems setup first checks for an NVIDIA
  driver (`nvidia-smi -L`); when present it preinstalls
  `torch==2.6.0`/`torchaudio==2.6.0` from the cu124 wheel index before the
  requirements install, so demucs runs on the GPU (`Device: cuda` in the job
  log; the setup log also prints a `Compute device:` line). Overrides:
  `BARBRO_TORCH_INDEX=off|cpu` forces CPU wheels, or set it to a custom index
  URL (e.g. cu118 for older drivers).
- **torchcodec is skipped on Windows** (it dlopens FFmpeg *shared libraries*
  that aren't there); `torchaudio 2.6` still has its own WAV writer via the
  `soundfile` backend. Markers in `stems/requirements.txt` encode all of this.
- **madmom (beats)** has no Windows wheel on PyPI and users have no compiler:
  the desktop-release CI builds `madmom-0.16.1-cp310-cp310-win_amd64.whl` and
  attaches it to every release; the beats setup installs that URL on win32
  (`BARBRO_MADMOM_WHEEL` overrides).
- **ffmpeg**: the stems/youtube venvs carry `imageio-ffmpeg`; its (version-
  named) static binary is copied to the canonical
  `python\bin\ffmpeg[.exe]` after setup and at boot
  (`ensureManagedFfmpegBinary()`); `ffmpegExePath()` prefers it, `BARBRO_FFMPEG`
  overrides. Demucs children get `BARBRO_FFMPEG_DIR` on their PATH.
- **Pause/resume of stem jobs is unavailable** (POSIX signals); the sidecar
  answers 501 and advertises `capabilities.pauseResume: false` on `/ping`, so
  the web hides those buttons.
- On Windows the tray icon provides the service lifecycle; packaged builds may
  also open the status/offline UI.

## Path A (bundling) — roadmap

This change implements **Path B**: auto-install on first boot. Path A
is the eventual robust ship — bundle pre-built venvs into the installer
so first-launch needs zero internet.

What's needed to flip to Path A:

1. **CI runner per platform** (mac-arm64, mac-x64, win-x64, linux-x64).
   Each runner needs a real Python toolchain. GitHub Actions free tier
   covers Mac runners; Windows runs come with Python preinstalled.
2. **Build script** (`desktop/scripts/build-venvs.sh`) that runs
   `uv venv` + `uv pip install` for each requirement set into
   `desktop/build/python/<name>-venv/`. Strip `__pycache__`, `.pyc`,
   pip cache, tests, locale files to keep size sane.
3. **`electron-builder.yml`** — add `extraResources` to copy
   `desktop/build/python/` into the packaged app's resources directory.
   Must NOT be inside asar (venvs contain executables).
4. **`nativePython.mjs` lookup order** — when running as a packaged
   app, check `process.resourcesPath + '/python/<name>-venv/'` first.
   Fall back to the existing userData path if the bundled venv is
   missing (dev mode + legacy).
5. **Disable the auto-setup orchestrator** for venvs that ship bundled
   (or keep it as a fallback in case the bundle is corrupted).

The auto-setup machinery here doesn't need to be ripped out — Path A
just changes the *probe* result so `runAutoSetup` sees the venvs as
already ready. The endpoints, status aggregator, web app integration,
and `/download` UI all keep working.

Expected installer size jumps:
- Mac arm64: ~80 MB → **~400 MB** (sections + beats only; stems still
  on-demand) or **~2.5 GB** (with stems bundled).
- Per-platform builds, so the cost multiplies across mac-arm/mac-x64/win/linux.

## File map

| Concern | File |
|---|---|
| Venv path / interpreter resolution | [`desktop/electron/nativePython.mjs`](../desktop/electron/nativePython.mjs) |
| Setup handlers (HTTP + install pipelines) | [`desktop/electron/main.mjs`](../desktop/electron/main.mjs) `handleSetup<Beats\|Sections\|Stems\|PiperTts>` |
| Auto-setup orchestrator | `desktop/electron/main.mjs` `runAutoSetup()`, `autoSetupState` |
| Health endpoint | `desktop/electron/main.mjs` `getHealthStatus()`, `handleHealth()` |
| Per-venv requirements | `desktop/native/python/<name>/requirements.txt` |
| Client probes | [`src/lib/client/desktopBeacon.ts`](../src/lib/client/desktopBeacon.ts) |
| Store | [`src/lib/stores/desktopCompanionStatus.ts`](../src/lib/stores/desktopCompanionStatus.ts) |
| Layout poll + redirect | [`src/routes/+layout.svelte`](../src/routes/+layout.svelte) |
| Download page UI | [`src/routes/download/+page.svelte`](../src/routes/download/+page.svelte) |
