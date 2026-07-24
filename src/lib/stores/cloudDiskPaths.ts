import { writable, get } from 'svelte/store'

/**
 * Reactive map of `cloudProjectId → local disk folder` for cloud-linked projects
 * that ALSO exist on disk on THIS machine. Persisted in localStorage; mirrored in
 * a store so the audio-mode badge (and the reload arbiter) react the instant a
 * local copy is discovered — which is what lets the app say "you have a local HD
 * copy, switch to it" instead of silently streaming compressed cloud audio.
 *
 * Populated two ways: when a cloud-linked project is opened from disk
 * (`rememberCloudProjectDiskPath`), and by the startup recents scan
 * (`indexRecentCloudProjects`).
 */
const KEY = 'barbro::cloudProjectDiskPaths'

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export const cloudDiskPaths = writable<Record<string, string>>(load())

export function setCloudDiskPath(cloudProjectId: string, diskPath: string): void {
  if (!cloudProjectId || !diskPath) return
  cloudDiskPaths.update((m) => {
    if (m[cloudProjectId] === diskPath) return m
    const next = { ...m, [cloudProjectId]: diskPath }
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* localStorage disabled — the store still works for this session */
    }
    return next
  })
}

/** The known local disk folder for a cloud project on this machine, or null. */
export function diskPathForCloudId(cloudProjectId: string | null | undefined): string | null {
  if (!cloudProjectId) return null
  const p = get(cloudDiskPaths)[cloudProjectId]
  return typeof p === 'string' && p.trim() ? p : null
}
