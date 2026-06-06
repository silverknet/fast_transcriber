# Agent collaboration notes

Living scratchpad while Claude + Codex both work on this repo. Append; do not delete others' entries unless they're explicitly marked stale.

Format: `## YYYY-MM-DD HH:MM — agent (branch) — topic`. One section per touch.

---

## 2026-06-06 — claude (improved-analyze-state) — Centralized playback engine refactor

**Plan file:** `/Users/martin/.claude/plans/write-the-more-long-snoopy-crown.md` (approved by user).

**Where we are in the plan:**

- ✅ Step 1 — `cues.spokenIntroText` schema + speech + fingerprint. Shipped.
- ✅ Step 2 — `src/lib/songmap/playbackPlan.ts` — single timing function consumed by editor + Ableton + renderers. Shipped, all renderers + Ableton orchestrator migrated.
- ✅ Step 3 — `src/lib/audio/playbackController.svelte.ts` — Svelte 5 rune class, single runtime owner per playback surface. 17 tests.
- ✅ Step 3.5 — Fixed three sync bugs in the controller:
  1. **Lookahead scheduling**: clicks within the 25 ms rAF window were all firing at `ctx.currentTime + LEAD` → up to 23 ms early. Fix: schedule each click at `ctxNow + (clickPoint.timeSec − planTime)`.
  2. **Time-base mismatch**: `plan.clickPoints[].timeSec` is trim-shifted, but the grid-view `<audio>` element plays the FULL uploaded file (original-time). Added `mediaTimeOffsetSec` so each surface declares its own audio→plan offset. Grid: `offset = plan.trimStartSec`. Cue mix preview: `offset = plan.titlePreludeSec + plan.prependSec`.
  3. **Past-click drop**: on seek/jump/wrong-offset the loop used to dump every missed click into "now". Now any click >18 ms in the past is dropped silently.

  All three bugs have explicit regression tests under "PlaybackController click sync — the math the user relies on" in `playbackController.test.ts`. **Don't relax them without flagging here** — they're the load-bearing tests for live grid-mode sync.

  302/302 full suite green. 0 type errors.

- ✅ Step 3.6 (hotfix) — Same delta + past-drop scheduling math applied IN PLACE to `WaveformPlayer.svelte`'s existing click loop so live grid clicks land on the beat TODAY (user was hearing audible drift). Step 4 still deletes this loop and migrates to the controller; this is a holdover.
- ⏳ Step 4 — Migrate `WaveformPlayer.svelte` to the controller; delete the local click loop / `audioTransport` import / click toolbar UI. **Pre-req before starting:** confirm in browser that the Step 3.6 hotfix made grid clicks audible-in-sync, because if it didn't, the bug is somewhere else and porting the loop won't fix anything. **(User confirmed 2026-06-06: grid clicks now sync.)**
- ⏳ Step 5 — Delete `audioTransport`, `beatsToClickPoints`, `mixTimelineClickPoints`.
- ✅ Step 6a — Count-in ghost ticks + per-bar "Set as start" in `TimelineBeatGrid.svelte`. Ghost ticks come from `songPlaybackPlan(sm).clickPoints` (count-in entries) shifted into original-time; parent passes them via the new `countInTicks` prop. Per-bar anchor button: dim by default, full opacity + amber on the current start bar, full opacity on hover. Click → parent's `setStartBar(barIndex)` → `applyStartBeat` → `startBeatId` updates → plan re-derives → ticks shift / click loop respects new anchor. One write, every consumer follows. No new tests (the underlying plan math is already pinned by `playbackPlan.test.ts`); browser verification is the right gate here.
- ✅ Step 6a-followup — Count-in **audio**: cases (1) natural lead-in (`prependSec === 0`) → count-in ticks merge into `cachedClickPoints`, fire inline as audio plays through. Case (2) tight trim (`prependSec > 0`) → `startCountInPreroll()` pre-schedules N count-in clicks via Web Audio at `ctx.currentTime + i*beatDur` and `setTimeout`-defers `audio.play()` by `prependSec * 1000`. Click loop excludes count-in in case (2) to prevent double-fire. Mid-song play (currentTime > firstDownbeatOriginalSec) skips count-in entirely. Stop / Pause cancels the pending deferred play. Same structural pattern as `PlaybackController.play()` — the bug-class-killer the user kept hitting.
- ✅ Step 6b — Reset-grid affordance. `timeline.original?: { bars; beats }` added to schema; `mergeAnalysisIntoSongMap` captures it on full analyses (deep-copied so live edits can't mutate the snapshot); partial fragments preserve the existing snapshot; subsequent full analyses overwrite it. Helpers: `resetTimelineToOriginal(map)` returns a new map; `timelineMatchesOriginal(map)` powers the disabled-state. UI: "Grid edits" panel in the edit page's grid mode, only rendered when a snapshot exists. Two-step inline confirm pattern (no modal) auto-cancels after 4s. 13 unit tests cover capture/preserve/overwrite/round-trip behavior. Existing songs without a snapshot don't see the section — they can re-analyze to opt in.
- ✅ Step 7 — `spokenIntroText` input in the Cue tab. Single text field in a new fieldset; placeholder = song title; clearing the input restores the title fallback (we store `undefined` not `""` so semantic distinction stays clean). Live readout (`Will announce: "…"`) reads `resolvedSpokenIntroText(sm)` so the user always sees what Piper will say. Writes through `patchSongMap`; the cue WAV fingerprint already includes this field (Step 1), so the cache invalidates and the badge flips to "Stale" automatically.
- ⏳ Step 8 — Cue mix preview on a second `PlaybackController`; render `mixPreviewAudioEl`; delete the parallel click loop + every no-op shim in `+page.svelte`.

**Files I'm actively touching:**

- `src/lib/audio/playbackController.svelte.ts` + `.test.ts`
- (Next) `src/lib/components/WaveformPlayer.svelte`
- (Next) `src/lib/components/TimelineBeatGrid.svelte`
- (Next) `src/routes/edit/+page.svelte` (grid editor + cue mix preview wiring)

**Files I'd prefer to NOT collide on while this is in flight:**

- `src/lib/songmap/playbackPlan.ts` (just stabilized — please don't refactor without flagging here)
- `src/lib/export/setlist/timings.ts` (now a projection of `songPlaybackPlan`; touch only if Ableton math needs changing)
- `src/lib/audio/renderCueTrack.ts`, `src/lib/audio/mixSongCuePreview.ts` (just migrated to `songPlaybackPlan`)
- `src/lib/audio/cueTrackSpeechSchedule.ts` (resolved-spoken-intro helper just landed)
- `src/lib/songmap/cueTrackFingerprint.ts` (v4 payload)

If you need to touch any of these, leave a note below first so I can pause/rebase.

**Things I am NOT touching:**

- `MixerEngine` / `MixerView` (Mix tab) — out of scope for this refactor per plan.
- Desktop sidecar (`desktop/`) — unrelated.
- Auth, schema migrations, supabase — unrelated.

**Sync-math invariants I'm enforcing (don't break these):**

- `audio-element-time` (`plan.clickPoints[].timeSec`) is **trim-shifted song-time**: `0` = `audio.trim.startSec` in original-time. Negative values = count-in (pre-roll).
- Each playback surface declares its `mediaTimeOffsetSec` so `audio.currentTime − offset = plan-time`:
  - Grid editor: `offset = plan.trimStartSec` (audio src = full file, currentTime = original).
  - Cue mix preview: `offset = plan.titlePreludeSec + plan.prependSec` (audio src = synthesized mix WAV).
- Clicks scheduled via `ctx.currentTime + (clickPoint.timeSec − planTime)`, never at "now".
- `songPlaybackPlan(sm)` is the only place beat math happens. No second derivation anywhere.

Free to message back here when you start work — even just "looking at X, won't touch Y."
