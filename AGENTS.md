# Agent Guide

This is the operational entry point for BarBro. Keep it short and current;
put domain detail in [`docs/`](docs/).

## Read First

1. Read [`docs/index.md`](docs/index.md).
2. Read [`docs/goal-plan.md`](docs/goal-plan.md) before changing scope,
   maturity, or architecture.
3. Open the domain document for the code you will touch.

Important entry points:

- System shape: [`docs/architecture.md`](docs/architecture.md)
- `.smap`: [`docs/smap-format.md`](docs/smap-format.md)
- Desktop/native work: [`docs/domains/desktop-sidecar.md`](docs/domains/desktop-sidecar.md)
- Cloud/auth/sync: [`docs/domains/cloud-auth-sync.md`](docs/domains/cloud-auth-sync.md)
- Ableton export: [`docs/domains/ableton-als.md`](docs/domains/ableton-als.md)
- Chord suggestions: [`docs/domains/chord-suggestions.md`](docs/domains/chord-suggestions.md)
- Live audio entry point: [`docs/architecture/audio-system-overview.md`](docs/architecture/audio-system-overview.md)
- Live shadow/input boundary: [`docs/architecture/live-audio-shadow-model.md`](docs/architecture/live-audio-shadow-model.md)
- Live architecture review: [`docs/reviews/live-audio-architecture-independent-review.md`](docs/reviews/live-audio-architecture-independent-review.md)
- Programmed Live transitions: [`docs/domains/live-transitions.md`](docs/domains/live-transitions.md)

## Current System

BarBro is a SvelteKit 2 / Svelte 5 application under `src/`. The Electron
desktop service under `desktop/` exposes native jobs and hardware control over
loopback HTTP on `127.0.0.1:47842`. The packaged offline build can also host the
SvelteKit app and opens service/offline windows, so old descriptions of the
desktop process as strictly headless are stale.

Keep these boundaries:

- `src/` does not import Electron internals.
- `desktop/` does not import source modules from `src/`.
- Browser/native feature communication uses explicit loopback HTTP contracts.
- Electron IPC is limited to the desktop service/status shell; it is not a
  second application API for browser features.
- Python tools are spawned by the desktop service, never by browser code.

The worktree is often shared by multiple agents. Preserve changes you did not
make, keep edits scoped, and never use destructive Git cleanup to get a tidy
diff.

## Svelte 5 Rules

Use Svelte 5 runes as the default design, not as optional style guidance.

- Use `$state` only for mutable source state.
- **Always use `$derived` or `$derived.by` for any value that is determined by
  props, stores, or other reactive state.** Do not mirror computed values into
  `$state`, event handlers, subscriptions, or effects.
- Use `$derived.by` when the calculation needs branches, loops, local variables,
  or data shaping. Keep the result pure.
- Do not add `{@const}` in markup. Shape loop/view data in `$derived.by` or a
  pure helper before rendering. Remove nearby `{@const}` when safely touching
  that code.
- Do not use `$effect` for derivation, initialization, state synchronization, or
  reacting to one local value by assigning another. Those are derived values or
  explicit user actions.
- `$effect` is an escape hatch only for an external side effect: browser/media
  APIs, imperative third-party widgets, timers, subscriptions, network/device
  synchronization, or DOM work that cannot be expressed declaratively. Keep it
  narrow and return cleanup for every owned external resource.
- Prefer event handlers, actions, load functions, callbacks, and explicit
  command methods for user-triggered work.
- Keep markup declarative. Put parsing, sorting, filtering, grouping, and view
  model construction in script-level derived state or pure modules.

When reviewing Svelte, treat avoidable `$effect`, `{@const}`, and manually
synchronized computed state as defects.

## Live Audio Safety Stop

Current Live Mode is **not approved for performance use**. The independent
review verdict is **Unsafe to implement as currently specified** and the
pre-implementation correction gate is tracked in
[`docs/goal-plan.md`](docs/goal-plan.md#immediate-priority--live-audio-safety).

Until that gate is closed:

- Do not claim Live Mode, click/cue isolation, performer routing, or readiness
  is gig-safe.
- Do not wire the proposed shadow model into UI status, graph construction,
  hardware writes, or sound.
- Private click, cue, and announcement content must fail closed and may reach
  Main only through explicit session-local Practice output.
- Live source admission must be positive. Mute state, filename guesses, editor
  audition state, and broad track discovery are not permission to play.
- UI configuration and green indicators are not runtime evidence.

Read the complete architecture, contracts, ADRs, scenario matrix, and review
before touching `MixerView`, Live playback, routing, XR18 control, cue/click
scheduling, output devices, or readiness.

### Current gated Live implementation (2026-08-02)

The pure pre-cutover slice is now materially ahead of the independent review,
but the review's **Unsafe to implement** verdict still governs production
cutover. The current authoritative progress is in
[`docs/goal-plan.md`](docs/goal-plan.md#phase-1--pure-contract-slice) and
[`docs/architecture/live-audio-shadow-model.md`](docs/architecture/live-audio-shadow-model.md).

Implemented, with no production consumer:

- [`src/lib/audio/liveAudioRoutingInput.ts`](src/lib/audio/liveAudioRoutingInput.ts)
  solely constructs `LiveAudioShadowInput` from one current snapshot. It does
  not read stores, components, prior graphs, or initialization history.
- [`src/lib/audio/audioConfigValidator.ts`](src/lib/audio/audioConfigValidator.ts)
  solely owns shadow admission, routing decisions, collisions, Practice
  isolation, and configured-only readiness reasons.
- SongMap v7 persists `liveRouting`: stable source intent,
  `sourceId -> mixerChannelId -> processing -> rigSourceLaneId`, performer
  sends, and explicit sum groups. V1-v6 migrate all found producers as excluded
  with no hardware lane until reviewed.
- Stem routing references only stable `stemId`. Local
  `liveStemRefs[stemId] -> relativePath` resolves the asset on this machine and
  is stripped by collaboration code. Old `stemRefs`, filenames, labels,
  ordering, mute/solo, and `liveSlot` cannot grant Live admission.
- `ProjectFile.liveRig.routingProfile` can persist complete Web Audio, USB,
  XR18-strip, Main-policy, monitor-bus, and physical-output topology. Shadow
  construction uses `captureRawProjectRoutingDto()` so malformed values reach
  validation without the normal defensive parser clamping them first.
- The supported persisted producer census is currently: original audio, all
  canonical stems, detected drums, drum machine, detected bass, and bass
  machine. Chord/arp/keybed/jam, preview, and test producers are explicitly
  unsupported or Editor-only until they gain persisted producer state.
- `buildLiveSourceInstallManifest()` and `auditInstalledLiveSources()` define
  the exact generation-owned source set and mark old-song, duplicate, or
  unplanned instances for teardown. They do not perform teardown.

The complete shadow mapping is:

```text
mixerChannelId -> sourceId -> producer/stemId -> local asset availability
  -> channel processing -> rig source lane
  -> Web Audio channel(s) -> USB return(s) -> XR18 input strip(s)
  -> Main policy and performer monitor sends -> bus -> physical output
```

Do not confuse this with runtime completion. Still missing before cutover:

- product commands/UI to review migrated excluded sources and author stable
  source, mixer, stem, and rig-profile assignments;
- the complete pure generation reducer and stale async cancellation commands;
- a repository sentinel for production destination connections outside the
  future executor;
- one authoritative `AudioRuntime`, graph execution, exact installed-set
  acknowledgement, XR18 transaction/readback, readiness UI, and physical QA.

Current verification baseline after this slice:

- `npm run check`: 0 errors, 4 pre-existing Svelte/CSS warnings.
- focused Live/schema/collab/project/Yjs tests: green.
- `npm run test`: 2,144/2,145 green. The one known pre-existing failure is
  `src/lib/audio/laneAlignment.test.ts`: generated lane keys omit `click`.

Do not "fix" that known lane failure as part of Live routing input work unless
the next task explicitly owns click lane alignment. Preserve concurrent dirty
worktree changes and do not wire the shadow input or plan into production UI,
playback, hardware, or readiness as a convenience.

## Persistence Rules

Parsers in `src/lib/songmap/parse.ts` and `src/lib/project/parse.ts` are explicit
whitelists. A type-only change can save successfully and then disappear on
reload.

For every persisted field change:

- update types, parser/migration, serializer if explicit, and validation;
- add a round-trip test that starts from persisted input;
- verify cloud/collaboration filtering and fingerprints where relevant;
- preserve malformed routing evidence when the safety validator needs to
  explain or repair it; do not silently clamp or discard it first.

Project filesystem writes use guarded/atomic helpers. Do not bypass them with
direct convenience writes.

## Commands And Verification

```bash
npm run dev
npm run check
npm run test
npm run test:browser
npm run test:desktop
npm run test:all

npm run dev --prefix desktop
npm run desktop:dist-mac-sync
npm run db:migrate
```

Use the smallest focused test while iterating. Before handing off a production
change, run all four baseline checks and report the command, pass/fail counts,
and known pre-existing failures:

```bash
npm run test
npm run test:browser
npm run test:desktop
npm run check
```

Do not summarize this as only “tests pass.” Audio scheduling, Svelte reactivity,
Web Audio, and component behavior require the Chromium browser project; unit
mocks alone are not proof. Add focused sidecar, script, cloud, or offline checks
when the changed surface has a dedicated suite.

For a defect fix, add a regression test and establish that it fails without the
fix when this can be done without disturbing the shared worktree. Never stash,
revert, or overwrite another agent's changes to manufacture a red run. Assert
that expected objects/events exist before asserting their order or properties.

## High-Risk Areas

- **Live/editor audio:** follow the safety stop above and the target ownership
  docs. No direct `AudioDestinationNode` escape from Live producers.
- **Ableton `.als`:** malformed XML can crash Live. Read the domain guide before
  changing [`src/lib/export/abletonSet.ts`](src/lib/export/abletonSet.ts).
- **Desktop service:** preserve HTTP boundaries and origin checks. Native binary
  and Python assets must be packaged outside `asar` as documented.
- **Supabase:** auth, `access_grants`, RLS, and env-admin access are distinct.
  Service-role clients belong only in trusted server code.
- **Project disk state:** permissions and handles can disappear; keep guarded
  commit/autosave behavior and test reload round trips.

## Documentation And Roadmap

When a change advances or invalidates a roadmap item, update
[`docs/goal-plan.md`](docs/goal-plan.md). Keep [`docs/index.md`](docs/index.md)
accurate when adding or superseding documentation. Material in
[`docs/archive/`](docs/archive/) and documents explicitly marked historical are
context, not instructions.
