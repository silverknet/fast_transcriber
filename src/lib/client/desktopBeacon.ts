/**
 * Probe the BarBro Electron companion on loopback.
 * Port must match `desktop/electron/main.mjs` (BARBRO_DESKTOP_BEACON_PORT).
 */
export const BARBRO_DESKTOP_BEACON_PORT = 47842

export const BARBRO_DESKTOP_PING_URL = `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}/ping`

export type DesktopPingPayload = {
  ok?: boolean
  name?: string
  version?: string
}

const PROBE_MS = 2000

export async function probeDesktopCompanion(): Promise<{
  ok: boolean
  version: string | null
  error: string | null
}> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), PROBE_MS)
  try {
    const res = await fetch(BARBRO_DESKTOP_PING_URL, {
      method: 'GET',
      signal: ctrl.signal,
      cache: 'no-store',
    })
    clearTimeout(t)
    if (!res.ok) {
      return { ok: false, version: null, error: `HTTP ${res.status}` }
    }
    const data = (await res.json()) as DesktopPingPayload
    if (data?.ok === true && data?.name === 'barbro-desktop') {
      return { ok: true, version: typeof data.version === 'string' ? data.version : null, error: null }
    }
    return { ok: false, version: null, error: 'Unexpected ping response' }
  } catch (e) {
    clearTimeout(t)
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'The user aborted a request.' || /abort/i.test(msg)) {
      return { ok: false, version: null, error: null }
    }
    return { ok: false, version: null, error: msg }
  }
}
