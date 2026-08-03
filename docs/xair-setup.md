# XR18 live-rig setup (BarBro → Behringer XR18)

The **safety rule**: the metronome **click** and spoken **cue** must be heard in the
performers' in-ears but **NEVER** in the front-of-house (FOH/house) mix. Click on
FOH ends the show. BarBro enforces this at the desk (main/LR assign) and **proves
it by reading the console back** — it never just sends-and-hopes.

Open the rig from the **live stage** (`/project/playback` → **Rig** button). Needs
BarBro Desktop running (the sidecar talks OSC to the XR18 over your network).

## Scope today

BarBro currently sends **one stereo pair** to the XR18's USB, so this page
**controls the desk over OSC** — routing, in-ear monitor mixes, faders/mutes, and
the house-safety assign. True per-stem discrete channels are a separate, later job;
until then keep **click/cue on their own channels** so the FOH-safety assign has
something to take off the house.

## One-time / soundcheck

1. **Connect** — enter the XR18's IP (default `192.168.1.1`, port `10024`) → **Connect**.
   The dot goes green when the desk replies.
2. **Output routing** — map each BarBro output to XR18 channel(s). Defaults follow the
   rig contract: **click → 17, cue → 18** (both flagged *monitor only*), stems on
   **9-16**. Adjust to match how your USB channels land on the desk.
3. **Verify HOUSE SAFE** — the big banner at the top reads the desk back:
   - **Green "House safe"** = click & cue are confirmed OFF the main mix.
   - **Red** = click/cue may still reach the house → hit **"Take click/cue off FOH"**,
     then it re-verifies. Do NOT go live until it's green.
4. **Monitor mixes** — add band members in Project settings, then here give each a
   **bus (1-6)** and dial their in-ear send levels per source (their vocal up, click
   to taste). **Test** briefly raises that bus so the performer confirms it's theirs.
5. **Follow mixer** (arm) — mirrors BarBro's live faders/mutes + the monitor sends to
   the desk as you play. Arming **applies the house-safety assign first**, every time.

## Before every show (pre-flight)

- [ ] Desktop app running; **Connect** → green dot.
- [ ] Banner is **green "House safe"** (hit Verify to re-read the desk).
- [ ] Each performer hears their own mix — **Test** each bus.
- [ ] Play a song: click/cue in the ears, **not** in the house (confirm at FOH).
- [ ] Arm **Follow mixer** if you want BarBro to drive levels live.

## Notes / gotchas

- **Fader law:** the XR18 taper is not linear — 0.75 = unity, 1.0 = **+10 dB**. BarBro
  converts through the correct curve so unity never slams the house +10 dB.
- **Security:** the sidecar now refuses live-console commands from any origin except
  localhost, BarBro's own site, and anything in `BARBRO_HARDWARE_ORIGINS` — a stray
  browser tab can't move your faders.
- **Two controllers:** don't run BarBro's XR18 control and another OSC app on the desk
  at once; `/xremote` echoes to both and they'll fight.
- **Config:** host/port + routing + monitor send levels are saved **per project on this
  device**; which performer is on which bus is saved with the project (shared).

## What's covered by tests

- `src/lib/hardware/xairRouting.test.ts` — the FOH-safety logic: click/cue taken off
  FOH, and "house safe" is only reported when the desk **reads back** confirming it
  (an unread channel counts as UNSAFE).
- `desktop/electron/xairOsc.test.mjs` — the OSC wire format incl. the `/ch/NN/mix/lr`
  assign and the read-back decode.
