/**
 * GETTING BARBRO'S AUDIO INTO THE XR18, over USB.
 *
 * ## Verified against real hardware
 *
 * Every fact here was read from an XR18V2 on firmware 1.19, not from a
 * datasheet. The previous version of this file was built on the X32's model —
 * "input blocks" of four channels sharing a source — and was fiction from top to
 * bottom. X-AIR ignores addresses it does not have, silently, with no reply and
 * no error, so being wrong looked exactly like being right.
 *
 * The real mechanism is TWO settings per channel:
 *
 *   /ch/NN/preamp/rtnsw    i   0 = the socket on the front, 1 = USB
 *   /ch/NN/config/rtnsrc   i   WHICH USB channel feeds it, ZERO-BASED
 *
 * `rtnsw` is the switch; `rtnsrc` is the selector. A channel ships with
 * `rtnsrc = channel - 1` (channel 9 → 8), which is why USB "looks" hard-wired
 * 1:1 until you change it.
 *
 * There is also `/ch/NN/config/insrc`, which is a DIFFERENT setting entirely —
 * it picks which analog socket a channel listens to. Mistaking one for the other
 * cost an afternoon and produced total silence with everything apparently set
 * correctly.
 *
 * ## Why this matters for BarBro
 *
 * macOS sends plain stereo as USB channels 1 and 2. So to hear BarBro on
 * channels 9 and 10 — leaving the mic inputs free — those channels need
 * `rtnsrc` 0 and 1, and `rtnsw` 1. Not the 1:1 default, which would have them
 * listening to USB 9 and 10, where nothing is playing.
 */

/** The XR18 has SIXTEEN channel strips. 17/18 is the aux return (`/rtn/aux`). */
export const XAIR_MAX_CHANNEL = 16

/** `/ch/NN/preamp/rtnsw` — the socket-or-USB switch. */
export function usbSwitchPath(channel: number): string {
  return `/ch/${String(channel).padStart(2, '0')}/preamp/rtnsw`
}

/** `/ch/NN/config/rtnsrc` — which USB channel feeds this strip (zero-based). */
export function usbSourcePath(channel: number): string {
  return `/ch/${String(channel).padStart(2, '0')}/config/rtnsrc`
}

/**
 * The USB channel BarBro's audio actually arrives on, zero-based for the desk.
 *
 * Plain stereo from macOS is USB 1 and 2, so the LEFT channel takes 0 and the
 * RIGHT takes 1 — regardless of which mixer channels they land on.
 */
export const USB_LEFT_SOURCE = 0
export const USB_RIGHT_SOURCE = 1

export type OscArg = { type: 'i' | 'f' | 's'; value: number | string }

/** What one mixer channel is currently listening to. */
export type ChannelInput = {
  channel: number
  /** True when this strip is fed from USB rather than its socket. */
  fromUsb: boolean | null
  /** Which USB channel feeds it, ONE-based for humans. Null if unknown. */
  usbChannel: number | null
  /** True when the desk did not answer — never treat this as "socket". */
  missing: boolean
}

const intArg = (args: OscArg[] | undefined): number | null => {
  const a = args?.[0]
  return a && typeof a.value === 'number' ? Math.round(a.value) : null
}

export function readChannelInput(channel: number, replies: Record<string, OscArg[]>): ChannelInput {
  const sw = intArg(replies[usbSwitchPath(channel)])
  const src = intArg(replies[usbSourcePath(channel)])
  if (sw === null && src === null) {
    return { channel, fromUsb: null, usbChannel: null, missing: true }
  }
  return {
    channel,
    fromUsb: sw === null ? null : sw === 1,
    usbChannel: src === null ? null : src + 1,
    missing: false,
  }
}

/** Everything worth asking to describe BarBro's stereo pair. */
export function usbQueryPaths(leftCh: number, rightCh: number): string[] {
  return [leftCh, rightCh].flatMap((c) => [usbSwitchPath(c), usbSourcePath(c)])
}

/** The writes that make a channel listen to a given USB channel. */
export function usbWritesFor(channel: number, usbSourceZeroBased: number): Array<{
  address: string
  value: number
}> {
  // Source FIRST, then the switch. If the switch flipped first, the strip would
  // briefly carry whatever USB channel it was previously pointed at — audible,
  // and on a live desk that is a pop in someone's ears.
  return [
    { address: usbSourcePath(channel), value: usbSourceZeroBased },
    { address: usbSwitchPath(channel), value: 1 },
  ]
}

/** Is BarBro's pair correctly fed from USB 1/2? */
export function barbroPairReady(
  left: ChannelInput,
  right: ChannelInput,
): { ok: boolean; reason: string } {
  if (left.missing || right.missing) {
    return { ok: false, reason: 'The desk did not answer, so nothing can be assumed.' }
  }
  if (!left.fromUsb || !right.fromUsb) {
    return {
      ok: false,
      reason: `Channels ${left.channel} and ${right.channel} are listening to the sockets on the front, not to this computer.`,
    }
  }
  if (left.usbChannel !== USB_LEFT_SOURCE + 1 || right.usbChannel !== USB_RIGHT_SOURCE + 1) {
    // The 1:1 default lands here: switched to USB, but pointed at USB 9/10 where
    // nothing is playing. Silent, and indistinguishable from "not set up" unless
    // you say which USB channel it is actually on.
    return {
      ok: false,
      reason: `Set to USB, but listening to USB ${left.usbChannel}/${right.usbChannel} — BarBro plays on USB 1/2.`,
    }
  }
  return {
    ok: true,
    reason: `Channels ${left.channel} and ${right.channel} are listening to this computer.`,
  }
}


// ── The whole live layout, not just the stereo pair ────────────────────────

export type LiveUsbPlan = {
  /** Desk channel → the zero-based USB channel it must be fed from. */
  writes: Array<{ channel: number; usbSource: number; lane: 'song' | 'click' | 'cue' }>
  /** Which desk channels end up carrying what — for the routing table. */
  deskChannels: { song: number[]; click: number[]; cue: number[] }
}

/**
 * Point the desk at BarBro's full multichannel output.
 *
 * The song is a stereo pair; the click and the cues are one channel each,
 * immediately after it. They need their own STRIPS — not their own levels on a
 * shared strip — because that is the only way the desk can send click to every
 * in-ear while keeping it off the main bus. Sharing a strip with the song means
 * taking the click off the house takes the song with it.
 *
 * `usbChannels` comes from `liveOutputMap`, so the two sides cannot disagree
 * about which USB channel carries what. A mismatch there is silence with every
 * setting apparently correct.
 *
 * Returns null when the layout would run past channel 16, rather than silently
 * truncating — writes to a channel an XR18 does not have are ignored without
 * complaint.
 */
export function liveUsbPlan(
  songLeftChannel: number,
  usbChannels: { song: number[]; click: number[]; cue: number[] },
): LiveUsbPlan | null {
  if (!Number.isInteger(songLeftChannel) || songLeftChannel < 1) return null
  const song = [songLeftChannel, songLeftChannel + 1]
  const click = [songLeftChannel + 2]
  const cue = [songLeftChannel + 3]
  if (cue[0]! > XAIR_MAX_CHANNEL) return null

  const writes: LiveUsbPlan['writes'] = []
  const pair = (deskChs: number[], usbChs: number[], lane: 'song' | 'click' | 'cue') => {
    deskChs.forEach((ch, i) => {
      const usbSource = usbChs[i]
      if (usbSource === undefined) return
      writes.push({ channel: ch, usbSource, lane })
    })
  }
  pair(song, usbChannels.song, 'song')
  pair(click, usbChannels.click, 'click')
  pair(cue, usbChannels.cue, 'cue')

  return { writes, deskChannels: { song, click, cue } }
}
