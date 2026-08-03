# Audio Module Ownership

**Status:** target ownership contract. Proposed target modules named below do not
necessarily exist yet. Current modules are referenced so migration work has a
concrete starting point.

The role words are strict:

- **Owner** stores the authoritative state and decides transitions.
- **Requester** may ask the owner to change state.
- **Validator** returns a pure verdict and performs no transition.
- **Executor** performs a commanded side effect and reports what happened.
- **Observer** receives read-only snapshots and cannot acknowledge success.

Every responsibility has exactly one owner. An owner may delegate execution, but
the executor does not become a second owner.

## Primary ownership map

| Responsibility | Primary owner | Requesters | Validator / executor | Observers |
|---|---|---|---|---|
| Project setlist and desired live assignments | Project audio configuration repository (`src/lib/project/*`) | Project settings UI, sync | Project parser/validator; guarded commit functions | AudioRuntime, Live UI |
| Song musical/cue data | SongMap repository/store | Editor actions, sync | SongMap parser/validator | Scheduler, resource loader, UI |
| Preferred audio device | Per-device preference repository (target `audioDevicePreference.ts`) | Rig settings UI | Device adapter resolves it | AudioRuntime/UI |
| Currently opened audio device | `AudioRuntime` | Live/Editor host | `AudioDeviceAdapter` executes open/close | UI projection |
| Device capabilities and loss events | `AudioDeviceAdapter` | AudioRuntime | Browser Web Audio/MediaDevices | AudioRuntime only |
| Valid desired routing | `AudioConfigurationValidator` result for a runtime generation | AudioRuntime | Pure validator | UI via runtime snapshot |
| Live source admission | `AudioConfigurationValidator`'s immutable `ValidatedLiveSourcePlan` | AudioRuntime supplies mode/project/song candidates | Pure source-admission selector inside validator | resource loader, runtime, UI snapshot |
| Canonical song schedule | `CanonicalSongScheduler` result | AudioRuntime, export/render callers | Pure scheduler | UI/export executors |
| Song resource load generation | `AudioRuntime` | Song/setlist UI | `SongResourceLoader` executes reads/decode | UI snapshot |
| Active Web Audio graph | `AudioRuntime` | Live/Editor UI | `MixerEngine` executes the graph plan | UI snapshot |
| Canonical playback position | `AudioRuntime` | transport UI, MIDI controller | MixerEngine clock executor | every UI surface |
| Click and cue scheduling | `AudioRuntime` executing `CanonicalSongSchedule` | transport/section commands | graph/cue executors | UI snapshot |
| Announcement firing decision | `CanonicalSongScheduler`; fired generation owned by `AudioRuntime` | Play/Restart/Announce commands | cue asset provider and cue executor | UI snapshot |
| Performer-to-monitor desired mapping | Project audio configuration repository | Project settings UI | configuration validator | runtime/UI |
| Logical-to-physical mapping | Validated configuration owned by AudioRuntime generation | Rig settings UI proposes config | pure validator | UI snapshot |
| XR18 OSC transport/readback | sidecar `XAirSession` (target extraction from `main.mjs`) | AudioRuntime through hardware bridge | `xairOsc.mjs` UDP executor | AudioRuntime snapshot |
| XR18 write orchestration | `AudioRuntime` | hardware arm/test controls | sidecar typed commands | UI snapshot |
| Output readiness | `AudioRuntime` | nobody may set it directly | pure readiness derivation from runtime evidence | UI |
| Errors and warnings | `AudioRuntime` for app audio; `XAirSession` for OSC facts | executors report typed failures | runtime folds by generation/output | UI |
| Test-signal session | `AudioRuntime` | Rig UI | device/graph/XR18 executors | UI and performer confirmation |
| Persistent assignment writes | Project/device repositories | settings UI through commands | guarded commit APIs | runtime reloads desired config |

## Target module contracts

### Project audio configuration repository

**Target location:** keep persistence in `src/lib/project/types.ts`,
`parse.ts`, and `commit.ts`; add a small `audioConfig.ts` projection if needed.

- **Responsibility:** parse, migrate, read, and atomically write desired project
  audio configuration: setlist, performers, monitor assignments, and logical to
  XR18 mappings.
- **Owned state:** persisted `ProjectFile` fields only.
- **Permitted dependencies:** project filesystem/cloud commit APIs and pure schema
  parsers.
- **Forbidden dependencies:** AudioContext, MixerEngine, XR18 network client,
  runtime readiness, meter frames, currently loaded song, and UI components.
- **Public interface:** read projection plus guarded commands such as
  `setProjectPerformers()` and `setProjectLiveRig()`.
- **Side effects:** project file/cloud writes only.
- **Lifecycle:** project open to close; no live-session lifecycle.
- **Failure modes:** parse/migration/write/conflict errors.
- **Cleanup:** cancel pending writes when project identity changes.
- **Testing:** parser, migration, round-trip, and atomic commit tests.

### Per-device preference repository

**Target location:** `src/lib/audio/audioDevicePreference.ts`.

- **Responsibility:** persist preferred output identity and local XR18 endpoint.
- **Owned state:** preference only, never the open device or connection health.
- **Permitted dependencies:** localStorage or desktop settings storage.
- **Forbidden dependencies:** AudioContext creation, XR18 writes, project sync,
  and readiness labels.
- **Public interface:** `readPreference()`, `writePreference()`, `clearPreference()`.
- **Side effects:** local settings storage.
- **Lifecycle:** process/device-local; survives application restart.
- **Failure modes:** unavailable storage, stale device identifier.
- **Cleanup:** none beyond replacing obsolete values.
- **Testing:** tolerant parse and storage-failure tests.

Current `rigSetupStore.ts` mixes endpoint, stereo pair, and a free-text private
channel list; `XAirSettingsPanel` and `LiveHardwareStrip` also persist the same
`barbro:liveHardware:xair:<projectId>` key. Migration must choose one schema and
adopt old values once.

### Audio configuration validator

**Target location:** `src/lib/audio/audioConfigValidator.ts`.

- **Responsibility:** turn persisted intent plus current capabilities into one
  `ValidatedAudioConfig` or typed issues. In Live mode this includes an exhaustive
  `ValidatedLiveSourcePlan`: every source allowed to enter the graph, its role,
  destination, and required/optional status.
- **Owned state:** none; the returned immutable result belongs to a runtime
  generation.
- **Permitted dependencies:** schema types and pure selectors from
  `liveRigPlan.ts`, `xairRouting.ts`, and SongMap.
- **Forbidden dependencies:** fetch, AudioContext, stores, timers, UI, or writes.
- **Public interface:** `validateAudioConfiguration(input)`. Candidate discovery
  is input; candidates absent from the returned source plan are forbidden, not
  implicitly muted.
- **Side effects:** none.
- **Lifecycle:** one call per config/device/song generation.
- **Failure modes:** explicit issue codes for capacity, collision, missing
  assignment, stale legacy mapping, unsupported stereo monitor, and missing cue.
- **Cleanup:** none.
- **Testing:** table/property tests, including every invalid mapping in the runtime
  data document and Live allowlist tests for unassigned, orphaned, preview-only,
  generated, missing, and explicitly included sources.

The first contract-only implementation is
[`audioConfigValidator.ts`](../../src/lib/audio/audioConfigValidator.ts), described
by [`live-audio-shadow-model.md`](live-audio-shadow-model.md). It is the sole owner
of shadow admission and desired-routing decisions. Its result has no production
consumer and must not be placed in a mutable store. The diagnostics formatter is
a read-only projection, not a second validator. During the later runtime cutover,
AudioRuntime must consume the validator result and the overlapping fallback
planners (`liveOutputMap`, `liveRigPlan` lane fallback, component-owned readiness)
must be disconnected or deleted in that same slice.

### Live routing input constructor

**Location:** `src/lib/audio/liveAudioRoutingInput.ts`.

- **Responsibility:** construct the one canonical `LiveAudioShadowInput` from a
  current project/song snapshot; discover all persisted producers; resolve
  explicit stable source/mixer/rig-lane bindings; retain raw project routing;
  generation-tag every record; and calculate exact expected installation sets.
- **Owned state:** none.
- **Permitted dependencies:** SongMap/project schema types, v7 compatibility
  adapter, and the pure audio configuration validator.
- **Forbidden dependencies:** Svelte stores, UI component state, filesystem or
  device access, AudioContext, prior plans, prior graphs, and mutable caches.
- **Public interface:** `captureRawProjectRoutingDto()`,
  `deriveLiveAudioShadow()`, `buildLiveSourceInstallManifest()`, and
  `auditInstalledLiveSources()`.
- **Failure behavior:** missing or malformed current data is preserved in the
  raw DTO and/or represented by typed blockers. Nothing is guessed from labels,
  filenames, order, mute/solo, or `liveSlot`.

### Canonical song scheduler

**Target location:** `src/lib/audio/songSchedule.ts`, initially a facade over
`songmap/playbackPlan.ts`, `audio/cueTrackSpeechSchedule.ts`, and section helpers.

- **Responsibility:** calculate all time-bearing events for one SongMap and
  lifecycle intent: musical start, click, count-in, every active cue track,
  announcements, section jumps, and repeat boundaries.
- **Owned state:** none; returns immutable schedules.
- **Permitted dependencies:** SongMap/project policy types and pure music helpers.
- **Forbidden dependencies:** physical channels, devices, XR18, audio nodes,
  stores, fetch, TTS, or UI.
- **Public interface:** `buildCanonicalSongSchedule(input)`.
- **Side effects:** none.
- **Lifecycle:** recomputed when relevant data/policy changes.
- **Failure modes:** schedule diagnostics, never silent timing guesses.
- **Cleanup:** none.
- **Testing:** unit/property tests and parity tests across Live, Editor, render,
  and export adapters.

### Song resource loader

**Target location:** `src/lib/audio/songResources.ts`.

- **Responsibility:** resolve and decode only sources admitted by the requested
  mode's validated source plan; prepare its generated MIDI, click buffers, and
  cue speech assets.
- **Owned state:** only in-flight request resources and cache entries.
- **Permitted dependencies:** project/cloud asset readers, cue asset provider,
  decoder passed by the device adapter, and canonical schedule.
- **Forbidden dependencies:** active transport, physical routing policy, UI stores,
  Editor mute/solo state as Live permission, or direct graph mutation.
- **Public interface:** `prepareSong(request, AbortSignal)` returning a complete
  `PreparedSong` plus required/optional diagnostics.
- **Side effects:** file/cloud/sidecar reads, decode, disposable caches.
- **Lifecycle:** request-scoped; cancellation mandatory.
- **Failure modes:** missing source, decode failure, unavailable TTS, stale request.
- **Cleanup:** abort fetches; release temporary resources; never commit after
  generation mismatch.
- **Testing:** fake asset ports and browser decode/cache tests.

### Audio runtime

**Target location:** `src/lib/audio/audioRuntime.ts`.

- **Responsibility:** sole authority for live audio state and command ordering.
- **Owned state:** mode/session generation, open device reference, validated
  desired config, active graph generation, prepared/active song generation,
  canonical transport position/state, Practice state, route health, confirmations,
  warnings, and errors.
- **Permitted dependencies:** all narrow domain ports listed here, never UI
  components.
- **Forbidden dependencies:** Svelte route/component state and direct project
  mutation. It reads desired config and emits requests to repositories; it does
  not write settings opportunistically.
- **Public interface:** typed commands (`enterMode`, `openDevice`, `loadSetlist`,
  `loadSong`, `play`, `pause`, `stop`, `seek`, `repeatSection`, `setPractice`,
  `applyRouting`, `testOutput`, `leaveMode`) plus read-only `subscribe/getSnapshot`.
- **Side effects:** orchestrates device, graph, loader, and XR18 executors.
- **Lifecycle:** application audio session. One runtime instance per window/process.
- **Failure modes:** typed command failures tied to generation and output ID.
- **Cleanup:** cancels stale work; tears down song sources before replacement;
  closes/suspends device on shutdown according to the lifecycle contract.
- **Testing:** pure state reducer/command sequencing tests and browser integration.

No component may construct a second AudioRuntime, MixerEngine, or transport for
the same application audio session.

For Live, AudioRuntime must compare every prepared/installed source ID with the
current `ValidatedLiveSourcePlan`. An executor reporting an unknown source is a
blocking invariant violation, not a reason to connect it muted.

### Audio device adapter

**Target location:** evolve `src/lib/audio/audioDevice.ts`.

- **Responsibility:** own one active AudioContext and facts about its selected
  sink, channel capacity, state, and loss events.
- **Owned state:** the open device instance and device observations.
- **Permitted dependencies:** Web Audio and MediaDevices only.
- **Forbidden dependencies:** songs, performers, project stores, XR18, and UI.
- **Public interface:** `open(preference)`, `resume()`, `suspend()`, `close()`,
  `observe()`, and context access restricted to graph executors.
- **Side effects:** device/context calls.
- **Lifecycle:** commanded by AudioRuntime. Probes use a separately identified test
  session and can never mutate the production context.
- **Failure modes:** permission, unsupported sink selection, insufficient channel
  count, suspended/closed/lost context.
- **Cleanup:** remove listeners, stop probes, close only contexts it owns.
- **Testing:** browser tests plus a real XR18 exact-channel proof.

### Mixer engine

**Target location:** narrow the existing `src/lib/audio/mixerEngine.ts`.

- **Responsibility:** execute a validated graph and transport schedule on the
  supplied AudioContext.
- **Owned state:** nodes and active sources for one runtime graph generation.
- **Permitted dependencies:** Web Audio primitives and engine data types.
- **Forbidden dependencies:** project stores, `liveRigPlan`, `liveOutputMap`,
  localStorage, hardware bridge, and product fallback policy.
- **Public interface:** install/remove a track only under an explicit graph-plan
  source ID and output edge; apply graph plan, play/pause/stop/seek, clock
  snapshot, dispose.
- **Side effects:** Web Audio node creation, connection, scheduling, teardown.
- **Lifecycle:** created/owned by AudioRuntime or a graph-generation child.
- **Failure modes:** unknown source IDs, missing explicit output edges, node,
  connection, and scheduling errors reported to AudioRuntime. It never substitutes
  Main for an absent private edge.
- **Cleanup:** stop every source and instrument, disconnect every node, clear
  callbacks; never close a context it did not create.
- **Testing:** OfflineAudioContext/browser graph assertions.

### Cue asset provider and cue executor

**Target location:** reuse `cueRender.svelte.ts`/sidecar TTS behind a narrow provider;
keep `LiveCueScheduler` as an internal executor or replace it with an equivalent.

- **Responsibility:** provider resolves speech assets by text/voice; executor plays
  already scheduled buffers at runtime context times.
- **Owned state:** disposable asset cache (provider) and active cue source nodes
  (executor), not cue policy.
- **Permitted dependencies:** TTS sidecar/cache for provider; AudioContext for
  executor.
- **Forbidden dependencies:** announcement mode, performer assignment, Main
  fallback, project persistence, or UI.
- **Public interface:** `getSpeechAsset(spec, signal)` and
  `scheduleCue(outputId, buffer, atContextTime)`.
- **Side effects:** TTS fetch/decode and source scheduling.
- **Lifecycle:** provider cache session-local; executor graph-generation-local.
- **Failure modes:** asset unavailable, decode failure, late/invalid schedule.
- **Cleanup:** abort stale renders and stop/disconnect pending sources.
- **Testing:** cache/cancellation and sample-clock scheduling tests.

### XR18 control adapter

**Target location:** web port in `hardwareBridge.ts`; sidecar session extracted from
`desktop/electron/main.mjs` around the existing `xairClient`; UDP executor remains
`xairOsc.mjs`.

- **Responsibility:** own one OSC control session, console identity, fresh
  readback/meter observations, command queue, and reconnect state.
- **Owned state:** sidecar XR18 session facts only. It does not own Web Audio.
- **Permitted dependencies:** sidecar UDP/network and pure XR18 path/parse helpers.
- **Forbidden dependencies:** Svelte components, SongMap, setlist, and direct UI
  callbacks.
- **Public interface:** narrow typed connect/disconnect/read/apply/test commands
  and a versioned snapshot endpoint/event stream.
- **Side effects:** XR18 OSC only.
- **Lifecycle:** sidecar process or explicit session. Reconnect invalidates old
  acknowledgements and never silently re-arms writes.
- **Failure modes:** unidentified console, timeout, stale reply, socket/network
  error, readback mismatch.
- **Cleanup:** unsubscribe meters, clear intervals/listeners/cache, close socket on
  disconnect and application shutdown.
- **Testing:** Node tests with a hostile fake desk: drops, stale replies, ignored
  writes, reconnects, and malformed meter frames.

### UI surfaces

**Current surfaces:** live route, edit route, `MixerView`, `LiveHardwareStrip`,
`XAirSettingsPanel`, `/rig`, transport bars, and controller adapters.

- **Responsibility:** collect intent and render runtime snapshots.
- **Owned state:** ephemeral presentation only: open dialog, selected row, tooltip,
  pending button gesture. Practice consent lives in AudioRuntime, not component
  localStorage.
- **Permitted dependencies:** runtime command API and read-only snapshot selectors;
  project commit commands for explicit settings forms.
- **Forbidden dependencies:** AudioContext, MixerEngine construction, XR18 bridge
  writes, route activation acknowledgements, and independent readiness state.
- **Public interface:** component props/events only.
- **Side effects:** navigation and explicit settings requests.
- **Lifecycle:** mount/unmount must not define audio lifetime.
- **Failure modes:** display runtime errors; UI errors cannot clear runtime errors.
- **Cleanup:** unsubscribe and cancel presentation-only timers.
- **Testing:** component/browser tests asserting request and projection behavior.

## Direct answers

| Question | Answer |
|---|---|
| Who owns the selected/preferred device? | Preference repository owns preference; AudioRuntime owns the resolved active choice. |
| Who owns the currently opened device? | AudioRuntime, executed by AudioDeviceAdapter. |
| Who owns the active graph? | AudioRuntime; MixerEngine is its executor. |
| Who validates physical mappings? | Pure AudioConfigurationValidator. |
| Who owns playback position? | AudioRuntime. |
| Who owns song loading? | AudioRuntime owns generation/commit; SongResourceLoader executes preparation. |
| Who owns click/cue scheduling? | CanonicalSongScheduler owns the plan; AudioRuntime owns execution. |
| Who decides announcement firing? | Scheduler from lifecycle intent; AudioRuntime records/executes that decision. |
| Who maps performers to monitor mixes? | Project config owns desired mapping; validator accepts/rejects it; runtime activates it. |
| Who maps mixer channels to stems/sources? | SongMap v7 owns stable `mixerChannelId -> sourceId/stemId`; `liveAudioRoutingInput.ts` resolves the current producer; AudioConfigurationValidator rejects missing, duplicate, stale, or implicitly summed bindings; MixerEngine may later execute only validated pairs. |
| Who maps logical to physical outputs? | Validator produces the mapping; runtime owns the active generation. |
| Who reconnects devices? | AudioRuntime commands the device adapter; sidecar XAirSession owns OSC reconnect mechanics. |
| Who exposes readiness? | AudioRuntimeSnapshot only. |
| Who may mark output ready? | AudioRuntime readiness derivation only; no UI or executor sets it. |
| Who destroys the previous song state? | AudioRuntime during generation replacement. |
| Who owns errors? | The executor owns raw facts; AudioRuntime owns user-facing active audio errors. |
| Who can mutate routing while playing? | AudioRuntime commands validated as safe-during-play; unsafe changes are rejected or require stop. |
| Who persists assignments? | Project/device repositories through explicit settings commands. |
| Who talks to XR18? | Sidecar XAirSession only; web AudioRuntime uses the narrow bridge. |
| Who talks to local audio? | AudioDeviceAdapter/MixerEngine under AudioRuntime. |
| Who owns test signals? | AudioRuntime test session; UI only requests and confirms. |
| Who prevents an unassigned source entering Live? | AudioConfigurationValidator owns the exhaustive source allowlist; AudioRuntime enforces it when committing; MixerEngine rejects anything else. |
| Who proves click/cue reached a performer? | AudioRuntime derives the verdict from one generation of device graph acknowledgement plus XAirSession USB/strip/Main-assign/bus-send/readback evidence. UI and configuration cannot prove it. |

## Critical failure prevention assignments

| Failure to prevent | Owner | Requester | Validator | Executor | Observer |
|---|---|---|---|---|---|
| Unassigned/editor-only/orphan source audible in Live | AudioRuntime owns installed set | Live UI requests song activation | AudioConfigurationValidator emits exhaustive Live source allowlist | SongResourceLoader prepares and MixerEngine installs only allowed IDs | UI shows admitted/omitted source evidence |
| Click/cue/announcement reaches Main without Practice | AudioRuntime owns active route generation | Live UI may explicitly request Practice | Validator rejects every private-to-Main edge except active Practice policy | MixerEngine applies supplied edges only; XAirSession proves private strips Main-off | UI reports runtime result only |
| Click or cue missing from intended performer monitor | AudioRuntime owns per-output readiness/failure | settings provide desired assignment | Validator resolves full logical-to-physical chain and capacity | AudioDeviceAdapter/MixerEngine/XAirSession acknowledge graph, USB strip, bus send/master/readback | UI identifies exact failed link; does not say Ready from assignment/meter alone |
| Stale node sounds after song/mode change | AudioRuntime owns generations and replacement | navigation/song UI | generation checks reject stale results | Loader aborts; MixerEngine/cue/MIDI executors stop and disconnect old generation | UI observes the new generation only |
| Editor audition state affects Live | AudioRuntime owns mode-specific active policy | Editor and Live request their own modes | Validator uses explicit Live config, never audition mute/localStorage | executor receives a fresh Live graph plan after Editor cleanup | both surfaces render their own projection |

## Dependency rules

```text
UI ---> AudioRuntime API ---> validators/scheduler (pure)
                |          \
                |           ---> SongResourceLoader ---> asset ports
                +--------------> AudioDeviceAdapter ---> Web Audio
                +--------------> MixerEngine ----------> Web Audio
                +--------------> XAir bridge ----------> sidecar XAirSession

Project repositories ---> persisted types
Scheduler -------------> SongMap/project policy types only
Validators ------------> data types and pure selectors only
```

Forbidden dependency directions:

- Scheduler -> physical device, XR18, UI, store, or fetch.
- Device discovery -> performer, song, setlist, or routing policy.
- Validator -> hardware writes, graph construction, stores, or timers.
- MixerEngine -> project store, localStorage, XR18, or fallback policy.
- Persistence -> runtime health, open device, meter state, or session consent.
- UI -> AudioContext, MixerEngine constructor, XR18 write endpoints, or mutable
  readiness stores.
- XR18 sidecar -> SongMap, Svelte, or project filesystem semantics.
- Runtime snapshot projection -> commands or side effects.

## Current forbidden patterns and replacements

| Current anti-pattern | Location | Why dangerous | Target replacement |
|---|---|---|---|
| Private lanes fall back to programme | `liveOutputMap.ts:88-116`, `mixerEngine.ts:376-386`, `MixerView.svelte:3237-3246`, `liveRigPlan.ts:268-279` | Missing capacity or disabled split sends click/cue to Main without consent | Validator returns no private route; runtime mutes it unless Practice is explicitly active |
| Mute is used as Live source admission | `MixerView.svelte:1710-2133`, `liveSlotLinks.ts:135-178` | Every candidate is installed; unlinked lanes inherit Editor mute and can sound | Validator emits an exhaustive source allowlist; excluded source IDs are never prepared or installed |
| Filename guesses stand in for explicit Live inclusion | `liveSlotLinks.ts:64-91`, `liveMidiMap.ts:223-238` | Old/custom/orphan names can be admitted differently across songs and devices | Migrate legacy guesses into explicit reviewed source assignments; ambiguous lanes default excluded |
| Production ignores the project rig graph | `MixerView.svelte:3235`, `mixerEngine.ts:275-293`; `liveRigLayout()` is used by tests, not this constructor | Runtime audio channels can disagree with persisted XR18 routes and monitor sends | AudioRuntime passes one validated graph plan and records executor acknowledgement |
| Click/cue XR18 input chain is incomplete | `/rig` configures only stereo USB sources (`routes/rig/+page.svelte:487-545`); `XAirSettingsPanel.svelte:330-424` writes sends/Main assigns but not click/cue USB source selection | A strip can be configured and metered while listening to the wrong USB return | Validated route includes Web channel -> USB source -> strip; XAirSession applies/readbacks the whole chain transactionally |
| Monitor display hard-codes a conflicting click strip | `MixerView.svelte:3946-3952`, `MonitorStatusStrip.svelte:37-62` inspect 11; `xairRouting.ts:112-138` defaults click to 15 | UI can display another source's meter as click evidence | Runtime snapshot supplies route IDs/channels from active graph; component accepts no guessed channel default |
| Aggregate bus meter treated as content proof | `monitorStatus.ts:88-150` and `MonitorStatusStrip.svelte` | Signal on a bus does not prove click/correct cue is present or private isolation holds | Readiness keeps bus activity as separate evidence; route-specific test plus graph/readback chain proves software path |
| UI component constructs runtime engine | `MixerView.svelte:3230-3259` | Component mount defines device/transport lifetime and can coexist with other engines | One application AudioRuntime owns engine independent of route mount |
| Parallel transports | `transport.svelte.ts`, `MixerView.svelte`, `WaveformPlayer.svelte:232-233`; edit route pauses one for another | Position, scheduling, and cleanup diverge | One AudioRuntime transport with surface adapters |
| Announcement policy/timer in UI | `MixerView.svelte:2660-2723` | Only primary track fires; lifecycle differs from render/export | Canonical schedule plus runtime fired-generation state |
| Primary cue track stands in for performer tracks | `cueTracks.ts:74-76`, `MixerView.svelte:1746,2609-2669` | Distinct performer cues cannot be routed or verified | Schedule every validated `performerId` cue lane |
| Three XR18 appliers | `LiveHardwareStrip.svelte`, `XAirSettingsPanel.svelte`, `routes/rig/+page.svelte` | Duplicate sockets/status/arming/diff caches issue conflicting writes | AudioRuntime -> one sidecar XAirSession command queue |
| Arming persisted in component localStorage | `LiveHardwareStrip.svelte:77-103`, `XAirSettingsPanel.svelte:146-203` | A new session can inherit permission to move a real desk | Session-local runtime arm; always false after start/reconnect |
| UI status treated as runtime evidence | `rigStatus.ts`, `rigHealth.ts`, `liveAudioCache.ts`, `MixerView`'s `mixerCanPlay` | Configured, decoded, replied, and active are conflated | One versioned runtime snapshot with explicit evidence |
| Throwaway context used to describe active device | `outputDevice.ts:81-107` | It may observe different capabilities and consumes another hardware context | Active device adapter reports its own sink/capabilities; probes are separately labelled evidence |
| MixerEngine imports routing policy | `mixerEngine.ts:18-24,278-311` | Executor silently decides fallback behavior | Runtime passes a fully validated graph plan |
| Destructive async reload inside component | `MixerView.svelte:2974-3022` | Generation races can wipe tracks or leave stale song state | Cancellable prepare, generation check, then one commit/cleanup transaction |
| Project model comment claims absent default mixes | `performerMix.ts:18-20` versus `ProjectFile` | Agents may build on a field that does not exist | Add an explicit schema only when approved; until then `liveRig.monitorSends` is the persisted source |

## First implementation slice

Create a pure `ValidatedAudioConfig` model (including
`ValidatedLiveSourcePlan`), validator, and runtime snapshot reducer without
moving playback yet. Adapt no production output path in this slice.

Acceptance criteria:

1. Inputs model source/stem ID, mixer-channel ID, rig programme-lane ID, Main,
   shared click, `cue:<performerId>`, performer monitor bus, Web Audio channel,
   XR18 strip, USB source, and XR18 aux bus distinctly.
2. Validation rejects missing/duplicate/stale mixer-channel-to-source bindings,
   implicit stem summing, Main/private overlap, duplicate private output channels,
   out-of-range channels/buses, insufficient device capacity, duplicate performer
   buses, missing cue-track ownership, and ambiguous legacy mappings.
3. Live source validation emits an exhaustive stable-ID allowlist and excludes
   unassigned, Editor-only, orphaned, and stale sources regardless of saved mute,
   solo, filename guess, or device-local preview state.
4. A pure runtime reducer accepts command-result events tagged with
   `sessionGeneration`, `configGeneration`, and `songGeneration`; stale events do
   not alter the snapshot.
5. Readiness selectors produce the exact states defined in
   [`../contracts/audio-readiness.md`](../contracts/audio-readiness.md), including
   the three-performer partial failure example.
6. No Svelte component, AudioContext, XR18 endpoint, or current playback behavior
   changes.
7. Unit/property tests cover every rejection and state transition; existing unit,
   browser, sidecar, and Svelte checks remain at their pre-slice baseline.
