import { BARBRO_DESKTOP_BEACON_PORT } from './desktopBeacon'

const BASE_URL = `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`

export type XAirOscArg = { type: 'i' | 'f' | 's'; value: number | string }

export type XAirStatus = {
  kind: 'behringer-xair'
  connected: boolean
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
