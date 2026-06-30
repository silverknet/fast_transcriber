# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Required reading

- **[AGENTS.md](AGENTS.md)** — operational on-ramp. Commands, current shape, Svelte 5 style rules, high-risk areas. Don't skip it.
- **[docs/index.md](docs/index.md)** — documentation map; the domain docs there are how you avoid wasting a session on stale assumptions.
- **[docs/goal-plan.md](docs/goal-plan.md)** — roadmap + feature-maturity ledger. Read BEFORE changing feature maturity or architecture; update WHEN you do.
- **[HANDOFF_FOR_CODEX.md](HANDOFF_FOR_CODEX.md)** — playback-engine architectural rules + the three sync bugs documented as load-bearing tests. Read before touching `src/lib/audio/playbackController.svelte.ts`, `src/lib/songmap/playbackPlan.ts`, or `src/lib/components/WaveformPlayer.svelte`.
- **[AGENT_NOTES.md](AGENT_NOTES.md)** — running scratchpad. Append your own notes; don't delete others' unless explicitly stale.

Domain deep-dives (consult the one that matches what you're touching):

- [docs/domains/ableton-als.md](docs/domains/ableton-als.md) — `.als` XML structure, setlist export, alignment math.
- [docs/domains/desktop-sidecar.md](docs/domains/desktop-sidecar.md) — sidecar boundary, endpoints, project I/O.
- [docs/domains/chord-suggestions.md](docs/domains/chord-suggestions.md) — chroma analysis + per-bar chord suggestions.
- [docs/domains/cloud-auth-sync.md](docs/domains/cloud-auth-sync.md) — Supabase auth, project sync, share links.
- [docs/smap-format.md](docs/smap-format.md) — `.smap` binary container + JSON envelope.

## Commands

```bash
npm run dev                          # http://localhost:5173 (web app)
npm run dev --prefix desktop         # 127.0.0.1:47842 (Electron sidecar; required for analyze + stems)
npm run check                        # svelte-check; expect 0 errors at HEAD

npm test                             # unit project only (~2s, ~350 tests)
npm run test:watch                   # unit project, watch
npm run test:browser                 # browser project — real Chromium via Playwright
npm run test:all                     # both projects
npx vitest run path/to/spec.test.ts  # single file

npm run db:up && npm run db:migrate  # local Postgres (port 5433) for editor_sessions
npm run desktop:dist-mac-sync        # build mac-arm64 DMG + sync into static/releases
```

Vitest is split into two projects in [vite.config.js](vite.config.js):

- **unit** (Node env) — includes `*.test.ts` and excludes `*.browser.test.ts`. Fast, mocked `AudioContext`, used for algebra + helpers + property-based tests (`*.property.test.ts` via `fast-check`).
- **browser** (real Chromium via `vitest-browser-svelte` + Playwright) — runs `*.browser.test.ts`. Chromium is launched with `--autoplay-policy=no-user-gesture-required` so `audio.play()` resolves without a synthetic gesture. `bits-ui` and `@lucide/svelte` are excluded from the optimizer because they ship unbundled `.svelte` files esbuild can't load.

The browser suite is the regression catcher for everything mocks can't see: real `$effect` graph ordering, real `AudioBufferSourceNode` scheduling, real `audio.play()` lifecycle.

## Architecture invariants (don't break these)

1. **`.smap` is the root of truth.** Every observable in the editor — bars, beats, chords, sections, count-in, song-start anchor, spoken intro, click positions, Ableton play-ranges — is **derived** from `.smap` fields. The runtime layer is a thin lens. If you find yourself adding a "bridge" between two pieces of state, you've drifted from the architecture.
2. **`$derived` everywhere, `$effect` almost nowhere.** Use `$effect` ONLY to sync reactive state into non-reactive sinks (DOM elements, Web Audio nodes, rAF loops, event listeners). Anything computable from other reactive state must be `$derived`. Bridging two `$state`s via `$effect` is the anti-pattern; it's been the source of several historical bugs.
3. **One timing function: `songPlaybackPlan(sm)`** in [src/lib/songmap/playbackPlan.ts](src/lib/songmap/playbackPlan.ts). Every consumer — live `PlaybackController` click loop, offline cue/click WAV renderers, Ableton orchestrator, mix builder — projects from this single source. Don't add a second derivation of "where do clicks land". The Ableton parity property test (`playbackPlan.property.test.ts > "Ableton parity"`) locks `songTimings(sm)` as a projection of `songPlaybackPlan(sm)` — if it fails you've drifted them.
4. **Editor and Ableton stay in lockstep.** What you hear in grid IS what the exported `.als` plays. `songTimings(sm)` in `src/lib/export/setlist/timings.ts` must remain a projection of `songPlaybackPlan`; do not reimplement it.

## Playback engine specifics

The grid editor's audio is **buffer-based**, mirroring `MixerEngine`: the song plays as `AudioBufferSourceNode.start(ctxTime, offset)` against the same `AudioContext` that hosts the click oscillators. There is one clock (`ctx.currentTime`) and one output latency. By construction, song and clicks cannot disagree.

- `PlaybackController.setAudioBuffer(buf)` is REQUIRED before `play()`. The host (`WaveformPlayer`) decodes once for waveform peaks and passes the same `AudioBuffer` to the controller via `$effect`.
- `setAudioElement(el)` is kept as a back-compat shim only; the controller does NOT use the audio element for playback.
- Playback position derives purely from `playStartPositionSec + (ctx.currentTime - playStartCtxTime)`. Never read `audioEl.currentTime` from the play path — that's how dual-clock drift gets reintroduced.
- Count-in: pre-schedule N oscillators at `ctxStart + c.timeSec` (negative offsets) and start the source at `ctxStart`. No `setTimeout`-deferred `play()`, no pause-and-resume race.
- `mediaTimeOffsetSec` translates buffer time ↔ plan-time. For grid editor, `offset = plan.trimStartSec` (buffer is the full uploaded file).

## Pitfalls that have burned previous sessions

- **Mixing original-time and trim-shifted time.** Always declare which time base a number is in and convert at the boundary. `plan.clickPoints[].timeSec` is trim-shifted; `firstDownbeatOriginalSec` is original-time. Don't pass one where the other is expected.
- **User-facing copy mentioning internals.** No "Python", "venv", "downloads N MB", "one-time install", "snapshot", "baseline" in any UI string. Use concrete user-language: "analyzed grid", "your bar and beat edits", "the song title".
- **`$effect` as a state bridge.** If a Svelte 5 `bind:` already gives you two-way reactivity to a `$state` field, do NOT add a `$effect` to also sync it. The combination has caused "play does nothing" bugs because the effect tracked the wrong dependency.
- **Big atomic rewrites of working code.** Migrations land in incremental phases that each leave the app functional. Add the new path as optional first, verify in browser, then delete the old one. There's a track record of "Phase A, B, C, D" commits for a reason.
- **Skipping browser verification.** Unit tests are mocked. For UI/audio changes, run `npm run dev` and click through. If you can't verify in your environment, say so explicitly — don't claim done.
- **Committing unrelated working-tree changes.** The repo often has changes from other branches/sessions sitting uncommitted (admin routes, docs, `.gitignore`, `AGENTS.md` tweaks). Stage only the files you actually touched.

## Repo structure (high-level)

- [src/lib/songmap/](src/lib/songmap/) — `.smap` schema, validation, merge, plan derivation, edit helpers, undo/redo store.
- [src/lib/audio/](src/lib/audio/) — `PlaybackController` (buffer-based), `MixerEngine`, click track rendering, cue/speech scheduling, waveform peaks, time geometry.
- [src/lib/components/](src/lib/components/) — `WaveformPlayer.svelte` (the editor surface), `TimelineBeatGrid.svelte` (bar strip), `MixerView.svelte`, shadcn primitives.
- [src/lib/export/](src/lib/export/) — Ableton `.als` writer + setlist orchestrator. The setlist subdir splits into [`timings.ts`](src/lib/export/setlist/timings.ts) (pure clip-range math), [`clickRender.ts`](src/lib/export/setlist/clickRender.ts) (shared with the mixer), [`preflight.ts`](src/lib/export/setlist/preflight.ts) (read-only readiness check), and [`orchestrator.ts`](src/lib/export/setlist/orchestrator.ts) (end-to-end pipeline). Cross-module alignment is locked by [`sync.test.ts`](src/lib/export/setlist/sync.test.ts) and `playbackPlan.property.test.ts > "Ableton parity"` — both must stay green.
- [src/routes/edit/+page.svelte](src/routes/edit/+page.svelte) — the editor page (~2k lines). Hosts the `PlaybackController` and the grid/sections/chords/cue tabs.
- [src/routes/analyzing/+page.svelte](src/routes/analyzing/+page.svelte) — beat-detection flow via desktop sidecar.
- [desktop/](desktop/) — Electron sidecar (loopback HTTP `127.0.0.1:47842`). Headless. **No imports between `src/` and `desktop/` in either direction.** Read [docs/domains/desktop-sidecar.md](docs/domains/desktop-sidecar.md) before touching.
- [db/migrations/](db/migrations/) — Supabase/Postgres schema; run via `npm run db:migrate`.

## Roadmap discipline

When work meaningfully advances or completes a listed roadmap item, update [docs/goal-plan.md](docs/goal-plan.md) — bump `Lvl`, tighten `Notes`, adjust detail bullets. Future agents depend on this being honest. Per [AGENTS.md](AGENTS.md), read `docs/goal-plan.md` BEFORE changing feature maturity or architecture.
