# Documentation Index

This is the map for humans and agents. If you are new to the repo, start with
the short files first and open domain docs only when you touch that area.

## First Read

| File | Use |
|---|---|
| [`../AGENTS.md`](../AGENTS.md) | Agent operating guide, commands, current conventions, danger zones. |
| [`architecture.md`](architecture.md) | Current system shape and ownership boundaries. |
| [`goal-plan.md`](goal-plan.md) | Roadmap/maturity snapshot. Update when work advances a listed item. |
| [`regression-checklist.md`](regression-checklist.md) | Manual smoke checklist after migrations or broad UI changes. |

## Domain References

| Domain | File |
|---|---|
| Ableton `.als` export | [`domains/ableton-als.md`](domains/ableton-als.md) |
| Cloud auth, invites, Supabase sync | [`domains/cloud-auth-sync.md`](domains/cloud-auth-sync.md) |
| Collaborative sync — **target** architecture (CRDT/Yjs) | [`domains/collab-sync-architecture.md`](domains/collab-sync-architecture.md) |
| Desktop sidecar and Python jobs | [`domains/desktop-sidecar.md`](domains/desktop-sidecar.md) |
| Desktop vs browser — capability split & audio failsafe | [`domains/desktop-vs-browser.md`](domains/desktop-vs-browser.md) |
| Hardware control / live rig | [`domains/hardware-control.md`](domains/hardware-control.md) |
| Programmed live transitions (current development path) | [`domains/live-transitions.md`](domains/live-transitions.md) |
| Offline mode — the no-login desktop build and how it syncs back | [`offline-mode.md`](offline-mode.md) |
| Chord suggestions | [`domains/chord-suggestions.md`](domains/chord-suggestions.md) |
| AI chord/section pipeline (for agents) | [`domains/ai-chord-pipeline.md`](domains/ai-chord-pipeline.md) |
| `.smap` file format | [`smap-format.md`](smap-format.md) |
| Python auto-setup internals | [`python-auto-setup.md`](python-auto-setup.md) |

## Live Audio Authority

Start with the overview, then the independent review and the Phase 0 gate in
[`goal-plan.md`](goal-plan.md#immediate-priority--live-audio-safety). The safety
invariants and ADR direction are accepted, but the current target specification
is **not implementation-ready**: its latest review verdict is **Unsafe to
implement** until the listed contract and product-decision blockers close.

| Purpose | File |
|---|---|
| Entry point, target flow, current audit, current-versus-target map | [`architecture/audio-system-overview.md`](architecture/audio-system-overview.md) |
| Independent architecture verdict, blockers, and required corrections | [`reviews/live-audio-architecture-independent-review.md`](reviews/live-audio-architecture-independent-review.md) |
| Ordered correction and implementation gates | [`goal-plan.md`](goal-plan.md#immediate-priority--live-audio-safety) |
| One primary owner for every audio responsibility | [`architecture/audio-module-ownership.md`](architecture/audio-module-ownership.md) |
| Implemented pure Live routing shadow, canonical current-state input, and diagnostics boundary | [`architecture/live-audio-shadow-model.md`](architecture/live-audio-shadow-model.md) |
| Persisted, desired, runtime, and UI state planes | [`architecture/audio-runtime-state.md`](architecture/audio-runtime-state.md) |
| Observable Live/Editor behavior and safety invariants | [`contracts/live-editor-routing.md`](contracts/live-editor-routing.md) |
| Exact meaning of output and Live readiness | [`contracts/audio-readiness.md`](contracts/audio-readiness.md) |
| Enter/load/play/switch/failure/shutdown lifecycle | [`contracts/playback-lifecycle.md`](contracts/playback-lifecycle.md) |
| Authoritative audio runtime decision | [`decisions/ADR-001-authoritative-audio-runtime.md`](decisions/ADR-001-authoritative-audio-runtime.md) |
| Fail-closed private audio decision | [`decisions/ADR-002-fail-closed-private-audio.md`](decisions/ADR-002-fail-closed-private-audio.md) |
| Canonical song scheduling decision | [`decisions/ADR-003-canonical-song-scheduling.md`](decisions/ADR-003-canonical-song-scheduling.md) |
| Scenario matrix and XR18 verification | [`testing/live-performance-scenarios.md`](testing/live-performance-scenarios.md) |

`audio-architecture-review.md`, `audio-refactor-roadmap.md`,
`live-rig-plan-review.md`, and `xr18-foh-safety.md` are historical audits/plans,
not current behavioral or ownership authority.

## Local README Islands

These stay next to the code they describe:

- [`../desktop/README.md`](../desktop/README.md) — sidecar dev, release, browser support, endpoints.
- [`../desktop/native/python/README.md`](../desktop/native/python/README.md) — Python script layout and manual smoke tests.
- [`../static/releases/README.md`](../static/releases/README.md) — local static desktop installer artifacts.

## Archive

[`archive/`](archive/) contains stale handovers and session notes. They are
kept for archaeology only. Prefer current docs and source code.

## Maintenance Rules

- Keep [`../AGENTS.md`](../AGENTS.md) short.
- Put deep implementation notes in `docs/domains/`.
- Do not link to private local paths such as `~/.claude/...` as required context.
- Prefer stable claims over exact transient counts unless the count is generated
  by a command shown nearby.
