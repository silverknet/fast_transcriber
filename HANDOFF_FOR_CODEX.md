# Handoff to Codex — playback engine refactor

Written by Claude 2026-06-06. Pick this up when Claude's session ends; the running notes scratchpad is in `AGENT_NOTES.md` and should also be skimmed.

The user is **Martin** (`martincbhak@gmail.com`). His style: terse, allergic to half-measures, will tell you when something feels forced. He's been explicit that the `.smap` is the root of truth and that he wants `$derived` everywhere, `$effect` almost nowhere. Read the user-facing memory rules (don't say "Python" / "venv" / "downloads N MB" / "one-time install" — short heading + progress only).

The approved plan file is at `/Users/martin/.claude/plans/write-the-more-long-snoopy-crown.md`. Skim it before doing the remaining steps so you understand the layer model.

---

## Where we are

Branch: `improved-analyze-state`. Main: `main`. Don't push without asking.

### Shipped (in commit order)

- `e5e0ecf` — Step 2: `songPlaybackPlan(sm)` — the ONE timing function. Live grid + Ableton orchestrator + cue WAV renderer + mix preview WAV builder all project from this. Lives in `src/lib/songmap/playbackPlan.ts`. Don't add second derivations elsewhere.
- `352d3f3` — Step 1: `cues.spokenIntroText` schema + threading through speech rendering + fingerprint (v4 payload).
- `55885f6` — Step 3 + 3.5 + 3.6: `src/lib/audio/playbackController.svelte.ts` (Svelte 5 rune class with three documented sync-math invariants and 21 unit tests). Same delta-scheduling + past-drop math applied IN PLACE to `WaveformPlayer.svelte`'s old click loop so grid clicks sync today.
- `7970680` — Step 6b: Reset grid. Schema delta `timeline.original?: { bars; beats }` captured at full-analysis merge time. UI in edit page grid mode with a two-step inline confirm.
- `6d5dc64` — Step 6a: Count-in ghost ticks (visible BEFORE bar 1) + per-bar "Set as start" anchor button. Reactivity demo: `countInBeats` 4 → 8 → 4 new ticks appear instantly.
- `f2ea509` — Step 6a-followup: count-in **audio** for tight-trim songs. Web Audio pre-roll + `setTimeout`-deferred `audio.play()`. Same structural pattern as `PlaybackController.play()`. No pause-and-resume race.
- `9b2d688` — Step 7: `spokenIntroText` input in Cue tab with live readout (`Will announce: "…"`).

Full suite is 315 tests, 0 type errors at HEAD.

### Shipped after this handoff was first written

- `0f68d7a` — Step 8 deleted (cue mix preview was unreachable; the Mix tab supersedes it).
- `e8025fc` — Controller pause-during-pre-roll bug fix + Phase A of Step 4 (controller hooked to audio element, dormant for click).
- `00b5d4f` — Step 4 phases B + C (delete WaveformPlayer's local click loop + count-in pre-roll).
- `d184413` — Step 4 phase D + Step 5 (delete `audioTransport`, `beatsToClickPoints`; `currentTime` / `isPlaying` become `$derived`).
- `9984ddd` — No-op shim cleanup (`stopClickLoop` / `cancelPendingAudioStart` removed from edit page).

### Not yet shipped

- **Step 4 phase E** — Move the click toolbar UI (play-with-click checkbox + volume popover) out of `WaveformPlayer.svelte` into a compact strip beneath it (per the plan's Layer 4). Purely cosmetic. The state itself is already `$bindable` and forwarded into the controller, so moving the chrome is a re-parenting exercise — no behavioral change.

---

## Architecture principles (don't violate these)

1. **`.smap` is the root of truth.** Every observable in the editor — count-in beats, song-start anchor, spoken intro, click positions, prepend silence, Ableton play-ranges — is **derived** from `.smap` fields. Runtime layer is a thin lens. The user has called this out specifically; he notices when something feels "bridged".
2. **`$derived` everywhere, `$effect` almost nowhere.** Only use `$effect` to sync reactive state into non-reactive sinks (DOM elements, Web Audio nodes, rAF loops). Everything else is `$derived`. The `PlaybackController` has exactly THREE `$effect`s and you can count them.
3. **One timing function:** `songPlaybackPlan(sm)`. Don't add a second derivation of "where do clicks land" anywhere. Renderers, Ableton orchestrator, mix preview, and live click loops all project from it.
4. **Editor and Ableton stay in lockstep.** What you hear in grid IS what the exported `.als` will play. The `songTimings(sm)` helper in `src/lib/export/setlist/timings.ts` is now a thin projection of `songPlaybackPlan`. Don't drift them.
5. **No pause-and-resume for count-in.** This was the bug Martin kept hitting. Always Web Audio pre-schedule + setTimeout-defer `play()`. Pattern is documented in `PlaybackController.play()`.

---

## The three sync bugs (will burn you if you regress)

These are caught by `src/lib/audio/playbackController.test.ts > "click sync — the math the user relies on"`. Don't relax those tests.

1. **Lookahead scheduling:** A click whose `timeSec` is within the rAF lookahead window must be scheduled at `ctxNow + (clickPoint.timeSec − planTime)`, NOT at `ctxNow + LEAD`. The naive "all clicks fire at LEAD" pattern fires every in-window click up to `CLICK_LOOKAHEAD_SEC` early (23 ms — audibly off).
2. **Time-base mismatch:** `plan.clickPoints[].timeSec` is **trim-shifted** (`0` = `trim.startSec`). Each playback surface's audio element has its own time base:
   - Grid editor: `audio.src = full uploaded file`, so `audio.currentTime` is original-time. `mediaTimeOffsetSec = plan.trimStartSec`.
   - Cue mix preview: `audio.src = synthesized mix WAV`. `mediaTimeOffsetSec = plan.titlePreludeSec + plan.prependSec`.
   - The OLD WaveformPlayer click loop happens to use original-time on both sides (it builds clickPoints from `beatGrid.beats[].timeSec` directly), so the offset is implicitly 0. Be careful when migrating it onto the controller — don't double-shift.
3. **Past-click drop:** On seek/jump/wrong-offset, the loop will dump every missed click into "now" unless you skip clicks older than `CLICK_PAST_GRACE_SEC` (18 ms). The same constant is used in `WaveformPlayer.svelte`'s hotfixed loop.

---

## Files you'll touch

### Plan layer (changes need broader buy-in)
- `src/lib/songmap/playbackPlan.ts` + `.test.ts` — the canonical plan. Don't add a second one. If you change it, run all 32 Ableton tests (`timings.test.ts` + `sync.test.ts`).
- `src/lib/songmap/types.ts` — Schema delta is in V1; bump `SONGMAP_FORMAT_VERSION` if you add fields that aren't optional with backward-compatible defaults.
- `src/lib/songmap/merge.ts` — Captures `timeline.original` snapshot. Don't blow it away on partial merges.

### Runtime
- `src/lib/audio/playbackController.svelte.ts` — Svelte 5 rune class. **Use this as the reference implementation for click loop / count-in / volume sync.** It's tested.
- `src/lib/components/WaveformPlayer.svelte` — Still has its own click loop with the same delta + past-drop math. Step 4 deletes this in favor of the controller.
- `src/routes/edit/+page.svelte` — Hosts the editor. Big file (~2k lines). The cue mix preview state is dead-coded — see Step 8 caveat above.

### Tests
- `src/lib/audio/playbackController.test.ts` — 21 tests. The sync precision ones are LOAD-BEARING — don't relax them.
- `src/lib/songmap/timelineEdit.test.ts` — 13 reset-grid tests added; covers capture / deep-copy / preserve / overwrite / round-trip.
- `src/lib/audio/cueTrackSpeechSchedule.test.ts` — has `spokenIntroText` fallback tests.

### Don't touch unless flagged here
- `src/lib/audio/mixerEngine.ts`, `src/lib/components/MixerView.svelte` — Mix tab; out of scope for this refactor.
- Desktop sidecar (`desktop/`) — unrelated to playback work.
- Auth, supabase, admin routes — unrelated.

---

## Pitfalls Martin will call you on

- **Mixing original-time and trim-shifted time without the offset.** This is the failure mode he caught me on. Always declare which time base a number is in; convert at the boundary; never assume.
- **Writing user-facing copy that mentions internals.** No "Python", "venv", "downloads N MB", "one-time install", "snapshot", "baseline". Use concrete user-language: "analyzed grid", "your bar and beat edits", "the song title".
- **$effect for things that should be $derived.** If the value is computable from other reactive state, it's a `$derived`. Use `$effect` only when you need to mutate something that can't be derived (a DOM element, an AudioContext, a rAF loop).
- **Big atomic refactors of working code.** Take Step 4 incrementally: add the controller as an optional prop, keep the old code running, migrate piece by piece, browser-verify each. Don't rip and replace.
- **Skipping browser verification.** There's a memory rule: "test fixes end-to-end before shipping; don't use user as test runner." For UI changes, run `npm run dev` and click through the affected flow. State this honestly if you can't verify in your environment.
- **Committing unrelated changes.** The working tree has `.gitignore`, `AGENTS.md`, admin routes, docs etc. that are NOT mine. Stage only the files you actually touched.

---

## Recommended next move

If Martin hasn't given new direction, start with the lowest-risk highest-leverage task:

1. **Cleanup pass (small commit):**
   - Delete the no-op shims `stopClickLoop()` and `cancelPendingAudioStart()` in `src/routes/edit/+page.svelte` (lines ~1165-1170) and their call sites (a handful). Run `npm run check` after.
   - This is contained, won't break anything, and reduces confusion before Step 4.

2. **Ask Martin about Step 8** (cue mix preview) — wire it up vs delete it. The answer changes how much Step 5 cleans up.

3. **Then Step 4** — controller migration. Do it like this:
   - Phase A: Add `controller: PlaybackController` as an optional prop on `WaveformPlayer.svelte`. When provided, the parent owns the controller; WaveformPlayer hands it the audio element via `controller.setAudioElement(audioEl)` in `$effect`. Don't change any internal behavior yet. Verify in browser.
   - Phase B: Route the play button through `controller.play()` (controller does count-in pre-roll). Delete the local count-in code. Verify.
   - Phase C: Delete the local click loop (`cachedClickPoints`, `runClickLoop`, etc.) and rely on the controller's loop. Delete the click-related `$bindable` props. Verify.
   - Phase D: Delete the `audioTransport` import and rely on the controller's transport. Verify.
   - Phase E: Move the click toolbar UI out of WaveformPlayer into a compact strip beneath it (per the plan's Layer 4).

4. **Then Step 5 + Step 8** — depending on Martin's call on Step 8.

---

## Test invocation reference

```
npm test                                    # unit suite (~2s, 326 tests)
npm run test:watch                          # unit suite, watch
npm run test:browser                        # browser suite (~7s, 6 tests in Chromium)
npm run test:all                            # both projects (332 tests)
npx vitest run path/to/spec.test.ts         # one file
npm run check                               # svelte-check (0 errors expected)
npm run dev                                 # start dev server
```

**Property-based tests** (`*.property.test.ts`) live in the unit project
and use `fast-check`. They generate hundreds of valid input shapes and
check invariants that are too tedious to cover by example:

- `playbackPlan.property.test.ts` — 10 properties of `songPlaybackPlan`:
  click points sorted, count-in spacing, `prependSec` formula,
  song-click trim window, etc. Caught one wrong assumption already
  (a property fired and the minimised counter-example revealed an
  edge case where `firstDownbeat` < `trim.startSec`).
- `timelineEdit.test.ts` — "any sequence of bar edits + reset reproduces
  the snapshot exactly". 100 randomised edit sequences per run.

**Browser tests** are the regression catcher for everything the mocked
unit tests can't see — `$effect` graph ordering, real `audio.play()`
lifecycle, real `AudioContext` (oscillator counts as a click proxy),
autoplay-policy edge cases. They live in `*.browser.test.ts` files
and run only via `test:browser` (excluded from `npm test`).

The browser project passes `--autoplay-policy=no-user-gesture-required`
to Chromium so `<audio>.play()` resolves without an artificial click
prelude. The optimizer is told to skip `bits-ui` and `@lucide/svelte`
because they ship unbundled `.svelte` files that esbuild can't load
(and the tests don't need them).

---

## When something goes wrong

- **Tests pass but live UI is wrong:** It's a Svelte runtime thing the unit tests can't catch (rAF timing, $effect ordering, DOM mount timing). Verify in browser; don't just look at types + tests.
- **Live UI works but tests fail:** Probably the new code added a clock the mock doesn't simulate. Look at `playbackController.test.ts`'s `MockAudioContext` and `MockAudioElement` for the existing patterns.
- **Ableton + editor drift:** You added a second timing derivation somewhere. Find it. Both must call `songPlaybackPlan(sm)`.

Good luck.
