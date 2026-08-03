/**
 * Reading and writing the offline session marker through the sidecar.
 *
 * The rules live in `$lib/project/offlineSession` and are pure; this is the
 * only part that touches disk, so the rules stay testable without a project on
 * hand and there is one place that knows how to ask.
 *
 * Every function here is best-effort. The marker is a convenience — it makes
 * the app say "3 songs changed offline" instead of leaving you to remember —
 * and a failure to write it must never break a save that is otherwise fine.
 * The edits themselves are in `song.smap` either way.
 */
import { BARBRO_DESKTOP_BEACON_PORT } from '$lib/client/desktopBeacon'
import { writeProjectAsset } from '$lib/client/desktopProjectFs'
import {
  OFFLINE_SESSION_FILENAME,
  parseOfflineSession,
  serializeOfflineSession,
  type OfflineSession,
} from '$lib/project/offlineSession'

const BASE_URL = `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`

/**
 * Read the marker, or null when there isn't one.
 *
 * A 404 is the ORDINARY answer — most projects have never been taken offline —
 * so it is not logged and not surfaced.
 */
export async function readOfflineSession(projectPath: string): Promise<OfflineSession | null> {
  const url = new URL(`${BASE_URL}/native/project/asset/read`)
  url.searchParams.set('projectPath', projectPath)
  url.searchParams.set('subpath', OFFLINE_SESSION_FILENAME)
  try {
    const res = await fetch(url.toString(), { cache: 'no-store' })
    if (!res.ok) return null
    return parseOfflineSession(await res.text())
  } catch {
    return null // sidecar unreachable — same as no marker
  }
}

export async function writeOfflineSession(
  projectPath: string,
  session: OfflineSession,
): Promise<boolean> {
  try {
    const bytes = new TextEncoder().encode(serializeOfflineSession(session))
    const r = await writeProjectAsset(projectPath, OFFLINE_SESSION_FILENAME, bytes)
    return r.ok === true
  } catch {
    return false
  }
}

/**
 * Delete the marker — the session is reconciled.
 *
 * Called only after every touched song has been pushed or explicitly discarded.
 * Clearing early would hide edits that never made it to the cloud, which is the
 * one failure this whole flow exists to prevent.
 */
export async function clearOfflineSession(projectPath: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/native/project/asset/remove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectPath, subpath: OFFLINE_SESSION_FILENAME }),
    })
    if (!res.ok) return false
    const body = (await res.json()) as { ok?: boolean }
    return body.ok === true
  } catch {
    return false
  }
}
