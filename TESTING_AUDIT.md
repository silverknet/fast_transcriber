# TESTING_AUDIT.md

Repository-wide testing, stability & quality pass. Living record.

## System overview

**BarBro** is a SvelteKit 2 / Svelte 5 web app for turning a song recording into a
performable chart: it detects the beat grid, lets you place chords/sections/lyrics,
plays back a click + cue track in lockstep, and exports an Ableton Live `.als`
setlist. A separate **headless Electron sidecar** (`desktop/`, loopback HTTP on
`127.0.0.1:47842`) runs the native jobs (beat/stem/lyrics analysis via Python,
project file I/O). Multi-song **projects** live on disk (`.smap` per song +
`barbro.project.json` manifest) and optionally sync to **Supabase cloud** for
collaboration. A live-performance mode drives an **APC Key 25** MIDI controller
and (this session) an in-app **synth**.

Architecture, from repository evidence:
- **`.smap` SongMap is the root of truth** (`src/lib/songmap/`): schema (`types.ts`),
  binary container (`smapFile.ts`), parse/validate, collab merge, drafts, migration,
  and the single timing derivation `songPlaybackPlan` (`playbackPlan.ts`).
- **Audio** (`src/lib/audio/`): buffer-based `PlaybackController`, `MixerEngine`,
  click/cue renderers, mastering, drum/bass synthesis — all Web Audio.
- **Export** (`src/lib/export/`): Ableton `.als` XML (`abletonSet.ts`, 1981 lines),
  setlist orchestrator, PDF/MusicXML.
- **Chords** (`src/lib/chords/`): sheet parsing, chroma→chord suggestion, transpose,
  key detection.
- **Cloud/sync** (`src/lib/client/`, `src/lib/project/`, `src/lib/stores/`):
  disk + cloud persistence, autosave push, pull/merge reconcile — historically the
  source of a real data-loss incident (see AGENT_NOTES.md).
- **Sidecar** (`desktop/electron/`): HTTP routes, auto-stems daemon, native Python
  process management, XR18 OSC, transpose cache.
- **Hardware** (`src/lib/hardware/`): APC Key 25 MIDI, XR18 routing.

Test infra (`vite.config.js`): Vitest split into **unit** (Node env, `*.test.ts`,
excludes `*.browser.test.ts`) and **browser** (real Chromium via Playwright,
`*.browser.test.ts`). Property tests via `fast-check` (`*.property.test.ts`).
Desktop uses `node --test` on `*.test.mjs`.

## Baseline results (before any changes this pass)

| Command | Result |
|---|---|
| `npm run check` (svelte-check) | **0 errors**, 4 warnings (pre-existing unused-CSS in `project/+page.svelte`) |
| `npm test` (unit) | **1082 passed** (101 files) |
| `npm run test:browser` (Chromium) | **52 passed** (8 files) |
| `npm run test:desktop` (node --test) | **58 passed**, 0 fail |
| `npm run build` (vite/rolldown) | **✓ built in 8.35s**, adapter-netlify done |

No lint/format script is defined (`prettier`/`eslint` not wired as npm scripts).
Baseline is fully green — this pass targets *coverage gaps and latent defects*, not
red suites.

## Substantial modules with NO sibling test (my scan, ≥120 lines)

Highest-value pure/critical targets first:
- `src/lib/songmap/validate.ts` (508) — **data-integrity gate**, pure, untested. ★
- `src/lib/songmap/parse.ts` (921) — parser/validator entry, only indirectly covered. ★
- `src/lib/chords/sheet/chordToken.ts` (249), `chords/diatonic.ts` (142),
  `chords/markingMenuTree.ts` (306) — pure chord logic. ★
- `src/lib/songmap/drumGroove.ts` (258), `harmonyEdit.ts` (135) — edit helpers.
- `src/lib/export/abletonSet.ts` (1981) — **Ableton XML, crash-risk**, untested. ★
- `src/lib/export/musicxml.ts` (204), `pdfLeadSheet.ts` (215).
- I/O-heavy (harder; analyzed by subagents): `desktopBridge.ts`, `commit.ts`,
  `cloudSync.ts`, `projectAutosave.ts`, `desktopProjectFs.ts`, `mixerEngine.ts`.

## Subsystem inventory (what each area does + how it's covered)

| Subsystem | Role | Coverage before | Coverage after this pass |
|---|---|---|---|
| `songmap/validate.ts` | Data-integrity gate for the `.smap` root-of-truth | none (indirect) | **37-test suite** + duplicate-id enforcement for id-keyed lists |
| `songmap/parse.ts` | Envelope → `SongMap`, migrations | indirect | `timeline.original` round-trip regression (**defect fixed**) |
| `songmap/collabMerge.ts` | Conflict merge for cloud/collab sync | 29 tests | +2 tests; `timeline.original` preserved (**defect fixed**) |
| `chords/parseChordText.ts` | Free-text chord → structured `ChordSymbol` | 19 tests | +6 tests; extended/altered chords (**defect fixed**) |
| `chords/formatChordSymbol.ts` | Structured chord → display text (inverse of parse) | none | **10-test suite** incl. parse↔format round-trip |
| `chords/transposeChord.ts` | Semitone transpose | 2 assertions | full 12-semitone sweep + enharmonics + slash (24 tests) |
| `audio/timeGeometry.ts` | Time↔pixel geometry for the waveform | none | **14-test suite** |
| `audio/computeCountIn.ts` | Pre-roll silence for N metronome clicks | none | **7-test suite** (happy path + trim + null contract) |
| `export/abletonSet.ts` | Ableton `.als` XML writer | none (indirect) | clip/track name XML-escaping (**defect fixed**) + 3 tests |
| `desktop/autoStems.mjs` | Auto-stem daemon budget bookkeeping | daemon tests | prefix-collision fix (**defect fixed**) + regression test |
| `hardware/apcKey25.ts` | APC Key 25 MIDI decode + knob soft-pickup | 14 tests | dead-assertion fix + isolated `crossed`-branch test |
| `client/browserCloudPull.ts` | Browser-mode cloud receive | 4 tests | +1 characterization test (watermark/skip trade-off) |

## Testing strategy

Derived from the code, not from the existing tests. Priorities, in order:

1. **Data-integrity boundaries first.** The `.smap` is the root of truth and flows
   through parse → validate → merge → serialize → cloud. A silent drop or collapse
   anywhere here is unrecoverable data loss, so these got the deepest scrutiny
   (and yielded the most defects: `timeline.original` dropped on *both* parse and
   merge; no duplicate-id guard on id-keyed lists that are later merged by id).
2. **Pure functions are cheap, high-leverage locks.** Chord parse/format,
   transpose, time geometry, count-in — deterministic, no mocks, fast. Every one
   is a function whose wrongness corrupts something the user sees or hears.
3. **Export = someone else's parser.** The `.als` is XML consumed by Ableton Live;
   user-controlled strings (dropped stem filenames, track names) MUST be escaped or
   Live refuses/crashes the set. Treated as an injection surface.
4. **Verify every subagent claim independently.** Subagents surveyed songmap,
   cloud-sync, export+chords, audio+hardware in parallel. Each flagged defect was
   re-read in the actual source before acting; each fix has a regression test that
   was **proven to fail without the fix** (git-stash the source, run the test, red;
   restore, green).
5. **Don't destabilize fragile subsystems for a speculative fix.** The cloud-sync
   engine has a documented data-loss history and can't be E2E-verified here. Where
   behavior was defensible-but-surprising, a *characterization* test locks it and
   the reasoning is written down, rather than a blind change.

## Tests added or improved

All added tests pass; every regression test was verified red-without-fix.

**New suites**
- `songmap/validate.test.ts` — 37 tests. Known-valid factory + one targeted
  corruption per invariant. Includes the new duplicate-id enforcement.
- `chords/formatChordSymbol.test.ts` — 10 tests. Quality map, seventh-stem
  substitution (`m7`+9 → `m9`, not `m79`), added-tone spelling, colour tones,
  accidentals, slash bass, and a parse↔format round-trip.
- `audio/timeGeometry.test.ts` — 14 tests. Linear map, clamps, view windowing,
  element offset+scroll, degenerate-input guards.
- `audio/computeCountIn.test.ts` — 7 tests. Prepend math, "enough lead-in" clamp,
  trim shift, and all four null-return paths.
- `chords/parseChordExtended.test.ts` — 6 tests (C1 regression, see defects).
- `songmap/timelineOriginalRoundtrip.test.ts` — 2 tests (parse regression).
- `export/abletonClipName.test.ts` — 3 tests (XML-escape regression).

**Extended existing**
- `chords/transposeChord.test.ts` — 2 assertions → 24 (full 12-semitone sweep).
- `songmap/collabMerge.test.ts` — +2 (`timeline.original` preservation).
- `hardware/apcKey25.test.ts` — fixed a dead assertion (`.toBeNull` → `.toBeNull()`),
  added a test isolating the knob `crossed` branch from the `near` branch.
- `client/browserCloudPull.test.ts` — +1 characterization test.
- `desktop/autoStems.daemon.test.mjs` — +1 (prefix-collision regression).

## Defects discovered & fixed

Each was independently confirmed in source and locked with a regression test.

| # | Severity | Defect | Fix | Regression test |
|---|---|---|---|---|
| D1 | High (data loss) | `parse.ts` never read `timeline.original`, so the analyzed baseline ("Reset grid") was dropped on every load, even though `merge.ts` writes it | Parse `o.original` into the timeline | `timelineOriginalRoundtrip.test.ts` (proven red-without-fix) |
| D2 | High (data loss) | `mergeForConflict` rebuilt `timeline` as `{ bars, beats }`, dropping `timeline.original` after any collab/cloud conflict resolve | Preserve `cloud ?? local` original through the merge | `collabMerge.test.ts` +2 (proven red-without-fix) |
| D3 | High (Live crash) | Ableton AudioClip `<Name>` (and track Effective/UserName) emitted user-controlled filenames **raw** while the adjacent `RelativePath` was escaped — `Rock & Roll.wav` → malformed XML Live can reject | `escapeXmlAttr(...)` on all four | `abletonClipName.test.ts` (3 tests) |
| D4 | High (corruption) | `parseChordText` mis-parsed common extended/altered chords: `Cm7b5`→`Cb5`, `Am9`→A-major/add9, `Cmaj9`→`Cadd9` (the `m7` guard rejected trailing colour tones; extensions salvaged as added tones) | Add `m7`/`m9-13`/`maj9-13` rules routing extensions & colour tones correctly | `parseChordExtended.test.ts` (5/6 red-without-fix) |
| D5 | Medium (data loss) | `autoStems` `clearBudgets` matched keys by bare `startsWith(projectPath)`, so clearing `/m/Album` also wiped sibling `/m/Album2` | Match on a path boundary (`=== path` or `startsWith(path + sep)`), mirroring `main.mjs:3045` | `autoStems.daemon.test.mjs` +1 (proven red-without-fix) |
| D6 | Medium (integrity) | `validateSongMap` had no duplicate-`.id` check for `harmony`/`sections`/`cueTracks`/cue events — the exact lists `mergeByIdList` collapses on, so a dup id = silent item loss on next sync | `pushDuplicateIdErrors` on all four lists | `validate.test.ts` +5 |
| T1 | Test bug | `apcKey25.test.ts:157` used `.toBeNull` (no call) — asserted nothing; the `±3 ticks` comment was also wrong (60 flips to absolute) | `.toBeNull()` + accurate comment + `absolute`-mode assertion | in-file |

## Assessed, NOT changed (deliberate)

- **Cloud-sync watermark advances past skipped songs** (`cloudSync.ts` / `browserCloudPull.ts`).
  The project-level `lastSyncedRevision` advances to the manifest revision even
  when an individual song is skipped (`applyCloudSong… → null`). Assessed as a
  **defensible trade-off, not a defect**: for the *permanent* skip cases
  (unmigratable payload, Phase-4-MVP new song) pinning the watermark to the bad
  song's revision would re-fetch the ENTIRE project on every pull forever. The
  conflict case self-heals via the push-409 path. The one genuine (narrow) gap is
  a *transient* `readProjectSong` failure, which won't auto-retry via the watermark
  — noted here as a known limitation rather than patched blind, since the sync
  engine has a documented data-loss history and can't be E2E-verified in this
  environment. Behavior is now locked by a labeled characterization test.

## Smoke-test results

The desktop sidecar (native/Python analysis) and the full editor UI can't be
driven headless in this environment, so "smoke" here means: the production build
compiles and every automated suite that exercises real runtime behavior is green
— including the **browser project** (real Chromium + Web Audio: `AudioContext`,
`AudioBufferSourceNode` scheduling, count-in pre-roll, `$effect` graph ordering)
and the **desktop node tests** (OSC round-trips, daemon bookkeeping, path safety).
UI/audio changes that require a human at `npm run dev` were not part of this pass
(no runtime-behavior source was changed beyond the six pure/near-pure fixes above,
each of which is covered by an automated test).

## Commands executed

```
npm run check          # 0 errors, 4 pre-existing warnings
npm test               # unit  — 1188 passed (108 files)
npm run test:browser   # browser (Chromium) — 52 passed (8 files)
node --test desktop/electron/*.test.mjs   # desktop — 59 passed, 0 fail
npm run build          # ✓ built in ~20s, adapter-netlify done
# plus: per-file vitest runs + git-stash red/green proofs for each regression test
```

## Remaining limitations

- Many pure modules remain untested (see the scan above): `chords/diatonic.ts`,
  `chords/deriveNumeral.ts`, `chords/markingMenuTree.ts`, `songmap/drumGroove.ts`,
  `audio/selectionMath.ts` / `viewportMath.ts` / `waveformInteraction.ts`,
  `export/musicxml.ts` / `pdfLeadSheet.ts`. None are known-broken; they're
  low-risk pure logic that simply lacks a lock.
- The cloud-sync transient-read gap above is documented, not fixed.
- No E2E path for the Electron sidecar's native/Python jobs or the live MIDI
  hardware in this environment; those remain human-verified.
- No `eslint`/`prettier` npm scripts exist, so there's no automated style gate.

## Final status

**Repository is left more stable than found.** Baseline was green; it is still
green, with **six real defects fixed** (two of them high-severity data-loss, one a
Live-crash XML-injection risk), **one dead test assertion repaired**, and **~106
net new tests** (unit 1082 → 1188). Every fix carries a regression test, and the
data-loss/collision fixes were proven to fail without their fix. All five suites
pass and the production build compiles.

| Suite | Baseline | After |
|---|---|---|
| `check` | 0 errors | **0 errors** |
| unit | 1082 | **1188** |
| browser | 52 | **52** |
| desktop | 58 | **59** |
| build | ✓ | **✓** |
