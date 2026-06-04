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

/** One per-venv health check returned by the sidecar's /native/health. */
export type DesktopHealthCheck = { name: string; ok: boolean; error?: string }

export type DesktopHealthResult = {
  ok: boolean
  /** True while auto-setup is running; checks[] is empty in that case. */
  installing: boolean
  checks: DesktopHealthCheck[]
}

/** One stage in the auto-setup pipeline. */
export type DesktopSetupStage = {
  name: string
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
  label?: string
  progress?: number
  error?: string
}

/** Aggregated state returned by /native/setup/status. */
export type DesktopSetupStatus = {
  ok: true
  running: boolean
  startedAt: number | null
  completedAt: number | null
  overall: number
  stages: DesktopSetupStage[]
  lastError: string | null
}

/**
 * Probe the sidecar's Python deps. Returns `null` when the sidecar is
 * unreachable or the response is unparseable. Callers should also check
 * `probeDesktopCompanion()` first — there's no point asking about deps
 * if the sidecar isn't running.
 *
 * The sidecar caches health internally for 60 s, so polling this every
 * few seconds doesn't actually spawn Python interpreters each time.
 */
export async function probeDesktopPythonHealth(): Promise<DesktopHealthResult | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(`http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}/native/health`, {
      method: 'GET',
      signal: ctrl.signal,
      cache: 'no-store',
    })
    clearTimeout(t)
    if (!res.ok) return null
    const data = (await res.json()) as Partial<DesktopHealthResult>
    if (typeof data?.ok !== 'boolean' || !Array.isArray(data.checks)) return null
    return {
      ok: data.ok,
      installing: data.installing === true,
      checks: data.checks as DesktopHealthCheck[],
    }
  } catch {
    clearTimeout(t)
    return null
  }
}

/**
 * Fetch the auto-setup orchestrator's state. Returns `null` when the
 * sidecar is unreachable. Useful while `pythonHealth === 'installing'`
 * to render per-stage progress bars on the download page.
 */
export async function probeDesktopSetupStatus(): Promise<DesktopSetupStatus | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}/native/setup/status`, {
      method: 'GET',
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as DesktopSetupStatus
  } catch {
    return null
  }
}

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
