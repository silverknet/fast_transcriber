import { writable } from 'svelte/store'
import type { DesktopHealthCheck, DesktopSetupStage } from '$lib/client/desktopBeacon'

/**
 * `pythonHealth` is the per-venv status reported by the sidecar's
 * `/native/health` endpoint:
 *  - `'unknown'`    → sidecar unreachable OR health endpoint not yet probed
 *  - `'installing'` → auto-setup is in flight; UI should show progress
 *  - `'ok'`         → all critical venvs (beats / sections) imported their
 *                     canonical modules successfully
 *  - `'broken'`     → at least one critical venv failed and we're NOT
 *                     currently installing; UI redirects to /download
 *
 * `setup` mirrors `/native/setup/status` when populated. It's null when
 * the sidecar hasn't reported a setup state yet.
 */
export type PythonHealth = 'unknown' | 'installing' | 'ok' | 'broken'

export type DesktopCompanionStatus = {
  reachable: boolean
  version: string | null
  lastCheckedAt: string | null
  lastError: string | null
  pythonHealth: PythonHealth
  brokenChecks: DesktopHealthCheck[]
  setup: {
    running: boolean
    overall: number
    stages: DesktopSetupStage[]
    lastError: string | null
  } | null
}

export const desktopCompanionStatus = writable<DesktopCompanionStatus>({
  reachable: false,
  version: null,
  lastCheckedAt: null,
  lastError: null,
  pythonHealth: 'unknown',
  brokenChecks: [],
  setup: null,
})
