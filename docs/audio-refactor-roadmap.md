# Audio refactor roadmap

> **Historical migration proposal, not architecture authority.** Before executing
> any item, reconcile it with
> [`architecture/audio-system-overview.md`](architecture/audio-system-overview.md),
> especially the ownership map, state model, and first implementation slice.

Companion to [audio-architecture-review.md](audio-architecture-review.md). Each
item is scoped to **one agent run**: one session, one branch, green suite at the
end, no half-migrated state left behind.

Read the review first — the ROI ranking there is why these are in this order.

## Rules for every run

1. **Leave the app working.** No run may end with a partially migrated concept.
   Add the new path alongside the old, migrate, then delete the old one — in
   that run.
2. **Verify behaviourally.** A test that greps source proves wiring exists, not
   that it works. Today an entire feature was silently dead while every
   source-level check passed. Where a source check is genuinely the only option,
   label it as a wiring guard and say so.
3. **Break every guard you write.** Re-introduce the bug and confirm the test
   goes red. Two assertions written today passed against the live bug
   (`Function.length` ignores defaulted params; `/fn\(([^)]*)\)/` stops at a
   nested paren). An assertion that cannot fail is worse than none.
4. **Codex is in this repo.** Check `git status` and file mtimes before starting;
   announce which files you are taking.
5. **Do not widen scope.** Each run lists what it must NOT touch.

---

## R1 — Make the mixer testable at runtime
**Depends on:** nothing. **ROI: 3.** Do this first.

**Goal.** Be able to assert what the mixer's audio graph actually *does*, in a
test, without a logged-in browser.

**Why first.** Every bug this month was invisible to the suite: transpose was
dead in Overview, MIDI was double-shifted, the mixer emptied itself on a
double reload. None of it could be caught, because `MixerView` cannot mount in
the browser project (`bits-ui` + Tailwind fail to transform) and the real app is
auth-gated. Until this exists, every later run is unverifiable.

**Files.** `vite.config.js`, a new `src/lib/audio/testing/` harness, one proof
test.

**Steps.**
1. Diagnose the `bits-ui`/Tailwind failure in the browser project — likely the
   `@tailwindcss/vite` plugin transforming `?svelte&type=style` virtual modules.
   Fix the config so components that import `bits-ui` can mount.
2. If that proves intractable, take the alternative: extract the mixer's
   orchestration far enough that it can be driven headlessly (this overlaps R8 —
   do the minimum, not the whole extraction).
3. Ship one test that mounts the mixer chain and asserts a real audio fact —
   e.g. with a personal transpose of −2 the engine's playback rate becomes
   `2^(-2/12)`.

**Done when.** A test fails if the transpose prop chain is broken, and passes
when it is intact.

**DONE 2026-07-31.** `vite.config.js` now (a) makes Tailwind skip vendor Svelte
virtual style modules, (b) aliases `$env/dynamic/*` to a stub, (c) adds a browser
setup file. `MixerPanel` mounts, and
`mixerTransposeRuntime.browser.test.ts` asserts the engine's playback rate for
five transpose/dial combinations.

It immediately caught a real bug: MixerView's transpose `$effect` read `engine`,
a plain `let` and therefore non-reactive, so it ran once at mount while the
engine was still null and never again — a song opened with a transpose already
set never had the rate applied. Fixed by gating on `engineReady` (`$state`).

**Known gap, deliberately left:** the harness mounts `MixerPanel` directly, so
it does NOT cover the `/edit` -> `MixerPanel` hop. Removing the
`transposeSemitones` prop from the route still passes. Keep the source guard in
`transposeCoverage.test.ts` for that hop until a run mounts the route itself.

**Do NOT.** Refactor any audio code in this run.

---

## R2 — Stop indexing audio nodes by creation order
**Depends on:** nothing (can run parallel to R1). **ROI: 2, but it is a toll booth.**

**Goal.** No test may depend on the order in which an engine constructs nodes.

**Why.** Adding one `GainNode` to `MixerEngine` broke 68 tests. Every run below
adds or moves nodes; without this each one pays that tax and is tempted to skip
the refactor instead.

**Files.** `mixerEngine.suppress.test.ts`, `transport.test.ts`,
`mixerEngine.bus.test.ts`, and any other `createdGains[N]` user.

**Steps.**
1. Give the mock context a way to label nodes, or look them up through the
   engine's own maps (`trackGains.get(key)` — already done in
   `mixerEngine.suppress.test.ts`, copy that).
2. Remove every positional index. `transport.test.ts` currently uses a named
   `ENGINE_INTERNAL_GAINS` constant — that was a stopgap, not the fix.

**Done when.** Adding a `createGain()` to `MixerEngine`'s constructor breaks
nothing. Prove it: add one temporarily, run the suite, remove it.

**DONE 2026-07-31.** `UnifiedTransport` gained `clickMasterForTest` /
`songTrackGainForTest` (same precedent as `engineRateForTest`,
`keysPointsForTest`), and every `createdGains[N]` is gone. Verified by adding an
internal `GainNode` and re-running the suite: zero positional failures.

---

## R3 — One owned AudioContext
**Depends on:** R2. **ROI: 3.**

**Goal.** The app constructs **one** hardware `AudioContext` and injects it.

**Why.** Six on a single `/edit` load against a browser cap of ~6. The seventh
throws, which is how a chord voice being enabled broke the cue renderer with no
traceable connection.

**Files.** new `src/lib/audio/audioDevice.ts`; `keysSynth.ts` (3 singleton
users: `chordPlayback.ts`, `chordBass.ts`, `chordArp.ts`), `chordKick.ts`,
`mixerEngine.ts:243`, `playbackController.svelte.ts:391`.

**Steps.**
1. `audioDevice.ts`: lazily create and hand out the single context; allow tests
   to inject one.
2. Point the chord-jam singletons at it. `KeysSynth.attachContext(ctx, {
   destination })` already exists — the mixer's chord lanes use it and add zero
   contexts. Only the jam singletons still self-construct.
3. `chordKick.ts` likewise.
4. Engines take a context rather than constructing one; default to the shared
   device so callers need not change.

**Done when.** A test asserts at most one hardware context is constructed for a
full editor+mixer session. Latency: `KeysSynth` used `latencyHint: 0` — confirm
the shared context uses the same hint, or measure that the keybed does not feel
worse.

**Do NOT.** Merge the engines (that is R10). One context, three engines is fine.

**DONE 2026-07-31.** `src/lib/audio/audioDevice.ts` owns the single hardware
context (`latencyHint: 0`, because the keybed plays through it). Migrated:
`KeysSynth`, `chordKick`, `MixerEngine` (now takes an optional context, so tests
and offline work can inject one) and `PlaybackController`.

Four more contexts were found that existed only to DECODE, and are now
`OfflineAudioContext` — they never held a hardware slot to begin with:
`drumKits.decodeToKitVoice`, `importedAudio`, `trimAudio`, `mixBackingTrack`
(plus `renderCueTrack`, converted earlier when it was the one actually throwing).

`KeysSynth.close()` no longer closes the context — it is process-wide now, and
closing it would silence every surface at once.

Tests get a per-test reset via `testing/resetAudioDevice.ts` in both projects,
so per-file `AudioContext` stubs are still observed.
`audioDevice.browser.test.ts` asserts two engines and three synths all share one
context; verified red by giving `KeysSynth` a private context again.

**Remaining hardware contexts, all outside the audio layer and short-lived:**
`DrumTrackPanel` (pad auditioning), `WaveformPlayer`, `edit/+page`, and two debug
routes. Worth folding in later; none is on the live path.

---

## R4 — Introduce `LaneSpec`, alongside the old code
**Depends on:** R2. **ROI: 3.**

**Goal.** One declarative description of what a lane IS. Nothing migrated yet.

**Files.** new `src/lib/audio/laneSpec.ts` + test.

**Steps.**
1. Define the type and the registry:
   ```ts
   type LaneSpec = {
     key: string
     kind: 'recorded' | 'midi'
     placesItself: boolean                  // PREBAKED_PREAMBLE_LANE_KEYS
     transpose: 'notes' | 'rate' | 'none'   // the six scattered pitch literals
     editor?: 'drum' | 'bass' | 'keys' | 'arp'
     hidden?: boolean
     liveSlotHint?: string
   }
   ```
2. Populate it for every lane that exists today: `original`, `stem:*`, `click`,
   `cue`, `drums-gen`, `bass-gen`, `drum-machine`, `bass-machine`,
   `chord-machine`, `arp-machine`.
3. Handle the `stem:*` prefix as a pattern, not 54 special cases.

**Done when.** A test asserts the registry reproduces today's answers for all
four existing `Set`s and for `laneHasPrebakedPreamble`, lane by lane. Nothing
else imports it yet.

**Do NOT.** Change any behaviour. This run is additive only.

---

## R5 — Migrate lane classification to `LaneSpec`
**Depends on:** R4. **ROI: 3.**

**Goal.** Delete the four `Set`s and the 54 key-string comparisons.

**Files.** `MixerView.svelte`, `laneAlignment.ts`, `xairRouting.ts`,
`liveMidiMap.ts`, `mixerEngine.ts`.

**Steps.**
1. Replace `PREBAKED_PREAMBLE_LANE_KEYS`, `EDITABLE_LANE_KEYS`,
   `HIDDEN_LANE_KEYS`, `PITCHED_MACHINE_LANES` with registry lookups.
2. Replace `key === 'drum-machine'`, `key.startsWith('stem:')` etc. throughout.
3. Delete `laneAlignment.ts`'s source-scraping guard — it exists only because
   the list was hand-maintained. The registry makes it unnecessary.

**Done when.** Grep finds zero `=== 'drum-machine'`-style comparisons outside
the registry. Adding a lane to the registry makes it clickable, aligned and
routable with no other edit — prove it by adding a throwaway lane in a test.

**Note.** This is the biggest single run. If it feels like more than one session,
split at the hardware boundary: mixer first, `xairRouting`/`liveMidiMap` second.

---

## R6 — One `TransposePlan`
**Depends on:** R4. **ROI: 3.**

**Goal.** One function turns a semitone offset into everything downstream.

**Files.** `varispeed.ts` (extend `varispeedPlan`), `MixerView.svelte`,
`+page.svelte`, `MixerPanel.svelte`.

**Steps.**
1. Extend the plan to carry the whole decision:
   ```ts
   { rate, audioShiftSemitones, noteSemitones, shifterLatencySec }
   ```
2. Both surfaces derive it once and pass the plan — not loose semitones plus two
   booleans through three components.
3. Fix the value-source split noted in review §2.8 AND §2.15. The editor writes a
   per-device localStorage key; `transpose.baseSemitones` is read in six places
   and written nowhere, so the fallback is always 0. Consequences to fix in this
   run:
   - **the live stage (`/project/playback`) is permanently untransposed** — it
     mounts `MixerView` with no transpose props at all;
   - lead sheet, MusicXML and PDF export always render at concert pitch.

   Make the transpose a store both surfaces read, rather than a value
   hand-carried by props. `effectiveTransposeSemitones(songMap, localOffset)`
   already has the parameter for it.

**Done when.** The R1 harness proves that setting −2 on the editor changes the
mixer's rate, and that `tempoHold` moves the split between rate and shift.

**DONE 2026-07-31.** `src/lib/stores/transposeSettings.svelte.ts` now owns the
offset (per song, per device), the varispeed switch and the dial, and derives
`plan = { rate, shiftSemitones, noteSemitones }` once. It resolves its own song
identity from `project` + `songMap`, so **a surface gets transpose by importing
it — there are no props to forget.** `/edit` and `MixerView` both read it; the
prop overrides survive only for hosts that must force a value.

- **The live stage transposes now.** `/project/playback` still mounts the mixer
  with no transpose props at all; three tests in
  `mixerTransposeRuntime.browser.test.ts` mount it exactly that way and assert
  the engine's rate. Verified red when the store lookup is removed.
- Storage keys are unchanged (`barbro::xpose::<songId>::<title>`), so existing
  per-song offsets carry over.
- `transposeCoverage.test.ts` now asserts **one module** mentions those keys —
  a direct encoding of "no double knowledge". Verified red by planting the key
  in `MixerView`.

**Still open, deliberately:** lead sheet / MusicXML / PDF export still call
`effectiveTransposeSemitones($songMap)`, which is always 0. Whether an export
should follow a personal transpose is a product decision, not a bug fix.

---

## R6a — Decide the send/return topology under transpose
**Depends on:** R6. **ROI: 3.** Fixes a live defect.

**Goal.** A reverb return comes back in the same key as the signal that fed it.

**Why.** `busReturnGains` connect straight to `masterGain` (mixerEngine.ts:328)
while the shifter sits on the recorded-audio sub-bus, so with the dial above 0 a
stem is shifted but its wet tail is not. Introduced 2026-07-31 by moving the
shifter off the master to stop MIDI being double-shifted.

**The decision this run must make.** A bus is fed by sends from BOTH recorded and
MIDI lanes, which want opposite treatment. Options:
1. Two return paths — recorded sends return pre-shifter, MIDI sends return
   post-shifter. Correct, costs a second return gain per bus.
2. Take recorded sends POST-shifter so everything downstream is already in the
   right key. Simpler graph; changes what the send is tapping.
3. Accept the wet tail being unshifted, and document it.

Pick one, write down why, and encode it in a test.

**Done when.** A graph test asserts that a recorded lane and its bus return
agree, and that a MIDI lane and its return agree, at a non-zero dial.

**DONE 2026-07-31 — option 2, with a stated deviation.**

Effect-bus returns now land on `audioBus`, i.e. PRE-shifter. A send taps the
track GAIN, so a recorded lane feeds the bus at ORIGINAL pitch; returning
pre-shifter means the wet tail gets transposed by the same shifter as its dry
signal. Previously every return went straight to the master and came back both
in the wrong key and early by the shifter's latency.

Spoken cues take the other path: `LiveCueScheduler` now connects to
`engine.unshiftedInput` instead of `masterGain`. A cue must never be
pitch-shifted — nobody wants a transposed voice — but it must still land on the
beat, and that path carries the latency compensation. The bus was renamed from
`midiBus` to `unshiftedBus` because that is what it means: *not pitch-shifted,
still in time*. MIDI lanes and cues both qualify.

**Deviation, deliberate and tested:** a MIDI lane's send is already at final
pitch, so its wet tail receives the residual shift once too often. It applies
only with the dial above 0 and only to the wet portion. Correcting it needs a
second chain instance per bus (double the DSP for a shared reverb), which is not
worth it today. `audioPitchShiftRouting.test.ts` pins the behaviour so the
trade-off stays deliberate rather than being rediscovered as a bug.

---

## R7 — One mix-time → context-time clock
**Depends on:** R6. **ROI: 3.**

**Goal.** Delete three copies of the scheduling math and three copies of the
window constants.

**Files.** new `src/lib/audio/scheduleClock.ts`; `drumMidiInstrument.ts`,
`bassMidiInstrument.ts`, `keysMidiInstrument.ts`.

**Steps.**
1. Extract the anchor + `ctxTimeFor(mixTime)` + rolling-window bookkeeping that
   all three instruments currently duplicate.
2. Each instrument keeps only what is genuinely its own: how to build a voice,
   and its `transpose` behaviour — which now comes from its `LaneSpec`, not a
   literal inside its node construction.
3. Move `SCHEDULE_WINDOW_SEC` / refill threshold into the clock.

**Done when.** `grep "atCtx + delta"` returns one hit. Existing timing tests
(`drumTransposeImmunity`, `midiTransposeNotDoubled`, the drum fidelity test)
still pass untouched — they are the regression net for this run.

**Do NOT.** Change any timing behaviour. This is a pure extraction; the fidelity
test measuring 0.00 dB / 1.0000 correlation must stay exactly that.

---

## R8 — Lift orchestration out of `MixerView`
**Depends on:** R5. **ROI: 2.**

**Goal.** `MixerView.svelte` (4188 lines, 24 `$effect`s) becomes a view.

**Files.** new `src/lib/audio/mixerSession.ts` (or `.svelte.ts`),
`MixerView.svelte`.

**Steps.**
1. Move the lane plan, load/reload pipeline, refresh queue and lane-state
   persistence into a service the component drives.
2. Fold in `mixerReloadSerialization.ts` — that serializer exists because
   `reload()` was not re-entrant and two overlapping calls emptied the mixer.
3. Audit the 24 `$effect`s against the house rule: keep only those syncing into
   non-reactive sinks (audio nodes, rAF, listeners). Convert the rest to
   `$derived`.

**Done when.** The load pipeline has direct unit tests. `$effect` count in the
component is in single digits.

---

## R9 — Unify the chord-jam settings
**Depends on:** nothing. **ROI: 2.** Standalone — good filler run.

**Goal.** One set of chord/bass/arp/kick settings.

**Why.** `TimelineWorkspace.svelte` keeps ~24 of its own `$state` knobs, and
`chordJam` keeps its own — writing the **same** localStorage keys. They cross
only on remount, and `syncSettings()` can overwrite the other surface's edit. It
has already caused a silent revert and a silent-lane bug.

**Files.** `chordJam.svelte.ts`, `TimelineWorkspace.svelte`.

**Steps.**
1. Lift the kick voice (`barbro:chordKick*`) into `chordJam` — the only thing it
   currently lacks.
2. Reconcile the two disagreeing defaults (`bassVolume` 0.75 vs 0.6) and drop
   the tab's `v > 0` guard that refuses a stored zero.
3. Repoint `TimelineWorkspace` at `chordJam.*`; delete its local state and its
   persistence effects. Keep `stemPunchOn/Amount` local — it is a transport
   monitor, not a jam voice.

**Done when.** Changing a knob in the Chords tab is immediately live in the
mixer with no remount. Keys are byte-identical, so existing user settings
survive — verify with a stored-settings test.

---

## R10 — Later, and only with a reason
**ROI: 1.** Do not start these speculatively.

- **Generate offline + live DSP from one description.** `drumBus.ts` (pure) and
  `drumBusLive.ts` (nodes) implement the same four stages twice. Currently
  correct and locked by a fidelity test. Do it when the chain next changes.
- **Merge the three transports.** `MixerEngine`, `PlaybackController` and
  `UnifiedTransport` duplicate position/seek/auto-stop. Large, risky, and after
  R3 and R7 most of the concrete pain is gone.

---

## Order

```
R1 ─┬─> R3 ──────────────┐
R2 ─┴─> R4 ─> R5 ─> R8 ──┴─> R10
         └──> R6 ─> R7
R9  (any time)
```

R1 and R2 first: until the suite can see behaviour and survive a node being
added, every later run is both unverifiable and expensive.
