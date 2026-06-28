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
| Desktop sidecar and Python jobs | [`domains/desktop-sidecar.md`](domains/desktop-sidecar.md) |
| Chord suggestions | [`domains/chord-suggestions.md`](domains/chord-suggestions.md) |
| `.smap` file format | [`smap-format.md`](smap-format.md) |
| Python auto-setup internals | [`python-auto-setup.md`](python-auto-setup.md) |

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
