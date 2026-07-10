# Hardware Control

Planned live hardware integration for controlling an external digital mixer and
MIDI controller from BarBro.

## Target v1 Rig

- Mixer: Behringer XR18 / X AIR class mixer.
- Controller: Akai APC Key 25 mk2.
- Audio path: XR18 remains the audio device and monitor mixer.
- BarBro role: setlist/playback brain, MIDI-control interpreter, and XR18 remote
  control surface.

The app should not try to replace the XR18 mixer engine. Backing tracks should
leave the computer through the XR18 USB interface, while monitor/main levels,
mutes, and bus sends are controlled remotely.

## Architecture

Use the desktop sidecar as the hardware bridge:

- XR18 control requires UDP OSC, which browsers do not expose.
- MIDI can be read through Web MIDI in some browsers, but the desktop sidecar is
  the reliable place for USB MIDI device enumeration, APC LED feedback, and
  long-running live-session state.
- The web app talks to the sidecar over the existing loopback HTTP contract.

Sidecar modules:

- `xairOsc.mjs`
  - connect to an XR18 by host/IP
  - send OSC parameter set/get
  - keep remote subscription alive
  - receive mixer feedback and maintain a state cache
- `midiControl.mjs`
  - enumerate MIDI devices
  - open APC Key 25 input/output
  - normalize MIDI events to semantic controls
  - send LED feedback where supported
- `hardwareSession.mjs`
  - bind APC controls to XR18 commands and BarBro transport
  - expose a snapshot/status API to the web app

## Sidecar API Shape

Initial endpoints stay narrow and testable:

- `GET /native/hardware/status`
  - sidecar hardware support, selected MIDI device, XR18 connection state
- `POST /native/hardware/xair/connect`
  - `{ host, port? }`
- `POST /native/hardware/xair/disconnect`
- `POST /native/hardware/xair/main-fader`
  - `{ value }`
- `POST /native/hardware/xair/channel-fader`
  - `{ channel, value }`
- `POST /native/hardware/xair/channel-on`
  - `{ channel, on }`
- `POST /native/hardware/xair/bus-send`
  - `{ channel, bus, value }`

Avoid broad arbitrary OSC writes from the web UI until the control map is safe.
Live sound mistakes are louder than UI bugs.

Planned but not implemented yet:

- `GET /native/hardware/midi/devices`
- `POST /native/hardware/session/start`
- `POST /native/hardware/session/stop`
- `GET /native/hardware/session/events`
- Guarded session mapping from APC controls to BarBro transport and XR18 writes.

Current web surface:

- The song Overview mixer shows a compact XR18 strip.
- Connect opens the sidecar UDP OSC socket; Follow mixer must be armed
  separately before BarBro writes faders/mutes.
- Routes are saved locally per project/browser. Defaults are intentionally
  conservative: original mix -> channels 17/18, click -> 15, cue -> 16, stems
  unmapped until the user assigns XR18 channels.
- The strip mirrors lane volume to XR18 channel fader and BarBro mute/solo state
  to XR18 channel on/off for mapped lanes only.
- The song Overview mixer and dedicated `/project/playback` live route show a
  compact APC Key 25 strip using Web MIDI in supported browsers:
  - Play toggles BarBro mixer playback.
  - Shift + Play or Shift + Stop All Clips restarts the current song from the
    beginning and starts playback.
  - Stop All Clips stops playback.
  - Record arms a one-shot replay of the current section. At the section end,
    BarBro jumps back once, then automatically continues through the set.
  - The 5x8 clip grid toggles mixer lanes/stems directly. Pad LEDs show the
    lane state: green = audible, red = muted, yellow = soloed, dim = hidden by
    another solo, off = no lane.
  - Track buttons 1-8 also toggle mute for the current mixer lane bank.
  - Knobs 1-8 adjust volume for the current mixer lane bank.
  - Scene Launch 1/2 step to the previous/next visible project song.
  - Scene Launch 3-5 select lane banks when a song has more than eight lanes.
  - Play, Record, track-button, scene-button, and clip-pad LEDs are updated when
    an APC MIDI output is selected.

## XR18 v1 Scope

Treat the XR18 as the authoritative live mixer:

- Main LR backing-track level.
- Musician monitor bus send levels.
- Mute/unmute backing/cue/click channels.
- Optional scene/song recall later, after safety prompts.
- Read-back status so the app does not lie when the mixer is changed from the
  official app or hardware.

Likely channel strategy:

- Reserve one stereo USB return pair for BarBro backing track.
- Optional separate channels for click/cue if the rig needs drummer-only cues.
- Aux buses represent monitor mixes.
- BarBro project should store the intended channel/bus layout as project-level
  hardware config, not inside each `.smap`.

## APC Key 25 mk2 v1 Scope

Start with a fixed performance mapping, then add learn/mapping UI later.

Good first mapping:

- Transport buttons: play/pause, stop.
- 8 knobs:
  - selected mode `Main`: control key XR18 channel/main levels.
  - selected mode `Monitor`: control sends from backing/cue/click channels into
    the selected monitor bus.
- 8 clip-stop buttons: mute/select the first 8 controlled channels or buses.
- Scene buttons: select monitor bus / mix layer.
- Clip grid: song/section launch, mute groups, or status pads after the basic
  mixer flow is stable.

The APC should be bi-directional when possible: LEDs need to reflect muted,
selected, and active states, especially on stage.

Current APC status:

- First implementation is browser Web MIDI, not sidecar MIDI. It works well for
  quick local testing on browsers that expose `navigator.requestMIDIAccess`;
  packaged sidecar MIDI is still the long-term path for full reliability.
- [`apcKey25.ts`](../../src/lib/hardware/apcKey25.ts) contains the protocol
  constants/parser and LED helpers based on Akai's APC Key 25 mk2 communication
  protocol.
- [`ApcKey25Control.svelte`](../../src/lib/components/ApcKey25Control.svelte)
  wires the parsed controls into the Overview mixer.

## Project Data

Add project-level config when implementation starts:

```ts
type HardwareControlConfig = {
  enabled: boolean
  mixer: {
    kind: 'behringer-xair'
    host?: string
    port?: number
    channels: {
      backingL?: number
      backingR?: number
      click?: number
      cue?: number
    }
    monitorBuses: Array<{ id: string; label: string; bus: number }>
  }
  controller: {
    kind: 'akai-apc-key-25-mk2'
    inputName?: string
    outputName?: string
  }
}
```

This belongs in `barbro.project.json`: it is a rig/project setup concern, not a
song map concern. Per-song snapshots can come later.

## Safety Rules

- Never auto-connect to a mixer and start writing parameters without explicit
  user action.
- Clamp all level values before sending them.
- Use soft pickup or relative deltas for knobs where possible to avoid sudden
  jumps.
- Prefer read-before-write and display stale/unknown states clearly.
- Add a panic action: mute BarBro-controlled channels or disconnect hardware
  control without stopping the official mixer app.
- Log every hardware write in sidecar debug output.

## Test Strategy

- Unit-test OSC encoding/decoding and XR18 path builders. Current coverage:
  [`xairOsc.test.mjs`](../../desktop/electron/xairOsc.test.mjs).
- Unit-test lane-to-XR18 route parsing/write planning. Current coverage:
  [`xairRouting.test.ts`](../../src/lib/hardware/xairRouting.test.ts).
- Unit-test MIDI event normalization using captured APC messages.
  Current coverage: [`apcKey25.test.ts`](../../src/lib/hardware/apcKey25.test.ts).
- Unit-test APC-to-XR18 mapping without hardware.
- Add a fake XR18 UDP server for sidecar integration tests.
- Add a fake MIDI adapter abstraction before binding to real OS MIDI APIs.
- Manual smoke with the real rig:
  1. Connect APC and XR18.
  2. Start session.
  3. Verify status/read-back.
  4. Move APC knobs slowly and confirm XR18 faders/sends.
  5. Change mixer from official app and confirm BarBro/APC reflect it.
  6. Play backing track through XR18 USB return.
  7. Test panic/disconnect.

## Open Questions

- Exact XR18 channel layout for BarBro: one stereo backing pair only, or separate
  backing/click/cue USB returns?
- Which aux buses belong to which musicians?
- Should BarBro recall per-song monitor snapshots, or only provide live manual
  control in v1?
- Should MIDI input be handled first through Web MIDI for a fast prototype, or
  go straight to sidecar for LED feedback and packaged reliability?
