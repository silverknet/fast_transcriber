# Live mode pre-flight checklist

> **Current operational checklist, not a routing/readiness guarantee.** The target
> software guarantees and failure behavior live in
> [`contracts/audio-readiness.md`](contracts/audio-readiness.md) and
> [`contracts/live-editor-routing.md`](contracts/live-editor-routing.md). Update
> this checklist as implementation reaches those contracts.

Run this before every show. Live mode must be trustworthy like Ableton — this
runbook makes it **verifiable**, not hopeful. Live mode is the `/project/playback`
route.

## The fixed control map (memorize — it never changes)

The APC Key 25 mk2 layout is now **fixed** so muscle memory is reliable:

| Control | Does |
|---|---|
| **Bottom pad row (8 pads)** | Toggle stems — **fixed order:** Drums · Bass · Vocals · Other · Guitar · FX · Click · Cue |
| **8 round Track buttons** | **Same stems, same order** (mirror the bottom pad row) |
| **Row above, pads 1–2** | Toggle **Custom 1 · Custom 2** (for explicitly linked mixer channels such as arp or chords) |
| **All remaining 30 pads** | Jump to a section (tap = next bar · double-tap = at section end) |
| **Play** | Play / pause |
| **Stop All Clips** | Stop |
| **Record** | Replay current section once |
| **Scene 1 / 2 / 3** | Prev song / Next song / Loop section |

A live lane that a song **doesn't have** leaves its pad **dim red** — nothing else
shifts. Drums is always button 1 and Custom 1/2 are always the first two pads of
the row above, every song. (This was the gig failure — fixed.)

LED colours: **lit = on/audible**, **dim blue = muted**, **dim red = absent**; a section
pad **blinks** when queued and pulses on the beat when current.

## Connect (once per session)

1. Plug the APC in by USB. Open **MIDI settings → Connect** and grant the browser
   MIDI permission (it's remembered after the first grant).
2. Confirm the **`…Control`** output port is the one lit — a green corner pad
   should appear the moment it's detected. **If the pads send input but the LEDs
   stay dead, the wrong output port was picked** (the mk2 exposes a separate
   keybed port that ignores LEDs). Reconnect / pick the Control port.
3. Use **wired** audio out. Bluetooth adds huge, un-tightenable latency.
4. Chrome/Chromium only for the desktop app — Safari blocks the local sidecar.

## Per-song / per-set smoke test

For at least the first song of the set (ideally each):

- [ ] **Load** the song — waveform + section colours appear.
- [ ] **Play from the top** — audio + click sound; chord rail scrolls smoothly.
- [ ] **Toggle every stem** from the bottom pad row **and** from a track button —
      confirm the *same button = the same instrument*, and the LED flips on/off.
      A missing stem's button stays dark.
- [ ] If Custom 1/2 are used, toggle the first two pads of the row above and
      confirm each controls only its explicitly linked mixer channel.
- [ ] **Launch a couple of sections** from the top pads (single + double tap).
- [ ] **Replay the same song from the top** (Play again / Restart) — it must
      restart cleanly from 0. *(This was the disaster; now fixed + regression-tested.)*
- [ ] If you use the **spoken announcement / count-in**: play with it, let it
      finish, then replay — confirm the replay is clean (this was the exact cause
      of the old replay failure).
- [ ] **Prev / Next song** loads the neighbour and waits on a blinking Play.

If anything is off, note the **song + exact button/action** — the engine and MIDI
mapping are covered by automated tests (below), so a repro points straight at the code.

## What's guaranteed by automated tests

These MUST stay green (`npm run test:browser`, `npm test`) — they pin the two
show-stoppers so they can't silently regress:

- `src/lib/audio/mixerEngine.replay.browser.test.ts` — replay auto-stops after an
  announced play and **restarts the same song from the top**; no stale/overlapping
  audio sources.
- `src/lib/hardware/liveMidiMap.stems.test.ts` — a given instrument is the **same
  button across different songs**; track buttons mirror the first eight live
  pads, while Custom 1/2 remain fixed on pads 8/9.

## Known good / gotchas

- Grant MIDI permission once; it persists.
- Wired audio only.
- Missing-stem buttons are intentionally dark — that's correct, not a fault.
- The chord rail scrolls per-frame; the lane/LED state only updates on
  play/pause + mute changes (kept off the hot path to avoid lag).

## In-ear rig (XR18 split) — the show-morning ritual (added 2026-08-03)

The click/cue-to-monitors path is live and self-verifying. What the app proves
by itself, and the four things only a human can do:

**The app proves, automatically, every time live mode opens with the desk on
the network:** engine split (console: `[mixer] output: split…`), desk strips
11/12 on the right USB returns and OFF the house (read back from the desk),
FOH safety, monitor sends present. The one-glance verdict is the **In-ears
strip chip**: `click→ears ✓` green = all of it proven this session;
`rig unverified` amber = the desk has not confirmed yet (usually: not on the
desk's Wi-Fi — USB audio still works, routing verification does not).

**You, before doors:**
1. Mac on the desk's Wi-Fi → wait for the green `click→ears ✓` chip.
2. Step through every song once (or check hydration lights) — a COLD first
   open registers the click lane ~10 s into playback; warmed songs start with
   click from beat one.
3. Packs start LOW (bus masters run ~0.7 — hot). Raise per person by ear in
   Rig → performer sliders.
4. Emma's U308 receiver on **MONO** — stereo mode + mono aux = one ear.

**Known open items:** cold-open click delay (fix planned: hold play until the
click lane is ready); in-ear sound QUALITY report unresolved — suspects: USB
return trim (`/ch/NN/preamp/rtntrim`), hot bus masters into pack limiters,
AAC stem sources in live. Measure at next rehearsal before touching anything.
