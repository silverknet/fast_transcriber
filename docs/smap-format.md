# `.smap` — single-file project format

BarBro stores the **musical document** as JSON (`SongMap`) and optionally **trimmed audio bytes** beside it. The on-disk **`.smap`** format packs both into **one binary file** (not zip).

## Binary layout (little-endian)

| Offset | Size | Field       | Description |
|--------|------|-------------|-------------|
| 0      | 4    | magic       | ASCII `SMAP` |
| 4      | 4    | version     | `uint32` — container version (currently `1`) |
| 8      | 4    | flags       | `uint32` — bit 0 = `hasAudio` |
| 12     | 8    | jsonLength  | `uint64` — UTF-8 JSON byte length |
| 20     | 8    | audioLength | `uint64` — raw audio length (0 if no audio) |

Then:

- **`jsonLength` bytes** — UTF-8 JSON: [`SongProject`](../src/lib/songmap/smapFile.ts) (`projectFormatVersion` + `songMap`). Object keys are serialized in **deterministic order** so save → load → save can yield **identical** file bytes when nothing changed.
- **`audioLength` bytes** — optional **reference** audio (typically **MP3 ~64 kbps** via lamejs after analysis); only if `hasAudio` is set. Analysis still runs on full-quality WAV; the app replaces the in-memory clip with this smaller file before save.

Implementation: [`smapFile.ts`](../src/lib/songmap/smapFile.ts) (`encodeSmapFile` / `decodeSmapFile`).

## JSON layer

- **`SongProject`** wraps the canonical [`SongMap`](../src/lib/songmap/types.ts) (`projectFormatVersion: 1`).
- **`SongMap.audio`** ([`AudioReference`](../src/lib/songmap/types.ts)) holds **metadata only** (file name, MIME, trim, duration, optional `sha256`). It does **not** embed file bytes.
- **Audio bytes** in the file are the trimmed clip used for playback; quality can be playback-oriented (compact codec) as long as metadata stays consistent.

## Import / export

- **Export:** [`exportRestorableStateAsSmapBlob`](../src/lib/songmap/persist.ts) → single `Blob` → download as `{title}.smap`.
- **Import:** [`parseImportedProjectFile`](../src/lib/songmap/persist.ts) accepts binary `.smap`, or **plain JSON** (legacy `SongMap` root or `SongProject` envelope) without audio.
- **Hydration:** [`hydrateRestorableSong`](../src/lib/stores/restorableSong.ts) after parse.

## Layers (conceptual)

| Layer | Contents |
|--------|----------|
| **SongMap** | Beats, bars, sections, harmony, `audio` reference, … |
| **SongProject** | `{ projectFormatVersion, songMap }` — JSON in `.smap` |
| **RestorableSongState** | `{ songMap, audioBlob?, songId? }` — in-memory hydration |

## What stays out of the file

Editor-only UI state (viewport, selection, tabs) is not part of the durable model.
