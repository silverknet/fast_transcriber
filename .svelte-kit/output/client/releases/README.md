# Desktop installers (served by this app)

Files here are **not committed** (see root `.gitignore`). Same-origin URLs:

- `/releases/barbro-desktop-<version>-arm64.dmg`

## Populate before deploy or local `/download` testing

```bash
cd desktop && npm install && npm run dist:mac-arm64
cd .. && npm run sync-desktop-release
```

Then `npm run dev` or `npm run build` — the DMG is copied into `static/` and served like any static asset.
