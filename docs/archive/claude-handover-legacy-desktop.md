# Legacy Claude Handover (Stale)

This file is archived session context. It is not current operating guidance.

The desktop sidecar is now headless and HTTP-only. It has no renderer, no
preload script, and no IPC API. Current docs:

- [`../domains/desktop-sidecar.md`](../domains/desktop-sidecar.md)
- [`../../desktop/README.md`](../../desktop/README.md)

---

# Original Handover

## Current state

- Desktop shell exists and stays orthogonal to web app code under `src/`.
- macOS arm64 unsigned packaging works (`desktop`): `npm run dist:mac-arm64`.
- Same-origin download flow is wired:
  - `/download` reads manifest from `PUBLIC_DESKTOP_MANIFEST_URL` or static fallback.
  - Static fallback is `static/desktop-downloads.json`.
  - Sync script copies DMG into `static/releases/` and updates manifest.
- Desktop connection indicator is live in web header (monitor chip, loopback ping).
- Native Python scaffolding has been added under `desktop/native/python/`:
  - `beats/analyze_downbeats.py` (desktop copy aligned with server script)
  - `stems/demucs_separate.py` (headless Demucs flow derived from frequency_domain workflow)
  - IPC + preload + renderer buttons are wired in Electron for local testing.

## Key files

- Download/manifest:
  - `src/routes/download/+page.server.ts`
  - `src/routes/download/+page.svelte`
  - `static/desktop-downloads.json`
  - `scripts/sync-desktop-release.mjs`
- Web desktop beacon:
  - `src/lib/client/desktopBeacon.ts`
  - `src/lib/stores/desktopCompanionStatus.ts`
  - `src/routes/+layout.svelte`
  - `src/lib/components/AppMenuBar.svelte`
- Desktop app:
  - `desktop/electron/main.mjs`
  - `desktop/electron/preload.cjs`
  - `desktop/electron/nativePython.mjs`
  - `desktop/renderer/index.html`
  - `desktop/electron-builder.yml`
  - `desktop/native/python/README.md`
  - `desktop/native/python/PROVENANCE.md`

## Known issues / caveats

- `npm run check` still fails on pre-existing typed `Button` usage in `src/routes/set/+page.svelte` (missing `class` prop at several call sites). Not introduced by desktop work.
- Desktop currently runs placeholder renderer UI, not the actual BarBro editor bundle.
- Python deps are not auto-installed; user must create venvs manually (documented in `desktop/native/python/README.md`).
- No notarization/codesign for public distribution yet (ad-hoc/dev only).

## What to do next (ordered)

1. **Wire real app in desktop shell**
   - Decide: load hosted BarBro URL vs bundle static build into Electron.
   - Keep separation: desktop should call web via explicit boundaries (URL/IPC), not import `src`.

2. **Turn native analysis into app flow**
   - Connect `native:analyze-downbeats` result to BarBro model path (currently only returns JSON in desktop renderer).
   - Reuse the existing TS transform logic (`beatsToSongMap`) by exposing a clear interface boundary (likely move shared logic into a desktop-safe package/module).

3. **Finish stems workflow integration**
   - Hook `native:demucs-separate` to the real project/export flow.
   - Add progress streaming/log events (current IPC returns result only at completion).

4. **Harden packaging**
   - Add Intel mac target and Windows target in builder/CI.
   - Add icons/resources.
   - Later: Apple notarization + signing.

5. **Keep docs synced**
   - Update `docs/goal-plan.md` levels/notes after each meaningful desktop step (required by AGENTS.md).

## Useful commands

- Web dev: `npm run dev`
- Desktop dev: `npm run dev --prefix desktop`
- Build desktop arm64: `npm run dist:mac-arm64 --prefix desktop`
- Copy DMG into static + update manifest: `npm run sync-desktop-release`
- One-shot build + sync: `npm run desktop:dist-mac-sync`
