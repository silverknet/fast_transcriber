# `.smap` — file format specification

**Status:** v2 — stable
**Container version (binary header `version`):** `2` — [`SMAP_FILE_VERSION`](../src/lib/songmap/smapFile.ts)
**JSON envelope version (`projectFormatVersion`):** `1` — [`SONG_PROJECT_FORMAT_VERSION`](../src/lib/songmap/smapFile.ts)
**SongMap schema version (`formatVersion`):** `2` — [`SONGMAP_FORMAT_VERSION`](../src/lib/songmap/version.ts)
**MIME type:** `application/vnd.barbro.smap` — [`SMAP_BLOB_TYPE`](../src/lib/songmap/smapFile.ts)
**Extension:** `.smap`

A `.smap` file is **one BarBro project**: a JSON musical document in a compact binary wrapper. Audio bytes live separately on disk through `audio.originalPath`; no zip and no base64-encoded audio inside the JSON. Legacy container v1 files with an embedded audio chunk are still read, but new writes use container v2.

The same format is used for:

- **Standalone export/import** — a downloadable `{title}.smap` file the user can move between machines.
- **In-project song storage** — `<project>/songs/<song-folder>/song.smap`, the canonical per-song document inside a multi-song project.

---

## 1. Binary container

All integers are **little-endian**.

### 1.1 Header — fixed 16 bytes ([`SMAP_HEADER_BYTE_LENGTH`](../src/lib/songmap/smapFile.ts))

| Byte range | Size | Field         | Type     | Description                                                                 |
|-----------:|-----:|---------------|----------|-----------------------------------------------------------------------------|
| `[0..3]`   | 4    | `magic`       | bytes    | ASCII `S M A P` — `0x53 0x4D 0x41 0x50`                                     |
| `[4..7]`   | 4    | `version`     | `uint32` | Container version. v2 = `2`.                                                |
| `[8..15]`  | 8    | `jsonLength`  | `uint64` | UTF-8 byte length of the JSON chunk.                                        |

### 1.2 JSON chunk — `jsonLength` bytes

UTF-8 encoded JSON object. Schema: `SongProject` (§2). Object keys are written in **deterministic order** (deep alphabetical, `undefined` omitted) so identical inputs round-trip to byte-identical files. See [`encodeSmapFile`](../src/lib/songmap/smapFile.ts).

### 1.3 Audio bytes

Current container v2 has no audio chunk. Audio lives next to the `.smap` and is referenced by `songMap.audio.originalPath` when the desktop sidecar can write it. Legacy v1 files may contain an audio chunk; the decoder exposes it as `audioBlob` for import and re-saving drops the embedded bytes.

### 1.4 Encoding rules

The encoder always writes container v2: 16-byte header + JSON chunk. Any `audioBlob` carried by a legacy import is ignored on re-save.

### 1.5 Decoding rules / well-defined errors

The reader ([`decodeSmapFile`](../src/lib/songmap/smapFile.ts)) throws on any of:

| Condition | Error |
|---|---|
| First 4 bytes ≠ `"SMAP"` | "wrong magic bytes" |
| unsupported container version | "unsupported container version" |
| File size < `16 + jsonLength` | "file is truncated" |
| JSON chunk is not valid UTF-8 JSON | "JSON chunk is not valid JSON" |
| Extra bytes past the declared end | "N unexpected byte(s) after JSON chunk" |

---

## 2. JSON envelope — `SongProject`

```jsonc
{
  "projectFormatVersion": 1,
  "songMap": { /* SongMapV2, §3 */ }
}
```

Defined in [`smapFile.ts`](../src/lib/songmap/smapFile.ts). The envelope exists so the container can evolve (e.g. add sibling fields next to `songMap`) without bumping the binary `version`.

**Legacy form** (parser-tolerant): a bare `SongMap` at the JSON root is accepted by [`parseSongProjectFromUtf8Text`](../src/lib/songmap/persist.ts) and auto-wrapped with `projectFormatVersion: 1`.

---

## 3. `SongMap` v2 schema

Source of truth: [`SongMapV2`](../src/lib/songmap/types.ts). Runtime validator: [`validate.ts`](../src/lib/songmap/validate.ts).

```ts
type SongMapV2 = {
  formatVersion: 2
  app?: { name: 'BarBro'; appVersion?: string }
  metadata: SongMetadata             // required
  audio?: AudioReference             // optional (no audio = JSON-only project)
  timeline: { bars: Bar[]; beats: Beat[] }   // required (arrays can be empty)
  sections: Section[]                // required (can be empty)
  harmony: HarmonyEvent[]            // required (can be empty)
  cueTracks: CueTrack[]              // shared editable cue data
  countInBeats?: number              // top-level click count-in
  startBeatId?: string               // optional song-start beat override
  projectFolder?: string             // display hint for the project folder name
  stemRefs?: Record<string, string>  // stem-name → project-relative path
  clickExport?: RenderedCueExport    // last rendered click WAV metadata
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

### 3.7 `cueTracks[]` — shared cue editor data

```ts
type CueTrack = {
  id: string
  name: string
  enabled: boolean
  voiceId?: string
  events: CueEvent[]
  suppressedGeneratedKeys: string[]
  renderExport?: RenderedCueExport
}

type CueEvent = {
  id: string
  kind: 'section' | 'count' | 'intro' | 'custom-text' | 'recorded-audio-placeholder'
  enabled: boolean
  anchor: CueAnchor
  text?: string
  generatedKey?: string
  generatedSource?: { kind: 'section'; sectionId: string; leadBars?: number; leadBeats?: number }
  source?: 'generated' | 'custom' | 'imported' | 'recorded'
  edited?: boolean
  stale?: boolean
}

type CueAnchor =
  | { kind: 'bar'; barId: string; leadBars?: number; leadBeats?: number; offsetSec?: number }
  | { kind: 'beat'; beatId: string; leadBars?: number; leadBeats?: number; offsetSec?: number }
  | { kind: 'time'; timeSec: number; leadBars?: number; leadBeats?: number; offsetSec?: number }
```

Cue tracks are collaborative song data. Generation from sections writes editable events into a selected track and uses stable `generatedKey`s / `generatedSource`s so regeneration can preserve custom cues, edited generated cues, disabled generated cues, and deleted generated cues listed in `suppressedGeneratedKeys`. Generated section cues anchor to the section-start beat with `leadBars: 1` by default, so the "one bar early" intent remains editable rather than baked into a resolved timestamp.

Top-level `countInBeats` remains separate from cue speech. Top-level `startBeatId` optionally moves the song-start anchor used by click/count-in math.

### 3.8 `stemRefs` — `Record<stemName, projectRelativePath>`

Map from stem name → relative path within the project folder. Stem names match [`STEM_TRACKS`](../src/lib/export/abletonSet.ts): `"Drums"`, `"Bass"`, `"Guitar"`, `"Vocals"`, `"FX"`. Display/persistence hint only — the canonical source is the filesystem (sidecar scans `<song>/stems/<preset>/*.wav`).

### 3.9 `renderExport` / `clickExport` — render-cache metadata

`cueTracks[].renderExport` stores the last rendered WAV metadata for that cue track. Top-level `clickExport` stores the click-only WAV metadata. Both share the [`RenderedCueExport`](../src/lib/songmap/types.ts) shape:

| Field | Type | Notes |
|---|---|---|
| `fingerprint` | `string` | Equals [`fingerprintCueTrackInputs(sm, track)`](../src/lib/songmap/cueTrackFingerprint.ts) at render time. Covers the selected cue track, `countInBeats`, `startBeatId`, `audio.trim`, beats, and sections. |
| `durationSec` | `number` | Rendered WAV duration. |
| `sampleRate` | `number` | Typically `44100`. |
| `generatedAt` | ISO 8601 `string` | |
| `preludeOffsetSec` | `number` | Position inside the WAV where `trim.startSec` lands. Consumers (Ableton export, mixer) read this to compute clip play ranges without re-deriving renderer timing. |
| `relativePath` | `string` | Local project path when written there. Cue tracks use `cue/tracks/<trackId>/cue-track.wav`; click-only uses `cue/click-track.wav`. Stripped from cloud sync. |

**Staleness:** when the SongMap is patched in the store, [`stores/songMap.ts`](../src/lib/stores/songMap.ts) re-computes the fingerprint and **clears** any export whose stored `fingerprint` no longer matches. The on-disk WAVs are NOT deleted — they're orphaned until next render.

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
- For `cueTracks[]`: valid ids/names, known event kinds, valid anchors, and structurally well-formed `renderExport` when present.
- For `clickExport` (when present): `preludeOffsetSec >= 0` and structurally well-formed.

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
- **Missing optional fields** (e.g. `sectionBorderHints`, `chordHints`, `clickExport`): silently ignored — they'll be regenerated on demand.
- **Legacy SongMap `formatVersion: 1` cue fields** (`cues`, `cueTrackExport`, `clickTrackExport`): parsed by the v1 migrator into `cueTracks[]`, top-level `countInBeats`, and `clickExport`. New saves emit v2 only.
- **Legacy `cueTrackExport` / `clickTrackExport` without `preludeOffsetSec`**: treated as stale; the entry is dropped on parse so the next render produces a fresh, fully-populated record.

Unknown top-level JSON keys are stripped by default during parse. (See [`parse.ts`](../src/lib/songmap/parse.ts).)

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
- **Rendered click / cue WAVs** — they live at `<song>/cue/click-track.wav` and `<song>/cue/tracks/<trackId>/cue-track.wav`. The `.smap` only references them through `clickExport` / `cueTracks[].renderExport`.
- **Project manifest** — the multi-song setlist (`barbro.project.json`) is a separate document; see [`src/lib/project/types.ts`](../src/lib/project/types.ts).
