# Architecture Overview

BarBro is a browser-first music transcription and set-prep app. The core user
state is a `SongMap` stored in `.smap` files and, optionally, synced through
Supabase for cloud projects.

## Runtime Pieces

| Piece | Path | Responsibility |
|---|---|---|
| SvelteKit web app | [`../src/`](../src/) | UI, auth routes, project editing, export orchestration, Supabase server endpoints. |
| Desktop sidecar | [`../desktop/`](../desktop/) | Headless Electron process exposing loopback HTTP for native/Python jobs. |
| Python analyzers | [`../desktop/native/python/`](../desktop/native/python/) | Beats, sections/chroma, Demucs stems, Piper TTS wrappers. |
| Database migrations | [`../db/migrations/`](../db/migrations/) | Supabase/Postgres schema, RLS, RPC helpers, access grants. |

## Current Boundaries

- `src/` must not depend on Electron internals.
- `desktop/` must not import from `src/`; communication is HTTP only.
- Python scripts are spawned by the sidecar, not by the browser.
- Audio bytes generally stay local. Cloud sync stores project/song JSON and
  metadata; hydration packs and local reconcile cover missing audio.
- Ableton export writes `.als` XML plus project-relative assets. Read
  [`domains/ableton-als.md`](domains/ableton-als.md) before changing it.

## Frontend Conventions

The app is SvelteKit 2 + Svelte 5. New Svelte code should use runes:

- `$state` for local mutable state.
- `$derived` / `$derived.by` for computed state.
- Prefer explicit events, load functions, stores, and helper functions over
  `$effect`.
- Avoid `{@const}` in new markup. If a value is reused in markup, derive it in
  the script block or pre-shape the array/object you iterate over.

Existing legacy markup still has some `{@const}`. Treat it as debt, not as the
style to copy.

## Persistence Layers

| Layer | Canonical files |
|---|---|
| `.smap` binary format | [`smap-format.md`](smap-format.md), [`../src/lib/songmap/smapFile.ts`](../src/lib/songmap/smapFile.ts) |
| Project folder layout | [`../src/lib/project/`](../src/lib/project/) |
| Cloud projects/songs/members | [`domains/cloud-auth-sync.md`](domains/cloud-auth-sync.md), [`../src/lib/client/cloudSync.ts`](../src/lib/client/cloudSync.ts), [`../src/routes/api/cloud/`](../src/routes/api/cloud/) |
| Supabase access gate | [`../src/lib/server/access.ts`](../src/lib/server/access.ts), [`../src/routes/admin/access/`](../src/routes/admin/access/) |

## Verification

Use the smallest check that covers the changed surface:

- Svelte/TypeScript: `npm run check`
- Pure logic: focused `vitest` file, or `npm run test` before broader handoff
- Desktop sidecar: `npm run dev --prefix desktop`, then hit `/ping` or the
  specific endpoint
- Database: apply migrations once per target DB, then verify through the app or
  a service-role probe
