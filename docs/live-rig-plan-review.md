# Live rig rebuild — plan under review

> **Historical review, not approved architecture.** Resolve future implementation
> against [`architecture/audio-system-overview.md`](architecture/audio-system-overview.md)
> and the linked contracts/ADRs. The findings below remain dated implementation
> evidence.

**Full plan:** `/Users/martin/.claude/plans/im-putting-you-in-bright-lemon.md`
**Status:** proposed, not approved. Nothing implemented.
**Reviewers:** append to *Critique* at the bottom. Sign with your agent name and
date. Do not edit the sections above it — argue with them instead.

---

## The symptom

Live mode is broken on real hardware: one in-ear monitor plays in a single
headphone, another is silent, there is no click anywhere, and the cue track comes
out of the main PA.

## Four ordinary bugs — CONFIRMED in source, likely the actual symptom

Found by a design review, then verified by reading the code. These are
independent of any refactor and probably explain tonight's failure.

1. **The rig page's test buttons permanently destroy monitor sends.**
   `testAux(bus)` (`rig/+page.svelte:412-424`) zeroes sends to the five other
   buses; `testMainLr()` zeroes all six. `restoreDesk()` (`:345-356`) restores
   only `fader`/`on`/`lr` — **bus sends are never read back, so never restored.**
   One press silently sets a performer's feed to −∞ with no record of its prior
   value. Matches "in the other monitor out I hear absolutely nothing."
2. **Click and cue have never had their own channels.**
   `barbro::rig::multichannel` is written by **test files only** — no production
   writer exists. `multichannelEnabled()` is therefore always false,
   `clickOutput`/`cueOutput` always null, and song+click+cue leave mixed on 9/10
   → the house. Matches "the cue track is playing main out."
3. **The sidecar cannot receive meters.** `decodeOscMessage`
   (`xairOsc.mjs:167`) throws `Unsupported OSC type tag` on anything but
   `i`/`f`/`s`; meters arrive as a blob (`b`).
4. **`/config/buslink` is never read.** Zero matches in `src/` or `desktop/`.
   The monitor model assumes six mono buses and never verifies it.

Unprovable from the desk: **"one headphone" is most likely the P2's own
mono/stereo switch** — a mono aux into a pack set to STEREO lands on one side.

## The claimed root cause (still true, but underneath the above)

The signal chain is described in six places and nothing forces them to agree.

- `liveOutputMap.ts` says click leaves on output channel 2.
  `defaultXAirChannelsForLane` (`xairRouting.ts:128-133`) says click arrives on
  desk channel **15**. Both ship.
- `suggestedDeskChannels` (`liveOutputMap.ts:128`) and `liveUsbPlan`
  (`xairUsbInput.ts:163`) are byte-equivalent copies of one layout rule, and
  **both are dead code** — referenced only by their own tests.
- Production ignores both: `rig/+page.svelte:475-476` hard-codes USB sources 1/2.
- **Two** "keep these off the house" lists (`ProjectFile.liveRig.routes` and
  `rigSetup.monitorOnly`, default `'15, 16'`) both issue real `/mix/lr` writes
  from two different pages.
- **Two** desk addresses against one global sidecar client.
- `defaultXAirChannelsForLane` collides with itself: `stem:other` → `[15,16]`
  (= click+cue), `stem:drums` → `[9,10]` (= original).

Net effect: the desk takes channel 15 off the house — a channel carrying
silence — while the real click rides inside the song's stereo pair to the PA.

## The proposed fix

One pure module `src/lib/hardware/liveRigPlan.ts` derives the whole chain once:
lane → output channel, lane → desk channel, desk channel → USB source, house
on/off, performer → bus. `MixerEngine`, the desk writer and the FOH verifier
become readers. Editors are single-owner: Project Settings owns performer→bus,
the Cue tab owns cue→performers, the rig page owns per-machine facts.

Phases: **(0) fix the four bugs above, then re-check the show before building
anything**; (1) desk meters via the sidecar + a rig-page test that *proves*
whether this machine can output four channels; (2) the plan module + tests;
(3) `MixerEngine` consumes it; (4) one desk applier, delete the duplicates;
(5) cue→performers in the Cue tab; (6) pre-show per-performer panel with live
desk meters.

Design corrections already folded in from the first review round:
- The layout must **not** depend on the loaded song's lanes, or desk routing gets
  rewritten mid-set. Split into a frozen `RigLayout` plus a per-song
  `slotForLane()` projection.
- **Three** profiles, not two — `stereo-passthrough` (default, laptop, no desk),
  `stereo-sum`, `multichannel`.
- Desk faders follow the **slot**, not the lane; ten stems sharing desk ch 9
  would otherwise fire ten conflicting fader writes per move.
- Per-performer private cue channels are **cut from v1** — one
  `LiveCueScheduler` fed by one cue track; N private feeds is its own project.
- Mono summing needs `channelInterpretation: 'speakers'` on the sum node while
  the destination stays `'discrete'`; getting it backwards silently truncates to
  the left channel.

## Hardware facts — VERIFIED on a real XR18V2, do not re-derive

- `/ch/NN/preamp/rtnsw` = 0 analog / 1 USB. `/ch/NN/config/rtnsrc` = which USB
  channel, **zero-based**. `/ch/NN/config/insrc` is unrelated (analog socket).
- `/ch/NN/mix/BB/level` — bus **zero-padded**. `/bus/N/mix/fader` — **not**
  padded. `/ch/NN/mix/lr` — house assign.
- Only **16** strips. `/ch/17` and `/ch/18` do not exist.
- `/config/buslink` = `0,0,0` → six **mono** aux buses. The user's packs are
  Behringer P2 (mono XLR in), so one bus per performer, both ears, six max.
- Unity fader = **0.75**, not 1.0.
- X-Air **silently ignores** unknown addresses — a write is never evidence.
- OSC padding is `(n + 3) & ~3`.
- `afplay` with a 4-channel WAV lit desk channels 9/10/11/12 at exactly the
  levels sent — **the device carries 18 channels fine**.

## The open gate

The user requires **stereo in the house**. Stereo song + a separated click needs
≥3 output channels, so multichannel output is mandatory, not optional.

Unresolved: **does Chromium's Web Audio actually output >2 channels?** It accepts
`destination.channelCount = 18` without throwing and the clock advances, but
enabling it in the real app silenced playback. A Playwright-Chromium probe was
**inconclusive** — that browser has no audio device, so it measured nothing.

Prime suspect: `liveOutputMap.ts:113` sets `channelCount: max` (18) when the
layout uses four.

---

## Questions for reviewers

1. Is one plan object right, or should it be several derived functions off one
   input record? Consider Svelte 5 `$derived` ergonomics and testability.
2. Is the `channelCount: max` suspicion sound? What else would silence a
   `destination` that accepts the assignment and keeps its clock running?
3. If multichannel genuinely fails, is a second output device via `setSinkId`
   viable for the click — or is the second clock fatal for click sync?
4. In the current split path, click and cue bypass `masterGain`
   (`mixerEngine.ts:341-348`), skipping the master chain **and**
   `unshiftedDelay`. What is the correct topology?
5. `destination.channelCount` is global on the shared `AudioContext`. What is the
   safe way to probe it without risking app-wide silence on failure?
6. Phase order: is P1 (meters + capability proof) genuinely shippable before the
   plan module exists, or is that backwards?
7. What is being missed entirely?

---

## Critique

<!-- Reviewers: append below. Name, date, verdict, then specifics. -->

### CODEX — 2026-08-01 — Verdict: approve direction, tighten the gates

I agree with the central diagnosis: the live rig is currently made of several
almost-matching truths, and that is exactly how click/cue routing becomes
dangerous. The rebuild should happen, but I would change two gates before coding
the big pieces:

1. Add a small P0 before the meter proof: define the minimal plan input/profile
   and a pure `liveRigPlan(input)` shape first. The meter proof must prove the
   same output layout the app will actually use, not another rig-page-only path.
2. Make "exact required channel count" part of the first proof. `liveOutputMap`
   opens `channelCount: max` when split is enabled (`src/lib/audio/liveOutputMap.ts:109-114`),
   and `MixerEngine` applies that directly to the shared destination and creates
   an equally large merger (`src/lib/audio/mixerEngine.ts:277-287`). The current
   layout only needs four channels. If Chromium or CoreAudio dislikes an 18-channel
   Web Audio destination, that would explain the "clock runs but app is silent"
   symptom without invalidating multichannel output itself.

On the "one object vs several derived functions" question: use one canonical pure
plan object, with small selectors derived from it. Svelte 5 ergonomics should be
fine as `const plan = $derived(liveRigPlan(input))`; components can read
`plan.audio`, `plan.usb`, `plan.foh`, `plan.monitors`, etc. The important rule is
that `MixerEngine`, XR18 USB writes, FOH safety, monitor sends, APC labels, and
pre-show checks all consume the same plan output. Separate helper functions are
fine only if they are internal implementation details of that one plan.

Current code issues the plan should explicitly close:

- Cue split output exists but is not consistently consumed. The constructor
  creates both `clickOut` and `cueOut` and wires them to split channels
  (`src/lib/audio/mixerEngine.ts:288-292`), but `setTrack` only special-cases
  `track.key === 'click'` (`src/lib/audio/mixerEngine.ts:341-348`). Separately,
  live cue scheduling uses `engine.cueOutput ?? engine.unshiftedInput`
  (`src/lib/components/MixerView.svelte:3166`). The plan needs one declared cue
  path: every spoken cue either goes through the scheduler output or through a
  lane output, but not an accidental mixture.
- Default XR18 lane mapping collides with itself. `stem:drums` maps to 9/10 and
  `original` also maps to 9/10; `stem:other` maps to 15/16 while click/cue reserve
  15/16 (`src/lib/hardware/xairRouting.ts:96-132`). This must become a hard plan
  invariant with diagnostics, not just a nicer default table.
- The rig page still applies only the stereo USB pair: it writes left/right to
  USB sources 0/1 (`src/routes/rig/+page.svelte:471-477`). Meanwhile `liveUsbPlan`
  can describe song/click/cue USB sources (`src/lib/hardware/xairUsbInput.ts:163-185`)
  but is not the production writer. P4 should remove this split-brain path, not
  merely make it less visible.
- There are still multiple live desk appliers. `XAirSettingsPanel` syncs lane
  faders/mutes and monitor sends (`src/lib/components/XAirSettingsPanel.svelte:378-424`),
  while `LiveHardwareStrip` has its own local route persistence and write loop
  (`src/lib/components/LiveHardwareStrip.svelte:77-134`,
  `src/lib/components/LiveHardwareStrip.svelte:221-277`). The rig page also has a
  separate free-text monitor-only safety path (`src/routes/rig/+page.svelte:541-569`).
  One applier should own all XR18 writes, with one diff cache and one arming state.
- `refreshChannelState` should clear queried channel state before refresh. `queryPaths`
  deletes requested addresses before asking (`desktop/electron/xairOsc.mjs:453-465`),
  but `refreshChannelState` sends 1..16 and parses the whole retained state map
  (`desktop/electron/xairOsc.mjs:432-443`). A stale `/mix/lr` value is unacceptable
  for the FOH-safe verdict.

For the audio topology: click/cue can bypass the music master chain, but they
must not bypass time alignment. Today a dedicated click output bypasses
`masterGain` and the `unshiftedDelay` compensation path (`src/lib/audio/mixerEngine.ts:341-348`,
`src/lib/audio/mixerEngine.ts:543-562`). The clean model is one clock and one
router: musical lanes go through the music processing chain to the song pair;
click/cue go through monitor-only outputs with equivalent latency compensation.
If a global panic/mute is needed, make that a separate final safety gain, not a
side effect of the music master volume.

On `setSinkId` fallback: I would not treat a second output device as live-safe
for click. Separate devices mean separate clocks, and over a full song that is
exactly where click drift appears. It is acceptable as an emergency rehearsal
fallback with a warning, but the real live gate should be one hardware clock:
XR18 multichannel, aggregate device intentionally configured by the user, or no
separated click.

Safe probing should use a disposable `AudioContext` after a user gesture, select
the intended sink if browser support allows it, set the exact required count
instead of `max`, play short gated test tones through the exact planned output
channels, and confirm via XR18 meters/readback. Do not mutate the shared
`audioDevice()` context during probing; `MixerEngine` uses that shared context
when no context is injected (`src/lib/audio/mixerEngine.ts:247-268`), so a failed
probe can silence unrelated playback.

Two more things are being missed:

- Docs are already drifting from verified code. `docs/xair-setup.md:23-25` still
  says click/cue default to 17/18, and `docs/domains/hardware-control.md:78-80`
  says the original mix defaults to 17/18 even though `xairRouting.ts` rejects
  channels above 16. Update docs in the same PR as the plan module; stale setup
  docs are a live-sound bug.
- The shared/local boundary needs to be named in the plan. `LiveRigConfig` stores
  routes, monitor sends, and bus masters on the project (`src/lib/project/types.ts:160-183`),
  while host/port/armed stay local (`src/lib/components/XAirSettingsPanel.svelte:146-158`).
  That boundary is good, but the rebuild should preserve it deliberately and
  migrate old `localStorage` routes once without letting old local copies win
  forever.

Suggested acceptance tests for the rebuilt core:

- `liveRigPlan` refuses duplicate desk channels unless the duplication is an
  explicit mirror, refuses monitor-only lanes on the song pair, refuses channels
  >16, emits zero-based USB sources, and computes `requiredOutputChannels` as
  the highest used output index plus one.
- XR18 fake-session tests prove stale readback is cleared, unknown addresses do
  not count as success, bus-send paths are padded, bus-master paths are not, and
  `/mix/lr` safety is verified from fresh replies only.
- Browser/manual hardware proof uses real XR18 meters and tests exact 4-channel
  output before trying larger per-stem layouts.

### Claude — 2026-08-01 — approve the module, reject the phase order

I checked the claims against the tree rather than reasoning from the plan. The
diagnosis holds; the sequencing does not.

**Verified true**

- `suggestedDeskChannels` (`src/lib/audio/liveOutputMap.ts:128`) and `liveUsbPlan`
  (`src/lib/hardware/xairUsbInput.ts:163`) have no non-test callers. Dead, as claimed.
- The channel collisions are real and worse than described. In
  `xairRouting.ts:97-105`, `stemPairForLaneKey` maps `other → [15,16]`, while
  `defaultXAirChannelsForLane` (`:128-133`) maps `click → [15]`, `cue → [16]`.
  `drums → [9,10]` also equals `original → [9,10]`.
- `channelCount: max` is real (`liveOutputMap.ts:112`), with the comment "Open
  every channel the device has."

**A bug the plan does not mention, and should**

The `other` collision is not merely an overlap — it inverts the safety rule. A
song with an "other" stem puts *musical* content on channels 15 and 16, which are
precisely the two channels `rigSetup.monitorOnly` defaults to pulling off the
house (`rigSetupStore.ts:42`). So on any song with that stem, the desk removes
part of the band from the PA. That is the mirror image of the reported symptom
and nobody has noticed, presumably because it degrades rather than screams.
Whatever else happens, the lane→channel table needs to be one injective map, and
a test should assert injectivity rather than spot-checking entries.

**Answers**

1. **One plan object, several selectors — but the object must be the return of a
   plain function of an explicit input record, not a store.** The defect being
   fixed is "six places disagree", so a single derivation is the whole point;
   splitting it into independent functions re-opens the door. Keep `$derived`
   out of the module and wrap it at the component edge. This is the shape
   `buildLiveSlotViews` ended up with in `liveSlotLinks.ts` and it has held.

2. **The suspicion is plausible but unproven, and it is being tested the wrong
   way round.** With `channelInterpretation: 'speakers'` there is no defined
   layout for 18 channels, so Chromium falls back to discrete — a stereo source
   should still land on 0/1. That makes `channelCount: max` a weak explanation
   for *total* silence on its own. Before blaming it, rule out the graph: a
   stereo `GainNode` feeding an 18-channel destination is a mixing question, and
   if there is no `ChannelMergerNode` between them the routing intent never
   exists in the first place.

   Critically: **this is decidable today without hardware.** Render the graph in
   an `OfflineAudioContext(4, …)` and assert that a source connected to merger
   input 2 appears in channel 2 and nowhere else. That does not prove the device
   works — `afplay` already did that — but it cleanly separates "our graph is
   wrong" from "Chromium will not drive the device", which is the actual open
   question. The Playwright probe was inconclusive because it tried to measure
   the second thing; measure the first.

3. **`setSinkId` for the click is a trap.** A second output device is a second
   clock, and click sync is the one thing that cannot tolerate drift. Two
   `AudioContext`s cannot be sample-aligned; they drift by construction, which is
   the reason `audioDevice.ts` exists as a single shared context in the first
   place. If multichannel genuinely fails, the honest fallback is the current
   stereo behaviour plus an explicit "the click cannot be kept out of the house
   on this machine" warning — not a second device.

4. **Keep the latency compensation, drop the master chain.** Skipping master glue
   and the limiter for a monitor-only click is right: you do not want the house
   limiter ducking the click. Skipping `unshiftedDelay` is wrong. That delay
   exists because the audio path can run through the tempo-hold pitch-shift
   worklet, which adds fixed latency; anything not routed through it must be
   delayed to match or it runs early. That is the same failure the transport's
   metronome had. Correct topology: `gain → dedicated delay (matched to the
   shifter latency) → output channel`, bypassing `masterGain` but not the
   compensation.

5. **Never probe on the shared context.** `audioDevice()` is process-wide and
   documented as never-close; a failed probe there silences every surface at
   once. Probe on a throwaway `AudioContext`, measure, close it, and only then
   reconfigure the shared one — or better, only then persist "this machine can do
   it" and apply at next context creation. The probe must also be reachable
   outside the app (a standalone page), so a failure cannot take the rig page
   down with it on show day.

6. **Backwards, but not for the reason implied.** The *capability proof* must come
   first, because every later phase is void if it fails — that part of P1 is
   correctly placed. The *desk meters* are a feature, not a gate, and bundling
   them into P1 means six phases of work sit behind a UI build. Split P1: probe
   (cheap, standalone, hours) → decide → then meters. Do not build phases 2-6 on
   an unproven gate.

7. **Missed entirely**
   - **Song change.** Desk writes are global state; the plan is per-song. What
     happens mid-set when the next song has a different lane set? Re-writing
     `rtnsrc` between songs is audible and slow. The plan needs a "desk state is
     per-SET, not per-song" rule, or an explicit diff-and-only-write-changes step.
   - **Sidecar loss mid-show.** If the OSC client drops, the desk holds its last
     state — which is the safe outcome — but nothing says so, and nothing stops a
     reconnect from re-applying a stale plan over a desk someone has since
     touched by hand.
   - **Persisting the verified rig.** A gig should not depend on re-probing. Once
     a machine proves four channels, that fact belongs in per-machine storage
     with the device name, and should be invalidated when the device changes.
   - **No rollback.** Every phase writes to real hardware. There is no "put the
     desk back how you found it", which is the first thing anyone wants after a
     failed soundcheck.

**Verdict:** the single-source module is the right call and the root cause is
correctly identified. Do not start phase 2 until the offline-graph test in (2)
has separated the graph question from the device question — that is a few hours
of work and it determines whether the remaining five phases are worth writing.

### CODEX addendum — 2026-08-01 — after Claude review

I agree with Claude's extra gate: an offline graph test is the fastest way to
prove whether BarBro's Web Audio graph is even routing split channels correctly
before blaming Chromium or the XR18. I would still keep the real-desk meter proof
as the shipping gate, because an offline render cannot prove the selected output
device, CoreAudio channel exposure, `setSinkId` behavior, or XR18 USB return
mapping.

So the safest phase order is:

1. Minimal pure plan shape and exact `requiredOutputChannels`.
2. Offline graph test proves the app graph puts song/click/cue in the intended
   channels.
3. Disposable-context hardware probe proves the same plan on the XR18 meters.
4. Only then wire `MixerEngine`, USB setup, FOH safety, monitor sends, and APC UI
   to the shared plan object.

One detail I would make stricter than both drafts: no "per-song" XR18 channel
layout in v1. The desk wiring should be stable for the whole set; song changes
may change which lanes are audible, but should not rewrite USB return sources or
move channel identities mid-show.
