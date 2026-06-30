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

### Python deps — auto-setup at boot

The sidecar auto-installs its Python venvs at first launch — no user
button click required. See [`docs/python-auto-setup.md`](../docs/python-auto-setup.md)
for the full architecture: health endpoint, auto-setup orchestrator,
per-venv install pipelines, debug recipe, and the Path A (bundled
installer) roadmap.

### Python env vars (optional dev overrides)

The managed venvs above take precedence over these in production. Use
the env vars when you want to point at a custom interpreter (e.g.
debugging with a different madmom version).

| Env | Purpose |
|-----|---------|
| `BARBRO_PYTHON` | Default interpreter when no managed venv resolves |
| `BARBRO_PYTHON_BEATS` | Beats interpreter override (beats venv at userData → this → `BARBRO_PYTHON` → `python3`) |
| `BARBRO_PYTHON_SECTIONS` | Sections interpreter override (sections venv → this → `BARBRO_PYTHON` → `python3`) |
| `BARBRO_PYTHON_STEMS` | Stems interpreter override (stems venv → this → `BARBRO_PYTHON` → `python3`) |
| `BARBRO_PYTHON_PIPER_TTS` | Piper interpreter override (piper venv → this → `BARBRO_PYTHON` → `python3`) |

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

### Releasing a new version (production)

The release pipeline is driven by a single git tag. Steps:

1. **Push the tag.** From `main`, tag and push:
   ```bash
   git tag desktop-v0.1.3       # bump the patch / minor / major
   git push origin desktop-v0.1.3
   ```
   The [`desktop-release`](../.github/workflows/desktop-release.yml) workflow fires on `desktop-v*` tags. It:
   - syncs `desktop/package.json#version` to the tag (`0.1.3`),
   - builds arm64 + x64 DMGs and ZIPs with `electron-builder`,
   - uploads them, plus `latest-mac.yml`, to the GitHub Release named after the tag.

2. **Verify the assets landed.** Open [the Releases page](https://github.com/silverknet/fast_transcriber/releases) and confirm the new release has the DMGs, ZIPs, and `latest-mac.yml`. If a previous tag accidentally created an empty release (e.g. `desktop-v0.1.1`, `desktop-v0.1.2`), delete it from the UI to keep the list clean — they're harmless but confusing.

3. **Tell the web app about it.** Bump [`src/lib/desktop/minSidecarVersion.ts#MIN_SIDECAR_VERSION`](../src/lib/desktop/minSidecarVersion.ts) to `'0.1.3'` and merge to `main`. Netlify deploys the change; every user running an older sidecar gets redirected to `/download` with update instructions.

   **Order matters:** never bump `MIN_SIDECAR_VERSION` before the release with that version has assets attached. If you do, every existing user is force-redirected to `/download` and the download URL 404s.

The static manifest at [`static/desktop-downloads.json`](../static/desktop-downloads.json) uses `releases/latest/download/<file>.dmg` URLs — those resolve to whichever GitHub release is marked "latest", which is automatically the chronologically newest published release. So you never edit the manifest as part of a release.

### What users see when they need to update

The web app polls the sidecar's `/ping` every 12 s. When the reported version is below `MIN_SIDECAR_VERSION`, the layout redirects to `/download`, which shows a numbered update flow:

1. Quit BarBro Desktop (right-click Dock icon → Quit).
2. Download the new version.
3. Drag it into Applications, click **Replace** when prompted.
4. Open the new BarBro Desktop, click **I've updated — check again**.

macOS replaces the old `.app` in-place during step 3 — no manual uninstall needed. Step 1 matters because the running sidecar binds loopback port 47842; the new launch would fail otherwise.

## Browser support

**Works:** Chrome, Edge, Firefox. **Doesn't work:** Safari.

The web app is served over HTTPS (from Netlify) and needs to fetch from the sidecar at `http://127.0.0.1:47842`. Chrome and Firefox special-case loopback / `localhost` as "potentially trustworthy" and let the HTTPS → HTTP request through. Safari doesn't grant that exemption — it treats every such request as mixed content and blocks it with `"Not allowed to request resource"` / `"due to access control checks"` in the console.

We confirmed empirically (June 2026, sidecar v0.1.5) that:
- `Access-Control-Allow-Private-Network: true` is set on every sidecar response (handles Chrome's strict PNA mode).
- Safari still blocks even with that header — the block happens before any CORS/PNA check.
- No server-side header fix exists.

Until we ship the real fix, `/download` detects Safari (`navigator.vendor === 'Apple Computer, Inc.'` + UA filter) and shows a hero telling the user to use Chrome or Firefox instead. See `src/routes/download/+page.svelte` (`isSafari` derived) and `src/lib/client/desktopBeacon.ts` (where the probe fails silently).

### The real fix (deferred): HTTPS on the loopback sidecar

To unblock Safari we need both endpoints on HTTPS. The conventional pattern (used by Plex, qBittorrent, etc.):

1. Sidecar generates a self-signed TLS cert on first launch, stored under `~/Library/Application Support/barbro-desktop/`.
2. Installer adds the cert to the macOS Keychain as trusted (one-time `security add-trusted-cert` invocation; needs admin password OR a user-installed cert).
3. Map a hostname like `localhost.barbro.app` → `127.0.0.1` (either via `/etc/hosts` or DNS for the public-domain trick that some Plex-style apps use).
4. Sidecar listens on `https://localhost.barbro.app:47842` with the trusted cert.
5. Web app probes that URL instead of `http://127.0.0.1`.

Estimated effort: roughly a day. Drawbacks: the keychain install step needs a one-time admin prompt (or the cert lives only in the user keychain, which Safari distrusts by default), and the hostname mapping is fiddly. The `.dev.local` mDNS path is another option but Safari's mDNS support is uneven.

For now: ship the Safari warning and revisit this when the Mac user base big enough on Safari to justify the day of work.

## Layout

| Path | Role |
|------|------|
| `electron/main.mjs` | Headless main process: loopback HTTP server + Python spawning. No window. |
| `electron/nativePython.mjs` | Resolve `native/python` paths (packaged `asar.unpacked`), spawn helpers |
| `native/python/beats/` | `analyze_downbeats.py` (madmom) — desktop-sidecar beat analyzer |
| `native/python/stems/` | `demucs_separate.py` — headless Demucs (derived from **frequency_domain** workflow) |
| `native/python/youtube/` | `import_audio.py` — YouTube best-audio import to PCM WAV via managed tools |
| `native/python/piper_tts/` | Piper TTS — `synthesize_wav.py` + `requirements.txt` (separate venv from stems) |

## Loopback HTTP

The main process listens on **`127.0.0.1:47842`** with `Access-Control-Allow-Origin: *` so the BarBro web app can call it directly from the browser.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/ping` | Health check — returns `{ ok, name: 'barbro-desktop', version }`. Drives the **Monitor** chip in the web header. |
| `POST` | `/native/analyze-downbeats` | Body = WAV bytes; returns `{ ok, data: { beats: [...] } }`. |
| `POST` | `/native/separate-stems` | Queue path-based Demucs stem separation; progress streams through `/native/jobs/:jobId/events`. |
| `GET` | `/native/stems/:jobId/:filename` | Stream one exported stem WAV. |
| `DELETE` | `/native/jobs/:jobId` | Cancel or release a queued/native job. |
| `GET` | `/native/setup/youtube-import/status` | YouTube audio import readiness. |
| `POST` | `/native/setup/youtube-import` | NDJSON stream: prepare managed audio import tools. |
| `POST` | `/native/import/youtube` | Queue YouTube URL -> PCM WAV import. |
| `GET` | `/native/import/youtube/artifact/:jobId` | Stream the temp WAV artifact for browser import. |
| `GET` | `/native/setup/piper-tts/status` | `{ ready, venvDir, modelPath, modelPresent, … }` — Piper venv + default voice. |
| `POST` | `/native/setup/piper-tts` | NDJSON stream: create venv, `pip install -r piper_tts/requirements.txt`, download **en_US-lessac-medium**. |
| `GET` | `/native/tts/hello-world` | Returns `audio/wav` saying “Hello world.” (web debug: `/texttospeech`). |
| `POST` | `/native/tts/synthesize` | JSON `{ "text": "…" }` → WAV (cue-track speech via Piper). |

**Browsers:** pages served over **HTTPS** may block or warn on **`http://127.0.0.1`** (mixed content). Chromium typically allows loopback; verify **Safari / Firefox** for your production URL. Local dev on `http://localhost:5173` is fine.

## Relationship to other work

- **BarBro web / `src/`** stays separate; the desktop app does not import it.
- **`frequency_domain`** Tk stem GUI is not bundled — Demucs logic is reflected in `native/python/stems/demucs_separate.py`; the web app's Stem Splitter UI mirrors the Tkinter shape (`StemSplitter.svelte`).
