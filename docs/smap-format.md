# `.smap` — file format specification

**Status:** v1 — stable
**Container version (binary header `version`):** `1` — [`SMAP_FILE_VERSION`](../src/lib/songmap/smapFile.ts)
**JSON envelope version (`projectFormatVersion`):** `1` — [`SONG_PROJECT_FORMAT_VERSION`](../src/lib/songmap/smapFile.ts)
**SongMap schema version (`formatVersion`):** `1` — [`SONGMAP_FORMAT_VERSION`](../src/lib/songmap/version.ts)
**MIME type:** `application/vnd.barbro.smap` — [`SMAP_BLOB_TYPE`](../src/lib/songmap/smapFile.ts)
**Extension:** `.smap`

A `.smap` file is **one BarBro project**: a JSON musical document plus an optional binary audio chunk packed into a single file. No zip, no base64-encoded audio inside the JSON.

The same format is used for:

- **Standalone export/import** — a downloadable `{title}.smap` file the user can move between machines.
- **In-project song storage** — `<project>/songs/<song-folder>/song.smap`, the canonical per-song document inside a multi-song project.

---

## 1. Binary container

All integers are **little-endian**.

### 1.1 Header — fixed 28 bytes ([`SMAP_HEADER_BYTE_LENGTH`](../src/lib/songmap/smapFile.ts))

| Byte range | Size | Field         | Type     | Description                                                                 |
|-----------:|-----:|---------------|----------|-----------------------------------------------------------------------------|
| `[0..3]`   | 4    | `magic`       | bytes    | ASCII `S M A P` — `0x53 0x4D 0x41 0x50`                                     |
| `[4..7]`   | 4    | `version`     | `uint32` | Container version. v1 = `1`. Readers reject other values.                   |
| `[8..11]`  | 4    | `flags`       | `uint32` | Bit 0 (`SMAP_FLAG_HAS_AUDIO`) = audio chunk present. Other bits reserved (0). |
| `[12..19]` | 8    | `jsonLength`  | `uint64` | UTF-8 byte length of the JSON chunk.                                        |
| `[20..27]` | 8    | `audioLength` | `uint64` | Byte length of the audio chunk. `0` iff `hasAudio` flag is unset.           |

### 1.2 JSON chunk — `jsonLength` bytes

UTF-8 encoded JSON object. Schema: `SongProject` (§2). Object keys are written in **deterministic order** (deep alphabetical, `undefined` omitted) so identical inputs round-trip to byte-identical files. See [`encodeSmapFile`](../src/lib/songmap/smapFile.ts).

### 1.3 Audio chunk — `audioLength` bytes (optional)

Raw audio bytes — *not* base64, *not* wrapped. Present **iff** `flags.hasAudio` is set AND `audioLength > 0`. Typical content: trimmed reference audio encoded as low-bitrate MP3 (~64 kbps via lamejs) — small enough to bundle, good enough for in-browser playback. Analysis still runs on the full-quality upload; the small clip replaces it before save.

Decoders read this chunk's MIME from `songMap.audio.mimeType` when present (e.g. `audio/mpeg`).

### 1.4 Encoding rules

| Encoder state                                    | `flags.hasAudio` | `audioLength`     | Audio chunk     |
|--------------------------------------------------|:---------------:|:------------------|:----------------|
| `audioBlob` missing or `audioBlob.size === 0`    | `0`             | `0`               | absent          |
| `audioBlob` present and non-empty                | `1`             | `audioBlob.size`  | raw bytes       |

### 1.5 Decoding rules / well-defined errors

The reader ([`decodeSmapFile`](../src/lib/songmap/smapFile.ts)) throws on any of:

| Condition | Error |
|---|---|
| First 4 bytes ≠ `"SMAP"` | "wrong magic bytes" |
| `version ≠ 1` | "unsupported container version" |
| File size < `28 + jsonLength + audioLength` | "file shorter than declared lengths" |
| `flags.hasAudio` set but `audioLength = 0` | "hasAudio flag is set but audioLength is 0" |
| `audioLength > 0` but `flags.hasAudio` unset | "audio bytes are present but hasAudio flag is not set" |
| JSON chunk is not valid UTF-8 JSON | "JSON chunk is not valid JSON" |
| Extra bytes past the declared end | "N unexpected byte(s) after the audio chunk" |

---

## 2. JSON envelope — `SongProject`

```jsonc
{
  "projectFormatVersion": 1,
  "songMap": { /* SongMapV1, §3 */ }
}
```

Defined in [`smapFile.ts`](../src/lib/songmap/smapFile.ts). The envelope exists so the container can evolve (e.g. add sibling fields next to `songMap`) without bumping the binary `version`.

**Legacy form** (parser-tolerant): a bare `SongMap` at the JSON root is accepted by [`parseSongProjectFromUtf8Text`](../src/lib/songmap/persist.ts) and auto-wrapped with `projectFormatVersion: 1`.

---

## 3. `SongMap` v1 schema

Source of truth: [`SongMapV1`](../src/lib/songmap/types.ts). Runtime validator: [`validate.ts`](../src/lib/songmap/validate.ts).

```ts
type SongMapV1 = {
  formatVersion: 1
  app?: { name: 'BarBro'; appVersion?: string }
  metadata: SongMetadata             // required
  audio?: AudioReference             // optional (no audio = JSON-only project)
  timeline: { bars: Bar[]; beats: Beat[] }   // required (arrays can be empty)
  sections: Section[]                // required (can be empty)
  harmony: HarmonyEvent[]            // required (can be empty)
  cues: CueSettings                  // required
  projectFolder?: string             // display hint for the project folder name
  stemRefs?: Record<string, string>  // stem-name → project-relative path
  cueTrackExport?: CueTrackExport    // last rendered cue WAV metadata
  clickTrackExport?: ClickTrackExport // last rendered click WAV metadata
  mixState?: MixState                // mixer volume / mute / solo
  sectionBorderHints?: SectionBorderHints // cached Python analyzer output
  chordHints?: ChordHints                 // cached Python analyzer output
}
```

### 3.1 `metadata` — `SongMetadata`

| Field | Type | Required | Notes |
|---|---|:---:|---|
| `title` | `string` (non-empty) | ✓ | |
| `artist` | `string` | | |
| `composer`, `arranger` | `string` | | |
| `key` | `string` | | Legacy display string. Keep in sync with `keyDetail`. |
| `keyDetail` | `SongKey` | | `{ root: 'C'..'B', accidental?: 'sharp'\|'flat'\|'natural', mode: 'major'\|'minor' }` |
| `bpm` | `number` | | Reference tempo. |
| `notes` | `string` | | Free text. |
| `createdAt`, `updatedAt` | ISO 8601 `string` | ✓ | |
| `analyzed` | `boolean` | | `true` once beat/bar analysis has completed. Absent in legacy files = inferred analyzed iff bars exist. Routes UI to /import vs /edit. |

### 3.2 `audio` — `AudioReference` (optional, metadata only)

Audio **bytes** live in the binary audio chunk, NOT in this object.

| Field | Type | Required | Notes |
|---|---|:---:|---|
| `fileName` | `string` | ✓ | |
| `mimeType` | `string` | | Used when materializing `audioBlob` on decode. |
| `durationSec` | `number` | | Full untrimmed duration. |
| `trim` | `{ startSec: number; endSec: number }` | ✓ | Half-open. `endSec > startSec`. Defines the song's playback region within the original audio. |
| `sha256` | `string` (hex) | | SHA-256 of the stored (trimmed/compressed) audio chunk. |
| `originalSha256` | `string` (hex) | | SHA-256 of the original HQ upload; used to verify re-uploads for full-quality re-analysis. |
| `source` | `'upload' \| 'import' \| 'unknown'` | ✓ | |

### 3.3 `timeline.bars[]` — `Bar`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` (non-empty) | Stable per-bar identifier. |
| `index` | `uint` | 0-based sequence in song. |
| `startSec`, `endSec` | `number` | Half-open `[startSec, endSec)` on the master audio timeline. Invariant: `endSec > startSec`. |
| `meter` | `{ numerator: uint, denominator: uint }` | Both ≥ 1. |
| `beatCount` | `uint` | Must equal `beatIds.length`. |
| `beatIds` | `string[]` | References to `beats[].id`. |

### 3.4 `timeline.beats[]` — `Beat`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` (non-empty) | |
| `barId` | `string` (non-empty) | References a `Bar.id`. |
| `indexInBar` | `uint` (`≥ 0`) | `0` = downbeat. |
| `timeSec` | `number` | Beat onset on the master audio timeline. |
| `strength`, `confidence` | `number` | Optional. |
| `source` | `'manual' \| 'detected' \| 'imported'` | Optional. |

### 3.5 `sections[]` — `Section`

Inclusive bar ranges (not half-open).

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | |
| `kind` | `'intro' \| 'verse' \| 'preChorus' \| 'chorus' \| 'bridge' \| 'solo' \| 'riff' \| 'break' \| 'outro' \| 'custom'` | |
| `label` | `string` | Free text override. |
| `barRange` | `{ startBarIndex: uint; endBarIndex: uint }` | Inclusive; `end >= start`; indices match `Bar.index`. |
| `color` | `string` | Optional UI hint. |

### 3.6 `harmony[]` — `HarmonyEvent`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | |
| `barId` | `string` | References `Bar.id`. |
| `beatId` | `string` | Preferred anchor; required for newly added events. |
| `startSec`, `endSec` | `number` | Master timeline. |
| `chord` | `ChordSymbol` | Absolute pitch + quality (Roman numerals are derived, not stored). |
| `beatAnchor` | `{ indexInBar: uint }` | Optional. |

`ChordSymbol` = `{ root: NoteName, accidental?, quality?, extensions?, bass?, bassAccidental?, displayRaw }`.

### 3.7 `cues` — `CueSettings`

| Field | Type | Notes |
|---|---|---|
| `mode` | `'off' \| 'spoken' \| 'click' \| 'countIn'` | Drives renderer behavior. |
| `countInBeats` | `uint` | Number of count-in clicks before bar 1. Only meaningful when `mode === 'countIn'`. |
| `useSectionLabels` | `boolean` | Whether the cue WAV speaks section names. |
| `prependSec` | `number` | Optional cached value of `computeCountIn(...).prependSec`. Derived from timeline + `countInBeats`. |
| `template`, `language` | `string` | Optional TTS phrasing settings. |

### 3.8 `stemRefs` — `Record<stemName, projectRelativePath>`

Map from stem name → relative path within the project folder. Stem names match [`STEM_TRACKS`](../src/lib/export/abletonSet.ts): `"Drums"`, `"Bass"`, `"Guitar"`, `"Vocals"`, `"FX"`. Display/persistence hint only — the canonical source is the filesystem (sidecar scans `<song>/stems/<preset>/*.wav`).

### 3.9 `cueTrackExport` / `clickTrackExport` — render-cache metadata

Both share the [`CueTrackExport`](../src/lib/songmap/types.ts) shape:

| Field | Type | Notes |
|---|---|---|
| `fingerprint` | `string` | Equals [`fingerprintCueTrackInputs(sm)`](../src/lib/songmap/cueTrackFingerprint.ts) at render time. Covers `cues`, `audio.trim`, beats, sections — any of which becoming stale invalidates the cached WAV. |
| `durationSec` | `number` | Rendered WAV duration. |
| `sampleRate` | `number` | Typically `44100`. |
| `generatedAt` | ISO 8601 `string` | |
| `preludeOffsetSec` | `number` | `titleCuePreludeSec(sm) + computeCountIn(sm,…)?.prependSec ?? 0` at render time. Position inside the WAV where `trim.startSec` lands. Consumers (Ableton export, mixer) read this to compute clip play ranges without re-deriving from `sm.cues`. |
| `relativePath` | `string` | Path within the project folder when written there (e.g. `cue/click-track.wav`). |

**Staleness:** when the SongMap is loaded into the store, [`stores/songMap.ts`](../src/lib/stores/songMap.ts) re-computes the fingerprint and **clears** any export whose stored `fingerprint` no longer matches. The on-disk WAVs are NOT deleted — they're orphaned until next render.

### 3.10 `mixState` — `MixState`

```ts
type MixTrackState = { key: string; volume: number; muted?: boolean; soloed?: boolean }
type MixState = { tracks: MixTrackState[]; master?: number }
```

Track keys: `"original"`, `"cue"`, `"stem:<filename>"` (e.g. `"stem:drums.wav"`). Unknown keys are tolerated (graceful when stems change on disk).

### 3.11 `sectionBorderHints`, `chordHints` — cached analyzer output

Persisted outputs from the Python sidecar's analyzers. Each carries an `audioFingerprint` (`sha256` or `<name>:<size>`), `generatedAt`, and `analyzerVersion` (bumped to force re-analysis on algorithm change). When inputs change or the version bumps, the hints are treated as stale.

### 3.12 `app` — provenance

```ts
type SongMapAppInfo = { name: 'BarBro'; appVersion?: string }
```

### 3.13 `projectFolder`

Display hint string (e.g. `"DangerousSong"`). Not a full path — used to render "song not found on this machine" UI when porting a `.smap` between projects.

---

## 4. Invariants

Enforced by [`validate.ts`](../src/lib/songmap/validate.ts):

- `metadata.title` non-empty, `createdAt` / `updatedAt` are ISO strings.
- For every `Bar`: `endSec > startSec`, `beatCount = beatIds.length`, `meter.numerator >= 1`, `meter.denominator >= 1`.
- For every `Beat`: `barId` references an existing `Bar`, `indexInBar >= 0`.
- For every `Section`: `kind` ∈ enum, `barRange.end >= barRange.start`, indices match `Bar.index`.
- For every `HarmonyEvent`: `barId` references a `Bar`, `chord.root` ∈ note names, `chord.bass` ∈ note names if present, `displayRaw` is a string.
- For `cueTrackExport` / `clickTrackExport` (when present): `preludeOffsetSec >= 0` and structurally well-formed.

`parseSongMap` runs the validator and throws [`SongMapParseError`](../src/lib/songmap/parse.ts) on the first violation in strict mode.

---

## 5. Determinism

The encoder produces **byte-identical** output for inputs that compare equal. To make this stable:

- Object keys are emitted in **deep alphabetical order**.
- `undefined` properties are **omitted entirely** (they never appear in the JSON).
- Numbers / arrays serialize via `JSON.stringify`'s native rules.

Consequence: `decode(encode(x)) ≡ x` modulo dropped `undefined`s, and `encode(decode(encode(x))) === encode(x)` byte-for-byte.

---

## 6. Compatibility / parser tolerance

- **Legacy JSON-only files** (no binary wrapper): plain `SongMap` at the JSON root is accepted by [`parseImportedProjectFile`](../src/lib/songmap/persist.ts) and auto-wrapped into a `SongProject`.
- **`.zip` bundles** (very old): explicitly rejected with a message instructing the user to re-export from BarBro as a single `.smap`.
- **Missing optional fields** (e.g. `sectionBorderHints`, `chordHints`, `clickTrackExport`): silently ignored — they'll be regenerated on demand.
- **Legacy `cueTrackExport` without `preludeOffsetSec`**: treated as stale; the entry is dropped on parse so the next render produces a fresh, fully-populated record.

The parser preserves unknown JSON keys at the SongMap root in `extras` so future fields don't get nuked on round-trip. (See [`parse.ts`](../src/lib/songmap/parse.ts).)

---

## 7. Code references

| Concern | File |
|---|---|
| Binary encode/decode | [`src/lib/songmap/smapFile.ts`](../src/lib/songmap/smapFile.ts) |
| JSON parser + validator entry | [`src/lib/songmap/parse.ts`](../src/lib/songmap/parse.ts) |
| Field-level invariants | [`src/lib/songmap/validate.ts`](../src/lib/songmap/validate.ts) |
| Type definitions | [`src/lib/songmap/types.ts`](../src/lib/songmap/types.ts) |
| Render-cache fingerprint | [`src/lib/songmap/cueTrackFingerprint.ts`](../src/lib/songmap/cueTrackFingerprint.ts) |
| Auto stale-clear on load | [`src/lib/stores/songMap.ts`](../src/lib/stores/songMap.ts) |
| Import/export pipeline | [`src/lib/songmap/persist.ts`](../src/lib/songmap/persist.ts) |
| Round-trip hydration | [`src/lib/stores/restorableSong.ts`](../src/lib/stores/restorableSong.ts) |

---

## 8. Out of scope

The `.smap` does NOT include:

- **Editor / UI state** — viewport, zoom, selected bar, open tabs, undo stack.
- **Stem WAVs** — they live alongside the `.smap` under `<song>/stems/<preset>/*.wav`. The `.smap` only references them through `stemRefs`.
- **Rendered click / cue WAVs** — they live at `<song>/cue/click-track.wav` and `<song>/cue/cue-track.wav`. The `.smap` only references them through `clickTrackExport` / `cueTrackExport`.
- **Project manifest** — the multi-song setlist (`barbro.project.json`) is a separate document; see [`src/lib/project/types.ts`](../src/lib/project/types.ts).
