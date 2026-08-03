# Audio Runtime State

**Status:** target state model. No current store implements this model in full.
The authoritative owner is the target `AudioRuntime` described in
[`audio-module-ownership.md`](audio-module-ownership.md).

## Four state planes

| Plane | Examples | Owner | Lifetime | May cause side effects? |
|---|---|---|---|---|
| Persisted configuration | preferred device identity, Main channels, performer/monitor assignments, XR18 mappings, cue tracks | project/device preference repositories | project or local preference | No; writes only describe intent |
| Validated desired state | resolved logical outputs, collision-free channel map, required capabilities, per-output validity | pure `AudioConfigurationValidator` result | until config/capabilities change | No |
| Runtime state | opened device, active graph, prepared song, transport position, output health, OSC session, failures | `AudioRuntime` | one Live/Editor runtime session | Yes, through owned adapters/executors |
| UI projection | labels, controls, progress, readiness states, structured warnings | pure projection of runtime snapshot | disposable | Never |

Configuration is not promoted to runtime state merely because it parsed or
validated. UI state is never copied back into runtime state. Runtime commands
are the only way to request a change.

## Identity and stale-result protection

Every asynchronous command/result carries these monotonically increasing IDs:

- `sessionGeneration`: changes whenever the audio runtime is initialized again.
- `configGeneration`: changes whenever validated desired routing changes.
- `songGeneration`: changes on every song preparation request, including a retry
  for the same song.

An event whose generation does not match the current snapshot is stale. The
runtime must clean up any resources returned by that event, record no readiness
from it, and never attach its graph or source nodes.

## Canonical snapshot

The target snapshot is immutable and has one conceptual shape:

```text
AudioRuntimeSnapshot
  session: { generation, mode, state }
  desiredConfig: { generation, validationResult, liveSourcePlan }
  device: DeviceRuntimeState
  xairControl: XAirRuntimeState
  song: SongRuntimeState
  transport: TransportRuntimeState
  outputs:
    main: OutputRuntimeState
    performers: Map<performerId, OutputRuntimeState>
    practice: PracticeRuntimeState
  readiness: LiveReadiness
  failures: RuntimeFailure[]
```

The snapshot may contain identifiers and evidence, not live `AudioNode`, socket,
buffer, or file-handle objects. Those stay in the owning adapters/executors.

## State machines

### Global audio runtime

```text
idle -> initializing -> operational <-> degraded
                         |               |
                         +-----> blocked-+
initializing -> blocked
operational/degraded/blocked -> shutting-down -> idle
```

| Transition | Trigger and owner | Side effects | Success | Failure and cleanup |
|---|---|---|---|---|
| `idle -> initializing` | `enter(mode)`; AudioRuntime | reset Practice off, subscribe to capabilities, open one audio device, start optional OSC session | device/config substates begin | close partial resources; `blocked` or `idle` if cancelled |
| `initializing -> operational/degraded` | runtime evidence fold | validate routes, create preserved global buses | readiness selector decides state | structured failure; no private fallback |
| `* -> blocked` | Main/song/device invariant fails | stop transport, cancel scheduled sources, mute/disconnect unsafe routes | blocked snapshot | remains blocked until a valid recovery command |
| `* -> shutting-down -> idle` | leave mode/app shutdown; AudioRuntime | stop, cancel loads, dispose song graph, close subscriptions/adapters as policy requires | empty snapshot and Practice off | cleanup is best-effort and errors are reported, never used to skip remaining cleanup |

`operational` means the runtime is functioning; Live readiness can still be
`degraded` when a non-Main performer output has failed.

### Audio device

```text
closed -> opening -> open <-> suspended
opening -> failed
open/suspended -> lost -> reconnecting -> open
lost/reconnecting -> failed
open/suspended/lost/failed -> closing -> closed
```

- **Owner:** `AudioDeviceAdapter`, commanded by `AudioRuntime`.
- **Open evidence:** the selected device instance is represented by the one active
  context, required output channels exist, and the context can be resumed.
- **Lost evidence:** device-change/context events or a failed graph operation show
  that the active instance is no longer usable. OSC loss alone is not device loss.
- **Reconnection:** cancellable and generation-scoped. It revalidates every
  physical mapping; it does not assume that the replacement has the same channels.
- **Cleanup:** close nodes/context owned by the adapter, invalidate manual output
  confirmations, and force every audio output out of `ready`.

### Song resources

```text
empty -> loading -> prepared -> activating -> active
loading/prepared/activating -> failed
loading/prepared/active/failed -> disposing -> empty
```

- `loading` is asynchronous and cancellable. It reads/decode resources without
  mutating the active graph.
- `prepared` proves required resources exist, but is not audible readiness.
- `activating` is the synchronous graph-commit boundary after a generation check.
- `active` means the new source generation is attached in a stopped state at
  position zero. It does not mean transport is playing.
- For Live, `prepared` and `active` carry source-ID sets. `active` is valid only
  when the executor's installed set exactly equals the exhaustive validated Live
  source plan. Excluded candidates have no connected nodes, even at zero gain.
- Optional missing stems produce warnings and are omitted only when the SongMap
  does not require them. A missing required programme source makes the song fail.
- Disposal cancels source nodes, cue speech, click/count-in schedule, MIDI notes,
  repeat state, and song-specific subscriptions before references are released.

### Transport

```text
stopped -> starting -> playing -> pausing -> paused
paused -> starting -> playing
playing/paused -> stopping -> stopped
playing/paused -> seeking -> playing/paused
```

- **Owner:** AudioRuntime. Web Audio clock position is canonical while playing;
  the runtime's anchored position is canonical while paused/stopped.
- `play`, `pause`, `stop`, and `restart` are idempotent for their resulting state.
- `seek` and section-repeat changes create a new schedule epoch and cancel all
  pending click, cue, announcement, and MIDI sources from the previous epoch.
- A transport command never changes persisted assignments.
- A stale callback may not advance transport or fire a cue.

### Output

All Main and performer outputs use the same minimal state vocabulary:

```text
unconfigured -> initializing -> ready
unconfigured -> failed
initializing/ready -> degraded
initializing/ready/degraded -> failed
ready/degraded/failed -> disconnected
disconnected/failed -> initializing
* -> unconfigured when desired assignment is removed
```

Definitions and exact guarantees are authoritative in
[`../contracts/audio-readiness.md`](../contracts/audio-readiness.md).

| Transition | Trigger | Owner/side effects | Cleanup |
|---|---|---|---|
| `unconfigured -> initializing` | a valid desired output appears | AudioRuntime asks executor to build it | remove any previous route first |
| `initializing -> ready` | executor acknowledges graph activation and current evidence passes | AudioRuntime records generation-tagged evidence | none |
| `ready -> degraded` | non-fatal control/readback loss or optional monitor content loss | freeze XR18 writes; keep proven audio graph | invalidate confirmation if route identity changed |
| `* -> failed` | graph/channel/config invariant fails | disconnect or mute that output; private lanes stay private | cancel only sources targeting the failed output |
| `* -> disconnected` | active device instance disappears | stop writing to route and invalidate activation | release route nodes when safe |

Main failure blocks playback. A performer failure does not destroy Main or other
performer routes; it marks Live degraded and that performer receives silence.

### Practice output

```text
off -> enabling -> on
enabling -> failed -> off
on -> off
```

- **Owner:** AudioRuntime session state.
- It is forced to `off` before every Live entry and after shutdown.
- Enabling requires a fresh explicit user action and exactly one selected enabled
  cue track. It may then add click and that cue track to Main.
- Losing a performer route never triggers `enabling`.
- Changing the selected practice cue track rebuilds only that session-local
  route. It never changes `CueTrack.performerId` or project assignments.

### Live readiness

```text
initializing -> ready | degraded | blocked
ready <-> degraded
ready/degraded -> blocked
blocked -> initializing
```

- **Ready:** Main and song are ready, and every configured/required performer
  output is ready. A project with no performers may be Main-only ready.
- **Degraded:** Main and song are ready, but at least one performer output or XR18
  control/readback facility is unavailable. Play may continue; failed private
  routes are silent and require a prominent warning.
- **Blocked:** Main, active audio device, required song programme, or isolation
  validation failed. Play is disabled/stopped.

## Configuration model and mapping validity

Existing desired-audio data is spread across `ProjectFile.performers[]`,
`ProjectFile.liveRig`, and each SongMap's `stemRefs`, `mixState`, and
`cueTracks[]`. Current `stemRefs`/`mixState` keys do not yet provide the target
stable channel-to-source binding. After its schema and migration are defined,
the validator normalizes these into distinct identifiers:

```text
mixerChannelId
  -> sourceId
  -> current-song original/stem/generated producer
  -> channel gain/EQ/mute/solo/effect sends
  -> rigProgrammeLaneId
  -> zero-based Web Audio device channel(s)
  -> zero-based USB return source(s)
  -> one-based XR18 input strip(s)
  -> Main/LR policy and per-performer aux sends

performerId
  -> monitorMixId
  -> logical output (monitor:<performerId>)
  -> zero-based Web Audio device channel
  -> one-based XR18 USB/input strip
  -> one-based mono XR18 bus
  -> physical aux/IEM destination

CueTrack.performerId
  -> logical private lane cue:<performerId>
  -> dedicated device channel/XR18 input strip (Main send off)
  -> only that performer's XR18 bus
```

The shared click follows the same private path but sends to all assigned performer
buses. Musical lanes send to Main and their configured monitor sends.

`mixerChannelId`, `sourceId`, and `rigProgrammeLaneId` are separate stable IDs.
The first binds a user-visible processing strip to one source; the second names
the asset or generated producer; the third names its hardware allocation. Mixer
labels, order, filenames, mute/solo, and `liveSlot` are not substitutes. Distinct
stems require distinct rig lanes for independent XR18 monitor sends; an explicit
sum is one monitor-controllable source group, not several independently routed
stems.

Current target constraints:

- Main is one stereo pair. Pair members are adjacent and ordered; Web Audio uses
  zero-based indices while XR18 channels/buses use one-based numbers.
- Performer monitor buses are mono XR18 buses `1..6` because that is the current
  schema. Stereo performer monitors are not inferred from two numbers.
- Two performers may not share a bus accidentally. Shared mixes require a future
  explicit monitor-group model.
- One performer cannot target multiple destinations in the current schema.
- Main device channels/strips may not overlap any click or cue private channel.
- Private logical outputs may not share device channels unless an explicit future
  matrix object defines the share. No override exists today.
- A mapping that exceeds device or desk capacity is invalid, not degraded.
- Legacy mappings with ambiguous numbering, collisions, missing performer/cue
  ownership, or unsupported stereo intent remain persisted for repair but are not
  activated.

The OSC control connection and USB audio connection are orthogonal. A connected
XR18 OSC socket does not prove that a Web Audio output channel reaches the desk.

Live source admission is another independent validated mapping:

```text
discovered song source candidate
  -> explicit/migrated Live assignment
  -> admitted stable source ID + content role
  -> explicit logical output edge(s)
  -> installed source/edge acknowledgement
```

Editor mute/solo and preview state may affect the Editor graph but are not inputs
to this permission mapping. Runtime caches may retain excluded bytes, never
excluded active nodes.

## Failure representation

Runtime failures are structured, generation-tagged records:

```text
RuntimeFailure {
  code
  severity: warning | output-failed | blocking
  scope: device | main | performer:<id> | song | transport | xair-control
  operation
  generation ids
  recoverable
  userMessage
  technicalCause?
}
```

UI dismissal may hide a presentation, but cannot delete an active failure. The
runtime clears a failure only after new evidence proves recovery or the affected
generation is disposed.

## UI projection rules

- Projection is a pure function of the snapshot plus harmless presentation
  preferences.
- A component may issue commands and show pending command IDs. It cannot set an
  output to `ready`, clear runtime failures, open/close devices, or mutate graphs.
- Readiness colours and labels use the exact vocabulary in the readiness contract.
- Resource-prefetch state, configuration validity, OSC response, and prior manual
  confirmation are shown as their own evidence; none is renamed `ready`.

## Unresolved target questions

1. Which Chromium/Electron device API and packaged environment can reliably select
   and retain the XR18 multichannel sink across supported platforms?
2. What fixed XR18 input/channel budget will BarBro support when musical stems,
   shared click, and one private cue lane per performer compete for 16 strips?
3. Should starting playback while Live is degraded require one explicit operator
   acknowledgement, or is a persistent warning sufficient?
4. How should stable device preference identity be represented on platforms that
   expose only changing or permission-gated device IDs?
5. Does the product need explicit shared/stereo monitor groups or multiple
   destinations per performer? Those are intentionally invalid in this model.
