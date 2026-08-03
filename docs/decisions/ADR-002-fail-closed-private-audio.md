# ADR-002: Fail-Closed Private Audio

- **Status:** accepted product and safety decision
- **Date:** 2026-08-02

## Context

Click, spoken cues, and song announcements are intended for performers. The
current stereo fallback in `liveOutputMap.ts`/`liveRigPlan.ts` can fold these lanes
into programme/Main when dedicated outputs are unavailable. During a show that can
send private timing instructions to the audience precisely when hardware fails.

## Decision

Private content never falls back to Main because a route is missing, invalid,
disconnected, or capacity-constrained. The affected performer output is silent and
Live becomes degraded. An unsafe/ambiguous mapping that compromises Main isolation
blocks playback.

The only exception is an explicit, session-local Practice action. It starts off on
every Live entry and may route shared click plus exactly one selected cue track to
Main. Reconnect, project load, and prior session state cannot enable it.

## Consequences

- Main is predictable: musical programme only under normal Live policy.
- A performer may lose private content rather than leak it; UI must make that loss
  prominent and identify the route.
- Partial failure is supported: safe outputs continue while failed outputs stay
  silent.
- Validation must understand channel collisions and physical mapping capacity.
- Practice state cannot be persisted as enabled and cannot serve as automatic
  recovery.

## Rejected alternatives

- **Automatic stereo fallback:** convenient for development, unsafe and surprising
  in performance.
- **Fallback only after a warning:** a warning is not consent and may be missed.
- **Persist the Practice toggle:** yesterday's rehearsal choice must not alter
  today's show output.
- **Mute all outputs for one monitor failure:** unnecessary when Main isolation and
  other routes remain proven.
