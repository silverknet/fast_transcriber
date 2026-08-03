import { BARBRO_DESKTOP_BEACON_PORT } from './desktopBeacon'

const BASE_URL = `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`

export type XAirOscArg = { type: 'i' | 'f' | 's'; value: number | string }

/**
 * What the desk said about itself, from its `/xinfo` reply.
 *
 * Null until a console has actually answered. This is the ONLY evidence that a
 * connection is real: opening a UDP socket contacts nothing, so `connected`
 * alone used to be true for any address you could type.
 */
export type XAirInfo = {
  address: string | null
  name: string | null
  model: string | null
  firmware: string | null
}

export type XAirStatus = {
  kind: 'behringer-xair'
  connected: boolean
  info?: XAirInfo | null
  host?: string
  port?: number
  lastMessageAt: string | null
  lastMessage: { address: string; args: XAirOscArg[]; remote?: { address: string; port: number } } | null
  lastError: string | null
}

export type HardwareStatus = {
  ok: true
  midi: { supported: boolean; devices: unknown[] }
  xair: XAirStatus
}

export type HardwareResult =
  | { ok: true; xair: XAirStatus }
  | { ok: false; error: string; xair?: XAirStatus }

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const data = await res.json()
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

async function postHardware(path: string, body?: unknown): Promise<HardwareResult> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? '{}' : JSON.stringify(body),
      cache: 'no-store',
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  const data = await readJson(res)
  const xair = data.xair as XAirStatus | undefined
  if (!res.ok || data.ok !== true || !xair) {
    return {
      ok: false,
      error: typeof data.error === 'string' ? data.error : `Hardware request failed (HTTP ${res.status})`,
      ...(xair ? { xair } : {}),
    }
  }
  return { ok: true, xair }
}

export async function getHardwareStatus(): Promise<HardwareStatus | null> {
  try {
    const res = await fetch(`${BASE_URL}/native/hardware/status`, {
      method: 'GET',
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data || data.ok !== true || !data.xair) return null
    return data as HardwareStatus
  } catch {
    return null
  }
}

export function connectXAirMixer(args: { host: string; port?: number }): Promise<HardwareResult> {
  return postHardware('/native/hardware/xair/connect', args)
}

export function disconnectXAirMixer(): Promise<HardwareResult> {
  return postHardware('/native/hardware/xair/disconnect')
}

export function setXAirMainFader(value: number): Promise<HardwareResult> {
  return postHardware('/native/hardware/xair/main-fader', { value })
}

export function setXAirChannelFader(channel: number, value: number): Promise<HardwareResult> {
  return postHardware('/native/hardware/xair/channel-fader', { channel, value })
}

export function setXAirChannelOn(channel: number, on: boolean): Promise<HardwareResult> {
  return postHardware('/native/hardware/xair/channel-on', { channel, on })
}

export function setXAirBusSend(channel: number, bus: number, value: number): Promise<HardwareResult> {
  return postHardware('/native/hardware/xair/bus-send', { channel, bus, value })
}

/** FOH-safety: `on:false` takes a channel OFF the main/LR (house) bus. */
export function setXAirChannelMainAssign(channel: number, on: boolean): Promise<HardwareResult> {
  return postHardware('/native/hardware/xair/channel-main-assign', { channel, on })
}

/** Aux-bus master fader (bus 1..6) — a performer's overall in-ear level. */
export function setXAirBusFader(bus: number, value: number): Promise<HardwareResult> {
  return postHardware('/native/hardware/xair/bus-fader', { bus, value })
}

/** Per-channel desk readback (`lr` 0 = off the house bus). */
export type XAirChannelState = { lr?: number; on?: number; fader?: number }
export type XAirReadback =
  | { ok: true; channels: Record<number, XAirChannelState> }
  | { ok: false; error: string }

/** Query the desk and return its actual per-channel state — the "prove it" read-back. */
export async function refreshXAirState(): Promise<XAirReadback> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/native/hardware/xair/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const data = await readJson(res)
  if (!res.ok || data.ok !== true || typeof data.channels !== 'object' || !data.channels) {
    return { ok: false, error: typeof data.error === 'string' ? data.error : `Read-back failed (HTTP ${res.status})` }
  }
  return { ok: true, channels: data.channels as Record<number, XAirChannelState> }
}

export type XAirMeterResult =
  | { ok: true; levels: number[] | null; ageMs: number | null }
  | { ok: false; error: string }

/**
 * What the desk is HEARING — the only proof that BarBro's audio arrived.
 *
 * A write is never evidence: X-Air ignores addresses it does not have with no
 * reply and no error. And a meter on BarBro's own output only proves what was
 * sent. This is the console's own report of every channel and bus.
 *
 * `levels` is null until the first frame lands, and `ageMs` says how old the
 * reading is — stale meters must never be shown as silence, because a monitor
 * wrongly marked dead is nearly as costly as one wrongly marked alive.
 */
export async function readXAirMeters(): Promise<XAirMeterResult> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/native/hardware/xair/meters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const data = await readJson(res)
  if (!res.ok || data.ok !== true) {
    return { ok: false, error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}` }
  }
  return {
    ok: true,
    levels: Array.isArray(data.levels) ? (data.levels as number[]) : null,
    ageMs: typeof data.ageMs === 'number' ? data.ageMs : null,
  }
}

// ── Desk input routing: where BarBro's audio lands ─────────────────────────
//
// The XR18 ignores the USB cable unless a channel's block is pointed at it, and
// that single setting is the difference between a working backing-track rig and
// total silence. BarBro reads it rather than assuming it — see
// `$lib/hardware/xairInputRouting`.

export type XAirQueryResult =
  | { ok: true; replies: Record<string, XAirOscArg[]> }
  | { ok: false; error: string }

/** Ask the desk for specific addresses. READ-ONLY — nothing is changed. */
export async function queryXAirPaths(
  addresses: string[],
  waitMs?: number,
): Promise<XAirQueryResult> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/native/hardware/xair/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses, ...(waitMs ? { waitMs } : {}) }),
      cache: 'no-store',
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const data = await readJson(res)
  if (!res.ok || data.ok !== true) {
    return { ok: false, error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}` }
  }
  return { ok: true, replies: (data.replies as Record<string, XAirOscArg[]>) ?? {} }
}

export type XAirRoutingWrite =
  | { ok: true; address: string; before: XAirOscArg[] | null; after: XAirOscArg[] | null }
  | { ok: false; error: string }

/**
 * Write one integer to one WHITELISTED desk address, and report what the desk
 * said before and after. The caller decides whether it worked by comparing them
 * — "the command was sent" is not evidence, because X-AIR silently ignores
 * addresses it does not have.
 *
 * The whitelist lives in the sidecar and currently allows only the two USB
 * input settings. Neither can make a sound: they choose a source, not a level.
 */
export async function setXAirOscInt(
  address: string,
  value: number,
): Promise<XAirRoutingWrite> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/native/hardware/xair/osc-int`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, value }),
      cache: 'no-store',
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const data = await readJson(res)
  if (!res.ok || data.ok !== true) {
    return { ok: false, error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}` }
  }
  return {
    ok: true,
    address: String(data.address ?? ''),
    before: (data.before as XAirOscArg[] | null) ?? null,
    after: (data.after as XAirOscArg[] | null) ?? null,
  }
}

/** One X-Air console found on the network. */
export type XAirConsole = {
  ip: string
  reportedIp: string | null
  name: string | null
  model: string | null
  firmware: string | null
}

export type XAirDiscovery =
  | { ok: true; consoles: XAirConsole[] }
  | { ok: false; error: string }

/**
 * Find every X-Air on the network by broadcasting `/xinfo`.
 *
 * The desk has no screen, so its address is otherwise unknowable without the
 * router's admin page. Typing one by hand is how you end up connected to
 * nothing — and a wrong address is indistinguishable from a desk that is off,
 * because UDP reports neither.
 */
export async function discoverXAirMixers(): Promise<XAirDiscovery> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/native/hardware/xair/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const data = await readJson(res)
  if (!res.ok || data.ok !== true) {
    return { ok: false, error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}` }
  }
  return { ok: true, consoles: (data.consoles as XAirConsole[]) ?? [] }
}
