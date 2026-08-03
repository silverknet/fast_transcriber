# Live And Editor Audio Routing Contract

**Status:** target observable behavior. This supersedes the earlier domain draft.
Current implementation differences are listed in
[`../architecture/audio-system-overview.md`](../architecture/audio-system-overview.md).

## Non-negotiable invariants

1. Main never receives click, cues, or announcements without an explicit,
   session-local Practice action.
2. Loss of a performer route never causes automatic fallback into Main.
3. Configuration state is not proof of runtime readiness.
4. Output status is derived only from the authoritative AudioRuntime.
5. Song changes cannot leave song-specific routing or scheduling state from the
   previous song active.
6. Live and Editor surfaces use the same canonical song schedule.
7. Preview actions never mutate persistent live assignments.
8. Invalid or ambiguous output mappings fail closed.
9. A frontend component may request a routing change but may not independently
   declare it successful.
10. No component, store, process, or adapter may create a parallel source of truth
    for live audio runtime state.
11. The Live musical graph is allowlist-only: a source absent from the validated
    Live source plan is not loaded into or connected to that graph. Muted is not
    equivalent to excluded.
12. Editor audition, preview, mute, solo, localStorage, filename inference, and
    stale graph state never grant a source permission to sound in Live.

## Content classes

| Content | Live Main | Live performer output | Editor local Main |
|---|---|---|---|
| Musical programme/original/stems | Yes | According to persisted monitor sends | Yes, according to audition mix |
| Musical MIDI instruments | Yes | According to persisted monitor sends | Yes |
| Shared click and count-in | Never, except Practice on | Yes for each ready assigned performer | Only after explicit Click audition |
| Performer cue track | Never, except the selected Practice track | Only the cue track whose `performerId` owns that output | Only the selected audition track |
| Song announcement | Same routing as its cue track | Same routing as its cue track | Same routing as selected audition track |
| Test signal | Never as an implicit fallback | Only the explicitly addressed route | Only after explicit test action |

Unassigned, Editor-only, preview, orphaned, stale, and excluded sources are not
Live content classes. They have no Live graph node or output edge.

Drum MIDI has no musical pitch transpose. Pitched MIDI uses the canonical song
transpose. This distinction does not alter its output privacy class.

## Live source admission

Before resources are loaded, the validator produces one exhaustive
`ValidatedLiveSourcePlan` for the current project, song, mode, and config
generation. Each admitted entry contains a stable source ID and kind, its
explicit inclusion reason, logical destination(s), required/optional status,
post-admission performance state, and generation identity.

The implemented shadow input for this contract has one owner:
[`liveAudioRoutingInput.ts`](../../src/lib/audio/liveAudioRoutingInput.ts). It
constructs the complete candidate/intent/mixer/rig input from a single current
snapshot. Components, stores, and runtime graph history may not supplement or
reconstruct it.

The following never imply Live inclusion by themselves:

- a file exists in the song folder or cloud asset map;
- a stem/machine was visible, enabled, or unmuted in Editor;
- a lane name resembles `drums`, `bass`, or another slot;
- a device-local preview/machine switch is on;
- the source was included in the previous song;
- a decoded buffer remains cached;
- a mixer track can be constructed successfully.

Legacy projects may be migrated once from recognized filename/default rules into
explicit assignments. An ambiguous legacy source defaults excluded and is shown
for repair. Live must never repeatedly infer permission at runtime.

Excluded sources may be prefetched as inert cache data only if useful, but they
cannot be attached to nodes, instruments, sends, effect buses, Main, or performer
outputs. AudioRuntime verifies the executor's installed source-ID set exactly
matches the validated plan before the song can become ready.

### Stem/source to mixer-channel binding

A source and a mixer channel are different identities. A source is an original,
stem asset, or generated musical producer. A mixer channel is the logical strip
that applies gain, EQ, mute, solo, and effect sends to exactly one source. A rig
source lane is the later hardware-output allocation; it is not the mixer channel.

The validated chain is explicit in both directions:

```text
mixerChannelId -> sourceId -> current-song stem/source record
current-song sourceId -> mixerChannelId -> channel processing
  -> rig programme source lane
  -> Web Audio channel(s) -> USB return(s) -> XR18 input strip(s)
  -> Main/LR policy and persisted performer monitor sends
```

Mixer order, labels, filenames, `stemRefs` keys, and `mixState.liveSlot` cannot
establish this binding. `liveSlot` may group validated mixer channels for APC/UI
control only; it cannot identify a stem, admit a source, or choose a physical
route. A missing source, duplicate channel/source binding, stale-song binding, or
channel pointing at a different source fails closed and remains visible for
repair.

Every independently controlled stem must retain its own rig source lane through
the XR18 input strip when performers need independent per-stem monitor sends. If
several mixer channels are explicitly summed into one rig lane, the plan must
describe the summed group and state that the XR18 can no longer set separate
monitor levels for its members. No implicit summing is allowed.

## Live Mode

### Output matrix

| Situation | Main | Ready performer outputs | Failed/unassigned performer outputs | Live state |
|---|---|---|---|---|
| All required routes ready | Musical programme only | Their monitor mix, shared click, own cues | N/A | `ready` |
| No performers configured | Musical programme only | None | None | Main-only `ready` |
| One or more performer routes fail | Musical programme only | Continue unchanged | Silence; no fallback | `degraded` |
| All performer routes fail | Musical programme only | None | Silence; no fallback | `degraded` |
| Main or active audio device fails | No output trusted | Private routes stopped or muted as part of blocking cleanup | Silence | `blocked` |
| Practice on | Musical programme + click + exactly one selected cue track | Existing ready routes remain as configured | Still no automatic fallback | `ready` or `degraded` from underlying outputs |

Concrete partial failure: P1 and P2 ready, P3 failed. Main receives musical
programme only. P1 hears P1's configured monitor mix, click, and P1 cues. P2
hears the equivalent P2 content. P3 receives silence. The UI shows Live
`degraded`, P1/P2 `ready`, and P3 `failed` with its cause. Playback may continue.

### Practice output

The control is conceptually **Hear click & cues in Main (practice)**.

- It is runtime/session state, never a persisted enabled default.
- It is reset off before every Live entry, re-entry, and application start.
- Enabling is an explicit action and requires selecting exactly one enabled cue
  track. Shared click/count-in plus that track may then reach Main.
- If the selected track has no events, Main still receives click; it receives no
  cue/announcement content. UI describes the empty track without substituting a
  different one.
- Disabling immediately removes click and cue routes to Main and cancels future
  practice-only cue sources; musical programme continues.
- Route/device failure never turns it on. Reconnection never restores a previous
  on state without a new explicit action.

### Performer route loss

Failure of one private route disconnects or mutes that logical output. It does
not change any Main connection, another performer route, monitor assignment, or
Practice state. Recovery revalidates and reconstructs only the affected route,
then the runtime may mark it ready from fresh evidence.

### Complete device loss

The runtime stops transport, cancels scheduled sources, invalidates every output
activation and physical confirmation, and marks Live blocked/disconnected. It
must not silently select the OS default output. Reconnection is a new validation
and activation attempt against the actual current device capabilities.

### Required private-route chain

For each private content route, readiness and execution refer to one explicit
chain, not separately configured fragments:

```text
canonical click or cue event
  -> logical click or cue:<performerId> lane
  -> graph-plan source/output edge
  -> zero-based Web Audio device channel
  -> zero-based XR18 USB return source
  -> one-based XR18 input strip
  -> strip Main/LR assignment OFF
  -> non-zero send to the intended one-based performer bus
  -> audible bus master / physical aux destination
```

Shared click may send to every validated performer bus. A performer cue lane may
send only to its owner unless an explicit future sharing rule is introduced.
Configuration of the last half does not compensate for a missing first half, and
aggregate bus meter activity does not identify which content produced it.

## Click, count-in, cues, and announcements

All timing is produced by the canonical SongMap schedule. Routing consumes the
schedule; it does not recreate its timing.

- Count-in timing uses top-level SongMap count-in/start-beat data through the
  canonical playback plan. It routes with click.
- Click events follow the canonical beat/grid and transport schedule epoch.
- Cue events use every enabled performer cue track in Live, not an arbitrary
  single `primary` track.
- A disabled cue track produces no cues and no announcement. It is not replaced.
- An enabled track with no matching events remains silent. Missing content is not
  an error unless a project policy explicitly marks it required.
- Seeking cancels pending events from the old epoch and schedules only events
  appropriate after the new position. A seek must not replay an auto announcement.
- Pause cancels future scheduled sources. Resume schedules from the paused
  position without auto announcement.
- Restart from the beginning creates a fresh-start epoch. Auto announcement may
  run according to project mode before count-in/song playback.
- Section repeat reschedules click/cues/MIDI at the loop boundary from the same
  schedule. It does not replay an auto announcement.

### Song announcements

An announcement is an `intro` cue event in a performer cue track, not a global
lane. `CueTrack.performerId`, enable state, voice, text, and output routing all
apply. The project announcement mode controls when intro events fire:

- **Auto:** only on a fresh play/restart from the beginning. Each enabled Live
  performer track fires on its own route. Count-in/song starts after the longest
  active announcement. In Practice, only the selected track fires on Main.
- **Triggered:** an explicit UI/controller command fires eligible intro events
  without moving transport.
- **Off:** neither Auto nor Triggered emits intro events.

For migrated data, absence of an explicit intro may resolve to the song title as
defined by the migration/cue scheduler. An explicit disabled intro means silence
and must not be mistaken for absence. Triggering while an older announcement is
active replaces/cancels it per output; announcements do not stack indefinitely.

## Song and transport changes

| Action | Required behavior |
|---|---|
| Play | Allowed only when Main and song are ready. Starts one schedule epoch. |
| Pause | Preserves position, cancels pending timed sources, leaves global routes intact. |
| Resume | Rebuilds timed sources from preserved position; no Auto announcement. |
| Stop | Stops timed sources and resets position to zero; global device/routes remain. |
| Restart | Cancels current epoch, resets to zero, then follows fresh-start announcement/count-in policy. |
| Seek | Cancels old epoch and resumes/stays paused at exact target; no stale cue may fire. |
| Repeat section | One canonical loop boundary controls audio, click, cue, and MIDI scheduling. |
| Change song while stopped | Prepare separately, dispose old song generation, commit new stopped song at zero. |
| Change song while playing | Prepare separately; when ready, stop old transport, dispose its sources, commit new stopped song at zero. No automatic play or crossfade. |

Song-specific state includes decoded buffers, source nodes, MIDI schedules,
click/count-in schedule, cue/announcement sources, selected section, repeat
intent, and song-scoped errors. None survives the replacement boundary. Device,
validated physical routing, and global output buses may be reused.

## Editor and Mixer audition

Editor/Mixer is an explicit local audition surface:

- Musical lanes use the local Main audition mix.
- Click sounds only when its audition control is enabled.
- Cue audition requires one selected track and an explicit track/preview control.
- Auto/Triggered/Off derives from the same intro events and schedule semantics,
  but output policy is local audition rather than performer routing.
- A single-cue preview is itself consent to sound that cue locally, regardless of
  the track-wide audition toggle.
- Preview selection, gains, mutes, and output choices do not persist into Live
  assignments unless the user performs a separate clearly named project action.
- Editor may discover and audition sources that are absent from the Live source
  plan. Entering Live tears down those preview nodes and rebuilds from the explicit
  Live allowlist; the source is not merely left connected at zero gain.
- Entering Editor does not connect/write XR18. Hardware test/follow actions must
  be separately armed for the current session.

Live and Editor may use different graph plans, but schedule event identity,
timing, count-in, repeat boundaries, transpose, and announcement eligibility are
canonical and shared.

## Invalid and ambiguous assignments

The validator rejects, without activating:

- Main/private device-channel overlap;
- duplicate private channels or duplicate performer XR18 buses;
- channels or buses outside current device/desk capabilities;
- cue tracks with missing/unknown performer ownership when used for Live routing;
- a stereo intent represented by an incomplete/non-adjacent pair;
- unsupported multiple destinations or implicit shared monitor mixes;
- legacy mappings whose zero-based/one-based convention cannot be determined;
- Live source candidates lacking explicit/migrated admission, including orphaned
  assets and Editor-only generated/preview lanes.

An invalid performer assignment fails that performer and degrades Live if Main is
safe. An invalid mapping that compromises Main/private isolation blocks Live.
Persisted data is retained for repair; it is not silently normalized into a
possibly audible route.

## XR18 control versus audio

XR18 OSC is a control connection. USB/Web Audio is the audio connection.

- OSC success alone proves no audio route.
- USB audio may continue when OSC is lost. The runtime freezes new desk writes,
  marks control unverified/degraded, and does not reroute content.
- Actual USB/device loss follows complete device-loss behavior.
- Main safety and monitor-send commands require a session-local arm plus validated
  desired config; a Svelte component cannot issue ad hoc OSC writes.

## Product limits of this contract

Current target performer outputs are mono XR18 buses `1..6`. Shared/stereo
monitor groups and multiple destinations per performer require explicit future
schema and policy; they are not inferred. Software readiness cannot prove a
physical cable, IEM pack, headphone, amplifier, or human audibility.
