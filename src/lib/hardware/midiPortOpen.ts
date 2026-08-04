/**
 * WEB MIDI'S SHARPEST EDGE: a listener does not open the port.
 *
 * Per the Web MIDI spec, assigning `input.onmidimessage = fn` implicitly OPENS
 * the port. `input.addEventListener('midimessage', fn)` does not. A port that
 * is `state: 'connected'` but `connection: 'closed'` delivers nothing, forever,
 * in complete silence — the listener is attached, the device is plugged in, the
 * status line says connected, and no message ever arrives.
 *
 * That is what killed the APC at rehearsals. Outputs were explicitly opened, so
 * every pad and button LED lit up perfectly; inputs were only listened to, so
 * pressing those lit-up buttons did nothing. It came and went because ANY other
 * code path that used `onmidimessage=` (the MIDI debug page, the mapping
 * dialog) opened the port as a side effect and left it open for the rest of the
 * session. At home he had been through one of those. At a rehearsal he went
 * straight to the live page, and the port was never opened by anyone.
 *
 * ## Why the answer is not "open it once when you bind"
 *
 * Ports are cached to avoid double-binding a listener. But a port that is
 * unplugged and plugged back in comes back as the SAME object with
 * `connection` reset to `'closed'` — so a bind-once-and-open guard opens it the
 * first time and never again. Unplug the USB mid-setup, plug it back in, and
 * the buttons are dead until a reload.
 *
 * Opening is therefore checked on EVERY refresh, independently of binding.
 */

/** The bit of `MIDIInput`/`MIDIOutput` this rule needs. */
export type MidiPortLike = {
  /** Is the hardware present? */
  state: string
  /** Is the port actually open for traffic? */
  connection: string
}

/**
 * The connected ports that are not open, and so are silently delivering
 * nothing. Call on every refresh — including for ports already bound.
 */
export function portsNeedingOpen<T extends MidiPortLike>(ports: readonly T[]): T[] {
  return ports.filter((p) => p.state === 'connected' && p.connection !== 'open')
}

/** Is this port actually able to deliver messages right now? */
export function isPortLive(port: MidiPortLike | null | undefined): boolean {
  return !!port && port.state === 'connected' && port.connection === 'open'
}
