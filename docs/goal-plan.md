# Goal plan and implementation levels

Living checklist for **what we intend to build** and **how complete each slice is**. Update this in-repo when scope or maturity changes; it complements [`regression-checklist.md`](regression-checklist.md) (QA after migrations), [`architecture.md`](architecture.md), and [`AGENTS.md`](../AGENTS.md) (agent operating guide).

## Implementation levels

Use **one letter** in **Lvl** plus short **Notes**. Values below are subjective estimates from the current codebase; change them when reality shifts.

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

**Epic rollup:** **M** — core editing surface is real; verbose grid/sections/chords/cue copy folded behind «How this tab works» / «About count-in»; waveform zoom/pan/selection help under «Zoom & shortcuts»; export/cue satellites uneven (**S**/**N**).

| Epic | Work item | Lvl | Notes |
|:----:|-----------|:---:|:------|
| SE | Core timeline / waveform / playback | M | Large `WaveformPlayer` surface; manual QA via [`regression-checklist`](regression-checklist.md). |
| SE | Beat / bar grid editing | M | `applyBarGridAction`, strip UX, **bar-edge drag** (`setBarBoundary` + `TimelineBeatGrid` handles); errors surfaced as `beatEditError`. |
| SE | Chord edit | M | Radial picker, multi-beat, paste pipeline, reversible song transpose display/write path; some coverage in `chordClipboard.test.ts` + `transposition.test.ts`. |
| SE | Generated drum track (BarBro Drums) | M | Drum stem → band-flux hit detection (`sections/transcribe_drums.py`, tuned on 3 real songs: min-tail cymbal discrimination, ghost-kick suppression) → `drumMidi` events (synced, LWW) → mixer lane "BarBro Drums" rendered with a picker of three kits (deterministic synth; acoustic kit now BUNDLED — five VCSL/CC0 one-shots in `static/drums/acoustic` with per-file provenance in LICENSE.md and a WAV-contract test; "Your kit" — the user's own one-shots from `<project>/kits/drums/*.wav` read via the sidecar, never bundled, partial kits filled by fallbacks, mixer always re-synthesizes since the fingerprint can't see sample files) at fixed −16 dB RMS. Quantize off/8ths/16ths/triplets at render time. Bass-ready schema. Gaps: no bundled acoustic samples yet, toms weak, groove engine loses fills/transitions (steady patterns only), Ableton MIDI export deferred. |
| SE | Generated bass track (BarBro Bass) | M | Bass stem → YIN monophonic note tracking (`sections/transcribe_bass.py`: RMS gate, attack-flake cleanup; validated on LNFSG vs hand-placed chords — 41.6% of sounding time on the exact bass note once the sheet's +2 key offset is accounted for, rest on chord tones) → `bassMidi` notes (synced, LWW like drumMidi) → "BarBro Bass" mixer lane, plucked-string synth bench-tuned against real stems (band-energy comparison vs LNFSG + Diggiloo bass stems: body ≤500 Hz within ~2 dB, definition 500 Hz+ between the two references; velocity→brightness, pluck transient, seeded string-rattle layer, light saturation) at fixed −18 dB RMS. Default style is the confident-bassist pass (`bassGroove.ts`: octave-flake folding, 8th-grid lock, legato phrasing, flattened dynamics — on Dum av dig: level swing 4.4→0.6 dB, sub-100 ms stabs 96→0); 'As detected' + quantize remain selectable. Transposition shifts NOTES and re-synthesizes (no stretch artifacts). Panel row lives in the BarBro Band panel. Gaps: single voice, YIN front-end could upgrade to basic-pitch (ML) if note accuracy limits, Ableton MIDI export deferred. |
| SE | Chord-sheet import (UG paste) | M | Paste a chords-over-lyrics sheet in the Lyrics tab → strict token parser (`chords/sheet/chordToken.ts`, lenient-parser trap locked by tests), column→word anchoring (`parseChordSheet.ts`), placement quantizes anchors to bar downbeats with a capped per-bar chroma vote + shared-bar-penalty DP (`placeChords.ts`; 12/14 exact-beat vs a hand-placed LNFSG reference, was 2/14), instrumental spreads, sections derived from markers (`deriveSections.ts`). One undo step; imports stash existing chords AND sections as parallel layers (v5 `chordLayers`/`sectionLayers`, switchers in both tabs). URL fetch deferred. |
| SE | Section edit | M | Range select + tag + overlap replace (`sectionEdit.ts`); labels default from kind only. |
| SE | Cue UX — count-in / prepend | M | Top-level count-in, live prepend math (`computeCountIn`), v2 canonical `cueTracks[]`, merge-aware section generation, selected-track render metadata (`cueTracks[].renderExport`) + click metadata (`clickExport`) with fingerprint auto-drop on drift. Cue tab has track/event editing MVP; recording and polish remain. |
| SE | Text-to-speech cue audio | M | Piper `POST /native/tts/synthesize` + explicit cue events rendered by [`renderCueTrack`](../src/lib/audio/renderCueTrack.ts) when BarBro desktop is running; schedule in [`cueTrackSpeechSchedule.ts`](../src/lib/audio/cueTrackSpeechSchedule.ts). Web-only sessions get clicks + on-screen note if desktop is off. |
| SE | Chord / lead-sheet PDF | S | `pdfLeadSheet.ts` + menu export; slash notation / engraving quality weak vs “gig-ready chart”. |

#### Detail — `SE`

- **Core timeline / waveform / playback (`M`, not `R`)**  
  **Evidence:** `/edit` wires trim-aware playback, minimap, selection tools described in regression checklist.  
  **Gap:** No automated UI/e2e harness; edge cases (very short clips, permission revoke mid-session, huge MP3 decode) rely on manual passes. **→ R** needs broader automated coverage or a tightened manual matrix.

- **Beat / bar grid (`M`)**  
  **Evidence:** `timelineEdit` / bar grid actions persist through `patchSongMap`; grid mode can **drag bar left/right edges** to stretch/shrink a bar (beats re-equalized); `timelineEdit.test.ts` covers `setBarBoundary`.  
  **Gap:** Complex edits (odd meters mid-song, sparse failure messages) not exhaustively tested in Vitest. **→ R** when destructive edits have invariant tests + clearer recovery.

- **Chord edit (`M`, nearing `R` on clipboard slice)**  
  **Evidence:** Harmony keyed by beat; `ChordRadialQuickSelect`; clipboard helpers tested (`chordClipboard.test.ts`); `formatVersion: 3` adds shared reversible transpose while source harmony/audio stay original. Display labels, chord picker commits, copy/paste, lead sheet, PDF/MusicXML, and mixer chord rail use sounding chords; nonzero audio transpose now waits for a local Rubber Band cache instead of playing wrong-pitch audio.
  **Gap:** Full UI/e2e matrix for transposed editing, edge chords, accessibility, undo story if added. Audio transpose still needs licensed Rubber Band binaries in the desktop bundle and real-song QA across semitone ranges. **→ R** when chord edits share the same validation discipline as timeline edits.

- **Section edit (`M`)**  
  **Evidence:** `setSectionForBarRange` replaces overlaps; strip UX documents modifiers.  
  **Gap:** No UI for custom **labels** or **colors** per section (`Section.label` / `color` exist but flow is kind presets). Medleys / duplicate kinds across disjoint ranges are OK but not “musical director” grade. **→ R** with label/color editing + validation tests.

- **Cue UX — count-in (`M`)**  
  **Evidence:** `formatVersion: 3` still migrates old cue fields into canonical `cueTracks[]`; `/edit` Cue tab can add/rename/duplicate/delete cue tracks, generate section/count events, edit/toggle/remove events, add custom cues, and render the selected track to `cue/tracks/<trackId>/cue-track.wav`. Click-only render remains `cue/click-track.wav`; `patchSongMap` clears stale per-track render metadata.
  **Gap:** Timeline markers/inspector/preview polish are still basic; no microphone recording UI yet; generated phrasing is intentionally simple. **→ R** when the editor feels musician-grade, supports recording, and has broader UI/e2e coverage.

- **TTS cue audio (`M` on desktop slice; web = clicks-only + note)**  
  **Evidence:** `POST /native/tts/synthesize` + `--text-file` in Piper; [`renderCueTrack.ts`](../src/lib/audio/renderCueTrack.ts) renders explicit `CueTrack` events; [`generateCueTrackFromSections`](../src/lib/songmap/cueTracks.ts) materializes section/count events with stable generated keys. Fingerprint includes the selected cue track, count-in, start beat, timeline, trim, and sections.  
  **Gap:** No in-browser neural TTS (requires sidecar); custom phrase templates/languages and recorded-audio events are schema-ready but not fully surfaced. **→ R** when web fallback or cloud TTS exists and copy/voice/recorded assets are robustly editable.

- **Lead-sheet PDF (`S`)**  
  **Evidence:** jsPDF path draws staff skeleton, chords, section labels; invoked from menu.  
  **Gap:** Typography, collisions, multi-page breaks, and musician expectations lag; few tests. **→ M** when charts are readable for a real set; **→ R/P** when layout rules + golden renders exist.

---

### Project view `PV`

Multi-song folder layout, manifest (`barbro.project.json`), open song → `/edit`.

**Epic rollup:** **M** — disk format + editor bridge solid; **setlist reorder** in UI; refresh line shortened with full detail on hover; **bulk export** still thin (**S**).

| Epic | Work item | Lvl | Notes |
|:----:|-----------|:---:|:------|
| PV | Open / save project folder layout | M | Parse/serialize with path validation (rejects `..` / leading-`/` / `\`); `createProjectOnDisk` / `openProjectFromHandle`; atomic commit ladder with rollback (incl. cleanup-failure surface); handle in IndexedDB via `PROJECT_HANDLE_KEY`; stale `?project=1` URL gracefully degrades to standalone. |
| PV | Project song structuring | M | Stable IDs, hide/remove (incl. "delete files" checkbox), import-local-`.smap`, cloud hydration/import flows, create-new via `?project=1` flow; **setlist order** via ↑↓ on project page (`moveProjectSong` in `commit.ts`). No drag-and-drop, no grouping / nested sets yet. |
| PV | Per-song entry → open in song editor | M | `loadProjectSongIntoEditor`; autosave debounced on `/edit` in project mode with 7-guard chain incl. fresh permission re-check + manifest `{folder,id}` invariant (`projectAutosave.ts`). `/project/playback` now gives the project a dedicated live setlist/playback route using the same song loader. |
| PV | Bulk / project-level export hooks | S | `getExportableSongs` filters hidden; no multi-song Ableton/PDF batch UX wired. |

#### Detail — `PV`

- **Open / save layout (`M`, not `R`)**  
  **Evidence:** Atomic commit ladder + rollback notes in [`commit.ts`](../src/lib/project/commit.ts); `song.smap` invariant enforced on add/import; folder name = `<slug>-<id.slice(0,8)>` with up to 3 retries on collision; rollback path raises a "files may remain on disk" error when even cleanup fails so the manifest invariant is never violated; `barbro.project.json` written deterministically with key sort.  
  **Gap:** Failure UX across browsers (quota, partial writes) lands as raw thrown messages rather than a structured toast/recovery UI; SongMap has `formatVersion: 3` cue/transpose migration tests, but broader project-manifest migrations are still ad hoc. **→ R** with user-visible recovery + manifest migration tests.

- **Song structuring (`M`, not `R`)**  
  **Evidence:** Manifest order is canonical (`ProjectFile.songs` order); `moveProjectSong` rewrites manifest + `updatedAt`; project list rows expose move up/down; local `.smap` imports land through [`importSmapToProject`](../src/lib/project/commit.ts), and cloud/hydration import paths reuse the same project file primitives; remove dialog distinguishes "remove from manifest" from "also delete files".  
  **Gap:** No drag-and-drop, no undo, no grouping (sets within a tour). **→ R** when reorder errors/surfaces match other manifest ops + optional keyboard reorder. **→ R** on data when duplicate-folder conflicts are impossible or detected.

- **Per-song → editor (`M`)**  
  **Evidence:** Mode `project-song`, active folder resolution for picks + Ableton `/set` folder shortcut; in project mode `/set` writes the `.als` next to `song.smap` as `song.als` (constant filename).  
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
| AB | Loopable cues | N | Song `cueTracks[]` and count-in do not yet drive Live cue markers / loop regions in export. |
| AB | Normalized audio stems | N | No loudness / peak targeting before writing WAV refs — manual prep. |

#### Detail — `AB`

- **Baseline export (`M`, fragile `R` barrier)**  
  **Evidence:** Large generator aligns trim (`audio.trim.startSec`) with MIDI/audio clips; `ensureAbletonProjectFolder` for relative refs.  
  **Gap:** Live minor-version coupling & SIGSEGV risk ([`AGENTS.md`](../AGENTS.md)); verification is manual open-in-Live. Count-in **prepend** from top-level `countInBeats` is not fully represented across every Live cue/loop workflow. **→ R** needs scripted golden `.als` checks + documented Live version pinning.

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
  **Evidence:** `CuePointsListWrapper` stub in template; no mapping from `cueTracks[]` model.  
  **→ S** once any cue exports as marker or clip boundary.

- **Normalized stems (`N`)**  
  **Evidence:** None in TS pipeline.  
  **→ S** with offline peak/RMS pass + preview; **→ M** when export applies gain per stem non-destructively.

---

### Desktop client `DT`

**Headless** native/Python sidecar invoked by the BarBro **web app** over loopback HTTP. Hosts long-running jobs (beats, stems). **No window, no renderer, no IPC** — the Electron main process runs as a background service (dock icon on macOS, Cmd+Q to quit) and exposes everything via HTTP. Logs to the terminal when run from `npm run dev`. An ongoing migration brings functionality from the `frequency_domain` repo into [`desktop/native/`](../desktop/native/README.md) (see [`PROVENANCE.md`](../desktop/native/python/PROVENANCE.md)).

**Epic rollup:** **S** — Headless sidecar for beats + stems + **Piper TTS hello-world** (web → loopback → Python). Distribution: signing still missing; Windows x64 build path landed (unreleased). OS-folder bridge gaps unchanged; stems path migration may still be in flux.

| Epic | Work item | Lvl | Notes |
|:----:|-----------|:---:|:------|
| DT | Shell / packaging (Electron) | S | [`desktop/`](../desktop/README.md): `npm run dev` runs headless (no window); **`npm run dist:mac-arm64`**; loopback HTTP exposes `/ping`, beats, stems, YouTube audio import, **Piper TTS** (`/native/setup/piper-tts`, `/native/tts/hello-world`), jobs/stems cleanup. **[`native/python/`](../desktop/native/python/README.md)** bundles madmom, Demucs, **`youtube/`**, **`piper_tts/`**. No signing/notarization. **Windows x64 port in tree** (2026-07-11): all venvs via uv (no system Python), CUDA torch preinstall on NVIDIA boxes (`Device: cuda`), CI `build-windows` job → unsigned NSIS installer + madmom cp310 wheel as release assets, tray quit affordance, `/ping` capabilities (pause/resume hidden on win), managed imageio-ffmpeg copy. Awaiting first `desktop-v*` tag + on-box verification; manifest `win-x64.url` flips after the release exists. Known win gaps: Rubber Band binary (transpose), signing. |
| DT | Web: installers page + manifest | M | [`/download`](../src/routes/download/+page.svelte), `PUBLIC_DESKTOP_MANIFEST_URL` + [`static/desktop-downloads.json`](../static/desktop-downloads.json); arm64 DMG same-origin via **`npm run desktop:dist-mac-sync`** → [`static/releases/`](../static/releases/README.md). |
| DT | Web: companion connected indicator | M | [`desktopBeacon.ts`](../src/lib/client/desktopBeacon.ts), layout poll, **Monitor** chip + File → Download in [`AppMenuBar`](../src/lib/components/AppMenuBar.svelte). |
| DT | Bridge to OS folders | N | Earlier IPC pickers (`native:pick-audio` / `native:pick-output-dir`) removed with the renderer. No loopback HTTP equivalent yet; web app uses FS Access for the project folder. |
| DT | Local beats analysis | M | Beats run through local desktop. [`beats/analyze_downbeats.py`](../desktop/native/python/beats/analyze_downbeats.py) (madmom) is reachable via `POST /native/analyze-downbeats`; web `/analyzing` requires the companion and converts returned beats with [`beatsToSongMap`](../src/lib/analysis/beatsToSongMap.ts). |
| DT | Stems generation | M | [`stems/demucs_separate.py`](../desktop/native/python/stems/demucs_separate.py) (Demucs CLI, derived from frequency_domain `stem_splitter.py` per `PROVENANCE.md`) reachable via **NDJSON-streaming** `POST /native/separate-stems` with progress events; web `StemSplitter.svelte` mirrors the Tk UI (stems checkboxes, quality presets, two progress bars, log). Heavy deps install on demand rather than at sidecar boot. Sidecar persists recoverable stem job intents and requeues interrupted splits on restart/setup, skipping already-healthy stem files. |
| DT | YouTube audio import | S | Shared Add Audio dialog supports local files and YouTube URL import. Sidecar `POST /native/import/youtube` queues best-audio download + PCM WAV conversion through managed `youtube/` tools, then returns a normal audio artifact for main import or writes `<song>/audio/*.wav` for project rows. |
| DT | Auto stem preparation | S | Project-wide policy (`autoStems {enabled,stems,quality}` in `barbro.project.json`) set via [`ProjectSettingsDialog`](../src/lib/components/ProjectSettingsDialog.svelte). Background scheduler [`autoStems.ts`](../src/lib/client/autoStems.ts) (started in layout, like autosave) renders missing/below-target stems for every analyzed, non-hidden song with audio through the existing serial Demucs queue. **Off by default.** Stability: renders the full untrimmed file (trim-independent); WAV-health check re-renders partial files; per-song attempt cap; orphaned-job reaper (`syncStemJobsWithSidecar`) clears jobs lost to a companion restart; caps reset on reconnect / policy change / project switch; gave-up songs surface via `autoStemsAttention` in the project card; in-progress stems glow amber. **Gap:** stale stems aren't invalidated if a song's audio is later replaced (no replace-audio UI yet); not browser-verified end-to-end. |
| DT | Rubber Band transpose cache | S | Sidecar `GET /native/transpose/status` + `POST /native/project/pitch-shift-cache` build disposable `cache/transpose/rubberband-r3-v1/...` WAVs with `--fine --formant --time 1 --pitch`; cache identity includes source hash/size + semitone; corrupt/drifting caches are rejected or pad/trim-repaired. **Gap:** licensed Rubber Band binaries are not committed; manual audio-quality QA pending. |
| DT | Piper TTS (cue prep) | S | Separate [`piper_tts/`](../desktop/native/python/piper_tts/) venv under userData; `POST /native/setup/piper-tts` (NDJSON) downloads **en_US-lessac-medium** from Hugging Face; `GET /native/tts/hello-world` returns fixed phrase WAV; web [`/texttospeech`](../src/routes/texttospeech/+page.svelte). **→ M** when wired into real cue export + project paths. |
| DT | Hardware control / live rig | S | Design note in [`hardware-control.md`](domains/hardware-control.md). Target v1: Akai APC Key 25 mk2 controls Behringer XR18 monitor/main backing-track mix through sidecar MIDI + OSC bridge. Sidecar XR18 OSC primitive + narrow HTTP endpoints exist; song Overview mixer and `/project/playback` have an explicit-connect/explicit-arm XR18 follow strip plus a Web MIDI APC Key 25 strip for transport, restart, one-shot section replay, clip-grid stem toggles, mute, volume, previous/next project song, and LED feedback. Packaged sidecar MIDI/session layer is still next. |
| DT | Offline / updates | N | — |

#### Detail — `DT`

- **Shell (`S`)** — **Evidence:** [`desktop/electron/main.mjs`](../desktop/electron/main.mjs) is a headless loopback HTTP server (no `BrowserWindow`, no `ipcMain`); [`nativePython.mjs`](../desktop/electron/nativePython.mjs) resolves bundled script/native binary paths + spawn helpers; [`native/python/`](../desktop/native/python/README.md) bundles madmom + Demucs + **`piper_tts/`** scripts; [`electron-builder.yml`](../desktop/electron-builder.yml) unpacks `native/python` and `native/bin` from asar. Console banner + per-job logs on the parent terminal. **Gap:** No tray/menu-bar icon yet — Cmd+Q only (terminal `Ctrl+C` works when run via `npm run dev`); no Apple notarization / Windows packaging; licensed Rubber Band binaries still need to be added for packaged transpose. **→ M** when the packaged app is reproducibly installable on a fresh machine (signed + ffmpeg/demucs/Rubber Band onboarding handled).
- **Web download + indicator (`M`)** — **Evidence:** server load merges remote/static manifest; client OS detection; menu links. **Gap:** `electron-builder` + hosted DMG/EXE URLs still manual; HTTPS→loopback mixed-content caveats (see [`desktop/README.md`](../desktop/README.md)).
- **Bridge to OS folders (`N`)** — **Evidence:** none. The earlier renderer-only IPC pickers were removed when the desktop went headless. **→ S** when loopback HTTP endpoints (`POST /native/pick-audio`, `/native/pick-output-dir`) expose `dialog.showOpenDialog` results to the web app. **→ M** when the picker results actually flow into `SongMap.audio` / `stemRefs` (instead of being a parallel affordance only).
- **Local beats analysis (`M`)** — **Evidence:** [`beats/analyze_downbeats.py`](../desktop/native/python/beats/analyze_downbeats.py) (madmom) callable via `POST /native/analyze-downbeats`. `/analyzing` route requires the companion, calls [`analyzeDownbeatsViaDesktop`](../src/lib/client/desktopBridge.ts), and builds the `SongMap` with [`beatsToSongMap`](../src/lib/analysis/beatsToSongMap.ts). **Gap:** No automated live sidecar HTTP smoke; Python deps are managed by sidecar auto-setup but still depend on platform tooling. **→ R** when the desktop path has CI or repeatable smoke coverage.
- **Stems generation (`M`)** — **Evidence:** [`stems/demucs_separate.py`](../desktop/native/python/stems/demucs_separate.py) gained a `--stream-progress` mode that emits NDJSON `log` / `progress` / `done` events parsed from Demucs tqdm output. Loopback HTTP `POST /native/separate-stems` forwards the NDJSON stream straight to the web app; subsequent `GET /native/stems/:jobId/:filename` fetches each WAV. [`StemSplitter.svelte`](../src/lib/components/StemSplitter.svelte) renders the Tk-style UI (stems checkboxes, quality combobox, two progress bars, log) with Demucs install notes behind a help icon and progress/log in `<details>` when idle. Written stems land in `<folder>/stems/<name>.wav` via FS Access and auto-resolve into `/set`'s stem-slot bindings. Sidecar writes recoverable intents to userData (`stems-job-recovery.json`); restart/setup requeues interrupted jobs for missing/unhealthy stems, while explicit Cancel clears recovery. **Gap:** Recovery is job-level, not true Demucs checkpoint resume; browser-side job surfacing after tab close is still limited; no auto-install of Python deps. **→ R** when recovery has HTTP smoke/regression coverage + automated deps onboarding.
- **Piper TTS (`S`)** — **Evidence:** [`piper_tts/synthesize_wav.py`](../desktop/native/python/piper_tts/synthesize_wav.py) + dedicated userData venv (`piper-tts-venv`) and model dir; `GET /native/setup/piper-tts/status`, `POST /native/setup/piper-tts` (NDJSON install + HF voice download), `GET /native/tts/hello-world` (fixed “Hello world.” WAV). **Gap:** No arbitrary text/cue API from web yet; no bundling of voices in the DMG (download at setup time). **→ M** when cue pipeline calls Piper with project-relative output paths.
- **Hardware control / live rig (`S`)** — **Evidence:** Design scope captured in [`docs/domains/hardware-control.md`](domains/hardware-control.md). [`xairOsc.mjs`](../desktop/electron/xairOsc.mjs) implements OSC encoding/decoding, XR18 path builders, `/xremote` keepalive, and clamped write helpers; sidecar exposes `GET /native/hardware/status` plus narrow XR18 connect/disconnect/fader/mute/bus-send endpoints. [`LiveHardwareStrip.svelte`](../src/lib/components/LiveHardwareStrip.svelte) adds explicit XR18 connect + "Follow mixer" arming in the song Overview mixer, backed by [`xairRouting.ts`](../src/lib/hardware/xairRouting.ts) for lane-to-channel write planning. [`ApcKey25Control.svelte`](../src/lib/components/ApcKey25Control.svelte) adds Web MIDI APC Key 25 transport, restart, one-shot section replay, clip-grid stem toggles, mute, volume, previous/next project song, and LED feedback, backed by [`apcKey25.ts`](../src/lib/hardware/apcKey25.ts). **Gap:** packaged sidecar MIDI/session layer, monitor-bus mapping, full XR18 read-back state cache, fake XR18 session test beyond UDP-send smoke, and real-hardware smoke are still missing. **→ M** when MIDI/APC mapping is wired through the sidecar and fake-hardware-tested end to end.
- **Offline / updates** — still **N**.

---

### Platform & shared layer `PF`

Cross-cutting: format, analysis pipeline, persistence, optional cloud/DB.

**Epic rollup:** **M** — `.smap` + parsing strongest (**R**); cloud / sync now **M** (auth + schema + sync engine + audio reconcile + hydration packs + status pill + conflict modal all shipped; automated tests around merge + cloud roundtrip are the remaining gap to **R**).

| Epic | Work item | Lvl | Notes |
|:----:|-----------|:---:|:------|
| PF | `.smap` encode/decode, deterministic saves | R | Tests: [`smapFile.test.ts`](../src/lib/songmap/smapFile.test.ts), [`persist.test.ts`](../src/lib/songmap/persist.test.ts); deterministic key order documented; `readSmapJsonOnly` for fast metadata-only reads (project list view). |
| PF | Web audio pipeline (upload → analyze → reference audio) | M | `/analyzing`, trim-to-WAV, sidecar beat analysis, reference audio handling; failure modes vary by browser codec. |
| PF | Local folder handles / autosave / Ableton marker | M | [`folderHandle.ts`](../src/lib/client/folderHandle.ts), project autosave guards; permission revoke = silent skip. |
| PF | Cloud / sync (auth + project collab) | M | Supabase auth ([`hooks.server.ts`](../src/hooks.server.ts), Google OAuth + magic link, admin access panel now merges Auth-only users missing `access_grants` while excluding env-admins) ✓; cloud schema ([`004_drop_legacy`](../db/migrations/004_drop_legacy.sql)–[`010_cloud_rpcs`](../db/migrations/010_cloud_rpcs.sql)) ✓; sync engine + `/api/cloud/projects/[id]/(songs\|members\|manifest)` + [`cloudSync.ts`](../src/lib/client/cloudSync.ts) ✓; **Phase 5+6 audio reconcile** ([`audioReconcile.ts`](../src/lib/project/audioReconcile.ts) + sidecar `/native/project/song/audio/scan` + Locate / Import-pack / Ignore in [`RelinkAudioBanner.svelte`](../src/lib/components/RelinkAudioBanner.svelte)) ✓; **hydration packs** ([`AppMenuBar`](../src/lib/components/AppMenuBar.svelte) → File → Export/Import; `/native/project/hydration/{export,import}`) ✓; **Phase 7 status pill** ([`CloudSyncPill.svelte`](../src/lib/components/CloudSyncPill.svelte) — Synced / N pending / Offline; manual retry; auto-flush on `online` event) ✓; **Phase 8 conflict modal** ([`collabMerge.ts`](../src/lib/songmap/collabMerge.ts) field classification + [`ConflictResolutionDialog.svelte`](../src/lib/components/ConflictResolutionDialog.svelte) with per-row Keep mine / Take theirs and a "Take theirs (all)" shortcut) ✓. Remaining: automated tests around merge primitives + cloud roundtrip. |
| PF | Postgres autosave (Docker) | S | Migrations [`001_editor_sessions.sql`](../db/migrations/001_editor_sessions.sql), [`002_projects.sql`](../db/migrations/002_projects.sql); parallel **browser API** path — adoption/ops unclear. |

#### Detail — `PF`

- **`.smap` (`R`)**  
  **Evidence:** Binary layout tests + JSON round-trips; deterministic serialization called out in [`smap-format.md`](smap-format.md); `readSmapJsonOnly` reads only header + JSON chunk (audio bytes skipped) for fast project list metadata loads, with magic / version / size-invariant / 10 MB JSON-length sanity checks.  
  **Gap:** **P** would add fuzz/import corpus + version migration guides for older files.

- **Web audio pipeline (`M`)**  
  **Evidence:** Trim-to-WAV for analysis, sidecar beat detection, merge into map, reference audio state persisted in `.smap`/project flows.  
  **Gap:** Large-file memory pressure, analysis API timeouts, re-analysis UX partially manual. **→ R** with job timeouts + user-visible retry semantics.

- **Folder handles / autosave (`M`)**  
  **Evidence:** Debounced 1.5 s `song.smap` writes via `projectAutosave.ts`; seven guard clauses — project open + active song + `editingMode === 'project-song'` + route is `/edit` + fresh `queryPermission('readwrite')` + manifest entry exists with matching `{folder,id}`. Cloud push and on-disk project autosave are separate paths. [`folderHandle.ts`](../src/lib/client/folderHandle.ts) provides the `getDirectoryHandleByPath` / `removeEntryRecursive` primitives both autosave + commit ladder share.  
  **Gap:** User may not know when autosave skipped (permission); standalone `/edit` vs project-mode differs. **→ R** with status indicator + failure toasts.

- **Cloud / sync (`M`)**  
  **Evidence:** End-to-end multi-device project collab via Supabase:
  - **Auth** — Google OAuth + magic link via `@supabase/ssr`. Server client at [`serverClient.ts`](../src/lib/server/supabase/serverClient.ts), browser client at [`browserClient.ts`](../src/lib/client/supabase/browserClient.ts), per-request session resolution in [`hooks.server.ts`](../src/hooks.server.ts). [`/admin/access`](../src/routes/admin/access/+page.server.ts) reviews both `access_grants` rows and Supabase Auth users who signed up before a pending grant row existed; users listed in `ADMIN_USER_IDS` are excluded from synthesized pending rows because admin access is env-driven.
  - **Schema** — `cloud_projects`, `cloud_project_members`, `cloud_songs`, `cloud_project_revisions`, `access_grants` + RLS + RPC helpers, migrations `004`–`010`.
  - **Sync engine** — server routes under `/api/cloud/projects/[id]/{songs,members,manifest}`; client orchestration in [`cloudSync.ts`](../src/lib/client/cloudSync.ts); `pendingChanges` counter persisted on `ProjectFile.cloud`.
  - **Audio identity & reconcile (Phase 5)** — sidecar `/native/project/song/audio/scan` walks `<song>/audio/` and returns sha256 + duration + sample rate + channels + file size per file (cached by `(absPath, mtime, size)` in memory). [`audioReconcile.ts`](../src/lib/project/audioReconcile.ts) does sha-first match, loose-field fallback; called from [`loadProjectSongIntoEditor`](../src/lib/project/commit.ts) so a renamed-or-dropped audio file is auto-found and `audio.originalPath` is restamped before the editor loads. [`identityMatchesStrict`](../src/lib/songmap/audioIdentity.ts) now does cross-kind sha comparison (a scanned file's hash will match either the SongMap's `audio.sha256` OR `audio.originalSha256`).
  - **Missing-audio UI (Phase 6)** — [`RelinkAudioBanner.svelte`](../src/lib/components/RelinkAudioBanner.svelte) shows expected fileName, duration, and sha prefix; offers **Locate** (relink with strict sha check + "Use anyway" override modal), **Import hydration pack** (drop a `.zip` and the reconciler picks up the freshly-extracted file), and **Ignore for this session** (lets the user keep editing chord chart / sections without audio).
  - **Hydration packs (Phase 9)** — File menu **Export / Import hydration package…**; sidecar endpoints `/native/project/hydration/{export,import}`; per-song match by id then by audio sha; existing files on the receiver are never overwritten so the existing quality picker chooses across the union.
  
  **Phase 7 (status pill)**: [`CloudSyncPill.svelte`](../src/lib/components/CloudSyncPill.svelte) reads `project.data.cloud.pendingChanges` + `navigator.onLine` and renders Synced / N pending / Offline. Clicking N pending calls `requestCloudPush()` to retry; the autosave also auto-subscribes to the window `online` event so reconnecting flushes the queue without user action.

  **Phase 8 (conflict modal)**: [`collabMerge.ts`](../src/lib/songmap/collabMerge.ts) classifies every field on a 409 — id-keyed list items (`harmony`, `sections`, `timeline.bars/beats`, `cueTracks`, and `cueTracks[].events`) merge per id; scalar metadata + cue track fields + countInBeats + startBeatId surface as safe conflicts; whole-timeline regeneration / `metadata.analyzed` flip / `expectedAudio` swap surface as `dangerous`. Defaults cloud-wins; the dialog ([`ConflictResolutionDialog.svelte`](../src/lib/components/ConflictResolutionDialog.svelte)) lets the user flip individual rows back to "Keep mine" or hit "Take theirs (all)" to wholesale-accept. On Apply we push the resolved SongMap with the cloud's revision as the new `clientBaseRevision`.

  **Automated coverage**:
    - [`collabMerge.test.ts`](../src/lib/songmap/collabMerge.test.ts) — non-overlapping list merges, same-id collisions, scalar metadata, dangerous flags, `applyConflictDecisions`, and no-silent-data-loss invariants.
    - [`audioIdentity.test.ts`](../src/lib/songmap/audioIdentity.test.ts) — strict cross-kind matching, loose-field tolerance, combined `identityMatches` priority, and `identityFromAudioRef` projection.
    - [`audioReconcile.test.ts`](../src/lib/project/audioReconcile.test.ts) — strict-match, cross-kind match, loose-match fallback, no-match, no-expected, scan-failure, and `applyReconcileMatch` preservation.

  **Gap to R:**
    - **No live HTTP smoke** against the new sidecar endpoints. The endpoint handlers are syntax-checked + logic-validated against a real project via standalone JS mirrors (the hydration export roundtrip and the audio scan-and-match flow), but no test actually fires an HTTP request at a running sidecar. Shipping unblocks this: once `desktop-v0.1.6` is out, the deployed web app exercises every endpoint on first use.
    - Conflict modal "Open diff" view isn't implemented — for the dangerous severity rows, surfacing the structural diff inline (vs just the JSON snippet) would help users decide more confidently.
    - No end-to-end multi-device test (two browsers, two accounts, concurrent edit, real 409). Would need a test harness that spins up two Supabase sessions; deferred until adoption justifies it.

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

- **`README.md`** — quick start; link into [`index.md`](index.md) instead of duplicating matrices.
- **`AGENTS.md`** — short agent operating guide.
- **`docs/goal-plan.md`** — epics + maturity; versioned with the code.
- **`docs/domains/`** — deep domain notes.
- **Issue tracker / Trello** — owners and dates; mirror epic codes (`SE`, `PV`, …) here for grep-friendly sync.

When a row reaches **R** or **P**, extend [`regression-checklist.md`](regression-checklist.md) where it defines “done.”
