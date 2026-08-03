# Audio architecture review — mixer / MIDI / effects / playback / speed / transpose

> **Historical implementation audit, not architecture authority.** Use
> [`architecture/audio-system-overview.md`](architecture/audio-system-overview.md)
> and its linked contracts for target ownership and behavior. This file remains
> useful as dated evidence about the implementation it inspected.

Written 2026-07-31 after a day in which one behaviour change (transpose) required
edits in six subsystems and broke four unrelated things. Every claim below is
cited and was verified against the working tree, not inferred.

The point of this document is to explain **why changes here cost 10 edits
instead of 1**, and what to change so they don't.

---

## 1. What the architecture actually is

### 1.1 Three playback engines, two of them nested

| Engine | Where | Owns |
|---|---|---|
| `MixerEngine` | [mixerEngine.ts](../src/lib/audio/mixerEngine.ts) | an `AudioContext`, per-track gains, effect busses, master chain, the varispeed rate, the rAF tick |
| `PlaybackController` | [playbackController.svelte.ts](../src/lib/audio/playbackController.svelte.ts) | its own `AudioContext`, the editor's waveform playback |
| `UnifiedTransport` | [transport.svelte.ts](../src/lib/audio/transport.svelte.ts) | wraps a `MixerEngine` (`:833`), adds click scheduling and the pitch shifter |

`UnifiedTransport` composes `MixerEngine`; `PlaybackController` is a third,
parallel implementation of the same transport concepts. There is no shared
"transport" abstraction — position derivation, auto-stop and seek exist
separately in each.

### 1.2 The lane model

```ts
MixerTrack {
  key: string          // <- the ONLY identity a lane has
  buffer?: AudioBuffer      // recorded audio
  instrument?: MidiInstrument  // generated/MIDI
  volume, muted, soloed, insert?
}
```

Exactly one of `buffer` / `instrument` is set. Because `key` is a bare string,
**"what kind of lane is this" is not modelled anywhere**. It is answered by
string comparison at the point of use — see §2.1.

### 1.3 The mix timeline

Everything is placed against one t=0. A lane's preamble (spoken intro + count-in)
is applied in one of two ways:

- **Recorded lanes** get silence *prepended into the buffer* — `computePrepend`
  in [MixerView.svelte](../src/lib/components/MixerView.svelte).
- **MIDI lanes** add the same offset when they schedule — `drumTrackLayout` in
  [drumPart.ts:52](../src/lib/audio/drumPart.ts).

Which lane takes which path is decided by a hand-maintained set,
`PREBAKED_PREAMBLE_LANE_KEYS` in [laneAlignment.ts](../src/lib/audio/laneAlignment.ts).

### 1.4 Transpose

One semitone offset `n` fans out into three different mechanisms:

```
n ──> varispeedPlan(n, tempoHold) ──> { rate, shiftSemitones }
       │                                 │
       │ rate ───────> engine.setPlaybackRate()   [BUFFER lanes only]
       │ shiftSemitones ──> pitch-shift worklet   [recorded audio sub-bus only]
       └─ transposeMidiNote(midi, n) ──> MIDI lane NOTES
```

Invariants that must hold, and that nothing enforces structurally:

- Recorded audio: `rate` covers `n·(1−hold)`, worklet covers `n·hold` → total `n`.
- MIDI lanes: notes carry the full `n`; the voice must **not** re-pitch by `rate`,
  and must **not** pass through the worklet — but must be delayed to match the
  worklet's latency.
- Drums: neither. No note transpose, no rate-following pitch.

Each of those three bullets is enforced by a different file, and each was
independently wrong at some point today.

---

## 2. Flaws, most structural first

### 2.1 There is no lane *kind* — 54 string comparisons and 4 parallel sets

A lane's behaviour is derived from its key string at 54 sites, e.g.
`key === 'drum-machine'`, `key.startsWith('stem:')`, `key === 'cue'`
— spanning the mixer, hardware routing ([xairRouting.ts:86](../src/lib/hardware/xairRouting.ts),
[liveMidiMap.ts:229](../src/lib/hardware/liveMidiMap.ts)) and the live stage.

On top of that sit four independent membership sets, each answering a different
question about the same lanes:

| Set | Question | Where |
|---|---|---|
| `PREBAKED_PREAMBLE_LANE_KEYS` | does it place itself on the timeline? | laneAlignment.ts |
| `EDITABLE_LANE_KEYS` | does clicking it open an editor? | MixerView.svelte:702 |
| `HIDDEN_LANE_KEYS` | is it shown as a channel? | MixerView.svelte:841 |
| `PITCHED_MACHINE_LANES` | does transpose rebuild it? | MixerView.svelte:1119 |

**Failure mode:** adding or changing a lane means finding all of them. Missing one
fails *silently* — the chords/arp lanes were unclickable because they were added
to `openEditor` but not `EDITABLE_LANE_KEYS`, and nothing errored.

**This is the root cause of "every fix requires going into 10 different places."**

### 2.2 Mix-time → context-time is implemented three times

```
bassMidiInstrument.ts:161   anchor.atCtx + delta / anchor.rate
drumMidiInstrument.ts:180   anchor.atCtx + delta / anchor.rate
keysMidiInstrument.ts:71    atCtx + delta / rate
```

…and the rolling-window constants are declared three times as well
(`SCHEDULE_WINDOW_SEC = 8`, `REFILL… = 4` in each of the three files).

**Failure mode:** each instrument can drift from the others independently, and a
fix to one is not a fix to the others.

### 2.3 "Does my pitch follow the playback rate?" is decided per voice, in six places

```
mixerEngine.ts:622,773,887   src.playbackRate = rate   (buffers: YES, correct)
drumMidiInstrument.ts:139    src.playbackRate = 1      (drums: NO)
bassVoiceGraph.ts:146,165    natural pitch             (MIDI: NO)
```

This is a **property of the lane kind**, not of the voice's DSP — yet it is
expressed as a literal buried in each voice's node construction.

**Failure mode:** the bass was transposed twice (notes + rate) for weeks; drums
were pitched by the transpose. Both were single literals in files nobody
associates with transpose.

### 2.4 Timeline placement is computed twice

`drumTrackLayout` ([drumPart.ts:52](../src/lib/audio/drumPart.ts)) and
`computePrepend` (MixerView) both compute `titleCuePreludeSec + countIn prepend`.
They agree **today** — verified — but only by coincidence of both defaulting the
same way. Nothing structurally ties them.

### 2.5 No owner for the audio device — the app exceeds the browser's context cap

Hardware `AudioContext`s are constructed independently by:

| `mixerEngine.ts:243` | one per engine |
| `playbackController.svelte.ts:391` | one |
| `keysSynth.ts:318` | **one per instance** — chord playback, chord bass, chord arp |
| `chordKick.ts:161` | one |

That is six on a single `/edit` load, and browsers cap hardware contexts at
about six. The seventh throws. This presented as a mystery "paused in debugger"
inside the cue renderer, which was taking two more for work that makes no sound.

**Failure mode:** enabling an unrelated feature (a chord voice) breaks a
different feature (cue rendering) with no traceable connection.

`KeysSynth.attachContext(ctx, { destination })` already supports injection — the
mixer's chord lanes use it and add zero contexts. The jam singletons predate it.

### 2.6 The same DSP exists twice: pure functions and live nodes

[drumBus.ts](../src/lib/audio/drumBus.ts) implements reverb, bus compression and
saturation as pure `Float32Array` functions for offline render.
[drumBusLive.ts](../src/lib/audio/drumBusLive.ts) reproduces the same four
stages as Web Audio nodes for live playback.

This is currently *sound* — the live path derives its IR and curves by sampling
the pure functions, and a fidelity test measures 0.00 dB / 1.0000 envelope
correlation between them. But it is two implementations of one signal chain, and
only a test keeps them together.

### 2.7 `MixerView.svelte` is 4188 lines and holds the orchestration

24 `$effect`s (vs 63 `$derived`), against a house rule that says `$effect`
almost nowhere. It owns the lane plan, the load/reload pipeline, the refresh
queue, transpose application, effect-bus editing and live-rig routing.

**Failure mode:** `reload()` wiping all tracks and rebuilding asynchronously was
not re-entrant; two overlapping calls emptied the mixer (silence). Orchestration
of that weight does not belong in a view, and cannot be unit-tested there —
the component will not even mount in the browser test project (`bits-ui` +
Tailwind), so none of it has behavioural coverage.

### 2.8 The transpose *value* has a different source per surface

The editor's control writes `personalTransposeSemitones` ([+page.svelte:327](../src/routes/edit/+page.svelte));
`MixerView` reads `effectiveTransposeSemitones($songMap)` unless given an
override prop, whose default is `null`.

**Failure mode:** the prop was never passed, so the mixer silently used the
song's `transpose.baseSemitones` (0) and transpose did nothing at all in
Overview. Every source-level check passed because every wire existed — the value
was simply never handed over.

### 2.9 Tests address audio nodes by creation order

Adding one `GainNode` to `MixerEngine`'s constructor broke **68 tests** that
index `createdGains[1]`. That is a test-suite coupling to internal construction
order, and it punishes exactly the refactors this document recommends.

### 2.10 Effect-bus returns bypass the pitch shifter (live defect, introduced 2026-07-31)

`busReturnGains` connect straight to `masterGain` ([mixerEngine.ts:328](../src/lib/audio/mixerEngine.ts)),
but the transpose shifter now sits on the recorded-audio sub-bus. So with the
tempo-hold dial above 0, a recorded lane is pitch-shifted while **its own reverb
return is not** — the wet tail comes back in the wrong key.

This is a direct consequence of moving the shifter off the master to stop MIDI
being double-shifted. It is not a simple re-patch, because a bus is fed by sends
from BOTH recorded and MIDI lanes, and those two want opposite treatment. It
needs the send/return topology decided deliberately — see roadmap R6a.

### 2.11 The editor's waveform player has no varispeed at all

`PlaybackController` starts its source without touching `playbackRate`
([playbackController.svelte.ts:291-295](../src/lib/audio/playbackController.svelte.ts)).
Transpose reaches the editor only through `UnifiedTransport`. Any surface driven
by `PlaybackController` therefore ignores transpose silently.

### 2.12 A rate change does not re-derive a queued jump

`pendingJump.targetCtxTime` is an absolute context time computed under the OLD
anchor and OLD rate. Changing the rate while a bar-quantized jump is queued
leaves it aimed at the wrong moment.

### 2.13 More duplication found by the subsystem maps

| Concept | Copies |
|---|---|
| The click rAF loop (index init, due-click derivation, stop-on-downbeat) | `playbackController.svelte.ts:504-578`, `transport.svelte.ts:943-999` |
| `END_EPS = 0.028` | `playbackController.svelte.ts:51`, `transport.svelte.ts:52`, `playbackPlan.ts:45` |
| Play start-position clamp + count-in decision | `playbackController.svelte.ts:236-286`, `transport.svelte.ts:559-596` |
| Live pitch-shifter lifecycle | `MixerView.svelte:1136-1172`, `transport.svelte.ts:381-423` |
| Per-device varispeed prefs (keys + clamping) | `MixerView.svelte:1086-1097`, `+page.svelte:558,569-577` |
| `{ input, output }` chain type | `mixerEngine.ts:25`, `mastering.ts:335`, `channelEq.ts:141` |
| tanh saturation curve | `mastering.ts:256-265`, `bassVoiceGraph.ts:39-50` |
| Synthesized reverb | `drumBus.ts:81-111`, `reverbBus.ts:56-119` |
| Stem discovery + `labelForStem` | `MixerView.svelte:1569-1679`, `loadSongStems.ts:23-91` |

### 2.14 The mixer allocates a new `controls` object every frame

An `$effect` rewrites the bindable `controls` prop while reading
`snapshot.positionSec` ([MixerView.svelte:2184-2196](../src/lib/components/MixerView.svelte)),
so a fresh object is published 60×/s to the parent. Change detection elsewhere in
the component is hand-rolled with plain `let last*` variables consulted inside
effects.

### 2.15 The LIVE STAGE is permanently untransposed (verified)

`/project/playback` mounts `<MixerView initialPlaybackMode lockPlaybackMode
liveMode />` — **no transpose props at all**
([playback/+page.svelte](../src/routes/project/playback/+page.svelte)). So
`transposeSemitonesOverride` is null and the mixer falls back to
`effectiveTransposeSemitones($songMap)`.

And that fallback is **always 0**: `transpose.baseSemitones` is read in six
places but **written nowhere in `src/`** — only parsed, validated, typed, and set
in one fixture. The real value lives in a per-device localStorage key
(`barbro::xpose::<songId>::<title>`, [+page.svelte:306](../src/routes/edit/+page.svelte)).

**Consequence: you set −2 in the editor, walk to the live stage, and it plays in
the original key.** Same root cause as the Overview bug — a value that exists in
one place and is hand-carried to another by props — but the live stage was never
wired at all.

The same fallback makes lead-sheet, MusicXML and PDF export render at concert
pitch regardless of what the editor displays.

`effectiveTransposeSemitones(songMap, localOffset = 0)` already has the parameter
that would unify this. No caller passes it.

### 2.16 The drum tail-hit path still converts time wrongly at rate ≠ 1

`scheduleTailHits` passes `offset = fromSec - hit.mixTimeSec`
([drumMidiInstrument.ts](../src/lib/audio/drumMidiInstrument.ts)) — that is
PART-seconds — into `scheduleSource`'s buffer `startOffset`, which needs
WALL-seconds. They differ by the playback rate. The visible tell is that
`scheduleSource`'s `rate` parameter is now declared and never read.

Only affects seeking into an already-ringing hit, so it is subtle, but it is
exactly the class F2 describes: a conversion done by hand instead of through
`varispeed.ts`.

### 2.17 The transport engine is safe from the double-transpose only by accident

`UnifiedTransport` puts the shifter on the **master tail**, which would
double-transpose any MIDI lane. It is correct today only because that engine
registers buffer tracks exclusively. Adding one MIDI lane to it reintroduces the
bug, and nothing enforces the constraint —
`audioPitchShiftRouting.test.ts` guards the mixer side only.

---

## 3. What to improve — ranked by ROI (3 = highest)

| # | ROI | Change | Why it pays |
|---|---|---|---|
| 1 | **3** | **Give a lane a first-class kind + capabilities** | Collapses 54 string checks and 4 sets into one declaration. Directly ends "one change, ten places". Everything else gets easier afterwards. |
| 2 | **3** | **One `TransposePlan` + one mix→ctx clock** | Kills §2.2/§2.3/§2.8 together — the exact class of bug that consumed today. |
| 3 | **3** | **One owned `AudioContext`, injected** | Removes a hard crash class (§2.5). Small: four call sites, and the seam already exists. |
| 4 | **2** | **Lift orchestration out of `MixerView` into a testable service** | Makes the load/reload/refresh pipeline unit-testable at all, and shrinks the file that everything collides in. |
| 5 | **2** | **Make the test suite address nodes semantically** | Unblocks 1–4; otherwise every one of them costs a 68-test repair. |
| 6 | **2** | **Unify the chord-jam settings** (Chords tab vs `chordJam`) | Two `$state` copies on the same localStorage keys; already caused silent reverts and a silent-lane bug. |
| 7 | **1** | **Generate offline + live DSP from one description** | Real duplication, but currently correct and test-locked. Do it when the chain changes, not before. |
| 8 | **1** | **Merge the three transports** | Large, risky, and the pain is mostly conceptual today. |

### Suggested order

**3 → 5 → 1 → 2 → 4.** Fix the test coupling first (it is cheap and it is the
toll booth on everything else), take the context ownership win, then the lane
kind, which makes the transpose unification mostly mechanical.

### What "done" looks like for #1 and #2

```ts
type LaneKind = 'recorded' | 'midi'
type LaneSpec = {
  kind: LaneKind
  placesItself: boolean      // replaces PREBAKED_PREAMBLE_LANE_KEYS
  editor?: MachineEditor     // replaces EDITABLE_LANE_KEYS + openEditor
  transpose: 'notes' | 'rate' | 'none'   // replaces the six pitch literals
  hidden?: boolean           // replaces HIDDEN_LANE_KEYS
}
```

Then "drums are never transposed" is `transpose: 'none'` — one field, in one
place, instead of a literal inside a sample scheduler.
