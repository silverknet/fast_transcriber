# Agent Guide

This file is the fast on-ramp for agents working in BarBro. Keep it short,
current, and operational. Deep domain notes live under [`docs/domains/`](docs/domains/).

## Start Here

1. Read [`docs/index.md`](docs/index.md) for the documentation map.
2. Read [`docs/goal-plan.md`](docs/goal-plan.md) before changing feature maturity, roadmap, or architecture.
3. Use the domain doc for the area you touch:
   - Ableton export: [`docs/domains/ableton-als.md`](docs/domains/ableton-als.md)
   - Desktop sidecar: [`docs/domains/desktop-sidecar.md`](docs/domains/desktop-sidecar.md)
   - Cloud/auth/sync: [`docs/domains/cloud-auth-sync.md`](docs/domains/cloud-auth-sync.md)
   - `.smap` format: [`docs/smap-format.md`](docs/smap-format.md)
   - Chord suggestions: [`docs/domains/chord-suggestions.md`](docs/domains/chord-suggestions.md)

## Current Shape

BarBro is a SvelteKit 2 / Svelte 5 web app with a separate headless Electron
sidecar for native jobs. The web app lives under `src/`; the desktop sidecar
lives under `desktop/` and exposes loopback HTTP on `127.0.0.1:47842`.

The desktop sidecar is intentionally isolated:

- It must not import from `src/`.
- It has no renderer, no preload script, and no IPC API.
- Browser UI talks to it through explicit HTTP endpoints.

Local `http://localhost:5173` uses the Supabase project configured in `.env`.
At the time of writing this repo points at hosted Supabase, not a local
Supabase stack, unless you deliberately change `.env`.

## Commands

```bash
npm run dev
npm run check
npm run test

npm run dev --prefix desktop
npm run desktop:dist-mac-sync
npm run db:migrate
```

Use `npm run check` after Svelte/TypeScript/doc-link-adjacent changes. Use
focused Vitest runs when touching pure logic, parsers, sync, audio math, or
export code.

## Svelte 5 Style

Prefer modern Svelte 5 runes and derived state:

- Use `$state` for local mutable state.
- Use `$derived` / `$derived.by` for values computed from state or props.
- Prefer event handlers, form actions, load functions, stores, or explicit
  helper functions over `$effect`.
- Avoid `{@const}` in markup for new code. Move repeated calculations into
  `$derived`, a helper function, or pre-shaped data.
- Keep data shaping in script blocks where possible so markup stays readable.

Existing files still contain some `{@const}` and effects. Do not expand that
pattern when adding new UI.

## Roadmap Rule

Whenever work finishes or meaningfully advances a listed roadmap item, update
[`docs/goal-plan.md`](docs/goal-plan.md): bump `Lvl` if appropriate, tighten
`Notes`, and adjust the relevant detail bullets. This keeps agent handoffs
grounded in current reality.

## High-Risk Areas

- **Ableton `.als` XML:** Live can crash on malformed XML. Read
  [`docs/domains/ableton-als.md`](docs/domains/ableton-als.md) before editing
  [`src/lib/export/abletonSet.ts`](src/lib/export/abletonSet.ts).
- **Desktop sidecar:** Headless HTTP only. Do not reintroduce renderer/preload
  assumptions from old handovers.
- **Supabase access:** Invite/admin access is split between Supabase Auth,
  `access_grants`, and env-driven `ADMIN_USER_IDS`. Use service-role clients
  only in trusted server code.
- **Project filesystem:** Browser File System Access handles can disappear or
  lose permission; project commits use guarded/atomic helpers for a reason.

## Stale Material

Archived handovers in [`docs/archive/`](docs/archive/) are historical context,
not instructions. Verify them against current code before using any detail.
