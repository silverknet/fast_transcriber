/**
 * Auto-stems status + force controls (web side).
 *
 * The background stem daemon lives in the sidecar; this is how the project
 * page sees WHAT it's doing (queued / running / blocked / gave-up, with a
 * reason) and offers force-retry / restart when a song is stuck. Purely
 * informational + user-triggered — the daemon keeps running regardless.
 */
import { writable } from 'svelte/store'
import { BARBRO_DESKTOP_BEACON_PORT } from './desktopBeacon'

const BASE = `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`

export type AutoStemPhase = 'queued' | 'running' | 'ready' | 'blocked' | 'failed' | 'abandoned'

export interface AutoStemStatus {
  /** Absolute folder key from the sidecar (used only for dedupe). */
  key: string
  /** Project-relative song folder, e.g. `songs/opener-7f3a`. */
  folder?: string
  songId?: string | null
  phase?: AutoStemPhase
  attempts?: number
  reason?: string | null
  stems?: string[]
  updatedAt?: number
}

/** Latest per-song status keyed by project-relative folder. */
export const autoStemsStatuses = writable<Map<string, AutoStemStatus>>(new Map())

/** Fetch the daemon's per-song status and mirror it into the store. */
export async function refreshAutoStemsStatuses(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/native/auto-stems/status`, { cache: 'no-store' })
    if (!res.ok) return
    const data = (await res.json()) as { ok?: boolean; statuses?: AutoStemStatus[] }
    const map = new Map<string, AutoStemStatus>()
    for (const s of data.statuses ?? []) {
      if (s.folder) map.set(s.folder, s)
    }
    autoStemsStatuses.set(map)
  } catch {
    /* sidecar unreachable — leave the last snapshot in place */
  }
}

/** Force one song back into the queue (clears its attempt budget). */
export async function retryAutoStemsSong(projectPath: string, folder: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/native/auto-stems/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath, folder }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Clear every attempt budget for a project + re-scan ("Restart auto-split"). */
export async function restartAutoStems(projectPath: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/native/auto-stems/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath }),
    })
    return res.ok
  } catch {
    return false
  }
}
