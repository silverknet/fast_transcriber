# Audio Readiness Contract

**Status:** target guarantee. The current `mixerCanPlay`, `liveAudioCache`,
`rigStatus`, `rigHealth`, XR18 response, and configured assignments are evidence
fragments; none is authoritative readiness.

## Status vocabulary

Every output uses exactly these user-facing states:

| State | Meaning | May show green? |
|---|---|---|
| `unconfigured` | No desired assignment exists, or this output is intentionally unused. | No |
| `initializing` | A generation-scoped validation/open/build/activation attempt is in progress. | No |
| `ready` | Every software guarantee for this output is true for the current generations. | Yes |
| `degraded` | The audio route may continue, but nonessential control/readback or optional content evidence is unavailable. | Warning only |
| `failed` | Configuration or activation failed while the device remains known. The route is silent/fail-closed. | No |
| `disconnected` | The active device/route instance disappeared. Prior evidence is invalid. | No |

`connected`, `configured`, `decoded`, `responding`, `prefetched`, and `confirmed`
are evidence labels, not aliases for `ready`.

## Main output readiness

Main is `ready` only when all are true for the current session/config generation:

1. The expected audio device instance is open in the authoritative adapter.
2. Its current capability report contains the full configured Main stereo pair.
3. The validated mapping has no private-channel collision or ambiguous numbering.
4. The graph executor acknowledged construction and activation of the Main bus
   and physical channel connections.
5. The active graph generation matches the desired configuration generation.
6. Main is not muted/disconnected by application policy.
7. No active blocking runtime failure scopes Main or the device.

XR18 OSC/readback is not required to prove the Web Audio graph. If XR18 desk
state is required to maintain Main safety and fresh readback is lost, Main is at
most `degraded`, never `ready`, until current evidence returns. A known unsafe
desk state makes Main `failed` and Live `blocked`.

## Performer output readiness

One performer output is `ready` only when all are true:

1. A known performer has one valid monitor assignment.
2. The desired mapping resolves a logical monitor output, device channel, XR18
   strip(s), one mono XR18 bus, and physical-output description without overlap.
3. The active device exposes every required channel.
4. Main isolation is validated: click and that performer's cue lane have no path
   to Main, and the performer's cue lane sends only to the assigned monitor bus.
5. The shared click and musical monitor-send graph for that performer was built.
6. The executor acknowledged route activation for the current config generation.
7. The application route is unmuted and has no output-scoped failure.
8. When desk state is part of the route, the latest required XR18 write/readback
   contract is current. Loss of readback may make the route `degraded`; known
   contradictory desk state makes it `failed`.
9. For click and cue content, the same active generation identifies the canonical
   event lane, Web Audio output channel, XR18 USB return source, input strip,
   Main-off assignment, non-zero send to this performer's bus, and active bus
   master. No link is inferred from a neighbouring/default channel.

A disabled or empty cue track does not fail the performer output: that content is
intentionally silent. A missing required performer assignment is `unconfigured`
and causes Live degradation when the roster expects that performer.

An XR18 aux-bus meter above threshold is evidence that some signal is leaving the
bus. It does not prove that click is present, that the correct performer's cue is
present, or that another performer's cue is absent. Route-specific graph/readback
evidence and a content-specific test are required for those claims.

## Practice readiness

- `off` is the normal neutral state and is always the initial Live state.
- `initializing` means the explicit action selected one enabled cue track and the
  runtime is adding click plus that track to Main.
- `ready` means those connections were activated against the current Main graph.
- `failed` means the route was not activated; Practice returns off and private
  content stays out of Main.
- Practice cannot be ready unless Main is ready or degraded-but-audible.

Practice is not a substitute for failed performer readiness and never turns on
automatically.

## Song readiness

A song is `ready` only when:

- its current generation is the active generation;
- the installed Live source-ID set exactly equals the exhaustive
  `ValidatedLiveSourcePlan`; excluded/unassigned candidates have no attached
  graph nodes or output edges;
- the SongMap parsed/migrated and the canonical schedule was produced;
- every required programme source is loaded/decoded;
- optional source omissions are recorded explicitly;
- required click/cue/MIDI assets for enabled output policy are prepared or have
  an intentional runtime generation path;
- song source nodes and schedule epoch can be created against the active graph;
- no blocking song failure remains.

Setlist metadata and `liveAudioCache` prefetch are not song readiness. A missing
optional stem degrades that lane/song presentation but does not block if a valid
programme source remains. Missing all required musical programme blocks playback.

## Live Mode readiness

| Live state | Exact condition | Playback |
|---|---|---|
| `initializing` | Device/config/song/output activation is not settled. | Disabled |
| `ready` | Main and song are ready; every configured/required performer output is ready. No performers configured is valid Main-only ready. | Allowed |
| `degraded` | Main and song are usable, isolation remains proven, but one/all performer routes or nonessential control/readback is degraded/failed/unconfigured. | Allowed with persistent prominent warning |
| `blocked` | Main, device, required song programme, or a mapping affecting Main/private isolation is unavailable/unsafe/ambiguous. | Disabled or immediately stopped |

This is explicitly partial, not all-or-nothing. The product does not lie that
the whole rig is ready when P3 has failed, and it does not unnecessarily silence
safe Main/P1/P2 paths.

### Three-performer example

| Output | State | Audible content |
|---|---|---|
| Main | `ready` | Musical programme only |
| P1 | `ready` | P1 monitor mix, shared click, P1 cue/announcement events |
| P2 | `ready` | P2 monitor mix, shared click, P2 cue/announcement events |
| P3 | `failed` | Silence; nothing falls back to Main/P1/P2 |
| Live | `degraded` | Playback allowed with persistent P3 warning |

## What green does and does not guarantee

Green guarantees current software evidence for the exact active device, graph,
route, configuration, and song generation. It may guarantee that Web Audio nodes
are connected and samples are scheduled/written to a device channel. With fresh
OSC readback it may also guarantee the requested XR18 parameters were observed.

It cannot guarantee:

- that a USB cable carries uncorrupted audio beyond the host;
- an XR18 analogue output, cable, transmitter, IEM pack, or headphones work;
- a performer has the pack on, volume up, or can hear the signal;
- venue patching matches its label;
- acoustic loudness or mix quality is acceptable.

Those require a manual test and human confirmation.

## Manual physical verification

1. Runtime must already show the software route as ready/degraded with a valid
   target. The operator explicitly starts a route-specific test signal.
2. Runtime records active test-source scheduling and, when available, current
   output/desk meter evidence.
3. The named performer confirms hearing the correct signal in the correct
   destination. The operator records a session-local confirmation for the exact
   route identity and device/config generation.
4. UI may show **physically confirmed this session** separately from software
   readiness. It is never persisted as permanent proof.

Confirmation is invalidated by application restart, Live re-entry, audio-device
instance change, OSC/desk reconnect that may reset state, channel/bus mapping
change, route reconstruction, or failed test. Pause/song change alone does not
invalidate unchanged global route confirmation.

## Failure and recovery

- Every failure includes scope, cause, operation, generation, and whether retry
  is meaningful. Absence of an error is not positive evidence.
- A failed performer route is muted/disconnected and retried independently.
- Main/device/isolation failure stops transport and blocks until fresh validation
  and activation succeeds.
- OSC loss freezes control writes and invalidates stale readback. Known audio can
  continue degraded; no routing is guessed.
- Recovery always returns through `initializing`; no state jumps directly from
  `failed`/`disconnected` to `ready` on a timer or UI click.
- Manual confirmation does not restore software readiness and software recovery
  does not restore manual confirmation.

## Current evidence gaps

The current implementation cannot honestly emit these green guarantees because:

- `audioDevice.ts` has no selected-device identity/capability lifecycle snapshot;
- `outputDevice.ts` and `multichannelProbe.ts` inspect throwaway contexts rather
  than the active playback context;
- production `MixerEngine` routing does not consume the complete project rig plan;
- `MixerView.loadAndRegisterTracks()` installs broad candidate lanes and uses
  initial mute state rather than an exhaustive Live source allowlist;
- `new MixerEngine()` falls back to `liveOutputMap()`, whose default maps song,
  click, and cue to the same stereo Main pair;
- current XR18 setup does not bind click/cue Web Audio channels, USB return
  sources, desk strips, bus sends, and bus meters into one acknowledged generation;
- Live monitor presentation hard-codes click strip 11 while the current route
  defaults put click on strip 15;
- OSC control, rig setup, mixer graph, and route status have separate owners;
- the app has no single generation-tagged acknowledgement of active output routes.

Until implementation reaches this contract, UI must describe narrower evidence
(`prefetched`, `OSC responding`, `configured`, `test confirmed`) rather than
calling an output ready.
