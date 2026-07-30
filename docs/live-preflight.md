# Live mode pre-flight checklist

Run this before every show. Live mode must be trustworthy like Ableton — this
runbook makes it **verifiable**, not hopeful. Live mode is the `/project/playback`
route.

## The fixed control map (memorize — it never changes)

The APC Key 25 mk2 layout is now **fixed** so muscle memory is reliable:

| Control | Does |
|---|---|
| **Bottom pad row (8 pads)** | Toggle stems — **fixed order:** Drums · Bass · Vocals · Other · Guitar · FX · Click · Cue |
| **8 round Track buttons** | **Same stems, same order** (mirror the bottom pad row) |
| **Top 4 pad rows** | Jump to a section (tap = next bar · double-tap = at section end) |
| **Play** | Play / pause |
| **Stop All Clips** | Stop |
| **Record** | Replay current section once |
| **Scene 1 / 2 / 3** | Prev song / Next song / Loop section |

A stem that a song **doesn't have** leaves its pad/button **dark** — nothing else
shifts. Drums is always button 1, every song. (This was the gig failure — fixed.)

LED colours: **lit = on/audible**, **dim = muted**, **dark = absent**; a section
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
  button across different songs**; track buttons mirror the stem pads.

## Known good / gotchas

- Grant MIDI permission once; it persists.
- Wired audio only.
- Missing-stem buttons are intentionally dark — that's correct, not a fault.
- The chord rail scrolls per-frame; the lane/LED state only updates on
  play/pause + mute changes (kept off the hot path to avoid lag).
