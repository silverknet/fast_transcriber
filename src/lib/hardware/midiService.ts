/**
 * App-wide MIDI service (singleton). One MIDIAccess for the whole app so the
 * controller stays connected while BarBro is open — across dialog open/close and
 * client-side navigation — instead of reconnecting every time a component mounts.
 *
 * Responsibilities:
 *   - Own the single `MIDIAccess`; expose a reactive `midiStatus` store.
 *   - Fan incoming messages out to any number of subscribers (`onMidiInput`).
 *   - Send LEDs to the APC (`sendApc`), and paint a persistent "connected"
 *     marker on the bright RGB pads the moment an APC is detected — the on-stage
 *     "it's connected" confirmation.
 *
 * Web MIDI needs a user gesture to GRANT permission the first time (use the
 * Connect button in the MIDI dialog). Once granted the browser remembers it, so
 * `ensureMidi()` on app start silently reconnects and relights on every load.
 */
import { browser } from '$app/environment'
import { writable } from 'svelte/store'
import {
  isLikelyApcKey25Mk2Name,
  apcClipPadLedMessage,
  apcSingleLedMessage,
  apcTrackButtonLedMessage,
  apcSceneLaunchLedMessage,
  APC_CLIP_PAD_COUNT,
  APC_PLAY_NOTE,
  APC_RECORD_NOTE,
  APC_STOP_ALL_CLIPS_NOTE,
} from './apcKey25'

export type MidiStatus = {
  supported: boolean
  /** Any MIDI input is present + connected. */
  connected: boolean
  /** An APC Key 25 specifically is connected. */
  apc: boolean
  deviceName: string
  /** Number of MIDI OUTPUT ports (LEDs need one). */
  outputs: number
  /** Name of the output we send LEDs to (empty if none). */
  outputName: string
}

export const midiStatus = writable<MidiStatus>({
  supported: browser && 'requestMIDIAccess' in navigator,
  connected: false,
  apc: false,
  deviceName: '',
  outputs: 0,
  outputName: '',
})

let access: MIDIAccess | null = null
let apcOut: MIDIOutput | null = null
let prevApc = false
/** When live mode owns the LEDs, the presence marker steps aside. */
let ledOwner: 'presence' | 'live' = 'presence'
let flashTimer: ReturnType<typeof setTimeout> | null = null

const inputSubs = new Set<(ev: MIDIMessageEvent) => void>()
const boundInputs = new WeakSet<MIDIInput>()

function dispatchInput(ev: Event) {
  for (const cb of inputSubs) cb(ev as MIDIMessageEvent)
}

function findApcInput(a: MIDIAccess): MIDIInput | null {
  const ins = [...a.inputs.values()]
  return ins.find((p) => isLikelyApcKey25Mk2Name(p.name)) ?? null
}

/**
 * The LED output port. The APC Key 25 mk2 exposes TWO output ports: the piano
 * keybed (which silently ignores LED note-ons) and the CONTROL port (which
 * drives every pad + button LED). Confirmed on this hardware: the control port
 * is named "…Control". Pick it explicitly — sending LEDs to the keybed does
 * nothing, which was the whole "pads stay green" bug.
 */
function findApcLedOutput(a: MIDIAccess): MIDIOutput | null {
  const outs = [...a.outputs.values()]
  return (
    outs.find((o) => isLikelyApcKey25Mk2Name(o.name) && /control/i.test(o.name ?? '')) ??
    outs.find((o) => /control/i.test(o.name ?? '')) ??
    outs.find((o) => isLikelyApcKey25Mk2Name(o.name)) ??
    outs[0] ??
    null
  )
}

function refresh() {
  if (!access) return
  for (const input of access.inputs.values()) {
    if (!boundInputs.has(input)) {
      input.addEventListener('midimessage', dispatchInput)
      boundInputs.add(input)
    }
  }
  const apcInput = findApcInput(access)
  apcOut = findApcLedOutput(access)
  // Open the control port, then paint once it's actually open (a closed port
  // can drop the first sends).
  if (apcOut && apcOut.connection !== 'open') {
    void apcOut.open().then(() => {
      if (ledOwner === 'presence') paintPresenceMarker()
    })
  }
  const anyInput = [...access.inputs.values()].find((i) => i.state === 'connected') ?? null
  const apc = !!apcInput && apcInput.state === 'connected'

  midiStatus.set({
    supported: true,
    connected: !!anyInput,
    apc,
    deviceName: apcInput?.name ?? anyInput?.name ?? '',
    outputs: [...access.outputs.values()].length,
    outputName: apcOut?.name ?? '',
  })

  // Just went from no-APC → APC present: flash a hello, then a steady marker.
  if (apc && apcOut && !prevApc) paintConnected()
  prevApc = apc
}

/** Idempotent. Safe to call from app start AND from the dialog's Connect button. */
export async function ensureMidi(): Promise<void> {
  if (!browser) return
  if (!('requestMIDIAccess' in navigator)) {
    midiStatus.set({ supported: false, connected: false, apc: false, deviceName: '', outputs: 0, outputName: '' })
    return
  }
  if (access) {
    refresh()
    return
  }
  const a = await navigator.requestMIDIAccess({ sysex: false })
  access = a
  a.onstatechange = () => refresh()
  refresh()
}

/**
 * Reconnect on app start ONLY if MIDI permission was already granted — so we
 * never trigger a permission prompt on load. The first grant happens via the
 * dialog's Connect button (a user gesture); after that this lights the
 * controller automatically on every launch.
 */
export async function autoConnectMidiIfGranted(): Promise<void> {
  if (!browser || !('requestMIDIAccess' in navigator)) return
  try {
    const status = await navigator.permissions.query({ name: 'midi' as PermissionName })
    if (status.state === 'granted') await ensureMidi()
  } catch {
    /* permission state unknowable here — don't prompt; the dialog handles it */
  }
}

/** Subscribe to every incoming MIDI message. Returns an unsubscribe. */
export function onMidiInput(cb: (ev: MIDIMessageEvent) => void): () => void {
  inputSubs.add(cb)
  return () => inputSubs.delete(cb)
}

/** Send raw bytes to the APC's CONTROL (LED) output port. */
export function sendApc(bytes: number[]): void {
  const out = apcOut
  if (!out) return
  try {
    if (out.connection !== 'open') void out.open()
    out.send(bytes) // per Web MIDI, send() auto-opens a closed port
  } catch {
    /* port not ready / rejected — ignore */
  }
}

// The APC Key 25 Mk1 and Mk2 light their pads DIFFERENTLY:
//   - Mk1: Note On ch 1 (0x90), velocity is the colour (1 green, 3 red, 5 yellow).
//   - Mk2: Note On ch 7 (0x96) = solid 100%, velocity is a 128-colour palette.
// We send BOTH (Mk1 first, so the Mk2 message wins on a Mk2) — whichever the
// unit understands lights up, the other is ignored.
export type PadColor = 'off' | 'green' | 'red' | 'yellow' | 'blue'

/**
 * Light one clip pad, per the APC Key 25 mk2 spec: `[0x96, pad, colourVelocity]`
 * — status 0x96 = solid 100% brightness, velocity indexes the fixed palette
 * (0 = off/black, 5 = red, 21 = green, …). One message only; sending anything
 * else to the same pad just fights it.
 */
export function sendPad(i: number, color: PadColor): void {
  sendApc(apcClipPadLedMessage(i, color)) // [0x96, i, paletteVelocity]
}

export type PadBehavior = 'solid' | 'pulse' | 'blink'
// Status byte low nibble = behavior: 0x96 solid 100%, 0x97 pulse 1/16, 0x9C blink 1/16.
const PAD_BEHAVIOR_STATUS: Record<PadBehavior, number> = { solid: 0x96, pulse: 0x97, blink: 0x9c }

/**
 * Light one pad by RAW palette velocity (0–127) with a behavior — lets us echo
 * BarBro's per-section colours (beyond the named ones) and mark the current
 * section (pulse) and a queued one (blink).
 */
export function sendPadRaw(i: number, velocity: number, behavior: PadBehavior = 'solid'): void {
  sendApc([PAD_BEHAVIOR_STATUS[behavior], i & 0x7f, velocity & 0x7f])
}

/** Light a pad at 10% brightness (status 0x90) — for "present but off" states. */
export function sendPadDim(i: number, velocity: number): void {
  sendApc([0x90, i & 0x7f, velocity & 0x7f])
}

/** The persistent "MIDI connected" marker: a single green corner pad. */
function paintPresenceMarker() {
  if (ledOwner !== 'presence') return
  for (let i = 0; i < APC_CLIP_PAD_COUNT; i++) sendPad(i, i === 0 ? 'green' : 'off')
}

/** Flash the whole pad grid green, then settle to the steady marker. */
export function paintConnected() {
  for (let i = 0; i < APC_CLIP_PAD_COUNT; i++) sendPad(i, 'green')
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    if (ledOwner === 'presence') paintPresenceMarker()
  }, 600)
}

/**
 * Diagnostic: cycle the pads red → green → off so you can SEE the LEDs respond,
 * then restore the resting marker.
 */
export async function testLights(): Promise<void> {
  if (apcOut && apcOut.connection !== 'open') {
    try {
      await apcOut.open()
    } catch {
      /* send() will still auto-open */
    }
  }
  // Cycle the whole grid RED → GREEN → OFF, ~0.9s each. This makes the answer
  // unambiguous: "red, then green, then dark" = full colour + off work;
  // "green the whole time" = the unit ignores colour velocity; "never dark" =
  // off isn't landing.
  if (flashTimer) clearTimeout(flashTimer)
  const steps: PadColor[] = ['red', 'green', 'off']
  let s = 0
  const tick = () => {
    const c = steps[s]!
    const on = c !== 'off'
    for (let i = 0; i < APC_CLIP_PAD_COUNT; i++) sendPad(i, c)
    for (let i = 0; i < 8; i++) sendApc(apcTrackButtonLedMessage(i, on ? 'on' : 'off'))
    for (let i = 0; i < 5; i++) sendApc(apcSceneLaunchLedMessage(i, on ? 'on' : 'off'))
    sendApc(apcSingleLedMessage(APC_PLAY_NOTE, on ? 'on' : 'off'))
    sendApc(apcSingleLedMessage(APC_RECORD_NOTE, on ? 'on' : 'off'))
    s++
    if (s < steps.length) {
      flashTimer = setTimeout(tick, 900)
    } else if (ledOwner === 'presence') {
      paintPresenceMarker()
    }
  }
  tick()
}

export function clearAllLeds(): void {
  for (let i = 0; i < APC_CLIP_PAD_COUNT; i++) sendPad(i, 'off')
  for (let i = 0; i < 8; i++) sendApc(apcTrackButtonLedMessage(i, 'off'))
  for (let i = 0; i < 5; i++) sendApc(apcSceneLaunchLedMessage(i, 'off'))
  sendApc(apcSingleLedMessage(APC_PLAY_NOTE, 'off'))
  sendApc(apcSingleLedMessage(APC_RECORD_NOTE, 'off'))
  sendApc(apcSingleLedMessage(APC_STOP_ALL_CLIPS_NOTE, 'off'))
}

/**
 * Live mode claims LED control (its own state mirroring). On release the
 * persistent connected marker is repainted.
 */
export function claimLeds(): void {
  ledOwner = 'live'
}
export function releaseLeds(): void {
  ledOwner = 'presence'
  paintPresenceMarker()
}
