# BarBro

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Optional — Postgres autosave (Docker):

```bash
npm run db:up        # starts Postgres on port 5433
npm run db:migrate   # creates the editor_sessions table
```

## Tech stack

SvelteKit 2 + Svelte 5 (runes), TypeScript, Tailwind CSS 4, Vite 8.
UI primitives from **shadcn-svelte** (`bits-ui` + `tailwind-variants`), icons from **Lucide** (`@lucide/svelte`).
Tests with Vitest.

## What it is

A browser-based music transcription editor. Import audio, detect beats, then edit bars, sections, and chord harmony on a zoomable waveform timeline. Export everything as a single `.smap` file.

## The `.smap` file format

A `.smap` is a binary container: a fixed 28-byte header, a UTF-8 JSON chunk (`SongProject` → `SongMap`), and an optional raw audio chunk.

```
HEADER  28 B   magic "SMAP" · container version · flags · jsonLength · audioLength
JSON    n B    SongMap: metadata, timeline (bars + beats), harmony, sections, cues
AUDIO   m B    reference MP3 (64 kbps), present when hasAudio flag is set
```

The JSON schema is defined in `src/lib/songmap/types.ts` — `SongMapV1`. Key top-level fields:

| Field | Purpose |
|---|---|
| `metadata` | Title, artist, key, BPM, timestamps |
| `timeline` | `bars[]` (index, meter, time span) + `beats[]` (barId, timeSec) |
| `harmony` | `HarmonyEvent[]` — chord per beat (absolute `ChordSymbol`, not numerals) |
| `sections` | Labeled bar ranges (verse, chorus, bridge, …) |
| `cues` | Click / count-in settings |
| `audio` | Reference file metadata (fileName, trim, sha256) |

## JSON ↔ UI: single source of truth

The `SongMap` JSON is the **complete, canonical state**. Every UI element — bars, beats, chords, sections, key, BPM — reads from and writes to this one object. There is no shadow state; if you serialize the JSON you get exactly what the editor shows, and loading it back restores the editor exactly.

Audio is handled the same way: after analysis (on full-quality WAV), the clip is re-encoded to a 64 kbps reference MP3 via lamejs. That MP3 is the audio chunk inside `.smap` — small enough to save and share, good enough for playback and navigation. The editor plays directly from this reference blob.
