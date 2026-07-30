# XR18: monitor mixes and the FOH safety invariant

**Status:** design note, no code written here. Findings from an outside session.
**Audience:** whoever picks up XR18 work next.
**Date:** 2026-07-30

---

## Read this correction first

I am a Claude Code session working in a *different* repo (`~/Documents/blocker/live-rig`,
a Swift CoreMIDI rig). I was asked to plan XR18 integration for an upcoming show
and I investigated BarBro to understand the audio side.

**I initially read the shipped `app.asar` (0.1.14), not this tree.** The tree is
well ahead of it. Anything I said before this document that contradicts what is
here is wrong, and this supersedes it. In particular I "discovered" the X Air
fader law and warned about it — [`xairRouting.test.ts`](../src/lib/hardware/xairRouting.test.ts)
already had it covered:

```ts
it('maps BarBro unity gain to 0 dB (fader 0.75), NOT full fader (+10 dB)')
```

Apologies for the noise. What follows has been re-checked against the working
tree as of today.

---

## What already exists here (and is good)

- [`src/lib/hardware/xairRouting.ts`](../src/lib/hardware/xairRouting.ts) — lane →
  channel routes, the fader law, solo/mute audibility, write diffing so a knob
  move doesn't re-send every channel. The diffing comment about "stomping FOH
  moves on unrelated channels" shows the right instinct already.
- [`src/lib/hardware/apcKey25.ts`](../src/lib/hardware/apcKey25.ts),
  [`liveMidiMap.ts`](../src/lib/hardware/liveMidiMap.ts),
  [`midiService.ts`](../src/lib/hardware/midiService.ts) — the controller.
- [`desktop/electron/xairOsc.mjs`](../desktop/electron/xairOsc.mjs) — the OSC
  transport, correct and tested.
- [`docs/live-preflight.md`](live-preflight.md) — the fixed control map. The note
  that *"Drums is always button 1, every song. (This was the gig failure —
  fixed.)"* is exactly the right reflex; this document is trying to apply the
  same reflex to a failure that hasn't happened yet.

Current channel map, from `defaultXAirChannelsForLane`:

| Lane | XR18 channels |
|---|---|
| `original` | 17, 18 |
| `click` | 15 |
| `cue` | 16 |

---

## The requirement that breaks the current model

Three performers, mono in-ears. **Each needs click and cues. The house must
hear neither.**

Today there is no bus-send or monitor concept anywhere in `xairRouting.ts` —
grep for `mix/0`, `busSend`, `monitor`, `aux` returns nothing. Every lane write
is one of two kinds:

```ts
| { kind: 'channel-fader'; channel: number; value: number }
| { kind: 'channel-on';    channel: number; on: boolean }
```

That is **correct for the current model**, where the only destination is the
main mix. Muting the click channel is a perfectly good way to make click
inaudible when FOH is the only place it could be audible.

**It stops being correct the moment monitor sends exist.** `channel-on` is the
channel's master mute: it silences the channel everywhere at once, monitors
included. So the moment performers need click in their ears while the house does
not hear it, `channel-on` can no longer be the control that keeps click off FOH —
using it would take the click out of the performers' ears too, which is the one
thing it must never do.

The control that separates them is **`/ch/NN/mix/lr`**, the main-bus assign. It
removes a channel from the main mix while its aux sends keep flowing. It is not
in `xairOsc.mjs` and not in `xairRouting.ts`.

---

## Proposed model

Add a per-route notion of where a lane is allowed to go.

```ts
export type XAirLaneRoute = {
  laneKey: string
  channels: number[]
  followVolume: boolean
  followMute: boolean
  /** Never assigned to the main mix. Reaches performers via aux sends only. */
  monitorOnly?: boolean
  /** Aux send level per monitor bus, 0…1. */
  monitorSends?: Record<number, number>
}
```

Then two new write kinds:

```ts
| { kind: 'channel-main-assign'; channel: number; assigned: boolean }  // /ch/NN/mix/lr
| { kind: 'channel-bus-send'; channel: number; bus: number; value: number }
```

And the rule that makes it safe:

> For every route with `monitorOnly`, `assigned` is always `false`.
> Nothing in the UI, no lane state, no solo, no song change can make it `true`.

Note this is a **different axis from mute**. `click` stays `followMute: true` so
the performer can still mute their own click; what it can never do is appear on
the main mix. Muting and routing become independent, which is what the
requirement actually asks for.

### Channel map

The existing map has `original` on 17/18 and click/cue on 15/16. With stems
needing channels too, something like:

| XR18 ch | Source | Main mix | Buses 1–3 |
|---|---|---|---|
| 1–8 | analog: mics / DIs | assigned | as needed |
| 9–14 | stems | assigned | yes |
| **15** | **click** | **never** | yes |
| **16** | **cue** | **never** | yes |
| 17–18 | `original` | assigned, normally at −∞ | optional |

Keeping click on 15 and cue on 16 matches what is already there, so no existing
route breaks. Worth knowing: the XR18's input-source routing works in blocks of
four, and 17/18 are the desk's *line* inputs — a separate block from 1–16. If
`original` stays on 17/18 that is a tidy separation.

The harder question is whether `click` and `cue` should remain toggleable stems
on the bottom pad row. [`live-preflight.md`](live-preflight.md) lists them as
stems 7 and 8, which is right for the *performer's* view — they should be able to
mute their own click. It just must not be the same control that governs whether
the house hears it.

---

## The safety invariant

The reason to treat this differently from a mix setting: a stem at the wrong
level is a mix problem you fix in the next bar. Click through the PA is the end
of the show. Different category, so it deserves a different mechanism.

The pattern that survives contact with a real stage:

**Arm — nothing reaches FOH until proven safe**

1. Refuse if another OSC client holds the desk (see below).
2. `/xinfo`; refuse on no reply or on the wrong desk name. A mistyped octet
   should not silently reconfigure someone else's mixer.
3. **Mute the main mix before anything else happens.**
4. Apply the assign bitmap for *every* channel, both directions.
5. **Read every one of them back.** Not "we sent the packets" — ask the desk.
6. Any mismatch or timeout → stay muted, refuse to arm, say which channel.
7. Only now unmute.

The failure mode is silence at FOH. Silence is recoverable; click is not.

**While running**

- Re-assert the protected assigns every ~2 s. Cheap, idempotent, survives the
  dropped UDP packet.
- Watch the `/xremote` push stream. Because the desk echoes every change to
  every subscriber, an iPad running X AIR Edit or a snapshot recall is caught in
  milliseconds rather than at the next poll. This is the single best argument
  for holding a subscription rather than firing and forgetting.
- Re-read explicitly every ~5 s in case a push was lost.

**On a violation:** correct first, re-read after ~250 ms, and only mute FOH if
the correction demonstrably failed. Dropping the house for 250 ms is bad; it is
much less bad than click going out front, and it only happens after a correction
has provably not worked.

**Losing the network is not a violation.** The desk keeps its last state, which
was safe. We have lost the ability to *observe*, not the guarantee itself.
Tripping the house because Wi-Fi hiccuped is precisely the failure this whole
mechanism exists to prevent. Treat it as a distinct `link-lost` state, keep the
house up, and re-verify fully on reconnect. The one exception worth making:
losing contact *while a violation is outstanding* should trip, because the last
thing actually observed was click on the main mix.

**Use Ethernet.** The XR18's Wi-Fi is fine for an iPad tweaking monitors. It is
not what a safety interlock should ride on.

---

## Two independent findings

**Multichannel output does not exist yet.** Re-checked against this tree today:
`setSinkId`, `enumerateDevices`, `maxChannelCount`, `channelCount`,
`createChannelMerger` all return **zero** hits across `src/`. Everything
terminates at `ctx.destination`.

None of the above matters until stems, click and cue arrive on the desk as
separate channels. That needs `setSinkId` to the XR18, `destination.channelCount`
raised after checking `maxChannelCount`, and a `ChannelMergerNode` fanning each
source to a fixed channel from a table. Chrome only — Safari does not support
sink selection, and the desktop app is a headless sidecar so this is a browser
question, not an Electron one.

**The sidecar's mixer endpoints are unauthenticated.**
`POST /native/hardware/xair/*` answers with `Access-Control-Allow-Origin: *`.
Any page open in that browser can move faders on the desk. Not urgent in a
rehearsal room; worth a token before this drives a real show.

Related: browsers throttle timers in background tabs. An 8-second `/xremote`
keepalive and a 2-second re-assert are exactly the things that stop firing when
the tab loses focus. If the interlock lives in the renderer, that is a real
failure mode — the sidecar is the better home for anything that must keep
ticking.

---

## One coordination note

`live-rig` (my repo) also maps the APC Key 25 — for chords, bass and arp, with a
mixer bank on the knobs. That **conflicts directly** with the fixed map in
`live-preflight.md`. Two programs cannot own one controller, and BarBro's claim
is the stronger one: it owns the stems, the sections and the transport, and its
map was paid for with a bad gig.

I am not proposing live-rig drive the XR18. This document is the useful part of
that work handed over; what to do with the rest is Martin's call.

---

## If it helps

I built and tested this design in Swift against a deliberately hostile mock desk
— one that drops packets, flips protected channels behind your back, accepts
writes and silently ignores them, goes deaf, and replies with truncated packets.
The state machine is a pure function of `(state, observation, policy, now)`,
which is what made those cases testable without hardware.

Happy to translate any of it to TypeScript against `xairRouting.ts`'s existing
shape, or to hand over the mock's fault list as a test plan. There is no XR18 on
this network, so `/ch/NN/mix/lr` is unverified — standard across the X32/X-Air
family, but confirm it on the desk before trusting it.

Ask via `AGENT_BRIDGE.md`.
