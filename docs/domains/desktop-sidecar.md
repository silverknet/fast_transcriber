# Desktop Service

The BarBro desktop package is an Electron loopback service for native jobs and
hardware control. Packaged offline builds also host the built SvelteKit app and
provide status/offline windows. Browser features still communicate with native
capabilities through HTTP; the shell is not a second feature API.

Canonical detailed docs:

- [`../../desktop/README.md`](../../desktop/README.md) — dev, release, browser support, loopback endpoints.
- [`../python-auto-setup.md`](../python-auto-setup.md) — managed Python venvs and boot-time setup.
- [`../../desktop/native/python/README.md`](../../desktop/native/python/README.md) — Python script layout and manual smoke tests.

## Current Contract

- Native/browser feature API: loopback HTTP at `http://127.0.0.1:47842`.
- The desktop service must not import source modules from `src/`.
- Native Python and binary assets live under `desktop/native/` and are packaged
  outside `asar` when executable access is required.
- `BrowserWindow`, `statusPreload.cjs`, and narrow IPC handlers belong only to
  the service/offline shell.
- Do not add Electron IPC as an alternate API for normal SvelteKit features.

## Main Endpoints

| Method | Path | Use |
|---|---|---|
| `GET` | `/ping` | Connectivity + sidecar version. |
| `POST` | `/native/pick-folder` | OS folder picker. |
| `POST` | `/native/pick-open-file` | OS file-open picker. |
| `POST` | `/native/pick-save-file` | OS file-save picker. |
| `GET` | `/native/health` | Python venv health. |
| `GET` | `/native/setup/status` | Auto-setup progress. |
| `POST` | `/native/analyze-downbeats` | WAV bytes -> beat JSON. |
| `POST` | `/native/analyze-drums` | JSON `{stemAbsPath}` (drum stem on disk) -> drum-hit events + class counts (sections venv, one-shot). |
| `POST` | `/native/analyze-bass` | JSON `{stemAbsPath}` (bass stem on disk) -> bass notes via YIN pitch tracking (sections venv, one-shot). |
| `POST` | `/native/separate-stems` | Project audio path -> queued Demucs progress/job. |
| `GET` | `/native/stems/:jobId/:filename` | Fetch generated stem WAV. |
| `GET` | `/native/setup/youtube-import/status` | YouTube audio import readiness. |
| `POST` | `/native/setup/youtube-import` | Prepare managed YouTube audio import tools. |
| `POST` | `/native/import/youtube` | Queue YouTube URL -> PCM WAV import job. |
| `GET` | `/native/import/youtube/artifact/:jobId` | Fetch temp WAV artifact for main import flow. |
| `POST` | `/native/tts/synthesize` | JSON text -> WAV speech. |
| `POST` | `/native/project/hydration/export` | Create hydration package. |
| `POST` | `/native/project/hydration/import` | Import hydration package. |

Check [`../../desktop/README.md`](../../desktop/README.md) for the fuller table.

## Auto stem preparation (background client)

[`autoStems.ts`](../../src/lib/client/autoStems.ts) is a web-side scheduler — **no new endpoints**. When `barbro.project.json` has `autoStems.enabled`, it drives the existing stem queue for every analyzed, non-hidden song with audio:

- Reads fresh disk truth each tick via `getProjectInfo` (`stemsByPreset`) and decodes each candidate `.smap` for the analyzed flag + source path; enqueues missing/below-target stems via `POST /native/separate-stems` (`outputDir = <song>/stems/<quality>/`, full untrimmed file as input).
- **Health-checks** existing stems with `POST /native/project/wav-info/batch` — files with implausible size-for-duration (a render killed mid-write) are re-rendered.
- **Reaps orphaned jobs**: `GET /native/jobs` is read through `listJobsResult` (which, unlike `listJobsViaDesktop`, distinguishes "zero jobs" from "unreachable"); web-side `running`/`queued`/`paused` jobs the sidecar no longer reports are dropped so a companion restart can't wedge a song forever.
- Per-song attempt cap prevents render loops; caps + the gave-up set reset on companion reconnect, policy change, and project switch. Gave-up songs surface via `autoStemsAttention`.

## Development

```bash
npm run dev --prefix desktop
curl http://127.0.0.1:47842/ping
```

The web app polls `/ping` and redirects users to `/download` when the sidecar
is missing, unhealthy, installing Python deps, or below `MIN_SIDECAR_VERSION`.

## Release Rule

Do not bump
[`MIN_SIDECAR_VERSION`](../../src/lib/desktop/minSidecarVersion.ts) until the
matching desktop release assets exist. Otherwise every existing user is sent to
`/download` for a file that may 404.
