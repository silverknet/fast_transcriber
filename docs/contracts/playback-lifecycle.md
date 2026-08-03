# Playback Lifecycle Contract

**Status:** target lifecycle. The current `MixerView.svelte` performs much of this
orchestration inside component effects and handlers; that is not the target owner.

## Ownership rule

`AudioRuntime` owns lifecycle sequencing and one active song generation. Resource
loaders, graph executors, device adapters, cue executors, and XR18 control are
narrow workers. UI issues commands and observes snapshots.

## Operation properties

| Operation | Sync/async | Cancellable | Transactional | Idempotent | While playing |
|---|---|---|---|---|---|
| Enter Live / initialize device | Async | Yes | Yes at session boundary | Yes for same active session | N/A |
| Validate desired config | Sync/pure | N/A | Produces whole result | Yes | Safe; activation is separate |
| Prepare song resources | Async | Yes | No active mutation | Yes by generation/cache identity | Safe in background |
| Commit prepared song | Sync graph transaction | No after commit begins | Yes | No; one generation once | Requires stop boundary |
| Play/resume | Sync command + scheduled work | Pending schedule can cancel | Schedule epoch atomic | Yes | Safe |
| Pause/stop/restart/seek | Sync command + node cancellation | N/A | New schedule epoch | Yes by resulting state/target | Safe |
| Change repeat intent | Sync | N/A | New schedule epoch at boundary | Yes | Safe |
| Change output assignment | Validate sync, activation async | Yes before activation | Per config generation | Yes by desired config | Forbidden unless runtime supports an explicit guarded reconfiguration; v1 stops first |
| Device reconnect | Async | Yes | New device/config generation | Yes | Playback is stopped for actual device loss |
| XR18 control reconnect | Async | Yes | New control generation | Yes | Audio may continue degraded; writes frozen |
| Leave/shutdown | Async cleanup | No user cancellation | Whole session cleanup | Yes | Stops first |

## Entering Live Mode

1. Route creates/attaches only the Live UI. It sends `enterLive(projectId)`.
2. AudioRuntime increments `sessionGeneration`, stops/disposes any Editor audition
   graph and schedule epoch, resets Practice off, clears stale confirmations, and
   enters `initializing`. Editor nodes are not reused as a Live starting graph.
3. Repositories load persisted project routing/device preference. This is intent,
   not readiness.
4. Device adapter discovers capabilities and opens exactly one selected device
   instance. Optional XAirSession starts separately.
5. Pure validator resolves desired logical/physical routes and the exhaustive Live
   source allowlist against current project, song, device, and XR18 capability
   evidence.
6. Runtime builds preserved global buses/routes only from a valid graph plan.
7. Setlist metadata loads. The first song begins cancellable preparation.
8. Prepared resources and schedule are committed as one stopped generation at
   position zero. Readiness selectors produce `ready`, `degraded`, or `blocked`.

Re-entering Live repeats this sequence. It may reuse caches, but never an enabled
Practice state, old graph acknowledgement, or old manual confirmation.

## Setlist and song preparation

Setlist loading provides ordered song identities and metadata. It does not decode
every song into the active graph and does not prove readiness. Prefetch may warm
future resources under bounded memory and cancellation policy.

`prepareSong(songId, songGeneration, signal)` performs off-graph work:

1. Load current SongMap and reconcile original/stem paths from disk or cloud.
2. Discover source candidates, then apply the validated mode-specific source plan.
   Unassigned/Editor-only/orphan candidates are not prepared as attachable sources.
3. Build the canonical schedule from SongMap data.
4. Resolve required/optional admitted musical, MIDI, click, cue speech, and
   transpose assets.
5. Decode/render resources without connecting them to active output buses.
6. Return a disposable `PreparedSong` tagged with all three generations plus
   warnings/failures.

Cancellation or stale completion disposes temporary resources and cannot alter the
active song, transport, readiness, or UI selection.

## Commit and replacement model

BarBro reuses one opened device and preserved global output buses. It replaces
song-specific sources and scheduling state. It does not crossfade songs in v1.

At commit:

1. Confirm prepared generations still match.
2. Confirm the prepared source-ID set exactly matches the validated source plan;
   unknown/missing required IDs abort before attachment.
3. Stop old transport and increment schedule epoch.
4. Cancel old audio/MIDI/click/cue/announcement sources.
5. Disconnect and dispose old song-specific nodes, sends, effect taps, instruments,
   and subscriptions.
6. Clear repeat, section, announcement-in-flight, and song-scoped errors.
7. Attach only the prepared source generation's explicit output edges to the
   already validated global buses.
8. Ask the executor for its installed source/edge acknowledgement and compare it
   to the plan before readiness can become green.
9. Set canonical transport position to zero and state to stopped.
10. Publish one snapshot identifying the new active song generation.

If attachment fails, dispose the new generation and publish a blocking song
failure. The old song is not resumed implicitly. Global device routes remain only
if their safety is still proven.

### Song change while stopped

Prepare the target while the current stopped song remains visible/available. At
successful commit replace the old song as above. The target remains stopped at
zero. A failed preparation leaves the old stopped generation active and reports
the target load failure; no partial target graph is attached.

### Song change while playing

Preparation may occur while the current song continues. Once ready, commit creates
a deliberate stop boundary: stop old playback, clean it, attach target stopped at
zero. Do not auto-play, preserve old position, or crossfade unless a future product
contract explicitly adds that behavior.

## Transport behavior

### Start

`play()` requires Main and song readiness. For a fresh start at zero, determine
announcement eligibility from the canonical schedule and project mode. Auto intro
events fire on eligible outputs; count-in/song starts after the longest active
announcement. A new schedule epoch owns every created source.

### Pause and resume

Pause snapshots position from the audio clock, cancels all future sources in the
current epoch, and keeps global/song graph resources. Resume creates a new epoch
from that position. It never runs Auto announcement.

### Stop and restart

Stop cancels the epoch and resets position to zero. Restart is stop plus a fresh
start and therefore may run Auto announcement. Both cancel any announcement still
in flight before deciding new eligibility.

### Seek

Seek is valid while paused or playing. Cancel the old epoch first, set exact target,
then either remain paused or schedule from target. Sources crossing the target are
reconstructed according to canonical sustained-state rules; already-past one-shot
cues and Auto announcement do not replay.

### Section repeat

Repeat intent stores a canonical section/loop boundary, not independent UI timers.
At the boundary, increment schedule epoch and schedule every content class from the
loop start. Auto announcement is excluded. Disabling repeat removes only future
looping; it does not seek.

### Triggered announcement

This is an output-scoped canonical intro command and does not change transport.
It cancels/replaces an older intro source on the same logical output. It is rejected
for disabled/empty/ineligible tracks and follows Live or Editor routing policy.

## Output and device changes

### One performer output fails

Cancel sources targeting that output and disconnect/mute its route. Keep Main and
other performers unchanged, mark Live degraded, and allow scoped reinitialization.
No source is reconnected elsewhere.

### All performer outputs fail

Apply the same scoped rule to each. Main musical playback may continue degraded.
Practice remains whatever the user explicitly chose; failure never enables it.

### Main or complete device loss

Stop immediately, cancel the schedule, mark all output activation evidence stale,
and block. Device adapter releases invalid resources and begins an explicit or
policy-approved reconnect attempt. It must not silently continue on OS default.

### XR18 OSC loss with audio device intact

XAirSession reports control loss. Runtime freezes writes and invalidates desk
readback/physical confirmation as applicable. The known active USB audio graph may
continue degraded; routes are not rebuilt or guessed. Reconnect uses a new control
generation, re-reads required state, diffs against validated desired config, and
requires arming before mutating the desk.

### Reconfiguration

Changing physical mappings while playing is forbidden in the first target slice.
Runtime validates the proposed configuration without effects, asks for a stop, then
activates the complete new generation. Failure leaves private outputs silent and
does not partially apply an unsafe plan.

## Leaving and shutdown

On leaving Live:

1. Stop transport and increment schedule epoch.
2. Cancel song loads/prefetches and every audio/MIDI/cue/test source.
3. Dispose song graph, global graph, subscriptions, timers, listeners, and meter
   polling owned by the runtime session.
4. Close/freeze XR18 command session according to adapter policy; never restore
   prior desk values from stale UI caches.
5. Close/suspend the device according to app-wide mode policy, then reset the
   runtime snapshot to idle.
6. Force Practice off and invalidate manual confirmations.

Application shutdown uses the same sequence and gives each cleanup owner a bounded
chance to close. One cleanup error cannot prevent later cleanup steps. Before-quit
sidecar closure is defense in depth, not the only owner.

## Initialization and recovery failures

- Parse/validation failure: no graph side effect; identify the exact mapping/data.
- Device open/capability failure: close partial device, Live blocked.
- Song preparation failure: dispose prepared partials; current stopped song may
  remain only if replacement commit has not begun.
- Graph commit failure: dispose new generation; Live blocked for active song.
- Optional stem/cue asset failure: omit/degrade only when the contract says the
  content is optional; never substitute a private destination.
- Retry always creates a new generation and returns through `initializing`.

## Current migration notes

`MixerView.svelte` currently performs preparation, engine construction, cue and
announcement scheduling, prefetch, graph reload, and cleanup. `UnifiedTransport`
and `WaveformPlayer` provide additional transports. Migration must first introduce
generation-safe state/validation, then move command ownership incrementally. Do not
replace the component with a second large orchestrator or leave both engines active.
