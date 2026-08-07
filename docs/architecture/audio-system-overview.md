# Audio System Overview

**Status:** target architecture and documentation entry point, currently blocked
from implementation. The independent review verdict is **Unsafe to implement**
until the Phase 0 corrections in
[`../goal-plan.md`](../goal-plan.md#immediate-priority--live-audio-safety) close.
Read the complete
[`independent review`](../reviews/live-audio-architecture-independent-review.md)
before using these target documents. The current code does not yet satisfy every
rule here; current behavior was audited against the working tree on 2026-08-02.

This document explains the system shape. Observable routing behavior belongs in
[`../contracts/live-editor-routing.md`](../contracts/live-editor-routing.md),
runtime state in
[`audio-runtime-state.md`](audio-runtime-state.md), and module boundaries in
[`audio-module-ownership.md`](audio-module-ownership.md).

## Document authority

| Question | Authority |
|---|---|
| What may reach Main or a performer? | [`live-editor-routing.md`](../contracts/live-editor-routing.md) |
| What does Ready mean? | [`audio-readiness.md`](../contracts/audio-readiness.md) |
| What happens during load, play, switch, failure, and shutdown? | [`playback-lifecycle.md`](../contracts/playback-lifecycle.md) |
| Which module owns a responsibility? | [`audio-module-ownership.md`](audio-module-ownership.md) |
| Which state is persisted, desired, active, or display-only? | [`audio-runtime-state.md`](audio-runtime-state.md) |
| Why are the three central decisions fixed? | [`../decisions/`](../decisions/) |
| How is behavior verified? | [`../testing/live-performance-scenarios.md`](../testing/live-performance-scenarios.md) |

`docs/audio-architecture-review.md`, `docs/audio-refactor-roadmap.md`,
`docs/live-rig-plan-review.md`, and `docs/xr18-foh-safety.md` are historical
reviews and migration evidence. They are not behavioral or ownership authority.

## Terms

- **Main**: the logical audience/FOH programme bus. It carries musical content.
- **Private content**: click, spoken cues, and song announcements. It may reach a
  performer route, or Main only after the explicit Practice action.
- **Performer output**: one verified private monitor path. On XR18 this is normally
  a mono aux bus and physical aux output feeding one performer's pack.
- **Cue track**: the `SongMap.cueTracks[]` record linked to a performer by
  `CueTrack.performerId`. Its `intro` event is that performer's announcement.
- **Monitor mix**: levels from musical lanes, click, and one performer's cue lane
  into that performer's logical monitor bus.
- **Logical output**: a role such as Main, shared click, `cue:<performerId>`, or
  `monitor:<performerId>`. It is independent of device numbering.
- **Device output channel**: a zero-based Web Audio output channel.
- **XR18 USB source**: a zero-based USB return selected by an XR18 input strip.
- **XR18 channel**: a one-based input strip, 1 through 16.
- **XR18 bus**: a one-based mono aux mix, 1 through 6 in the current model.
- **Physical output**: the desk's Main L/R or an aux socket. Software cannot prove
  that the cable, pack, headphones, or loudspeaker after it is audible.
- **Control connection**: UDP OSC over the network. It carries commands and
  readback, never audio.
- **Audio connection**: the USB/device path carrying samples. It can work while
  OSC is unavailable, and vice versa.
- **Practice**: session-local consent to add click and exactly one selected cue
  track to Main. It is disabled on every Live Mode entry.
- **Canonical song schedule**: the pure timing result from SongMap, project
  announcement policy, and selected/assigned cue tracks. Both Live and Editor
  execute this schedule.
- **Audio runtime**: the sole authority for the currently opened device, active
  graph, loaded song generation, transport position, output health, and errors.

## Target flow

```text
ProjectFile + SongMap + per-device preference
                    |
                    v
        pure configuration validation
                    |
                    v
          validated desired audio state
                    |
           +--------+---------+
           |                  |
           v                  v
 canonical song schedule   song resource preparation
           |                  |
           +--------+---------+
                    v
        AudioRuntime command/state machine
                    |
          +---------+----------+
          |                    |
          v                    v
 AudioDevice + MixerEngine   XR18 control adapter
          |                    |
          +---------+----------+
                    v
          active routing graph + readback
                    |
                    v
       immutable AudioRuntimeSnapshot
                    |
                    v
          Live / Editor UI projections
```

The UI can request a transition. Only `AudioRuntime` can report that it occurred.
XR18 OSC readback is authoritative for console facts; `AudioRuntime` incorporates
those facts into the one application-level runtime snapshot.

## Layers

| Layer | Owns | Accepts / produces | Persistence | Side effects and hardware | Failure representation | Test boundary |
|---|---|---|---|---|---|---|
| Persisted configuration | Setlist, performer identities, cue tracks, explicit Live source assignments, desired monitor and physical mappings, per-device preference | Parsed `ProjectFile`, `SongMap`, local device preference | Project/SongMap or device-local as specified | Filesystem writes only through project commit/repository APIs | Parse issues and migration diagnostics | Parser and round-trip tests |
| Configuration validator | A pure verdict and exhaustive source/output plan for one requested mode/device/project/song | Raw configuration + source candidates + current capabilities -> `ValidatedAudioConfig` or typed issues | None | None | Stable issue codes with affected source/output IDs | Unit/property tests |
| Canonical scheduler | Click, count-in, cue, announcement, section, and transport timing | SongMap + policy + lifecycle intent -> immutable schedule | None | None | Invalid/missing timing data in schedule diagnostics | Unit/property/parity tests |
| Song resource preparation | Decoded admitted musical buffers, generated MIDI parts, click assets, cue speech assets | Validated source/schedule plan -> cancellable prepared generation | Memory/cache only | Disk/cloud/sidecar reads and decode; no output routing | Per-resource required/optional failures | Unit tests with fake ports; browser decode tests |
| Audio runtime | Device/session/song/transport/output state and command ordering | Commands -> immutable snapshots and structured events | Session-local only | Opens device, commits graph, executes schedule, coordinates XR18 adapter | State-machine failures tied to command and generation | Reducer tests plus browser integration |
| Audio device adapter | The one active `AudioContext`, selected sink/capabilities, device events | Open/resume/suspend/close requests -> device observations | Preference is elsewhere; open instance is transient | Web Audio device calls only | Open/state/capability errors | Browser tests and real-device proof |
| Graph executor | Nodes, buses, sources, gains, route activation, sample clock execution | Validated graph plan + prepared resources | None | Web Audio graph mutations | Explicit construction/activation failures | Offline/browser audio tests |
| XR18 adapter | OSC socket, console identity, fresh readback, command acknowledgements, meter age | Narrow typed commands -> sidecar snapshots | Host preference elsewhere; session is transient | UDP OSC in sidecar only | `disconnected`, `identifying`, `ready`, `stale`, `failed` | Node tests with fake UDP desk |
| Runtime projection | Read-only view fit for UI | `AudioRuntimeSnapshot` -> labels/controls | None | None | Does not invent or clear failures | Pure UI projection tests |
| Live/Editor UI | User intent and presentation | Events -> runtime commands; snapshots -> display | UI preferences only where specified | No device, graph, or XR18 side effects | Displays runtime issue IDs and messages | Component/browser tests |

## Actual current call paths

### Live song and setlist

1. [`src/routes/project/playback/+page.svelte`](../../src/routes/project/playback/+page.svelte)
   derives the visible setlist from `projectStore.data.songs` (lines 43-60).
2. `openSong()` calls `loadProjectSongIntoEditor()` or
   `loadCloudSongIntoEditor()` (lines 84-103).
3. The disk loader in
   [`src/lib/project/commit.ts`](../../src/lib/project/commit.ts) reads and parses
   `.smap`, resolves/reconciles audio, hydrates `songMap` and `audioSession`, and
   marks the active song (lines 904-1023).
4. The route mounts
   [`MixerView.svelte`](../../src/lib/components/MixerView.svelte) with
   `liveMode` (playback route lines 577-579).
5. `MixerView` constructs its own `MixerEngine` and `LiveCueScheduler` on mount
   (lines 3230-3249), then builds and loads tracks itself (lines 1701-2147).
6. Song changes stop the engine and invoke a serialized destructive reload
   (lines 2974-3022 and 3078-3093). Stem prefetch readiness is a separate cache
   signal in `liveAudioCache.ts`, not output readiness.

### Editor and mixer

1. [`src/routes/edit/+page.svelte`](../../src/routes/edit/+page.svelte) configures
   and loads the module singleton `transport` for non-Overview tabs.
2. Entering Overview pauses that transport because Overview mounts `MixerView`
   with another `MixerEngine`; the source contains a TODO to fold them together
   (lines 597-614).
3. `WaveformPlayer.svelte` also constructs a fallback `PlaybackController` when a
   host does not inject the transport (lines 232-233). It shares the process-wide
   `AudioContext`, but it remains a separate transport state machine.

### Local audio output

- [`audioDevice.ts`](../../src/lib/audio/audioDevice.ts) lazily creates one shared
  `AudioContext` (lines 21-78), but it exposes no selected-device identity,
  readiness snapshot, or connection lifecycle.
- [`outputDevice.ts`](../../src/lib/audio/outputDevice.ts) creates and closes a
  throwaway context to inspect `maxChannelCount` (lines 81-107). That observation
  is not guaranteed to describe the context currently producing audio.
- `MixerEngine` uses `liveOutputMap()` when no `RigLayout` is injected. Current
  production construction uses `new MixerEngine()` without a layout.
- `liveOutputMap()` defaults multichannel off and maps song, click, and cue to the
  same stereo pair (lines 70-117). `MixerEngine.setTrack()` consequently sends a
  click without a dedicated output into the musical bus (lines 360-386), and
  `MixerView` sends cues to `engine.cueOutput ?? engine.unshiftedInput` (lines
  3237-3246). This violates the target fail-closed contract.
- [`routes/debug/timer/timerSound.ts`](../../src/routes/debug/timer/timerSound.ts)
  owns its own `AudioContext` for the 45-second rehearsal timer. It is a debug
  route, deliberately outside every engine: the context is created on the space
  press and closed once the bell has rung, it imports nothing from `$lib`, and
  nothing imports it. It is not a Live source and must never acquire a mixer
  channel — routing it through `MixerEngine` would give it one. Allow-listed in
  [`destinationSentinel.test.ts`](../../src/lib/audio/destinationSentinel.test.ts).

### XR18 control

1. UI components call
   [`hardwareBridge.ts`](../../src/lib/client/hardwareBridge.ts), a loopback HTTP
   client.
2. [`desktop/electron/main.mjs`](../../desktop/electron/main.mjs) owns one module
   global `xairClient`, identifies the console via `/xinfo`, and exposes typed
   endpoints (lines 510-693 and 696-920).
3. [`desktop/electron/xairOsc.mjs`](../../desktop/electron/xairOsc.mjs) owns the
   UDP socket, `/xremote` keepalive, meter subscription, reply cache, and close
   cleanup. It does not currently implement automatic reconnect.
4. `LiveHardwareStrip.svelte`, `XAirSettingsPanel.svelte`, and `/rig` each issue
   XR18 commands and hold overlapping local connection, arming, route, write-diff,
   and verification state. `rigStatus.ts` is written by both `/rig` and
   `XAirSettingsPanel`; it is evidence aggregation, not runtime authority.

## Known critical Live failures

These are observed manual-test failures, not speculative risks. Until the target
architecture is implemented and the acceptance tests below pass, Live Mode is
not performance-trustworthy.

### Unassigned and editor-only sources enter Live

The current Live route mounts the same `MixerView` used for Overview. Its
`loadAndRegisterTracks()` constructs a candidate plan containing the original,
all discovered disk/cloud stems, click, detected/generated drums and bass,
enabled machines, and device-local chord/arp lanes
([`MixerView.svelte`](../../src/lib/components/MixerView.svelte) lines
1710-1978). It then calls `engine.setTrack()` for every successfully loaded
candidate (lines 2045-2133).

Live inclusion is therefore expressed primarily as an initial `muted` value,
not as graph admission:

- `liveInitialMuted()` leaves unlinked non-original lanes at their saved mixer
  mute (`liveSlotLinks.ts` lines 160-178). An unlinked machine, extra take, or
  orphan that was audible in Editor can remain audible in Live.
- Missing explicit `liveSlot` values fall back to filename guesses
  (`liveSlotLinks.ts` lines 64-91 and `liveMidiMap.ts` lines 223-238), so an
  inferred stem can enter Live without explicit current configuration.
- `showBand` is always true; detected and machine lanes are offered whenever
  their SongMap features are enabled (`MixerView.svelte` lines 441-466 and
  1844-1978).
- `ProjectDefaults.liveStems` controls initial mute for known stem slots, but it
  is not a complete source allowlist and it does not prevent an excluded source
  from being loaded and connected.

This explains the observed “unassigned sources are audible” symptom. The target
must build a `ValidatedLiveSourcePlan` whose admitted source IDs are exhaustive.
Only those IDs may be installed in the Live graph. Muting is a performance
control after admission; it is not a security/safety boundary.

### Click and cues reach Main

The current production path is direct and confirmed in source:

1. Live constructs `new MixerEngine()` without a `RigLayout`
   (`MixerView.svelte` line 3235).
2. `MixerEngine.resolveOutputMap()` therefore calls `liveOutputMap()`
   (`mixerEngine.ts` lines 278-293).
3. Multichannel is a localStorage opt-in whose only current writers are browser
   tests; default is off (`liveOutputMap.ts` lines 70-94).
4. That default maps song, click, and cue all to `[0, 1]` (lines 88-105).
5. Click falls through to `audioBus` when no dedicated output exists
   (`mixerEngine.ts` lines 360-386).
6. `LiveCueScheduler` is explicitly constructed with
   `engine.cueOutput ?? engine.unshiftedInput`, so cue speech also falls into the
   musical master path (`MixerView.svelte` lines 3230-3246).

The existing comments describe stereo fallback as convenience; the target
contract rejects it for Live. If no private output exists, click/cues are silent
unless the user explicitly enables Practice. Editor audition may still use its
separate explicit local policy.

**Current-path status (2026-08-02):** the Live route now enforces this
fail-closed behavior ahead of the target runtime. In `liveMode`, `MixerView`
suppresses the click lane at the engine (`setTrackSuppressed`, gain-level, not
UI-level) and gates every cue/announcement scheduling call, unless a
session-local, never-persisted Practice toggle is explicitly on. The auto
announcement's start delay is gated with it so a silenced announcement cannot
leave dead air. Locked by `liveFailClosed.browser.test.ts` (real-render
suppression, gate restores saved mix state). This is interim hardening of the
current path, not the target admission model — no shadow-model consumer was
added, and it does not change this document's target contracts.

### Click/cue monitor delivery is not established

The desired route exists in pieces, but no current generation ties them together:

```text
click/cue schedule
  -> MixerEngine clickOut/cueOut (only if split)
  -> Web Audio output channel
  -> XR18 USB return source for a desk strip
  -> strip off Main
  -> non-zero send to each intended performer bus
  -> bus master / aux output
```

Current breaks in that chain:

- Production does not inject `liveRigLayout()` into `MixerEngine`, so project
  performer/routing configuration does not select its output graph.
- The only production USB-return setup in `/rig` configures the stereo song pair
  (`routes/rig/+page.svelte` lines 487-545). `XAirSettingsPanel` applies fader,
  mute, Main assignment, and bus-send writes, but does not program click/cue
  strips' `rtnsw`/`rtnsrc` inputs (`XAirSettingsPanel.svelte` lines 330-424).
- `XAirSettingsPanel` defaults click/cue to desk strips 15/16, while the Live
  `MonitorStatusStrip` is hard-coded to inspect click strip 11
  (`xairRouting.ts` lines 112-138; `MixerView.svelte` lines 3946-3952;
  `MonitorStatusStrip.svelte` lines 37-62).
- A performer bus meter proves aggregate signal is leaving that XR18 bus. It
  does not prove click or that performer's cue is present, nor that another
  source is absent (`monitorStatus.ts` lines 88-150).
- Current cue execution uses one primary cue track and one shared `cue` output,
  not one `cue:<performerId>` route.

Consequently, a configured `monitorBus`, non-zero send, green bus meter, or OSC
reply cannot currently prove that click/cue travelled from BarBro to the intended
performer. The readiness contract deliberately withholds that claim.

### Shared root causes and prevention owners

| Observed failure | Shared root cause | Primary prevention owner | Executor/observer duties |
|---|---|---|---|
| Unassigned source audible | Candidate discovery, Editor mute state, and Live admission are conflated | `AudioConfigurationValidator` produces the exhaustive `ValidatedLiveSourcePlan` | SongResourceLoader may prepare admitted IDs only; AudioRuntime installs exactly the plan; MixerEngine rejects unknown IDs |
| Click/cue in Main | Main is the implicit no-private-output fallback | Validator makes private-to-Main edges invalid; AudioRuntime enforces Practice exception | MixerEngine executes explicit edges only and has no fallback |
| Click/cue monitor delivery unknown | Web Audio, USB return, desk strip, bus send, and meter evidence have separate owners/generations | AudioRuntime owns the end-to-end active route generation and readiness result | AudioDeviceAdapter and XAirSession report acknowledgements/readback; UI only observes |
| Stale/orphan sources after mode/song change | Component-owned destructive reload and parallel transports | AudioRuntime owns generation replacement and cleanup | MixerEngine must stop/disconnect every removed source; stale completions are ignored |
| Editor audition leaks into Live | Same component/plan reads saved or device-local audition state | Mode-specific validated graph policy owned by AudioRuntime generation | Editor UI may request preview; repositories do not reinterpret it as Live inclusion |

## Current versus target

### Song scheduling

- **Current owner:** `songmap/playbackPlan.ts` owns click/count-in timing;
  `cueTrackSpeechSchedule.ts`, `sectionCueClips.ts`, and `MixerView.svelte` own
  overlapping cue and announcement decisions.
- **Current behavior:** click timing is mostly canonical, while section cues and
  announcement firing are added by `MixerView` timers/state.
- **Current problems:** only the primary cue track is scheduled; lifecycle policy
  can diverge between Live, Editor, render, and export.
- **Target owner:** pure `CanonicalSongScheduler` facade, built from the existing
  tested schedule helpers.
- **Target responsibility:** emit one immutable schedule for all musical timing,
  click, count-in, every assigned cue track, and announcement lifecycle intent.
- **Migration required:** move `MixerView` announcement/section timing decisions
  behind the facade, then make Live and Editor consume it.

### Live source admission

- **Current owner:** `MixerView.loadAndRegisterTracks()`, `liveInitialMuted()`,
  filename-derived `laneSlotIndex()`, saved `mixState`, and device-local machine
  switches collectively decide what can sound.
- **Current behavior:** almost every candidate is loaded and connected; Live
  differences are mostly initial mute/solo values.
- **Current problems:** unassigned, orphaned, generated, or Editor-audition lanes
  can remain audible; loading/connecting a muted lane also leaves unnecessary
  graph state to clean up.
- **Target owner:** pure `AudioConfigurationValidator` source-admission phase,
  returning `ValidatedLiveSourcePlan` as part of the desired config generation.
- **Target responsibility:** enumerate every allowed Live source by stable ID,
  role, destination, and required/optional status. Absence means forbidden.
- **Migration required:** separate candidate discovery from Live admission; stop
  reading arranging mute/device preview state as permission; make AudioRuntime
  install only admitted IDs and test that excluded IDs create no graph nodes.

### Playback transport

- **Current owner:** `UnifiedTransport`, `MixerView`/`MixerEngine`, and fallback
  `PlaybackController` each own transport state.
- **Current behavior:** Edit non-Overview uses `transport`; Overview and Live use
  a component-owned engine; waveform fallback can own a third state machine.
- **Current problems:** position, stop, seek, loading, and cleanup can disagree.
- **Target owner:** `AudioRuntime`.
- **Target responsibility:** one canonical position and one command-ordered
  transport per application audio session.
- **Migration required:** adapt all surfaces to request runtime transport commands;
  retain `MixerEngine` only as execution machinery.

### Audio-device management

- **Current owner:** module-global `audioDevice.ts` plus independent throwaway
  contexts in output inspection and probes.
- **Current behavior:** the active output is the OS/browser default; no sink is
  selected or persisted by BarBro.
- **Current problems:** capability observations can describe a different context;
  UI cannot know which device instance is open or lost.
- **Target owner:** `AudioDeviceAdapter`, commanded only by `AudioRuntime`.
- **Target responsibility:** selected/preferred device resolution, the one active
  context, capability observations, state changes, and cleanup.
- **Migration required:** extend `audioDevice.ts` behind a stateful adapter and
  remove device-readiness inference from components.

### Routing validation

- **Current owner:** parsing, `liveRigPlan.ts`, `xairRouting.ts`, and UI-specific
  checks each validate different subsets.
- **Current behavior:** malformed numbers are sanitized, but duplicate roles,
  Main/private overlap, device capacity, and loaded-song requirements are not one
  atomic verdict.
- **Current problems:** a locally valid projection can contradict the active graph.
- **Target owner:** pure `AudioConfigurationValidator`.
- **Target responsibility:** validate the entire desired configuration against the
  current device, project, song, and XR18 topology without side effects.
- **Migration required:** consolidate current pure helpers as inputs/selectors and
  return typed per-output issues.

### Routing execution

- **Current owner:** `MixerEngine`, `LiveCueScheduler`, and XR18-writing UI
  components.
- **Current behavior:** Web Audio routing is constructed in the engine; desk routes
  are applied separately by components. Production constructs the engine without
  the project `RigLayout`, so the tested `liveRigPlan` projection is not the
  active Live graph.
- **Current problems:** no command generation ties graph activation to desk
  readback; stereo fallback leaks private content into Main.
- **Target owner:** `AudioRuntime`, with `MixerEngine` and `XAirControlAdapter` as
  executors.
- **Target responsibility:** apply one validated plan, track acknowledgements, and
  publish the resulting active route generation.
- **Migration required:** remove policy imports from `MixerEngine`; remove XR18
  side effects from UI.

### Runtime readiness

- **Current owner:** no single owner. `mixerCanPlay`, `liveAudioCache`, `rigStatus`,
  `rigHealth`, and component status each answer a narrower question.
- **Current behavior:** track count gates Play; decoded-stem cache drives setlist
  dots; XR18 config/readback drives the navbar rig verdict.
- **Current problems:** none proves the active device, graph, song, and route
  generation together. In particular, aggregate XR18 bus meters cannot identify
  whether click or the correct cue event reached a performer.
- **Target owner:** `AudioRuntimeSnapshot` produced by `AudioRuntime`.
- **Target responsibility:** derive all output/song/global readiness from current
  runtime evidence and declare the limit of each guarantee.
- **Migration required:** replace mutable UI status stores with projections of the
  runtime snapshot.

### Performer monitor assignment

- **Current owner:** `ProjectFile.performers[].monitorBus`, written through project
  commit functions; `XAirSettingsPanel` and Project Settings both present editors.
- **Current behavior:** one performer maps to one XR18 bus; duplicate buses can be
  selected in some surfaces and are only diagnosed elsewhere.
- **Current problems:** assignment existence is sometimes treated as monitor
  readiness; per-performer cue audio is not executed separately; no active
  generation binds Web Audio channel, XR18 USB source/strip, bus send, and aux.
- **Target owner:** persisted project audio configuration repository.
- **Target responsibility:** own desired performer-to-monitor assignment only.
- **Migration required:** centralize validation and keep runtime activation/status
  out of project data.

### Cue scheduling

- **Current owner:** primary-track helpers plus `MixerView`'s dynamic cue scheduler.
- **Current behavior:** one `LiveCueScheduler` plays one primary cue track.
- **Current problems:** `CueTrack.performerId` exists, but distinct performer cue
  tracks cannot reach distinct monitor mixes.
- **Target owner:** canonical scheduler for timing; `AudioRuntime` for execution.
- **Target responsibility:** schedule each enabled assigned cue track on its own
  logical private cue lane.
- **Migration required:** add per-performer cue-lane planning and channel-capacity
  validation before enabling it.

### Announcements

- **Current owner:** `MixerView.svelte` lines 2660-2723.
- **Current behavior:** project mode chooses Auto/Triggered/Off, but only the
  primary track's intro/title is synthesized and played.
- **Current problems:** announcement lifecycle and output policy are component
  state, and disabled/missing per-performer intros are not represented correctly.
- **Target owner:** canonical scheduler for decision/text; `AudioRuntime` for
  fired-generation state and execution.
- **Target responsibility:** treat announcements as intro events on performer cue
  tracks and obey fresh-start/trigger semantics.
- **Migration required:** remove the parallel announcement clip/timer path from
  `MixerView` after parity tests exist.

### Practice mode

- **Current owner:** not implemented as a distinct runtime policy. Stereo fallback
  effectively mixes private content to Main without a Practice action.
- **Current behavior:** click/cue can reach Main whenever split output is disabled.
- **Current problems:** this is the inverse of explicit session-local consent.
- **Target owner:** `AudioRuntime` session state.
- **Target responsibility:** disabled on every Live entry; when enabled, route
  click and exactly one selected cue track to Main.
- **Migration required:** first make private routing fail closed, then add the
  explicit Practice command and selector.

### XR18 integration

- **Current owner:** sidecar owns the UDP client, while three UI surfaces own
  orchestration and writes.
- **Current behavior:** `/xinfo`, typed writes, readback, and meters work through
  loopback HTTP; reconnect and one-session authority do not.
- **Current problems:** duplicate arming/diff state, two persistence shapes, direct
  UI hardware side effects, and status that can outlive the active graph.
- **Target owner:** sidecar `XAirSession` for OSC facts; `AudioRuntime` for
  application orchestration.
- **Target responsibility:** one socket, one command queue, fresh acknowledgements,
  reconnect state, and narrow typed commands.
- **Migration required:** retire component appliers and ingest one sidecar snapshot.

### UI status presentation

- **Current owner:** individual components and `rigStatus.ts`.
- **Current behavior:** status is inferred from local component fields, cached
  resources, or partial desk evidence.
- **Current problems:** identical colors can mean decoded, configured, replied,
  or actually active.
- **Target owner:** pure runtime projection functions; UI is observer only.
- **Target responsibility:** map precise runtime states to neutral, initializing,
  ready, degraded, failed, and disconnected labels.
- **Migration required:** delete independent mutable readiness flags after the
  runtime snapshot is wired.

## Recommended implementation order

1. Introduce the pure validated configuration type, exhaustive Live source plan,
   and immutable runtime snapshot/reducer without changing audio behavior.
2. Make unassigned-source admission and private-lane fallback unrepresentable in
   validated plans; add browser tests for excluded-source silence and Main
   isolation.
3. Put current Live and Editor execution behind one `AudioRuntime` command API.
4. Move song loading into cancellable preparation plus a generation-checked
   commit; preserve global device/output buses across song changes.
5. Consolidate click, count-in, cue, and announcement schedules.
6. Replace the three XR18 UI appliers with one sidecar-backed adapter and fresh
   readback state.
7. Add per-performer cue lanes after real channel capacity is proven.
8. Add the Practice command, then replace UI status with runtime projections.

The first small implementation slice is specified with acceptance criteria in
[`audio-module-ownership.md`](audio-module-ownership.md#first-implementation-slice).
