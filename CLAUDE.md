# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

BarBro — a browser-based music transcription editor. Import audio, run server-side beat/downbeat detection, then edit bars, beats, sections, and chord harmony on a zoomable waveform. Export the project as a single `.smap` file.

## Common commands

```bash
npm run dev          # Vite dev server on http://localhost:5173
npm run dev:clean    # same, after wiping Vite's cache (use when HMR misbehaves)
npm run build        # production build
npm run preview      # preview built output
npm run check        # svelte-check (TypeScript + Svelte diagnostics)
npm run check:watch
npm run test         # vitest run (one-shot)
npm run test:watch
npx vitest run path/to/file.test.ts   # run a single test file
```

Postgres autosave (optional, only needed if exercising server autosave):

```bash
npm run db:up        # docker compose: Postgres on host port 5433
npm run db:migrate   # apply db/migrations/*.sql to existing volume
npm run db:down
```

Python beat detection (required for `/api/analyze`):

```bash
bash src/lib/server/analysis/python/install-deps.sh   # creates .venv with madmom
# then put PYTHON=.venv/bin/python3 in .env at repo root, restart dev server
```

The analyze endpoint reads `PYTHON` / `BARBRO_PYTHON` from SvelteKit's `$env/dynamic/private` (i.e. the `.env` file) **and** `process.env`. If you change `.env`, restart `npm run dev`.

## High-level architecture

### One canonical model: `SongMap`

The single source of truth for the musical document is `SongMap` (`src/lib/songmap/types.ts`, currently `SongMapV1`). It contains: `metadata`, `timeline.bars[]` + `timeline.beats[]` (flat list, each beat has a `barId`), `harmony[]` (`HarmonyEvent` per beat with an absolute `ChordSymbol` — Roman numerals are derived, never stored), `sections[]`, `cues`, and an `audio` reference (file metadata only, never bytes).

Every UI element reads from and writes to this one object. There is no shadow state — serialize the JSON and you have exactly what the editor shows; load it back and the editor is restored. Public API is re-exported from `src/lib/songmap/index.ts`; prefer importing from there.

Mutations go through `patchSongMap(updater)` in `src/lib/stores/songMap.ts`. It runs the immutable updater, merges audio-session info into `audio`, validates with `validateSongMap`, and on failure leaves the store unchanged. It also bumps `metadata.updatedAt`. Edit primitives live in `timelineEdit.ts`, `harmonyEdit.ts`, `sectionEdit.ts`.

### `.smap` container format

A `.smap` is a binary file: 28-byte header (`SMAP` magic, container version, flags, jsonLength, audioLength) + UTF-8 JSON `SongProject` (`{ projectFormatVersion, songMap }`) + optional raw audio bytes (typically 64 kbps MP3 made by `lamejs` from the analyzed WAV). No zip, no base64. See `src/lib/songmap/smapFile.ts` and `docs/smap-format.md`. Encode/decode/parse helpers live in `src/lib/songmap/persist.ts` (`parseImportedProjectFile`, `exportRestorableStateAsSmapBlob`, etc.).

JSON serialization is deterministic: keys follow object-literal construction order, and `serializeSongMap` strips `undefined`. Save → load → save with no edits should produce byte-identical output.

### Audio pipeline

`src/routes/+page.svelte` (the import landing page) trims the user's upload to a WAV with `trimAudio.ts`, posts it to `POST /api/analyze`, then re-encodes the trimmed clip to a small reference MP3 via `encodeReferenceAudio.ts` (`lamejs`). The server analyze route writes the WAV to a temp dir, spawns the Python script, parses its JSON, and converts beats into a partial `SongMap` via `beatsToSongMap.ts`. Analysis runs on full-quality WAV; the editor plays from the reference MP3 after analysis succeeds.

`src/lib/stores/audioSession.ts` holds the in-memory blob (`File`) and trim window. `src/lib/stores/restorableSong.ts` is the bridge: `hydrateRestorableSong({ songMap, audioBlob })` populates both stores, and `clearFullAppSongState()` resets them.

### Server autosave (optional)

When `DATABASE_URL` is set, `src/lib/client/serverAutosave.ts` autosaves the project every 30 s (and on tab hide) to Postgres, keyed by an anonymous browser fingerprint hash (`SHA-256` over a small set of stable browser features). Schema is `editor_sessions` (one row per fingerprint). When `DATABASE_URL` is missing, `/api/sessions/*` endpoints return 503 and the client treats autosave as off — the app still works in-memory only. The `barbro_session` cookie carries the session id for restore-on-reload via `src/routes/+layout.server.ts`.

### Routing & layout

SvelteKit 2 + Svelte 5 (runes — `$state`, `$props`, `$derived`). Two main pages: `/` (import landing — upload, trim, analyze) and `/edit` (the timeline editor). `+layout.svelte` starts/stops autosave, restores from server on first mount, and **blocks navigations from `/edit` back to `/`** while a song is loaded (via `beforeNavigate`) — the import page would otherwise wipe in-memory work. Honor that invariant when adding new navigation flows.

### UI stack

Tailwind CSS 4 (loaded via `@tailwindcss/vite` in `vite.config.js`, not PostCSS). UI primitives are shadcn-svelte (`bits-ui` + `tailwind-variants`); generated components live in `src/lib/components/ui/<primitive>/`. Icons are `@lucide/svelte`. The shadcn config is in `components.json` (style `nova`, base color `zinc`, typescript primitives are JS-only). The `$lib` alias points to `src/lib`.

### Chord domain

`src/lib/chords/` is the chord vocabulary: parsing (`parseChordText`), formatting (`formatChordSymbol`), transposition, diatonic suggestions, secondary dominants, slash bass, the marking-menu radial picker geometry, and chord-clipboard serialization. `resolveChordAtEachBeat` carries chords forward across beats (a chord stays in effect until the next `HarmonyEvent`). Numerals are *derived* from `metadata.keyDetail` + chord, never stored. PDF/MusicXML export lives in `src/lib/export/`.

### Tests

Vitest, `environment: 'node'`, `include: ['src/**/*.{test,spec}.ts']`. Tests are colocated next to the unit they cover (e.g. `parseChordText.test.ts`, `smapFile.test.ts`). No browser/DOM tests yet — pure-logic only.

## Conventions worth knowing

- **No shadow state.** If you add UI that depends on song data, read it from `songMap` (or a derived `$derived` over it) — don't cache copies in component state across mutations.
- **Bar/beat times use half-open intervals** `[startSec, endSec)` on the master timeline. The transport uses `END_EPS = 0.028` to clamp playback at bar ends.
- **Roman numerals are derived, never stored.** When you need one, call `deriveNumeral` against `metadata.keyDetail`.
- **Bump `SONGMAP_FORMAT_VERSION` only for breaking shape changes** (`src/lib/songmap/version.ts`). Extend `SONGMAP_VERSION_CHANGELOG`. Same for `SMAP_FILE_VERSION` if the binary container layout changes.
- **`patchSongMap` is the only sanctioned mutation path** — don't bypass it; validation failures must leave the store untouched.
- **Editor-only state (viewport, selection, tabs) stays out of `SongMap`.** It's transient and belongs in component `$state` or in `src/lib/stores/`.
- **`src/lib/timeline/{model,transforms}/` are placeholders** for the future Song Master Model; they currently contain only README stubs.

## Regression checklist

Before declaring an editor change done, walk through `docs/regression-checklist.md` (upload, playback, selection, minimap, "Use Song" trim flow). UI correctness is not covered by the test suite.
