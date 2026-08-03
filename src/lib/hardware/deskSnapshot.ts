/**
 * PUT THE DESK BACK HOW YOU FOUND IT.
 *
 * ## Why this exists
 *
 * The rig page's test buttons need a channel to themselves: to prove a tone is
 * reaching one performer's in-ears, every OTHER monitor send on that channel has
 * to come down, or the tone is in all six pairs of ears at once and proves
 * nothing.
 *
 * That part was right. What was missing is the other half — the sends were
 * zeroed and never restored. `restoreDesk()` only ever put back `fader`, `on`
 * and `lr`, because those are the only fields `refreshChannelState` reads. Bus
 * sends were written but never read, so there was nothing to restore FROM.
 *
 * The consequence was not subtle and it was found on a real desk: after pressing
 * "Test aux 2", channels 9 and 10 fed aux 2 and nothing else. Two of three
 * performers had silent in-ears, with no record anywhere of what their levels
 * had been. It reads exactly like broken hardware.
 *
 * The same hole exists for the USB input switch: pointing a strip at USB takes
 * over whatever was plugged into its socket, and there was no way back.
 *
 * ## The rule
 *
 * Nothing is written to the desk until what it is about to overwrite has been
 * READ and kept. A snapshot with a missing field restores nothing for that
 * field — a guess is worse than leaving it alone, because it looks like a
 * restore and is not.
 */

/** The XR18 has SIXTEEN channel strips; `/ch/17` and `/ch/18` do not exist. */
export const XAIR_MAX_CHANNEL = 16

/** The six aux buses, which feed the in-ear packs. */
export const XAIR_BUS_COUNT = 6

const p2 = (n: number) => String(n).padStart(2, '0')

/**
 * `/ch/NN/mix/BB/level` — how much of a channel feeds one aux bus.
 *
 * The bus number is ZERO-PADDED here and NOT padded on `/bus/N/mix/fader`. That
 * asymmetry is the desk's, not a typo, and it was confirmed against a real
 * XR18V2: the padded form on `/bus` gets no reply at all.
 */
export function busSendPath(channel: number, bus: number): string {
  return `/ch/${p2(channel)}/mix/${p2(bus)}/level`
}

/** Everything that has to be read before a channel can be safely written to. */
export type DeskChannelSnapshot = {
  fader?: number
  on?: number
  lr?: number
  /** Bus number (1-based) → send level. Absent buses were never read. */
  sends?: Record<number, number>
  /** `/ch/NN/preamp/rtnsw` — 0 analog socket, 1 USB. */
  usbSwitch?: number
  /** `/ch/NN/config/rtnsrc` — which USB channel, zero-based. */
  usbSource?: number
}

/** One desk write, in the shape the caller applies. */
export type DeskRestoreWrite =
  | { kind: 'fader'; channel: number; value: number }
  | { kind: 'on'; channel: number; on: boolean }
  | { kind: 'lr'; channel: number; on: boolean }
  | { kind: 'bus-send'; channel: number; bus: number; value: number }
  | { kind: 'usb-source'; channel: number; value: number }
  | { kind: 'usb-switch'; channel: number; value: number }

/** The addresses to query before touching a channel's bus sends. */
export function busSendQueryPaths(channel: number): string[] {
  const out: string[] = []
  for (let b = 1; b <= XAIR_BUS_COUNT; b++) out.push(busSendPath(channel, b))
  return out
}

type Replies = Record<string, { type: string; value: number | string }[] | undefined>

function numeric(replies: Replies, address: string): number | undefined {
  const v = replies[address]?.[0]?.value
  return typeof v === 'number' ? v : undefined
}

/**
 * Fold a desk reply set into a snapshot, keeping anything already captured.
 *
 * Existing values WIN. A snapshot is taken once, before the first write; asking
 * again after the page has changed something would capture the page's own
 * writes and "restore" the desk to the state it was being rescued from.
 */
export function withBusSends(
  base: DeskChannelSnapshot,
  channel: number,
  replies: Replies,
): DeskChannelSnapshot {
  if (base.sends) return base
  const sends: Record<number, number> = {}
  for (let b = 1; b <= XAIR_BUS_COUNT; b++) {
    const v = numeric(replies, busSendPath(channel, b))
    // A bus that did not answer is left OUT rather than defaulted to 0 — this
    // link drops UDP, and a dropped reply must never be recorded as silence.
    if (v !== undefined) sends[b] = v
  }
  return { ...base, ...(Object.keys(sends).length > 0 ? { sends } : {}) }
}

/** Same, for the USB input switch and source. */
export function withUsbInput(
  base: DeskChannelSnapshot,
  usbSwitch: number | undefined,
  usbSource: number | undefined,
): DeskChannelSnapshot {
  if (base.usbSwitch !== undefined || base.usbSource !== undefined) return base
  return {
    ...base,
    ...(usbSwitch !== undefined ? { usbSwitch } : {}),
    ...(usbSource !== undefined ? { usbSource } : {}),
  }
}

/**
 * The writes that undo everything captured, in a safe order.
 *
 * USB SOURCE goes before USB SWITCH, for the same reason it does when applying:
 * flipping the switch first would briefly pass whatever USB channel the strip
 * was previously pointed at — a pop in someone's in-ears.
 *
 * Bus sends come before the channel fader so a restored send cannot be heard at
 * the test level for the moment in between.
 */
export function restoreWrites(
  channel: number,
  snap: DeskChannelSnapshot | undefined,
): DeskRestoreWrite[] {
  if (!snap) return []
  const out: DeskRestoreWrite[] = []
  for (const [busStr, value] of Object.entries(snap.sends ?? {})) {
    out.push({ kind: 'bus-send', channel, bus: Number(busStr), value })
  }
  if (snap.usbSource !== undefined) out.push({ kind: 'usb-source', channel, value: snap.usbSource })
  if (snap.usbSwitch !== undefined) out.push({ kind: 'usb-switch', channel, value: snap.usbSwitch })
  if (snap.fader !== undefined) out.push({ kind: 'fader', channel, value: snap.fader })
  if (snap.on !== undefined) out.push({ kind: 'on', channel, on: snap.on >= 0.5 })
  if (snap.lr !== undefined) out.push({ kind: 'lr', channel, on: snap.lr >= 0.5 })
  return out
}

/** Every restore write for a whole set of touched channels. */
export function restoreAllWrites(
  touched: Record<number, DeskChannelSnapshot>,
): DeskRestoreWrite[] {
  return Object.entries(touched).flatMap(([ch, snap]) => restoreWrites(Number(ch), snap))
}

/**
 * Does this snapshot cover everything the caller is about to change?
 *
 * Used to refuse a destructive action rather than perform one that cannot be
 * undone. "I could not read the desk" is a far better outcome than a silent
 * in-ear mix nobody can reconstruct.
 */
export function canRestoreSends(snap: DeskChannelSnapshot | undefined): boolean {
  if (!snap?.sends) return false
  for (let b = 1; b <= XAIR_BUS_COUNT; b++) if (snap.sends[b] === undefined) return false
  return true
}
