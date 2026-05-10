# Goal plan and implementation levels

Living checklist for **what we intend to build** and **how complete each slice is**. Update this in-repo when scope or maturity changes; it complements [`regression-checklist.md`](regression-checklist.md) (QA after migrations) and [`AGENTS.md`](../AGENTS.md) (Ableton `.als` notes).

## Implementation levels

Use **one letter** in **Lvl** plus short **Notes**. Values below are **subjective estimates** from the current codebase (May 2026); change them when reality shifts.

| Lvl | Meaning |
|:---:|:---|
| **N** | **Not started** — no meaningful code path or agreed design is locked in. |
| **S** | **Spike / partial** — explored or stubbed; not reliable for normal use. |
| **M** | **MVP** — happy path works end-to-end for the primary user flow. |
| **R** | **Robust** — errors, edge cases, persistence, and regressions we care about are handled or explicitly deferred with tickets. |
| **P** | **Polished** — UX, performance, and docs match what we’d show outsiders; covered by checks we trust. |

Notes may include `(blocked: …)`.

### How to read the “detail” sections

Under each epic, **Detail** bullets spell out **what exists in code**, **what keeps the level below R/P**, and **what would justify bumping a row**. This is not a spec — it is audit-style commentary tied to the repo today.

### Epic codes (stable first column)

| Code | Epic |
|:----:|:-----|
| `SE` | Song / `.smap` edit view |
| `PV` | Project view |
| `AB` | Ableton export |
| `DT` | Desktop client |
| `PF` | Platform & shared layer |

---

## Status tables

All tables share: **Epic** · **Work item** · **Lvl** · **Notes**.

### Song / `.smap` edit view `SE`

Canonical single-song experience — timeline, waveform, harmony, sections, cues — driven by [`SongMap`](../src/lib/songmap/types.ts).

**Epic rollup:** **M** — core editing surface is real; export/cue satellites uneven (**S**/**N**).

| Epic | Work item | Lvl | Notes |
|:----:|-----------|:---:|:------|
| SE | Core timeline / waveform / playback | M | Large `WaveformPlayer` surface; manual QA via [`regression-checklist`](regression-checklist.md). |
| SE | Beat / bar grid editing | M | `applyBarGridAction`, strip UX; errors surfaced as `beatEditError`. |
| SE | Chord edit | M | Radial picker, multi-beat, paste pipeline; some coverage in `chordClipboard.test.ts`. |
| SE | Section edit | M | Range select + tag + overlap replace (`sectionEdit.ts`); labels default from kind only. |
| SE | Cue UX — count-in / prepend | M | Radio count-in, live prepend math (`computeCountIn`); `CueSettings` has unused fields (`spoken`, templates…). |
| SE | Text-to-speech cue audio | N | UI placeholder only (“coming soon”); schema allows `spoken` but no synthesis/export path. |
| SE | Chord / lead-sheet PDF | S | `pdfLeadSheet.ts` + menu export; slash notation / engraving quality weak vs “gig-ready chart”. |

#### Detail — `SE`

- **Core timeline / waveform / playback (`M`, not `R`)**  
  **Evidence:** `/edit` wires trim-aware playback, minimap, selection tools described in regression checklist.  
  **Gap:** No automated UI/e2e harness; edge cases (very short clips, permission revoke mid-session, huge MP3 decode) rely on manual passes. **→ R** needs broader automated coverage or a tightened manual matrix.

- **Beat / bar grid (`M`)**  
  **Evidence:** `timelineEdit` / bar grid actions persist through `patchSongMap`.  
  **Gap:** Complex edits (odd meters mid-song, sparse failure messages) not exhaustively tested in Vitest. **→ R** when destructive edits have invariant tests + clearer recovery.

- **Chord edit (`M`, nearing `R` on clipboard slice)**  
  **Evidence:** Harmony keyed by beat; `ChordRadialQuickSelect`; clipboard helpers tested (`chordClipboard.test.ts`).  
  **Gap:** Full matrix (carry-forward display, edge chords, accessibility, undo story if added) not fully specified/tested. **→ R** when chord edits share the same validation discipline as timeline edits.

- **Section edit (`M`)**  
  **Evidence:** `setSectionForBarRange` replaces overlaps; strip UX documents modifiers.  
  **Gap:** No UI for custom **labels** or **colors** per section (`Section.label` / `color` exist but flow is kind presets). Medleys / duplicate kinds across disjoint ranges are OK but not “musical director” grade. **→ R** with label/color editing + validation tests.

- **Cue UX — count-in (`M`)**  
  **Evidence:** `cues.mode` driven to `countIn` / `off`; prepend seconds computed for stem alignment guidance.  
  **Gap:** `CueMode` includes `click` / `spoken` but editor does not expose them; `useSectionLabels`, `template`, `language` unused. **→ R** when modes match real rehearsal flows + persisted cues sync with exports.

- **TTS cue audio (`N`)**  
  **Evidence:** None — placeholder string in [`edit/+page.svelte`](../src/routes/edit/+page.svelte).  
  **→ M** needs synthesis target (browser vs rendered WAV), file placement, and Ableton/session playback story.

- **Lead-sheet PDF (`S`)**  
  **Evidence:** jsPDF path draws staff skeleton, chords, section labels; invoked from menu.  
  **Gap:** Typography, collisions, multi-page breaks, and musician expectations lag; few tests. **→ M** when charts are readable for a real set; **→ R/P** when layout rules + golden renders exist.

---

### Project view `PV`

Multi-song folder layout, manifest (`barbro.project.json`), open song → `/edit`.

**Epic rollup:** **M** — disk format + editor bridge solid; **setlist reorder** in UI; **bulk export** still thin (**S**).

| Epic | Work item | Lvl | Notes |
|:----:|-----------|:---:|:------|
| PV | Open / save project folder layout | M | Parse/serialize + `createProjectOnDisk` / `openProjectFromHandle`; handle in IndexedDB via `PROJECT_HANDLE_KEY`. |
| PV | Project song structuring | M | Stable IDs, hide/remove/import/new song; **setlist order** via ↑↓ on project page (`moveProjectSong` in `commit.ts`). No grouping / nested sets yet. |
| PV | Per-song entry → open in song editor | M | `loadProjectSongIntoEditor`; autosave debounced on `/edit` in project mode (`projectAutosave.ts`). |
| PV | Bulk / project-level export hooks | S | `getExportableSongs` filters hidden; no multi-song Ableton/PDF batch UX wired. |

#### Detail — `PV`

- **Open / save layout (`M`, not `R`)**  
  **Evidence:** Atomic commit ladder + rollback notes in [`commit.ts`](../src/lib/project/commit.ts); `song.smap` invariant enforced on add/import.  
  **Gap:** Failure UX across browsers (quota, partial writes) not uniformly surfaced to users; no migration versioning beyond `formatVersion: 1`. **→ R** with user-visible recovery + migration tests.

- **Song structuring (`M`, not `R`)**  
  **Evidence:** Manifest order is canonical (`ProjectFile.songs` order); `moveProjectSong` rewrites manifest + `updatedAt`; project list rows expose move up/down (`ProjectSongRow`).  
  **Gap:** No drag-and-drop, no undo, no grouping (sets within a tour). **→ R** when reorder errors/surfaces match other manifest ops + optional keyboard reorder. **→ R** on data when duplicate-folder conflicts are impossible or detected.

- **Per-song → editor (`M`)**  
  **Evidence:** Mode `project-song`, active folder resolution for picks + Ableton `/set` folder shortcut.  
  **Gap:** Edge cases (song deleted on disk while editor open, manifest drift) partially guarded via autosave manifest invariant check — still worth explicit tests. **→ R** with regression tests for drift scenarios.

- **Bulk export (`S`)**  
  **Evidence:** Helper filters hidden songs; comments reference future bulk Ableton/PDF.  
  **Gap:** No orchestration UI, no progress/cancel, no parallel safety on writes. **→ M** when one command exports N `.als` or similar.

---

### Ableton export `AB`

`.als` gzip XML + on-disk stems; Live 12-oriented ([`abletonSet.ts`](../src/lib/export/abletonSet.ts), `/set`).

**Epic rollup:** **M** — main XML path is substantial; **loop/cue/DSP** goals barely started (**S**/**N**).

| Epic | Work item | Lvl | Notes |
|:----:|-----------|:---:|:------|
| AB | Baseline set export (tracks, clips, project audio) | M | Tempo, meter, stems, arrangement + session clips (audio registration per AGENTS). |
| AB | Click tracks | M | MIDI note clip + embedded Drum Rack XML (`clickDrumRack.xml`). |
| AB | Backing track | M | Fixed stem slots (`STEM_TRACKS`); user binds folder audio → `StemClip` refs. |
| AB | Loopable sections | S | **Locators** from sections; Live loop brace / practice workflows not explicitly authored. |
| AB | Loopable cues | N | Song **cues** (count-in, future TTS) do not drive Live cue markers / loop regions in export. |
| AB | Normalized audio stems | N | No loudness / peak targeting before writing WAV refs — manual prep. |

#### Detail — `AB`

- **Baseline export (`M`, fragile `R` barrier)**  
  **Evidence:** Large generator aligns trim (`audio.trim.startSec`) with MIDI/audio clips; `ensureAbletonProjectFolder` for relative refs.  
  **Gap:** Live minor-version coupling & SIGSEGV risk ([`AGENTS.md`](../AGENTS.md)); verification is manual open-in-Live. Count-in **prepend** from `CueSettings` is **not** clearly folded into clip timelines — trim alignment uses audio trim only. **→ R** needs scripted golden `.als` checks + documented Live version pinning.

- **Click tracks (`M`)**  
  **Evidence:** Per-beat MIDI with drum rack device IDs isolated above generator IDs.  
  **Gap:** Sound palette tied to factory rack samples; edge BPM/tempo maps untested at extremes. **→ R** when sample fallback + listening checklist exists.

- **Backing / stems (`M`)**  
  **Evidence:** Named tracks; folder scan + clip pairing session/arrangement.  
  **Gap:** Missing stem slots stay empty tracks — OK but not guided; no loudness match between stems. See normalization row.

- **Loopable sections (`S`)**  
  **Evidence:** `xmlLocator` list from `SongMap.sections`.  
  **Gap:** Locators ≠ Arrangement Loop Start/Length automation; no scene launcher loops per section. User expectation “loop this chorus” only partly met. **→ M** when loop behavior defined and encoded intentionally.

- **Loopable cues (`N`)**  
  **Evidence:** `CuePointsListWrapper` stub in template; no mapping from `cues` model.  
  **→ S** once any cue exports as marker or clip boundary.

- **Normalized stems (`N`)**  
  **Evidence:** None in TS pipeline.  
  **→ S** with offline peak/RMS pass + preview; **→ M** when export applies gain per stem non-destructively.

---

### Desktop client `DT`

Native shell, OS folders, long jobs, optional Python stems bridge.

**Epic rollup:** **N** — zero packaging/integration in-repo today.

| Epic | Work item | Lvl | Notes |
|:----:|-----------|:---:|:------|
| DT | Shell / packaging (Tauri / Electron / …) | N | Ship target undefined; web-only deployment. |
| DT | Bridge to OS folders | N | Browser FS Access used instead (permission UX differs). |
| DT | Stems generation | N | External Python program — no spawn/API/worker contract in this repo. |
| DT | Offline / updates | N | — |

#### Detail — `DT`

- **Shell / folders / stems / offline** — all **N**: no `src-tauri`, no Electron main process, no IPC layer, no bundled Python runtime. **→ S** is a thin spike (open folder + shell echo); **→ M** requires install story, code signing expectations, and stems job lifecycle (progress, cancel, errors).

---

### Platform & shared layer `PF`

Cross-cutting: format, analysis pipeline, persistence, optional cloud/DB.

**Epic rollup:** **M** — `.smap` + parsing strongest (**R**); cloud/DB **S**.

| Epic | Work item | Lvl | Notes |
|:----:|-----------|:---:|:------|
| PF | `.smap` encode/decode, deterministic saves | R | Tests: [`smapFile.test.ts`](../src/lib/songmap/smapFile.test.ts), [`persist.test.ts`](../src/lib/songmap/persist.test.ts); deterministic key order documented. |
| PF | Web audio pipeline (upload → analyze → reference MP3) | M | `/analyzing`, server analysis merge, [`encodeReferenceAudio.test.ts`](../src/lib/audio/encodeReferenceAudio.test.ts); failure modes vary by browser codec. |
| PF | Local folder handles / autosave / Ableton marker | M | [`folderHandle.ts`](../src/lib/client/folderHandle.ts), project autosave guards; permission revoke = silent skip. |
| PF | Cloud / sync | S | `/api/projects` + fingerprint; list/save/load/copy-from-cloud — **not** full sync or conflict resolution. |
| PF | Postgres autosave (Docker) | S | Migrations [`001_editor_sessions.sql`](../db/migrations/001_editor_sessions.sql), [`002_projects.sql`](../db/migrations/002_projects.sql); parallel **browser API** path — adoption/ops unclear. |

#### Detail — `PF`

- **`.smap` (`R`)**  
  **Evidence:** Binary layout tests + JSON round-trips; deterministic serialization called out in [`smap-format.md`](smap-format.md).  
  **Gap:** **P** would add fuzz/import corpus + version migration guides for older files.

- **Web audio pipeline (`M`)**  
  **Evidence:** Trim-to-WAV for analysis, merge into map, lamejs reference encode path.  
  **Gap:** Large-file memory pressure, analysis API timeouts, re-analysis UX partially manual. **→ R** with job timeouts + user-visible retry semantics.

- **Folder handles / autosave (`M`)**  
  **Evidence:** Debounced `song.smap` writes with seven guard clauses (`projectAutosave.ts`).  
  **Gap:** User may not know when autosave skipped (permission); standalone `/edit` vs project-mode differs. **→ R** with status indicator + failure toasts.

- **Cloud (`S`)**  
  **Evidence:** [`projectsCloud.ts`](../src/lib/client/projectsCloud.ts) CRUD-shaped calls; fingerprint identity only.  
  **Gap:** No offline queue, no merge, no multi-device story, no project-scoped cloud matching folder projects. **→ M** when “save to cloud” matches mental model for BarBro projects.

- **Postgres (`S`)**  
  **Evidence:** Schema exists for sessions + named projects.  
  **Gap:** Feature flag / deployment docs thin; not proven as primary persistence vs OPFS/local. **→ M** when one blessed path is documented and tested in CI.

---

## Epic boundaries — are these the right slices?

| Epic | Rough scope |
|:----:|:------------|
| SE | Everything that mutates **one** `SongMap` |
| PV | Everything that mutates **many** songs + manifest |
| AB | Everything whose contract is **Live’s file format + assets** |
| DT | Everything that needs **OS integration** or **non-browser runners** |
| PF | Shared infrastructure |

**Optional splits later:** print/share epic if PDF grows; “audio prep” if normalization + TTS + stems share one pipeline.

**Desktop vs web:** SE + PV remain web-first; DT adds shell and long-running jobs without renaming epics.

---

## Where this lives vs README

- **`README.md`** — quick start; link here instead of duplicating matrices.
- **`docs/goal-plan.md`** — epics + maturity; versioned with the code.
- **Issue tracker / Trello** — owners and dates; mirror epic codes (`SE`, `PV`, …) here for grep-friendly sync.

When a row reaches **R** or **P**, extend [`regression-checklist.md`](regression-checklist.md) where it defines “done.”
