# Goal Plan

Living roadmap for BarBro. This file records current capability, confidence,
and the next promotion gate. Detailed implementation history belongs in domain
documents, tests, and Git history.

**Last audited:** 2026-08-02 against the current working tree. Uncommitted code
with implementation and tests is included, but a row is not considered shipped
until its migrations/assets/release requirements are also available.

## Levels

| Lvl | Meaning |
|:---:|---|
| **N** | Not started or no agreed implementation contract. |
| **S** | Spike/partial implementation; not dependable for its primary workflow. |
| **M** | Primary happy path works end to end. Important robustness gaps remain. |
| **R** | Expected failures, persistence, migrations, and regressions are handled. |
| **P** | Release-quality UX, performance, documentation, and verification. |

Epic codes remain stable for issue tracking:

| Code | Epic |
|:---:|---|
| `SE` | Song editor and `.smap` behavior |
| `PV` | Project and setlist workflows |
| `AB` | Ableton/export workflows |
| `DT` | Desktop service and native capabilities |
| `PF` | Shared platform, persistence, auth, and collaboration |

## Immediate Priority — Live Audio Safety

**Current verdict:** Live Mode is not show-safe. The independent review in
[`reviews/live-audio-architecture-independent-review.md`](reviews/live-audio-architecture-independent-review.md)
rates the target specification **Unsafe to implement** until its blocking
contracts are corrected.

The accepted direction remains:

- one runtime audio authority;
- positive Live source admission;
- fail-closed click, cue, and announcement routing;
- generation-owned resources and cleanup;
- one canonical schedule/transport clock;
- readiness derived from acknowledged runtime evidence.

Current `/project/playback`, XR18 controls, APC controls, meters, and assignment
UI are development surfaces. None proves that Live installed only intended
sources, kept private content out of Main, or delivered click/cue to a performer.

> **2026-08-03 — click/cue-to-performer DELIVERED on the current path.** The
> multichannel split works end to end on the real rig, each link verified:
> auto-derived profile (`resolveProfileRequest`: ≥4 device channels AND saved
> desk host), engine split (song→ch0/1, click→2, cue→3; mono→stereo shim;
> proven in render tests), claim-once desk applier (strips 11/12 ← USB 3/4,
> off LR, sends to performer buses, all read back from the desk), FOH banner
> judging the layout's strips. Heard by Martin; desk meter −2.4 dB on the
> click strip. Key correction: the practice fail-closed gate must NOT
> suppress click when the split is active (the desk is the gate there) —
> that suppression was the last silent-click cause. Known polish: cold first
> song-open registers the click lane ~10 s into playback; consider
> hold-play-until-click-ready in live.

### Phase 0 — Close The Architecture Gate

**Status:** in progress. Blocks implementation of the target runtime.

Resolve and record these product decisions:

1. **Shadow contract chosen and persisted in SongMap v7:** the Live source-intent
   and mixer-channel identity model uses stable source and channel IDs.
   Every stem, original, or generated musical source needs a stable `sourceId`;
   every mixer strip needs a stable `mixerChannelId` that points to exactly one
   source. `mixState.liveSlot`, mixer order/label, mute state, and filename
   inference are controller/audition state, not source identity or admission.
2. Decide whether keybed, chord-jam keys/bass/arp, preview/test sources, and
   future real-time instruments are supported in Live. Supported producers must
   enter through the executor; unsupported producers must be unable to sound.
3. Define a versioned XR18 rig profile: Web/USB channels, input strips,
   mono/stereo rules, programme lanes, shared click, private cue lanes, monitor
   buses, physical outputs, and maximum performers/sources.
4. Define supported audio-device/sink identity and failure behavior when the
   required device or channel capacity is unavailable.
5. Define allowed degraded rehearsal modes. Private-route failure can never be
   overridden into Main; Practice output is explicit and session-local.
6. Choose exclusive show-control or cooperative/manual XR18 ownership,
   including drift and reapply policy.
7. Define announcement inheritance and distinguish never-authored, generated,
   explicitly enabled, and explicitly disabled states.
8. Define when manual physical confirmation expires.

Correct the target documents before implementation:

- Routing owns lossless persisted intent, stable IDs, one-time migration, a
  complete producer census, and exact `CandidateManifest -> AdmittedSourcePlan
  -> ResolvedInstallManifest` accounting.
- Runtime state separates the logical mix chain (`source/stem -> mixer channel
  -> channel processing -> rig programme lane`) from source allocation
  (`programme lane -> Web -> USB -> XR18 input -> LR policy`) and monitor routing
  (`XR18 source input + monitor mix -> aux send -> bus master -> physical output`).
  Independently mixed stems require distinct rig source lanes; explicitly
  summing channels removes independent XR18 monitor control and must be visible.
- Parsing validates raw persisted routing before normalization and preserves
  malformed/unknown records for diagnosis and explicit repair.
- Readiness distinguishes `configured`, `scheduled`, `observed`, and
  `physically confirmed` evidence.
- Lifecycle defines generation/abort ownership, stale-result cleanup,
  idempotent disposal, Editor pause-versus-dispose, and an ordered XR18
  transaction with readback, timeout, abort, and drift behavior.
- Ownership marks the first implementation as a contract-only shadow artifact,
  forbids a mutable shadow store, and names the cutover/deletion point for every
  overlapping planner and readiness surface.

**Gate exit:** the corrected target set receives an independent verdict of at
least **Approved with required corrections**, with every first-slice blocker
closed.

### Phase 1 — Pure Contract Slice

**Status:** canonical shadow input and validation are implemented; runtime cutover
remains blocked by Phase 0 and the remaining Phase 1 proofs.

Build immutable types, pure validation, current-data adapters, and a pure
generation reducer. It must not feed UI readiness, construct graphs, write
hardware, open devices, play sound, or add another mutable store.

Required proof:

- raw invalid persisted values survive into validation;
- every current production sound producer is admitted or prohibited explicitly;
- stable IDs do not depend on labels, order, or filenames after migration;
- every admitted musical source resolves through exactly one stable mixer channel,
  and every mixer channel resolves back to one current-song source; missing,
  duplicate, stale, or mismatched bindings fail closed;
- mixer gain, EQ, mute, solo, controller slot, and display order are post-binding
  processing/presentation state and cannot create Live admission;
- every admitted source is installed or explicitly omitted exactly once;
- required sources cannot be omitted and unadmitted sources cannot be installed;
- source channels/input strips are distinct from monitor buses;
- validation emits deterministic exhaustive reason codes;
- stale results emit generation-scoped cleanup/cancellation commands;
- a repository sentinel detects production destination connections outside the
  executor boundary;
- current production audio and UI behavior remain unchanged.

Implemented shadow evidence:

- `audioConfigValidator.ts` now calculates deterministic positive source
  admission, Main/private routing, performer logical/physical mappings,
  collision issues, Practice routing, and configured-only readiness reasons.
- SongMap v7 persists stable source intent, producer identity,
  `sourceId -> mixerChannelId -> processing -> rigSourceLaneId`, performer sends,
  and explicit sum groups. V1-v6 migration records producers as excluded and
  unassigned to hardware until reviewed.
- `liveAudioRoutingInput.ts` is the sole current-state adapter. It discovers all
  supported persisted producers, retains a lossless raw project routing DTO,
  generation-tags candidates/intents/channels/assets, and does not read editor
  `mixState`, labels, order, filenames, mute/solo, or `liveSlot` for admission.
- The validator rejects missing/duplicate/mismatched mixer ownership, stale
  generation records, implicit lane sums, and sum groups whose members require
  source-specific XR18 sends after summing.
- Pure install-manifest and exact-set audit helpers identify missing, duplicate,
  unplanned, and prior-generation source installations without touching runtime.
- `liveAudioShadowDiagnostics.ts` exposes an opt-in stable projection/logger;
  no production route, graph, store, hardware adapter, or readiness UI consumes it.
- focused tests cover the original safety scenarios plus canonical stem binding,
  presentation-metadata non-admission, direct-load determinism, exhaustive
  producer discovery, explicit summing, distinct stem lanes, raw DTO retention,
  and exact generation-owned installation accounting.

Still required before Phase 1 completes: the full pure generation reducer and
stale cancellation commands, and product commands/UI that review migrated
sources and author the canonical rig profile. A current-tree
production-destination sentinel exists
(`src/lib/audio/destinationSentinel.test.ts`: census of every
`new AudioContext(` and `.connect(…destination` in `src/`, allowlisted with a
written justification per entry, mutation-proven); the executor-boundary
variant is still owed at cutover.

### Phase 2 — Authoritative Runtime And Admission

Introduce one `AudioRuntime`, move every Live producer behind executor-provided
destinations, bind each admitted source to its validated mixer channel and rig
source lane, and install only those exact source/channel IDs. Remove
mute-as-admission, filename admission, direct-destination synth escape, Editor
audition leakage, and stale generation resources. Delete or disconnect each
replaced owner in the same cutover slice.

### Phase 3 — Physical Routing And XR18 Transaction

Activate one validated source graph through the selected sink, USB channels,
XR18 input strips, LR policy, aux sends, bus masters, and physical outputs.
Apply hardware changes in the documented safe order with fresh readback.
Control loss or external drift invalidates readiness according to the selected
ownership mode.

### Phase 4 — Readiness UI And Certification

Retire or relabel legacy green/readiness surfaces. UI projects only the
authoritative snapshot and names its evidence level. Complete automated
isolation/lifecycle tests and the real-XR18/manual matrix in
[`testing/live-performance-scenarios.md`](testing/live-performance-scenarios.md),
including full-set timing and repeated Editor/Live/device-loss cycles.

Live Mode cannot reach `M` until source admission, Main/private isolation,
performer routes, lifecycle cleanup, and physical verification pass for the
supported rig profile.

## Current Roadmap

### Song Editor `SE`

**Rollup: M.** The editor is useful for song preparation. Its weakest areas are
recorded-audio transpose, musician-grade cue polish, broad browser UI coverage,
and Live-safe execution.

| Work item | Lvl | Current capability and next gate |
|---|:---:|---|
| Timeline, waveform, playback, grid, sections | M | Interactive waveform, zoom/pan/selection, beat/bar boundary editing, section ranges, and persisted playback metadata work. Promote with broader browser interaction, malformed-grid, large-file, and permission-loss coverage. |
| Chords, suggestions, and drafts | M | Chord selection/editing, drag selection, keyboard copy/paste, section auto-fill, suggestion visibility, `N.C.`, chord-sheet import, and v6 arrangement drafts are present. Promote after end-to-end editing/accessibility coverage and remaining suggestion UX cleanup. |
| Lyrics | M | Imported/timed lyrics and chord-sheet workflows participate in v6 drafts. Automated transcription/fitting quality and correction UX remain below robust. |
| Cue editor and TTS | M | Canonical per-performer `cueTracks[]`, section/count generation, event editing, and Piper WAV rendering exist. Recording is schema-only; announcement semantics and Live performer routing are blocked by the safety plan. |
| Mixer and BarBro machines | M | Audio plus MIDI drum, bass, chord, and arp lanes share mixer controls and effect sends. SongMap v7 now has a separate canonical Live `mixerChannelId -> sourceId/stemId -> rig source lane` contract; editor keys remain local audition/presentation state. Authoring UI, runtime cutover, and real-device audio QA remain before Live certification. |
| Personal transpose | S | Chords, key display, and pitched MIDI notes transpose reversibly; drums do not. Recorded-audio pitch shifting is intentionally disabled in current editor/mixer code, so transpose is not an end-to-end audio feature. |
| PDF and MusicXML | S | Exports exist, but engraving, pagination, collision handling, and musician-facing golden fixtures remain limited. |

Authoritative format details live in [`smap-format.md`](smap-format.md). The
current persistent format is v7; v1-v6 migrate on parse and saves emit v7.

### Project And Setlist `PV`

**Rollup: M.** Local projects, cloud projects, setlist organization, and basic
set export work. Live playback remains a development surface.

| Work item | Lvl | Current capability and next gate |
|---|:---:|---|
| Local project lifecycle | M | Create/open, guarded saves, metadata refresh, add/import/remove/hide, relink, and project folder persistence work through desktop/FS Access paths. Promote with structured recovery for permission loss, manifest drift, and partial disk failures. |
| Song order and project UI | M | Drag-and-drop order is canonical and cloud manifest changes are pushed. Grouped sets, undo, and keyboard reorder remain. |
| Shared project workflow | M | Share/join/member flows, browser-cloud project restore, metadata/song sync, hydration, and role-aware audio actions exist. Promote after repeatable two-account end-to-end conflict and migration tests. |
| Project audio movement | M | Hydration packages move local-quality assets; compressed AAC mix/stems can be uploaded for browser collaborators and cached client-side. Promote after storage/RLS deployment smoke, replacement/invalidation tests, and multi-device QA. |
| Auto stem preparation | S | Project policy is persisted; the desktop daemon runs background preparation and the web shows status. Cross-platform packaging, interruption behavior, and source-replacement invalidation need proof. |
| Ableton setlist export | M | Project settings export one Live 12 set with ordered scenes, stems, mixer gains, and regenerated click WAVs after preflight. Cue tracks, progress/cancel, and broader Live-version verification remain. |
| Project Live playback | S | `/project/playback` supplies setlist navigation, stage UI, mixer, APC, and XR18 development controls. Current-path hardening (2026-08-02): click/cue/announcement fail closed off Main in `liveMode` behind a session-local Practice toggle (engine-level suppression, real-render tests); chord/arp voices only sound when hosted as visible mixer lanes, while unhosted preview voices are suppressed; `rigHealth` names its evidence level (`configured` vs `observed`). The APC map now exposes ten stable mixer-linked slots: the original bottom eight plus Custom 1/2 on the first two pads of the row above. Still explicitly not show-safe until the Live plan completes — hardening is not admission. |

### Ableton And Other Exports `AB`

**Rollup: M.** Single-song and project-level `.als` generation are real, but
Live-version compatibility remains a high-risk manual boundary.

| Work item | Lvl | Current capability and next gate |
|---|:---:|---|
| Single-song Ableton set | M | Stems, arrangement/session clips, tempo/meter, click rack, and locators are generated. Promote with pinned Live-version fixtures and repeatable open-in-Live smoke tests. |
| Project setlist Ableton set | M | Ordered project songs export as scenes with stems and click through a preflighted desktop pipeline. Add cue lanes, progress/cancel, and failure recovery. |
| Section/loop workflows | S | Section locators exist; authored loop braces/scenes and musician practice semantics are incomplete. |
| Cue export | N | `cueTracks[]` do not yet become dedicated Ableton cue clips/tracks. |
| Loudness preparation | N | No authoritative project-wide loudness target/normalization workflow exists. Keep source audio untouched when this is designed. |

Read [`domains/ableton-als.md`](domains/ableton-als.md) before changing `.als`
generation.

### Desktop Service `DT`

**Rollup: M for local capability, S for distribution and Live hardware.** The
desktop process is a loopback service with status and offline-app windows.

| Work item | Lvl | Current capability and next gate |
|---|:---:|---|
| Loopback service and native jobs | M | Beats, stems, drum/bass analysis, YouTube import, Piper TTS, project assets, transcode, and hardware endpoints exist. Promote with endpoint-level packaged smoke and clearer timeout/recovery contracts. |
| OS folder/file bridge | M | `/native/pick-folder`, `/native/pick-open-file`, and `/native/pick-save-file` are used by project, hydration, import, relink, and set workflows. Add packaged macOS/Windows permission smoke. |
| Offline desktop app | M | A no-login packaged SvelteKit build, offline project readiness, session marker, and sequential reconciliation path exist. Promote after a full Wi-Fi-off dress rehearsal and interrupted-reconcile QA. |
| Packaging and updates | S | macOS/Windows build paths and manifests exist; signing/notarization, verified release assets, auto-update, and clean-machine installation remain incomplete. |
| Stem preparation daemon | S | Desktop reads project `autoStems` policy, queues missing work, persists recovery intent, and exposes status. It is job recovery, not Demucs checkpoint resume. |
| High-quality transpose cache | S | Rubber Band cache endpoints and validation exist, but licensed binaries are not bundled and the current web playback path does not enable this renderer. |
| XR18/APC live rig | S | OSC, MIDI/APC, rig planning, USB-input, monitor/readback, test-signal, and UI pieces exist. They are not one acknowledged end-to-end route and cannot advance independently of the Live safety plan. |

See [`domains/desktop-sidecar.md`](domains/desktop-sidecar.md),
[`offline-mode.md`](offline-mode.md), and
[`domains/hardware-control.md`](domains/hardware-control.md).

### Platform And Collaboration `PF`

**Rollup: M.** Local persistence and current LWW cloud collaboration work on the
primary path; CRDT adoption, live-database verification, and destructive failure
coverage remain incomplete.

| Work item | Lvl | Current capability and next gate |
|---|:---:|---|
| `.smap` v7 persistence | R | Deterministic binary/JSON persistence, v1-v6 migration, drafts, cue tracks, lyrics, chord detail, machines, effects, and canonical Live routing have round-trip coverage. Keep parser, serializer, cloud filtering, and round-trip tests together for every field. |
| Project manifest persistence | M | Defensive parse and guarded writes cover current project/cloud/offline/performer fields. The Live safety design requires a new lossless diagnostic-ingest boundary for invalid routing. |
| Auth and access | M | Google/magic-link auth, invite-only access, admin grants, pending invites, and server-side membership enforcement exist. Promote with repeatable deployment/RLS smoke. |
| Cloud metadata/song sync | M | Realtime pull, autosave push, revision conflict handling, draft-aware merge, manifest sync, and member-write migration 017 exist. Verify migrations 015-017 and non-owner writes against the actual hosted database. |
| Cloud audio/browser mode | M | Migration 016, storage paths/RLS, creator AAC upload, browser download/cache, and local-HD preference are implemented. Promote with two-device replacement, stale-cache, missing-object, and quota/failure QA. |
| CRDT/Yjs migration | S | Deterministic shadow `Y.Doc` conversion, round-trip, convergence, and property tests exist. No production writer, reader, UI, or cloud transport uses it yet; current LWW sync remains authoritative. |
| Test and release confidence | M | Unit, Chromium, sidecar, script, offline, and live-database checks exist as separate suites. CI/release policy must ensure the applicable suites and migrations run rather than relying on unit tests alone. |

See [`domains/cloud-auth-sync.md`](domains/cloud-auth-sync.md) and
[`domains/collab-sync-architecture.md`](domains/collab-sync-architecture.md).

## Promotion Order

1. Close Live Phase 0 before adding target runtime code.
2. Verify cloud migrations 015-017 and member audio/edit flows against the
   hosted Supabase project.
3. Complete a packaged offline dress rehearsal and clean-machine desktop smoke.
4. Implement the pure Live contract slice, then re-review before runtime cutover.
5. Continue editor/cue/export polish without presenting it as Live safety proof.

## Maintenance Rules

- Keep rows concise: capability, real gap, promotion condition.
- Do not store benchmark anecdotes, session histories, or implementation diaries
  here. Put them in domain docs, tests, review documents, or Git history.
- Never raise a row because code exists alone. Required migrations, packaged
  assets, hardware proof, and user-visible error behavior count.
- Update this file when a change materially advances or invalidates a row.
- Add or extend [`regression-checklist.md`](regression-checklist.md) when a row
  reaches `R` or `P`.
