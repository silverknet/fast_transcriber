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
- ✅ Cleanup — Deleted the no-op `stopClickLoop()` / `cancelPendingAudioStart()` shims in `edit/+page.svelte` and their five call sites. They existed as compile placeholders during an earlier mid-refactor state; everything they were "protecting" is fully migrated now. -16 lines.
- ✅ Cleanup — Deleted the entire cue-mix-preview path: `prepareMixPreview`, `mixPreviewGate`, `runMixClickLoop` / `syncMixNextClickIdx` / `stopMixClickLoop` / `startMixClickLoopFromCurrentTime`, `onMixPreviewPlay` / `onMixPreviewPause` / `onMixPreviewEnded`, `pauseMixPreview`, all `mixPreview*` / `mixClick*` state, and the orphaned `src/lib/audio/mixSongCuePreview.ts` + its test (no remaining importers). The path was UNREACHABLE — `prepareMixPreview` was defined but never called from any template. ~163 lines from `edit/+page.svelte` + 187 lines of audio code. Step 8 supersedes this entirely; if the cue mix preview ever comes back it'd be wired through the second `PlaybackController` pattern, not these resurrected functions.
- 🔧 Step 4 (in progress) — Migrate `WaveformPlayer.svelte` to the controller; delete the local click loop / `audioTransport` import / click toolbar UI. Recommended phased approach is in `HANDOFF_FOR_CODEX.md`.
  - ✅ **Controller bug fix** — pause/stop/destroy during count-in pre-roll now cancel the deferred `audio.play()`. Was firing audio anyway because `isPlaying` guard wasn't true yet. 3 new regression tests pin it.
  - ✅ **Phase A** — controller instantiated in parent; songMap / rangeStart / rangeEnd / volumes fed via `$effect`s; WaveformPlayer hands it the `<audio>` element.
  - ✅ **Phases B + C** — `togglePlay` / `stopPlayback` dispatch to `controller.play()` / `controller.stop()` instead of `transport.X(tbind())`. Click loop + count-in pre-roll DELETED from WaveformPlayer (~150 lines: `cachedClickPoints`, `runClickLoop`, `startClickLoop`, `stopClickLoop`, `syncNextClickIndex`, `ensureClickGraph`, `clickCtx`, `clickMaster`, `clickLoopRaf`, `nextClickIdx`, click sync constants, the click-restart `$effect`, the click-volume + song-volume sync `$effects`, `startCountInPreroll`, `cancelPendingCountInPlay`, `pendingPlayTimeoutId`). The controller now owns all of this. Props `countInPrependSec` + `firstDownbeatOriginalSec` dropped from WaveformPlayer + parent. WaveformPlayer's `controller` prop falls back to a local instance for the trim variant (home page) so callers that don't pass one keep working.
  - ✅ **Phase D** — `currentTime` / `isPlaying` are now `$derived(controller.currentTime)` / `$derived(controller.isPlaying)`. `tbind()` deleted. `audioTransport` import deleted. Audio tag's `onplay` / `onpause` / `onended` / `ontimeupdate` handlers deleted (controller attaches its own via `$effect`). `transport.ensurePlayheadInRange(tbind())` inlined as a simple range check. `commitMediaTiming` / `loadFile` now route the paused-state currentTime sync through `controller.seek(t)` rather than direct `currentTime = t` writes.
  - ✅ **Step 5** — Deleted `src/lib/audio/audioTransport.ts` (no remaining importers). Trimmed `BeatClickPoint` + `beatsToClickPoints` from `src/lib/audio/debugClickTrack.ts` (also unused). Net: -130 lines of audio glue, one rAF loop, one event-listener wire-up. The only thing that still mirrors `audio.currentTime` is the controller's `#tickTransport`.
  - ⏳ **Phase E** — move click toolbar UI out of WaveformPlayer into a compact strip beneath it (per the plan's Layer 4). Cosmetic; can defer.
- ⏳ Step 5 — Delete `audioTransport`, `beatsToClickPoints`, `mixTimelineClickPoints`.
- ✅ Step 6a — Count-in ghost ticks + per-bar "Set as start" in `TimelineBeatGrid.svelte`. Ghost ticks come from `songPlaybackPlan(sm).clickPoints` (count-in entries) shifted into original-time; parent passes them via the new `countInTicks` prop. Per-bar anchor button: dim by default, full opacity + amber on the current start bar, full opacity on hover. Click → parent's `setStartBar(barIndex)` → `applyStartBeat` → `startBeatId` updates → plan re-derives → ticks shift / click loop respects new anchor. One write, every consumer follows. No new tests (the underlying plan math is already pinned by `playbackPlan.test.ts`); browser verification is the right gate here.
- ✅ Step 6a-followup — Count-in **audio**: cases (1) natural lead-in (`prependSec === 0`) → count-in ticks merge into `cachedClickPoints`, fire inline as audio plays through. Case (2) tight trim (`prependSec > 0`) → `startCountInPreroll()` pre-schedules N count-in clicks via Web Audio at `ctx.currentTime + i*beatDur` and `setTimeout`-defers `audio.play()` by `prependSec * 1000`. Click loop excludes count-in in case (2) to prevent double-fire. Mid-song play (currentTime > firstDownbeatOriginalSec) skips count-in entirely. Stop / Pause cancels the pending deferred play. Same structural pattern as `PlaybackController.play()` — the bug-class-killer the user kept hitting.
- ✅ Step 6b — Reset-grid affordance. `timeline.original?: { bars; beats }` added to schema; `mergeAnalysisIntoSongMap` captures it on full analyses (deep-copied so live edits can't mutate the snapshot); partial fragments preserve the existing snapshot; subsequent full analyses overwrite it. Helpers: `resetTimelineToOriginal(map)` returns a new map; `timelineMatchesOriginal(map)` powers the disabled-state. UI: "Grid edits" panel in the edit page's grid mode, only rendered when a snapshot exists. Two-step inline confirm pattern (no modal) auto-cancels after 4s. 13 unit tests cover capture/preserve/overwrite/round-trip behavior. Existing songs without a snapshot don't see the section — they can re-analyze to opt in.
- ✅ Step 7 — `spokenIntroText` input in the Cue tab. Single text field in a new fieldset; placeholder = song title; clearing the input restores the title fallback (we store `undefined` not `""` so semantic distinction stays clean). Live readout (`Will announce: "…"`) reads `resolvedSpokenIntroText(sm)` so the user always sees what Piper will say. Writes through `patchSongMap`; the cue WAV fingerprint already includes this field (Step 1), so the cache invalidates and the badge flips to "Stale" automatically.
- ⏳ Step 8 (revised) — Cue mix preview was deleted entirely (was unreachable). If the user wants it back later, instantiate a second `PlaybackController` for it (the dormant grid controller in `edit/+page.svelte` is the working template) and render a real `<audio bind:this>` in the Cue tab. No `mixPreviewAudioEl` state, no parallel click loop — the controller owns all of that.

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

## 2026-05-28 17:35 — claude (improved-analyze-state) — db:migrate hosted env quirk

`npm run db:migrate` against the hosted Supabase project fails with `ENOTFOUND db.<ref>.supabase.co` — direct 5432 host isn't resolvable from this network. Use the Management API path the cloud-auth-sync doc already calls out:

```bash
supabase link --project-ref <ref>      # one-time
supabase db query --linked --file db/migrations/<NNN>_xxx.sql
# Then record in the runner's bookkeeping so subsequent `db:migrate` invocations skip it:
echo "INSERT INTO public.schema_migrations (name) VALUES ('<NNN>_xxx.sql') ON CONFLICT DO NOTHING;" \
  | supabase db query --linked --file /dev/stdin
```

Migration 012 (`cloud_pending_invites`) was applied this way + back-filled. Future migrations targeting hosted Supabase should follow the same pattern unless someone fixes the DNS path.

## 2026-06-29 — claude (improved-analyze-state) — auto-stems + analyze/trim stability

Worked across several stability fixes this session (branch has intermingled
Codex YouTube work + earlier chord work — **stage only files you touched**):

- **Analyzing flow:** existing project songs were duplicated by the analyze
  flow (`commitNewSongToProject` always allocates a new folder). Added
  `updateActiveProjectSong` (in-place write) and route existing vs new in
  `analyzing/+page.svelte`. Also fixed a bounce-to-/project (open → no audio
  file → `/analyzing` → `/` → layout redirect): `onEditSong` now only enters
  `/analyzing` when a decoded file is actually present.
- **Editor trim persists:** `WaveformPlayer` gained `onSelectionCommit`
  (fires once on drag-release); `edit/+page.svelte` writes it to
  `sm.audio.trim` — gated to pre-analysis (`bars.length === 0`) so it can't
  desync an analyzed grid (re-trim of analyzed songs stays the job of
  Re-analyze).
- **Auto stem prep (new):** project-wide `autoStems` policy in the manifest
  (`ProjectSettingsDialog`, gear in project header, OFF by default). Scheduler
  `src/lib/client/autoStems.ts` (started in layout). Stability invariants:
  renders the FULL untrimmed file (trim-independent); only analyzed
  non-hidden songs with audio; WAV-health check re-renders partial files;
  per-song attempt cap (3); orphaned-job reaper `syncStemJobsWithSidecar`
  (uses new `listJobsResult` that distinguishes unreachable from zero-jobs)
  so a companion restart can't wedge a song; caps reset on
  reconnect/policy-change/project-switch; mid-tick project-switch guard;
  gave-up songs surface via `autoStemsAttention` → amber note in the card;
  in-progress stems glow amber.

**All green:** `npm run check` 0 errors, `npm test` 383 passing (pure cores +
reaper + parse round-trip covered). **NOT browser-verified** — the
sidecar/demucs background loop, a real mid-render kill, and trim drag need a
`npm run dev` + companion click-through. Known gap: replacing a song's audio
later won't invalidate stale stems (no replace-audio UI exists yet).

## 2026-06-29 (later) — claude — auto-stems: architecture pivot to sidecar + critical fix

Review feedback exposed two things:
1. **Orchestration was in the frontend** (`src/lib/client/autoStems.ts`, started
   from the layout) — so it stops when the tab closes. Not真 background.
   Decision: move orchestration into the **sidecar** (runs whenever the desktop
   app is up; watches ALL opened projects; persists across restarts). Web app
   shrinks to: write policy + register project path + view jobs.
2. **CRITICAL BUG (fixed):** `parseManifestObject` in `desktop/electron/main.mjs`
   stripped `autoStems`, and `handleProjectManifestWrite` round-trips through it
   — so saving the policy via the sidecar silently dropped it. The feature's
   config never persisted. Added `parseManifestAutoStems` passthrough.

Done this pass (all verified): UI dots now amber only for the stems a job is
actually rendering (`StemJobEntry.stems`); progress bar removed from project
list (quiet background); manifest passthrough fix; new sidecar daemon module
`desktop/electron/autoStems.mjs` (ported pure logic + DI daemon shell) with
`autoStems.test.mjs` (6/6 via `node --test`). `node --check` clean on both
.mjs; web `npm run check` 0 errors, 384 tests.

**REMAINING WIRING (not done — needs a desktop run to verify):**
- `main.mjs`: extract `createStemsJob(...)` core from `handleSeparateStems`
  (so daemon + HTTP share enqueue — refactor of working code, verify manual
  stems still work); instantiate `createAutoStemsDaemon` in `app.whenReady`
  with DI (`readManifest`, `readSmapHeader`, `listStemSets`, a `wavInfo`
  reader [reuse the /wav-info/batch internals], `enqueueJob`→createStemsJob,
  `hasInflightJobForSong`, persistence via `app.getPath('userData')`); add
  `POST /native/auto-stems/watch {projectPath}` route.
- Web: bridge `registerAutoStemsProject(projectPath)`, call on project open;
  then **remove the frontend orchestration** in `autoStems.ts` (keep only the
  viewing layer) and drop `startAutoStems` from the layout — otherwise both
  schedulers double-drive. `autoStemsAttention` (give-up UI) becomes
  sidecar-owned; needs an endpoint to surface, or drop the card note for now.

Until the cutover, the FRONTEND scheduler is still the active one (works while
a tab is open). NOT pushable as "background" until the sidecar wiring + a
desktop test pass land.

## 2026-06-29 (cutover) — claude — auto-stems orchestration moved to sidecar

Completed the architecture pivot. Orchestration now lives in the sidecar
daemon; the web app only writes policy + registers projects + views jobs.

Sidecar (`desktop/electron/`):
- `autoStems.mjs` daemon: DI shell + ported pure logic; persists watched
  projects to `userData/auto-stems-watch.json`; resumes on boot; per-song
  attempt cap; corruption re-render; single-flight per song; `stopped` guard so
  a tick in-flight during quit can't resurrect the timer. 6 node tests pass.
- `main.mjs`: extracted `createStemsJob` (shared by HTTP handler + daemon —
  manual stems path behaviour preserved); `hasInflightStemJobForSong`;
  `parseManifestAutoStems` passthrough (the critical persistence fix);
  daemon wired in `app.whenReady` with DI adapters (readProjectManifest,
  readSmapHeaderJson, listStemSets, readAudioInfo+statSync for wavInfo,
  createStemsJob for enqueue); `POST /native/auto-stems/watch` route;
  `autoStemsDaemon.stop()` on before-quit.

Web:
- `watchProjectForAutoStems` bridge; called (best-effort) from
  `openProjectByPath` + `createProjectOnDisk` so opening a project registers it.
- Project page polls `syncStemJobsWithSidecar` every 8s while open + reachable
  → daemon-spawned jobs show their amber in-progress dots live.
- **Removed** `src/lib/client/autoStems.ts` (+ its test) and the layout
  start/stop calls — no more frontend orchestration (no double-drive). Card no
  longer references `autoStemsAttention`; job failures still surface via the
  existing terminal-error row.

Verified: web `npm run check` 0 errors, 366 tests; both .mjs `node --check`;
6 daemon node tests. **STILL NOT desktop-runtime-verified** — needs a real run:
enable autoStems in Project Settings → confirm sidecar log "now watching" +
"queued" → stems land in `<song>/stems/<quality>/` → kill desktop app
mid-render, relaunch → confirm it resumes from the persisted watch list and
re-renders the partial. Known minor: `wavInfo` only parses wav/mp3, so a
non-wav stem (flac/aif) would read as unhealthy and get re-rendered as wav
(demucs emits wav, so unlikely).

## 2026-06-29 (daemon tests) — claude — behavioural coverage for the daemon

Added `desktop/electron/autoStems.daemon.test.mjs` — drives the daemon SHELL
through its DI seams (fake manifest/smap/stem-scan/wav-info/enqueue), since the
live sidecar can't run here. 10 tests, all green; covers: enqueues correct
stems for analyzed+audio song; disabled policy no-op; skips un-analyzed /
no-audio / hidden / in-flight songs; satisfied song no-op; corrupt stem
re-render; attempt cap stops at 3; missing-folder dropped from watch list;
multi-project pass. Sidecar test total now 16 (6 pure + 10 behavioural).
Web unchanged: 0 check errors, 366 tests.

This is as far as static verification goes — the only thing left is the live
desktop run described in the earlier note.
