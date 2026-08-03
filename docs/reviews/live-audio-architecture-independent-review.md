# Independent review: proposed Live audio architecture

Date: 2026-08-02  
Scope: architecture and live-safety review only  
Evidence base: the current working tree, including its uncommitted architecture, contract, implementation, and test files

## Verdict

**Unsafe to implement.**

This verdict applies to the proposal *as a complete implementation specification*, not to its safety direction. The target architecture makes the right high-level choices: one runtime authority, fail-closed routing, a positive source allowlist, generation-scoped prepare/commit/cleanup, canonical scheduling, and evidence-based readiness. It is materially safer than the current runtime.

The proposal is not yet internally closed enough to implement safely. Its first slice would validate concepts whose authoritative inputs are absent, ambiguous, or destroyed by current parsers. It also omits several real Live sound producers that bypass the proposed executor. In one central diagram it conflates a performer monitor destination bus with a source channel. Those are contract defects, not merely missing implementation.

The proposed first slice becomes safe after the blocking corrections in findings F-01 through F-06 are made in the target documents. No production audio behavior needs to change to make those corrections.

## Executive summary

The strongest part of the proposal is its safety invariant: no Live sound should exist outside an admitted, generation-owned plan, and the UI must not infer readiness from configuration intent. The current code provides ample evidence that these constraints are necessary. Today, `MixerView` discovers broadly and then uses mute state as admission; the default graph sends song, click, and cues to the same stereo destination; XR18 configuration assumes separate desk inputs that the Web Audio graph does not produce; several green indicators describe only fragments of the path; and lifecycle work is not transactionally owned.

The proposal nevertheless has six blockers before its pure-model first slice:

1. There is no canonical persisted Live source-assignment model from which `ValidatedLiveSourcePlan` can be derived. `mixState.liveSlot` is a controller-link field and still falls back to filename inference.
2. The source census does not explicitly include the Live keybed synth and chord-jam keys, bass, and arpeggiator. These can connect directly to the shared audio destination, outside `MixerEngine`.
3. The runtime-state mapping incorrectly gives a performer monitor destination its own Web Audio channel and XR18 input strip. Source lanes need those coordinates; an XR18 aux bus aggregates sends from source strips.
4. “Installed source set exactly equals the plan” conflicts with allowed optional-source omissions. The proposal needs separate candidate, admitted, and resolved-install sets.
5. The proposal requires invalid saved routing to remain visible, but the current project parser filters, rounds, and clamps it before a validator could diagnose it.
6. A new unused validated model is permitted as a first slice while ADR-001 rejects a second runtime truth. That can be safe only as an explicitly contract-only shadow artifact with provenance/parity fixtures, no UI or runtime authority, and an already-defined cutover owner.

The target documents also need sharper readiness language. Graph construction and XR18 readback can prove configured topology; they cannot prove that unique click or cue content reached a performer or that a physical output is audible. Those require scheduled-source evidence, metering or a unique test signal, and ultimately a human check at the physical output.

## Five most important findings

| ID | Severity | Finding | First-slice effect |
| --- | --- | --- | --- |
| F-01 | Critical | The positive Live source plan has no canonical persisted input or complete migration rule. | Blocks |
| F-02 | Critical | Real-time Live synth producers can bypass the proposed source plan and graph executor. | Blocks |
| F-03 | High | The target monitor mapping confuses source-channel routing with destination-bus ownership. | Blocks |
| F-04 | High | Exact-set readiness contradicts optional omission semantics. | Blocks |
| F-05 | High | Current parsing erases invalid routing evidence that the target validator is required to report. | Blocks |

## What the target architecture gets right

The following target rules are supported by the code audit and should be retained:

- A single `AudioRuntime` should own Live and Editor audio and enforce mode transitions. The current mixture of a shared `AudioContext`, a module-level Editor transport, per-view mixer engines, and separate synth hosts makes ownership implicit.
- Live needs positive source admission, not broad discovery followed by muting. A zero gain value does not remove a node, timer, instrument, MIDI response, or routing side effect.
- A route must be modeled end to end: logical source, Web Audio channel, USB channel, XR18 input strip, LR state, aux-bus send, bus master, and physical output.
- Private outputs must fail closed. Click and performer cue/announcement content must never fall back to Main when an isolated path is unavailable.
- Prepare and commit must be generation-scoped. Stale asynchronous work must be unable to install nodes, overwrite readiness, or dispose the next song's resources.
- Musical and spoken events should share one canonical schedule and transport clock.
- Readiness needs exact evidence and reason codes, not optimistic booleans.
- Manual physical confirmation must remain distinct from automated graph and hardware evidence.
- The first implementation slice should be pure, exhaustively tested, and produce no sound.

These are appropriate governing constraints. The corrections below make them implementable against BarBro's actual data and call paths.

## Current end-to-end evidence

### 1. Musical source discovery to Main and monitors

The current Live path is:

`project/playback/+page.svelte` mounts `MixerView(liveMode=true)`

→ `MixerView.loadAndRegisterTracks()` constructs a plan containing the original mix, every best local stem, every cloud stem, rendered click, generated drums, drum machine, generated bass, bass machine, and conditionally chord lanes

→ every constructible item is passed to `MixerEngine.setTrack()`

→ Live admission is represented mainly by initial mute state from `liveSlotLinks`, project stem defaults, and saved lane mute state

→ `MixerEngine.play()` creates a source for every registered buffer track, including muted tracks

→ because `MixerView` constructs `new MixerEngine()` without the target layout, `resolveLiveOutputMap()` normally uses the local-storage compatibility mapping, whose default maps song, click, and cue to channels `[0, 1]`

→ the shared stereo master reaches `AudioContext.destination`.

Relevant implementation points include:

- `src/lib/components/MixerView.svelte`, especially `loadAndRegisterTracks`, its load-plan construction, `engine.setTrack`, `initialMutedFor`, and the unparameterized `new MixerEngine()` in `onMount`.
- `src/lib/hardware/liveSlotLinks.ts`, where an absent explicit link falls back to filename matching.
- `src/lib/audio/liveStemDefaults.ts`, where a custom stem is generally audible unless treated as a vocal.
- `src/lib/audio/mixerEngine.ts`, where `setTrack` chooses the click bus only if a split layout exists and `play` creates sources for registered tracks.
- `src/lib/audio/liveOutputMap.ts`, whose compatibility default maps all categories to the stereo output.

This is not positive admission. It is broad registration with later gain policy. It also means the XR18 UI can configure distinct musical strips and bus sends while the browser is actually delivering a stereo program pair.

### 2. Click from SongMap to Web Audio, XR18, and performer output

The musical playback plan derives count-in and click events from `SongMap`. `renderClickTrackData()` renders that schedule to a buffer, using the primary cue track when calculating prelude timing. `MixerView` registers the result as the `click` track and `MixerEngine` schedules it alongside the musical tracks.

In the currently instantiated graph, click does not receive an isolated destination. It falls into the same program bus and stereo destination as music. The separate `LiveCueScheduler` is likewise constructed with the mixer cue output if one exists, otherwise the unshifted/program input.

The hardware side does not complete the missing link:

- The `/rig` USB-input operation assigns the selected stereo pair to USB 1/2.
- `xairUsbInput.ts` can describe a four-lane USB plan, but that plan is not the active end-to-end Live setup transaction.
- `XAirSettingsPanel.svelte` writes fader, mute, LR, and bus-send settings but does not program the XR18 USB return source/channel mapping needed to turn Web output channels into the assumed input strips.
- Default desk-strip constants put click and cue at strips 15 and 16, while other musical sources can also occupy those strips.

Consequently, the current chain is proven only as far as “a rendered click buffer is scheduled into the browser's shared stereo output.” It is not proven as `click → dedicated Web channel → USB channel → dedicated XR18 strip with LR off → each performer bus → physical output`.

The Live monitor strip further hard-codes song strips 9/10 and click strip 11. Those numbers do not correspond to the default XR18 route plan or the actual browser graph. Its meters therefore cannot establish content identity or the proposed end-to-end mapping.

### 3. Performer cue and announcement routing

`CueTrack.performerId` exists in `SongMap`, is parsed, and survives serialization. Execution does not currently use it to choose a cue lane, Web channel, XR18 strip, or performer bus.

The active path selects one primary track (`first enabled`, otherwise `first`) through `getPrimaryCueTrack()`. Section cue specs, rendered cue data, and announcements are derived from that track and played through one `LiveCueScheduler` with one fixed destination. `MixerView` does not fan cues out by performer.

The spoken-intro fallback also violates a target distinction. `resolvedSpokenIntroText()` finds an enabled intro and otherwise returns the song title. Thus an explicitly disabled intro can become indistinguishable from an absent intro and can still cause title speech. The project-default helper can remove a generated intro and store suppression-related state, but the target documents do not define the canonical persisted distinction or its migration.

Today, therefore, the real path is:

`primary CueTrack → one rendered/scheduled cue or announcement → shared cue destination → normally Main`.

The proposed per-performer path is sound, but it needs an executable mapping from each event's `performerId` to a source cue lane and then to the owning destination bus. The destination bus itself must not be modeled as the source channel.

### 4. Editor, Live entry, song change, leave, loss, and reconnect

Editor audio is hosted by a module-level `UnifiedTransport`. The edit page configures and loads it and generally pauses it on view changes and destruction; it does not dispose the underlying mixer graph. `UnifiedTransport.#ensureEngine()` creates its own `MixerEngine`, and its click gain can connect directly to the destination.

Entering Live therefore destroys the Editor view and pauses its singleton, but does not demonstrate complete graph teardown before the Live engine is installed. The target's one-runtime mode transition is necessary.

Live song loading also lacks generation ownership:

- `openSong(songId)` blocks only a duplicate request for the same song. Different-song requests can overlap.
- hydration publishes `SongMap` and audio-session state before the route commits the new active-song ID, exposing intermediate store combinations to effects.
- `MixerView` serializes destructive reloads but does not cancel or invalidate stale asynchronous work. A previous load can finish before the queued replacement and install an obsolete state window.
- asynchronous click, cue, and announcement rendering is not uniformly tied to a generation that is invalidated on component destruction.
- `MixerEngine.dispose()` stops sources and disconnects some nodes, but bypasses `removeTrack()`'s per-instrument disposal path and does not explicitly tear down the entire internal bus/effect/output graph.

Device lifecycle is not yet a runtime fact. `audioDevice.ts` owns a shared `AudioContext`, but no production path establishes a stable sink identity, `devicechange` reaction, `AudioContext.statechange` policy, or sink-switch transaction. The capability probe uses a throwaway context and therefore is not proof about the active Live graph.

OSC lifecycle is similarly partial. A local socket can be “connected” while `lastMessageAt` is stale. Current UI code often reduces desk reachability to the presence of any historical reply. There is no active-generation evidence lease or automatic safe reconnect/reapply transaction.

The target lifecycle contract addresses the correct failure modes. It should add exact cleanup-command semantics to the first reducer contract so stale-resource disposal is not left as an informal side effect.

### 5. Hardware and graph evidence to visible readiness

Current visible readiness has several independent meanings:

- `MixerView` considers playback possible when it is not loading, has no load error, and has at least one lane.
- The playback setlist's “Ready — instant switch” dot is based on the local audio cache.
- `rigHealth` can be green from desk identity, a USB stereo-pair check, click/cue route naming and LR state, and the existence of at least one monitor assignment.
- `XAirSettingsPanel` treats any historical reply timestamp as desk evidence and presents a “House safe” result based on route readback.
- `/rig` has a separate checklist whose aggregate passes when checks are passed *or skipped*.
- The monitor strip presents meters with hard-coded channel identities.

None of those incorporates the current song generation, exact admitted source set, active Web graph, active sink, actual USB/strip mapping, performer-specific cue route, fresh XR18 evidence, and manual physical output confirmation. Several can be green simultaneously for mutually incomplete facts.

The target's readiness model is therefore warranted. It must, however, name the level of evidence precisely: configured, scheduled, electrically observed, or physically confirmed.

## Prioritized findings

### F-01 — No canonical input exists for positive Live source admission

**Severity:** Critical

**Affected target rule:** Routing contract: exhaustive positive source allowlist and explicit or deterministically migrated assignments. Module ownership: `ValidatedLiveSourcePlan` as the first-slice input/output. Runtime-state model: one validated configuration derived from persisted inputs.

**Current implementation evidence:** `SongMap.mixState.liveSlot` is described and used as a Live controller/button slot. `resolveLaneSlot()` in `src/lib/hardware/liveSlotLinks.ts` falls back to filename classification when an explicit link is absent. `MixerView.loadAndRegisterTracks()` discovers originals, local and cloud stems, generated parts, machines, and optional chord lanes independently of that field. `ProjectDefaults.liveStems` names four Demucs-style classes and does not enumerate arbitrary imported, cloud, generated, or machine sources. Neither `src/lib/songmap/types.ts` nor `src/lib/project/types.ts` defines an exhaustive persisted Live source manifest with stable source identity, requiredness, destination category, and migration provenance.

**Why this is dangerous:** A validator cannot prove positive intent from a field that means controller linkage plus filename inference. It could reject valid songs inconsistently, silently admit newly discovered source classes, or certify only the small subset represented in project defaults. The resulting object would look authoritative while omitting the actual discovery surface.

**Required documentation correction or owner decision:** Add a normative persisted-input contract before specifying `ValidatedLiveSourcePlan`. The owner must choose either (a) a new `liveSources[]`/assignment structure or (b) a formally expanded replacement for `liveSlot`; the existing semantics cannot merely be assumed. Define stable source IDs for original audio, imported/local stems, cloud stems, generated drums/bass/chords, machine tracks, and future producers; required versus optional status; desired public/private role; how legacy filenames are migrated once; how migration provenance is stored; and how unknown candidates remain visible but inadmissible. Define the adapter from the discovery candidate manifest to the persisted intent.

**Does this block the first implementation slice?** Yes. The first slice's primary input and exhaustive-source acceptance criteria are otherwise undefined.

### F-02 — Direct Live sound producers are missing from the source census

**Severity:** Critical

**Affected target rule:** No sound source may exist outside the generation-owned plan and graph executor; private paths must never fall back to Main; readiness requires an exhaustive installed-source set.

**Current implementation evidence:** The Live playback page creates a separate `KeysSynth`, attaches it to the shared `audioDevice`, and mounts its MIDI controller. `KeysSynth` connects its output to the supplied destination or `ctx.destination`. `MixerView` also drives `chordJam`; its keys, bass, and arpeggiator voices lazily create synths with default destinations. Chord keys and arpeggiator are suppressed only when corresponding hosted lanes exist, while the chord-lane feature is currently disabled; the bass voice remains direct. These producers are not registered by `MixerEngine.setTrack()` and are not covered by a source plan limited to loaded/rendered lanes.

**Why this is dangerous:** The graph executor and its sentinel tests could be entirely correct while a MIDI key press or chord-jam event still reaches Main directly. Lifecycle cleanup and readiness could also claim that a generation is silent after its planned nodes are gone while these externally hosted synths remain attached to the shared context.

**Required documentation correction or owner decision:** Add a normative Live producer registry/census to the architecture. Explicitly include the keybed, chord-jam keys, chord-jam bass, chord-jam arpeggiator, preview/test producers available from Live UI, and any future real-time instrument. Decide whether real-time instruments are a supported Live feature. If yes, require executor-provided destinations, generation ownership, an admitted role, cleanup, and sentinel tests. If no, require them to be unavailable and unable to respond while Live owns the runtime. Add a source-code guard or test strategy that identifies production connections to `AudioDestinationNode` outside the executor.

**Does this block the first implementation slice?** Yes. The advertised exhaustive plan and fixtures cannot be exhaustive until the producer boundary is defined.

### F-03 — The target data flow conflates source lanes and monitor destination buses

**Severity:** High

**Affected target rule:** Runtime-state model mapping `performerId → monitorMixId → logical output → Web Audio channel → XR18 strip → bus → physical output`; routing contract for performer cues and monitor mixes; first-slice collision and capacity validation.

**Current implementation evidence:** Current project data associates each performer with an XR18 monitor bus. Current hardware planning assigns *source lanes* to XR18 input strips, then writes sends from each source strip to one or more aux buses. An aux monitor bus is therefore a mixing destination. It does not inherently have a Web Audio output channel or a corresponding XR18 input strip. The current UI already illustrates the danger: it configures per-lane strip sends while the browser actually emits a stereo mix, so the logical and physical topologies disagree.

**Why this is dangerous:** Following the proposed arrow literally would allocate a device channel and input strip per monitor destination, then also map performer cue sources to strips. Collision and capacity validation would be performed over the wrong entities. Readiness could prove that “monitor Alice” has a channel while failing to prove which source strips feed Alice's bus.

**Required documentation correction or owner decision:** Replace the mapping with two explicit relations:

1. `source lane → Web channel → USB channel → XR18 input strip → LR policy`, and
2. `(source strip, monitorMixId) → aux-send state → XR18 bus master → physical output`.

Then define performer cue as a private *source lane* owned by a performer whose only permitted aux destination is that performer's bus. Define program and click as shared source lanes with sends to selected performer buses. Capacity and collision validation must allocate source strips/channels, not monitor buses.

**Does this block the first implementation slice?** Yes. It changes the shape and invariants of `ValidatedAudioConfig`.

### F-04 — Exact-set readiness and optional omission are contradictory

**Severity:** High

**Affected target rule:** Readiness and lifecycle contracts requiring the installed/prepared source set to equal the exhaustive plan, while allowing optional source failures or omissions to be recorded.

**Current implementation evidence:** Some sources are intrinsically conditional: cloud/local alternatives, generated parts, machines, optional chord lanes, and assets that may be unavailable. The target documents both require exact equality and allow optional omissions without defining whether an omitted optional source remains a member of the authoritative plan.

**Why this is dangerous:** Two implementations can both claim compliance: one compares installed sources against all planned candidates and can never become ready after an optional failure; another silently removes failures from the plan and allows arbitrary plan shrinkage. Generation reducers and tests will encode whichever interpretation is chosen first.

**Required documentation correction or owner decision:** Define three named sets and the transition between them: `CandidateManifest` (everything discovered), `AdmittedSourcePlan` (positive intent plus required/optional policy), and `ResolvedInstallManifest` (installed members plus explicit omission records). State a set equation, for example: every admitted source appears exactly once as `installed` or `omitted`; required sources may not be omitted; the runtime installed set exactly equals admitted items marked installed; no non-admitted source may be installed. Require omission reasons and generation ownership.

**Does this block the first implementation slice?** Yes. Exact reducer states and acceptance tests depend on it.

### F-05 — Current parsing destroys invalid data before validation

**Severity:** High

**Affected target rule:** Invalid legacy routing is retained for repair, surfaced with stable reason codes, and never silently normalized into a valid configuration.

**Current implementation evidence:** `src/lib/project/parse.ts` filters malformed route rows, skips invalid records, rounds monitor-bus values, clamps numeric levels, and drops unsupported bus assignments while building an explicit object. The downstream validator therefore receives sanitized or absent data rather than the saved values. This is especially important because repository policy correctly describes parsers as whitelists.

**Why this is dangerous:** A broken mapping can disappear, collide after rounding, or become apparently valid after clamping. The UI cannot explain or repair what is no longer represented, and a fail-closed validator can issue the wrong reason code.

**Required documentation correction or owner decision:** Add a lossless diagnostic-ingest boundary to the target. Choose either raw persisted DTOs that the validator consumes before normalization, or typed invalid variants that retain the original value and location. Define which tolerant transformations remain permitted and which are validation errors. Require malformed/unknown route entries to round-trip until explicitly repaired or migrated. Add raw-to-validated fixtures to the first slice.

**Does this block the first implementation slice?** Yes. The proposed validator adapter otherwise cannot meet the target contract.

### F-06 — The pure first slice risks becoming a prohibited second truth

**Severity:** High

**Affected target rule:** ADR-001's single runtime authority; module ownership's first slice introducing a validated model and reducer without changing production audio output.

**Current implementation evidence:** Current production will continue to use `MixerView` discovery, current parsers, `liveRigPlan`, local-storage output mapping, mutable stores, and UI-specific readiness while the proposed pure model is initially unused. Several of these already calculate overlapping source, route, and health concepts.

**Why this is dangerous:** “Pure and unused” is a good test seam, but without a strict boundary it becomes another architecture that can drift before cutover. Passing tests may demonstrate only the hand-built fixture universe rather than parity with current saved data and discovery output. A reducer that merely ignores stale events also does not define who disposes resources produced by those stale operations.

**Required documentation correction or owner decision:** Label the slice explicitly as a **contract-only shadow artifact**, not a runtime authority. State that it must not feed UI readiness, graph construction, hardware writes, or sound until the cutover slice. Require adapters and characterization fixtures from real current project/SongMap shapes; a complete candidate census; a named next-slice owner and deletion/cutover point for overlapping planners; and reducer outputs for cleanup/cancellation commands when stale prepared resources are rejected. Prohibit adding another mutable store for the shadow model.

**Does this block the first implementation slice?** Yes, until these guardrails are written. With them, the pure slice is the correct starting point.

### F-07 — Readiness overstates what graph and desk configuration can prove

**Severity:** High

**Affected target rule:** Readiness statements that a performer is ready only after click/cue “reached” the performer, and first-slice readiness reason codes.

**Current implementation evidence:** The browser can prove node connections and scheduled events. XR18 readback can prove parameters such as input source, LR state, bus send, and bus master. Neither proves the identity of actual audio at a strip or audibility at a wired P2/IEM output. Current hard-coded monitor meters reinforce that a moving level is not content-specific evidence.

**Why this is dangerous:** A green result may be read as acoustic proof even when USB channels are swapped, a strip carries program rather than click, a bus is physically disconnected, or the P2 is off. Conversely, making all such facts automated could create an impossible acceptance criterion.

**Required documentation correction or owner decision:** Define an evidence taxonomy and constrain copy to it:

- `configured`: graph and desk parameters match the generation plan;
- `scheduled`: the expected source event exists on the current transport generation;
- `observed`: a uniquely identified test signal is detected at the intended desk bus/strip through a defined measurement;
- `physically confirmed`: a human confirms the named physical output.

State which level each readiness state requires. Replace “reached the performer” with the precise level actually established. Keep physical confirmation separate and scoped to rig/profile/generation or an explicitly defined lease.

**Does this block the first implementation slice?** Yes for readiness-state/reason-code acceptance criteria; no for source/route value types in isolation.

### F-08 — The first-slice capacity validator lacks an XR18 allocation policy

**Severity:** High

**Affected target rule:** Deterministic Web/USB/XR18 allocation, collision rejection, fixed capacity, shared program/click lanes, and one private cue lane per performer.

**Current implementation evidence:** The XR18 has a finite input-strip budget. Current defaults allocate named musical lanes plus click and cue at the upper strip numbers, with potential overlap for “other” stems. The target calls for per-performer private cue sources but leaves the fixed strip budget, stereo groups, sharing rules, and maximum supported performer count unresolved.

**Why this is dangerous:** The validator cannot distinguish a supported show from an impossible one without normative allocation rules. A fixture can accidentally bless a plan that has no realizable XR18 topology, or reject a viable shared-lane arrangement.

**Required documentation correction or owner decision:** Define a versioned XR18 rig profile before writing positive capacity fixtures: reserved strips; mono/stereo treatment; program grouping; click lane; number and placement of performer cue lanes; allowed shared source strips; unavailable local/USB strips; and the maximum performers/sources. If profiles are configurable, define the profile schema and require an exact profile identity in validation and readiness.

**Does this block the first implementation slice?** Yes for mapping and capacity validation.

### F-09 — Explicitly disabled announcements lack a canonical migration contract

**Severity:** Medium

**Affected target rule:** Explicitly disabled intro/announcement means silence and must not be treated as absence that triggers title fallback; canonical cue scheduling.

**Current implementation evidence:** `resolvedSpokenIntroText()` falls back to the song title when no enabled intro event is found. `getPrimaryCueTrack()` also falls back to the first cue track when none is enabled. Project defaults can remove a generated intro and track suppression-related state, but execution does not expose a single canonical absent-versus-disabled representation for the target scheduler.

**Why this is dangerous:** Migration can make a performer hear an announcement the author explicitly disabled. Different schedule producers can also interpret the same SongMap differently.

**Required documentation correction or owner decision:** Define the saved state for `never authored`, `generated default`, `explicitly enabled`, and `explicitly disabled`, including per-performer inheritance. Specify the one-time migration from current cue events/default overrides and require the canonical scheduler to consume that state without title fallback for explicit disablement.

**Does this block the first implementation slice?** No if the slice excludes canonical schedule construction. It blocks the first cue-scheduler/admission cutover slice.

### F-10 — Activation safety needs a transaction and drift policy, not just target values

**Severity:** High

**Affected target rule:** Atomic generation commit, hardware reconciliation, freeze on OSC loss, fail-closed private routes, and no unsafe transient state.

**Current implementation evidence:** Current XR18 writes are individual OSC commands. Existing planning can calculate final LR/send states, but the route from USB returns to input strips is not part of the active transaction. Historical safety notes recommend broad Main muting and periodic correction, while the new contracts favor ownership and frozen writes on control loss. The documents do not completely resolve command order, readback timeout, rollback/safe fallback, or behavior when another controller changes the desk after validation.

**Why this is dangerous:** A safe final configuration can be reached through an unsafe transient—for example cue input active on LR before LR-off readback—or can drift immediately after readiness. Retrying after partial OSC loss can overwrite a house engineer's intentional change.

**Required documentation correction or owner decision:** Before the hardware executor slice, define a transaction state machine: precondition evidence; safe activation order; readback per step; timeout; abort state; what can be rolled back; which writes freeze on loss; how external drift invalidates readiness; and which controls BarBro owns versus only observes. Decide whether the rig uses an exclusive show-control mode, cooperative/manual mode, or both with different guarantees.

**Does this block the first implementation slice?** No for pure configuration types. It blocks the first XR18-writing executor and any claim of atomic hardware commit.

### F-11 — Existing readiness surfaces need an explicit retirement/copy plan

**Severity:** Medium

**Affected target rule:** One readiness authority with stable states and exact evidence.

**Current implementation evidence:** Cache readiness, `rigHealth`, `rigStatus`, “House safe,” the `/rig` skippable checklist, and monitor-strip meters currently expose different partial truths. Some use a historical `lastMessageAt`; some use local manual state; some have hard-coded channel identities.

**Why this is dangerous:** A correct new readiness model can coexist with old green indicators and still leave the operator choosing the most reassuring signal. “Ready,” “House safe,” and green dots have operational meaning even when intended as narrower diagnostics.

**Required documentation correction or owner decision:** Add a readiness-surface migration table. For every existing badge/panel, specify whether it is removed, relabeled as a limited diagnostic, or exclusively driven by the authoritative snapshot. Ban green “ready/safe” language for cache-only or stale hardware evidence. Define whether a skipped manual step results in `not verified`, never `ready`.

**Does this block the first implementation slice?** No while the model is contract-only. It blocks connecting the model to production UI.

### F-12 — Lifecycle cleanup is not yet expressed as a testable resource protocol

**Severity:** High

**Affected target rule:** Generation ownership, stale completion rejection, deterministic cleanup, Editor-to-Live transition, device loss/reconnect, and no leaked nodes or timers.

**Current implementation evidence:** Live route loads can overlap; hydration publishes related stores in stages; mixer reloads serialize without generation cancellation; editor transport is paused rather than disposed; `MixerEngine.dispose()` does not follow the per-track instrument disposal path; `KeysSynth.close()` does not disconnect the full shared graph; and device/OSC freshness is not generation leased.

**Why this is dangerous:** Ignoring a stale completion is not enough if it created nodes, timers, decoded buffers, MIDI listeners, or hardware writes. A later generation can inherit sound or have its resources disposed by an older cleanup.

**Required documentation correction or owner decision:** Add a resource protocol to the lifecycle contract: every prepare operation receives a generation and abort signal; every produced resource is registered before asynchronous publication; rejected/stale results return a cleanup command; commit transfers ownership exactly once; cleanup is idempotent and generation-scoped; no cleanup may target a newer generation. Include shared real-time synths, MIDI subscriptions, speech buffers, timers, hardware subscriptions, and transport schedule handles. Define the Editor `pause` versus `dispose` transition explicitly.

**Does this block the first implementation slice?** It blocks the runtime reducer portion unless cleanup commands/effects are part of its state-machine contract. It does not block standalone configuration validation.

## Target-document contradictions and omissions

The target set is directionally coherent, but the following edits are required before implementation:

| Target document area | Contradiction or omission | Required edit |
| --- | --- | --- |
| Runtime-state model | Maps a monitor destination through a Web channel and XR18 input strip. | Split source-channel allocation from source-to-bus send and bus-to-physical-output relations (F-03). |
| Routing contract | Requires explicit/migrated admission but does not define the persisted source-intent schema. | Add candidate/admission schema, stable IDs, and one-time migration (F-01). |
| Routing/module ownership | “Exhaustive sources” does not name direct keybed/chord-jam producers. | Add a normative producer census and real-time-instrument policy (F-02). |
| Readiness/lifecycle | Exact installed/prepared set is required while optional omissions are allowed. | Define candidate, admitted, installed, and omitted sets with a set equation (F-04). |
| Routing/runtime state | Invalid legacy values must be retained, but input ingestion is assumed to provide them. | Define lossless raw/invalid representations and parser responsibilities (F-05). |
| ADR-001/module ownership | One runtime truth versus a deliberately unused new model. | Mark the model contract-only, forbid production authority, and specify cutover/parity obligations (F-06). |
| Readiness | “Reached performer” mixes configuration, observation, and physical confirmation. | Add the evidence taxonomy and scope every state/copy string (F-07). |
| Module ownership/runtime unresolved questions | Collision/capacity tests are required before a rig allocation profile exists. | Decide a versioned XR18 strip/channel budget (F-08). |
| Routing/canonical schedule | Explicit disablement is a rule without canonical persisted/migration semantics. | Define announcement states and migration (F-09). |
| Lifecycle/hardware | Atomic commit does not define XR18 command order, rollback, ownership, or drift. | Add the hardware transaction state machine before executor work (F-10). |
| Readiness | No retirement plan exists for old badges and skippable checks. | Add a surface migration matrix (F-11). |
| Lifecycle/first reducer | Stale results are ignored, but resource disposal ownership is implicit. | Define reducer cleanup commands and executor obligations (F-12). |

The architecture overview should link these normative additions once made, but it should remain a concise map. Detailed schemas belong in routing/runtime-state contracts; transaction sequencing belongs in lifecycle; evidence language belongs in readiness; decisions with meaningful alternatives should become ADRs.

## Historical-document risks

The documentation index correctly marks the older planning material as historical or non-authoritative. The banners reduce risk, but several concrete instructions remain plausible enough to be copied into implementation or show procedure:

- `docs/domains/hardware-control.md` retains “open questions” about separate click/cue routing and an older project-data sketch even though the target architecture makes stronger decisions.
- `docs/live-preflight.md` focuses on hearing audio/click and controller replay. It can be read as show-safety assurance without Main isolation or performer-specific checks.
- `docs/xr18-foh-safety.md` contains obsolete source/channel assumptions, broad Main-mute/periodic-rewrite guidance, and statements that predate the current multichannel code and origin-gated sidecar endpoints.
- `docs/audio-refactor-roadmap.md` says to add a new path beside the old path and remove the old path in the same run, while the new plan intentionally begins with an unused pure contract. It also defers transport unification that the new single-runtime ADR makes foundational.
- `docs/live-rig-plan-review.md` contains a machine-local absolute path, once cut performer cues from the first version, recommends a current-stereo warning fallback that conflicts with fail-closed private routing, and treats persisted capability proof more strongly than the target's active evidence model permits.
- `docs/goal-plan.md` describes some hardware/readback work as wholly missing despite partial implementation and has no explicit milestone stating that the current Live graph is not show-safe pending the architecture cutover.

Action: keep the historical content, but add short inline supersession notes at the dangerous recommendations, each pointing to the exact current contract or ADR. Do not silently rewrite history. Separately, add a visible roadmap item for the architecture cutover and current safety limitation when authoritative-document edits are next authorized.

## Product-owner decisions required before coding

The following are product decisions, not implementation details:

1. **Live source intent:** introduce a new persisted source-assignment model or formally replace/expand `mixState.liveSlot`.
2. **Real-time Live instruments:** support keybed and chord-jam voices through the executor, or disable them whenever Live owns audio.
3. **XR18 rig profile:** reserve the exact source strips/channels, stereo group rules, cue-lane count, and maximum supported performer count.
4. **Audio-device policy:** define supported browser/OS sink selection, the device identity used for readiness, and behavior when a stable sink ID is unavailable.
5. **Degraded operation:** define whether music-only or Main-degraded rehearsal can run, who acknowledges it, how long the acknowledgement lasts, and which private-content failures can never be overridden.
6. **Hardware control ownership:** choose exclusive show-control versus cooperative/manual desk operation and the corresponding drift/reapply policy.
7. **Announcement semantics:** define inheritance and saved states for absent, generated, explicit, and explicitly disabled per-performer speech.
8. **Manual-evidence lease:** decide when physical confirmation expires—rig profile change, device change, hardware generation, app restart, or another defined boundary.

The existing decisions that click/cue are private, private routing fails closed, monitor outputs are mono, and schedule timing is canonical should not be reopened unless new hardware evidence makes them impossible.

## Assessment of the proposed first implementation slice

### Decision

The proposed pure-model slice is the right implementation category, but **it is safe only after documentation corrections F-01 through F-06 and the first-slice portions of F-07, F-08, and F-12**.

Starting with `ValidatedAudioConfig`, a pure validator, and a pure generation reducer avoids touching live output while the contracts harden. It is the appropriate minimum architectural abstraction if it remains immutable, side-effect-free, source-exhaustive, and explicitly non-authoritative until cutover.

It is not yet safe to code from the present text because the data source, topology, optionality, invalid-input behavior, capacity profile, and shadow-model boundary are underdefined.

### Missing acceptance criteria

Add these acceptance criteria to the first slice:

1. The input type distinguishes raw persisted values, discovery candidates, persisted admission intent, and the validated result. No adapter may silently discard malformed routing.
2. A fixture enumerates every current production Live producer, including playback-page keybed and chord-jam keys/bass/arpeggiator, and classifies each as admitted or prohibited.
3. A repository test or lint/sentinel strategy detects production connections to the audio destination outside the designated runtime/executor boundary. Allowlisted debug/test code is explicit.
4. Source lanes allocate Web channels, USB channels, and XR18 strips; monitor destinations allocate buses and physical outputs. Tests reject any model that treats a monitor bus as a source strip.
5. `CandidateManifest`, `AdmittedSourcePlan`, installed sources, and omissions have exact set semantics. Every admitted ID is accounted for once; required omissions fail; unadmitted installs fail.
6. Stable source identity does not depend on display label, array order, or filename after migration. Migration provenance and ambiguity are testable.
7. The XR18 fixture names the rig-profile version and proves all reserved strips, stereo groups, cue lanes, buses, and maximum supported performers fit without collision.
8. Positive and negative fixtures cover zero, one, and maximum performers; shared click/program sends; per-performer cue isolation; exhausted channels; duplicate stable IDs; duplicate buses; strip/USB collisions; unknown source class; ambiguous legacy filename; missing required source; optional omission; and raw invalid values.
9. The validator returns a stable, ordered, exhaustive reason-code set; it does not stop at the first error when additional repair information is safe to calculate.
10. The result is deeply immutable or treated as a value; no consumer can mutate it into an unvalidated state.
11. The shadow model has no store, UI, hardware, graph, or audio side effects. A test or dependency boundary enforces this.
12. Characterization fixtures are produced through adapters from representative current Project/SongMap data, not only hand-authored target objects.
13. Generation state distinguishes preparing, prepared, committed, failed, superseded, device-lost, hardware-stale, and disposed with exact allowed transitions.
14. Stale events cannot change current state or readiness. If they carry resources, the reducer emits a cleanup/cancellation command scoped to the stale generation.
15. Commit transfers ownership once; cleanup is idempotent; an older generation cannot dispose a newer generation's resource ID.
16. Readiness reasons state the evidence level (`configured`, `scheduled`, `observed`, `physically confirmed`) and never claim a stronger level.
17. Three consecutive generation fixtures include out-of-order load, stale success after failure, stale hardware evidence, device loss during prepare, device loss after commit, and re-entry after disposal.
18. Existing production behavior and audio output are byte-for-byte/graph-observably unchanged by the slice, aside from test-only adapter execution.
19. The next cutover slice and the owner responsible for deleting/replacing each overlapping legacy planner are named before merge.

### Minimum abstraction judgment

`ValidatedAudioConfig` plus `ValidatedLiveSourcePlan` is the minimum useful pure abstraction only if it contains:

- versioned rig-profile identity;
- stable admitted source IDs and roles;
- source Web/USB/strip allocation and LR policy;
- source-to-monitor-bus send policy;
- bus-to-performer/physical-output ownership;
- required/optional resolution and omission records;
- validation provenance and stable reason codes.

Do not put live node instances, mutable meters, `AudioContext`, OSC clients, UI booleans, or manual confirmation state in this value. Those belong in generation-scoped runtime evidence referencing the validated configuration ID.

## Residual risks requiring real XR18 and manual verification

Even after the architecture and automated tests are complete, the following cannot be established safely by pure tests alone:

- Chromium/macOS exposes the expected active multichannel device and preserves channel ordering on the supported interface.
- The active context—not a probe context—uses the intended sink and survives or correctly fails closed across unplug, replug, sleep, sample-rate change, and default-device change.
- XR18 USB-return source commands address the intended input strips on the supported firmware and persist only as intended.
- Each unique browser test signal arrives on exactly the intended XR18 strip, has LR off when private, and is absent from every forbidden strip/bus.
- Program, click, and every performer's cue/announcement are independently identified at every assigned aux bus.
- Bus masters feed the documented physical outputs, the P2/IEM mono arrangement reaches both ears as intended, and no hidden analog/Ultranet routing bypass exists.
- FOH control from X Air Edit/tablet and BarBro interact according to the chosen ownership policy; external drift invalidates readiness without unsafe surprise rewrites.
- OSC interruption during every activation step leaves the desk in the documented safe state and recovery does not replay stale-generation writes.
- Latency and relative timing among music, click, section cues, and announcements remain acceptable over a full set.
- Repeated Editor → Live → song change → device loss → reconnect → leave → re-enter cycles produce no stale audio, doubled MIDI response, leaked scheduled cue, or meter from an old generation.
- Manual confirmation is performed at the actual physical outputs with the show cabling, amplifiers, bodypacks/headphones, snapshots, and gain structure.

These checks should produce evidence tied to the rig-profile version, active device identity, application build, XR18 firmware, and test time. They should not be persisted as timeless proof.

## Final assessment

The proposal has the correct safety philosophy and is worth pursuing. It should not yet be implemented as written because its most important proof object—an exhaustive validated configuration—does not have a complete, lossless, topologically correct input contract, and because sound can currently originate outside the proposed executor.

Correct the documents first. Then implement the pure contract-only slice with the expanded acceptance criteria above. After that, the highest-value production slice is not a broad refactor: it is a narrow generation-owned Live admission/executor boundary that captures every producer, prevents direct-destination escape, and keeps private content silent unless the complete configured path is current and proven at the declared evidence level.
