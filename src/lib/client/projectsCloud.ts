import { browser } from '$app/environment'
import { get } from 'svelte/store'
import {
  exportSongMapJson,
  parseSongMapJsonString,
  restorableStateFromJsonAndBlob,
  sha256HexOfBlob,
} from '$lib/songmap/persist'
import { hydrateRestorableSong } from '$lib/stores/restorableSong'
import { audioSession } from '$lib/stores/audioSession'
import { songMap } from '$lib/stores/songMap'
import { computeBrowserFingerprintHash } from './browserFingerprint'

const PROJECT_META_KEY = 'barbro_current_project'

export type CurrentProjectMeta = {
  id: string
  name: string
}

export type CloudProjectListItem = {
  id: string
  name: string
  hasSongMap: boolean
  updatedAt: string
}

let _fingerprint: string | null = null
async function getFingerprint(): Promise<string> {
  if (!_fingerprint) _fingerprint = await computeBrowserFingerprintHash()
  return _fingerprint
}

export function getCurrentProject(): CurrentProjectMeta | null {
  if (!browser) return null
  try {
    const raw = localStorage.getItem(PROJECT_META_KEY)
    return raw ? (JSON.parse(raw) as CurrentProjectMeta) : null
  } catch {
    return null
  }
}

export function setCurrentProject(meta: CurrentProjectMeta | null): void {
  if (!browser) return
  if (meta) {
    localStorage.setItem(PROJECT_META_KEY, JSON.stringify(meta))
  } else {
    localStorage.removeItem(PROJECT_META_KEY)
  }
}

export async function listCloudProjects(): Promise<{
  ok: boolean
  projects?: CloudProjectListItem[]
  error?: string
}> {
  if (!browser) return { ok: false, error: 'Browser only' }
  const fp = await getFingerprint()
  const res = await fetch(`/api/projects?fingerprint=${encodeURIComponent(fp)}`)
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; projects?: unknown; error?: string }
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error ?? `List failed (${res.status})` }
  }
  return { ok: true, projects: data.projects as CloudProjectListItem[] }
}

export async function saveCloudProject(
  projectId?: string,
  name?: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!browser) return { ok: false, error: 'Browser only' }

  const sm = get(songMap)
  if (!sm) return { ok: false, error: 'Nothing to save' }

  const fp = await getFingerprint()
  const jsonText = exportSongMapJson(sm, false)
  const sess = get(audioSession)
  const projectName = name ?? (sm.metadata.title?.trim() || 'Untitled Project')

  const form = new FormData()
  form.set('songMapJson', jsonText)
  if (!projectId) form.set('name', projectName)

  const file = sess.file
  if (file) {
    try {
      const sha = await sha256HexOfBlob(file)
      if (sha) form.set('audio', file, file.name || 'audio')
    } catch {
      // skip audio if hashing fails
    }
  }

  if (projectId) {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'X-BarBro-Fingerprint': fp },
      body: form,
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `Save failed (${res.status})` }
    }
    setCurrentProject({ id: projectId, name: getCurrentProject()?.name ?? projectName })
    return { ok: true, id: projectId }
  }

  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'X-BarBro-Fingerprint': fp },
    body: form,
  })
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string }
  if (!res.ok || !data.ok || !data.id) {
    return { ok: false, error: data.error ?? `Create failed (${res.status})` }
  }
  setCurrentProject({ id: data.id, name: projectName })
  return { ok: true, id: data.id }
}

export async function loadCloudProject(
  projectId: string,
): Promise<{ ok: boolean; name?: string; error?: string }> {
  if (!browser) return { ok: false, error: 'Browser only' }
  const fp = await getFingerprint()

  const res = await fetch(`/api/projects/${projectId}?fingerprint=${encodeURIComponent(fp)}`)
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    name?: string
    songMap?: unknown
    hasAudio?: boolean
    error?: string
  }
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error ?? `Load failed (${res.status})` }
  }

  if (data.songMap == null) {
    return { ok: false, error: 'Project has no saved content' }
  }

  const jsonStr = JSON.stringify(data.songMap)
  const parsed = parseSongMapJsonString(jsonStr)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  let blob: Blob | null = null
  if (data.hasAudio) {
    const ar = await fetch(
      `/api/projects/${projectId}/audio?fingerprint=${encodeURIComponent(fp)}`,
    )
    if (!ar.ok) return { ok: false, error: 'Audio download failed' }
    blob = await ar.blob()
  }

  const bundle = restorableStateFromJsonAndBlob(jsonStr, blob, projectId)
  if (!bundle.ok) return { ok: false, error: bundle.error }

  hydrateRestorableSong(bundle.state)
  setCurrentProject({ id: projectId, name: data.name ?? 'Untitled Project' })

  return { ok: true, name: data.name }
}

export async function deleteCloudProject(
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!browser) return { ok: false, error: 'Browser only' }
  const fp = await getFingerprint()

  const res = await fetch(`/api/projects/${projectId}`, {
    method: 'DELETE',
    headers: { 'X-BarBro-Fingerprint': fp },
  })
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error ?? `Delete failed (${res.status})` }
  }

  if (getCurrentProject()?.id === projectId) {
    setCurrentProject(null)
  }

  return { ok: true }
}
