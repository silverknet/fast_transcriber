# ADR-001: Authoritative Audio Runtime

- **Status:** accepted target decision
- **Date:** 2026-08-02

## Context

Actual playback state is currently distributed across `MixerView.svelte`,
`MixerEngine`, `UnifiedTransport`, `WaveformPlayer`, module-global
`audioDevice.ts`, UI-owned XR18 components, and stores such as `rigStatus` and
`liveAudioCache`. These values describe different evidence and lifecycles. A UI
component can currently infer success without one owner acknowledging the active
device, graph, song, and route generation together.

## Decision

One app-level `AudioRuntime` is the sole authority for actual audio runtime state.
It owns lifecycle command ordering, canonical transport position, active graph and
song identities, generation handling, route health, structured failures, and the
immutable snapshot consumed by UI.

The runtime commands narrow executors/adapters:

- `AudioDeviceAdapter` opens and observes one device/context;
- `MixerEngine` executes an already validated graph plan;
- `SongResourceLoader` prepares cancellable resources off graph;
- cue/MIDI executors schedule supplied canonical events;
- sidecar `XAirSession` owns OSC connection facts and serialized commands.

Repositories own persisted intent. Pure validators/schedulers own transformations.
UI requests commands and observes snapshots. None may declare runtime success.

## Consequences

- Runtime state is session-local, immutable to observers, and generation-tagged.
- Components become replaceable views instead of lifecycle owners.
- Device, song, graph, and output cleanup has one coordinator and explicit workers.
- Tests can drive a reducer/runtime with fake ports and prove stale completion,
  partial failure, and cleanup.
- Migration must be incremental; creating a second runtime beside current owners
  without retiring their authority would worsen the problem.

## Rejected alternatives

- **A shared collection of Svelte stores:** stores do not establish side-effect
  ordering, atomic graph activation, or cleanup ownership.
- **MixerView as authority:** component mount/navigation is not a reliable audio
  lifecycle and Editor/Live would still diverge.
- **MixerEngine owns policy and state:** a graph executor should not read project
  persistence, choose privacy fallback, control XR18, or project UI labels.
- **Sidecar owns all audio:** current audio playback is Web Audio and moving it is
  a separate product/engineering decision, not required for single authority.
