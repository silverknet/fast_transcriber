# ADR-003: Canonical Song Scheduling

- **Status:** accepted target decision
- **Date:** 2026-08-02

## Context

Song timing currently spans `songmap/playbackPlan.ts`, `cueTrackSpeechSchedule.ts`,
`MixerView.svelte` effects, `LiveCueScheduler`, `UnifiedTransport`, and fallback
`PlaybackController` instances. Live and Editor can therefore drift in count-in,
seek, repeat, announcement, or cue behavior even when reading the same SongMap.

## Decision

One pure `CanonicalSongScheduler` facade derives transport-aligned musical, click,
count-in, MIDI, cue, and intro-announcement events from the canonical SongMap and
explicit transport command. It builds on existing pure playback/cue helpers rather
than replacing proven timing math.

Scheduling does not know devices, performers' physical channels, XR18, Main, or
Editor/Live policy. Runtime routing decides where supplied events execute. Live and
Editor may route differently, but consume event identities and timing from the same
schedule. Every seek/repeat/song change creates a schedule epoch; stale events are
cancelled and ignored.

## Consequences

- Count-in, click, cue, MIDI, section repeat, and announcement eligibility can be
  tested without Web Audio or hardware.
- Performer cue tracks remain separate event streams; routing maps them later.
- Editor preview uses the same timing without gaining live hardware authority.
- Runtime owns execution/cancellation, not derivation.
- Migration must remove independent component timers once each path consumes the
  canonical schedule.

## Rejected alternatives

- **Separate Live and Editor schedulers:** duplicates the hardest timing rules and
  guarantees behavioral drift.
- **Put routing in the scheduler:** couples pure song logic to mutable hardware and
  makes fail-closed behavior difficult to test.
- **Use one primary cue track globally:** does not support performer-specific cue
  events or announcements.
- **Keep announcement on an independent timer:** breaks seek/restart/repeat epoch
  semantics and cue-track ownership.
