import { browser } from '$app/environment'
import { get } from 'svelte/store'
import {
  exportSongMapJson,
  parseSongMapJsonString,
  restorableStateFromJsonAndBlob,
  sha256HexOfBlob,
} from '$lib/songmap/persist'
import { hydrateRestorableSong } from '$lib/stores/restorableSong'
import { serverAutosaveStatus } from '$lib/stores/serverAutosaveStatus'
import { audioSession } from '$lib/stores/audioSession'
import { songMap } from '$lib/stores/songMap'
import { computeBrowserFingerprintHash } from './browserFingerprint'

const META_KEY = 'barbro_autosave_meta'
const INTERVAL_MS = 30_000

let autosaveBootInFlight = false
/** Set when {@link stopServerAutosave} runs so late async bootstrap does not attach timers. */
let autosaveCancelled = false

type LocalMeta = { sessionId: string; fingerprint: string }

let intervalId: ReturnType<typeof setInterval> | null = null
let unsubscribers: (() => void)[] = []
let fingerprint: string | null = null
let sessionId: string | null = null
let lastSavedContentKey = ''
let lastUploadedAudioSha: string | null = null
let dirty = false

function writeMeta(m: LocalMeta) {
  localStorage.setItem(META_KEY, JSON.stringify(m))
}

function contentKey(): string {
  const sm = get(songMap)
  const f = get(audioSession).file
  if (!sm) return ''
  const json = exportSongMapJson(sm, false)
  return `${json}\0${f?.size ?? 0}\0${f?.name ?? ''}\0${f?.lastModified ?? 0}`
}

function markDirtyIfChanged() {
  const k = contentKey()
  if (!k) return
  if (k !== lastSavedContentKey) dirty = true
}

async function ensureSession(): Promise<boolean> {
  if (!fingerprint) fingerprint = await computeBrowserFingerprintHash()

  const res = await fetch('/api/sessions/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fingerprint }),
  })

  if (!res.ok) {
    serverAutosaveStatus.update((s) => ({
      ...s,
      enabled: false,
      lastError: res.status === 503 ? 'Server autosave off (no database)' : `ensure failed (${res.status})`,
    }))
    return false
  }

  const data = (await res.json()) as { ok?: boolean; sessionId?: string }
  if (!data.ok || !data.sessionId) {
    serverAutosaveStatus.update((s) => ({ ...s, enabled: false, lastError: 'Invalid ensure response' }))
    return false
  }

  writeMeta({ sessionId: data.sessionId, fingerprint: fingerprint! })

  const sid = data.sessionId
  sessionId = sid
  serverAutosaveStatus.update((s) => ({
    ...s,
    enabled: true,
    sessionId: sid,
    lastError: null,
  }))
  return true
}

export async function saveServerAutosaveNow(): Promise<{ ok: boolean; error?: string }> {
  return flushAutosave(true)
}

async function flushAutosave(manual: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!manual && !dirty) return { ok: true }

  const sm = get(songMap)
  if (!sm) {
    return { ok: false, error: 'Nothing to save' }
  }

  const okEnsure = await ensureSession()
  if (!okEnsure || !sessionId || !fingerprint) {
    return { ok: false, error: 'No session' }
  }

  const sess = get(audioSession)
  const json = exportSongMapJson(sm, false)

  const form = new FormData()
  form.set('songMapJson', json)

  const file = sess.file
  if (file) {
    let sha: string | null = null
    try {
      sha = await sha256HexOfBlob(file)
    } catch {
      sha = null
    }
    if (sha && sha !== lastUploadedAudioSha) {
      form.set('audio', file, file.name || 'audio')
    }
  }

  serverAutosaveStatus.update((s) => ({ ...s, saving: true, lastError: null }))

  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PUT',
    headers: { 'X-BarBro-Fingerprint': fingerprint },
    body: form,
  })

  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    audioSha256?: string | null
    updatedAt?: string
    error?: string
  }

  if (!res.ok || !payload.ok) {
    const msg = payload.error ?? `Save failed (${res.status})`
    serverAutosaveStatus.update((s) => ({ ...s, saving: false, lastError: msg }))
    return { ok: false, error: msg }
  }

  if (file && payload.audioSha256) {
    lastUploadedAudioSha = payload.audioSha256
  }

  lastSavedContentKey = contentKey()
  dirty = false

  const at = payload.updatedAt ?? new Date().toISOString()
  serverAutosaveStatus.update((s) => ({
    ...s,
    saving: false,
    lastSavedAt: at,
    lastError: null,
  }))
  return { ok: true }
}

async function tick() {
  if (!dirty) return
  const sm = get(songMap)
  if (!sm) return
  await flushAutosave(false)
}

export async function loadServerAutosave(): Promise<{ ok: boolean; error?: string }> {
  if (!browser) return { ok: false, error: 'Browser only' }

  const okEnsure = await ensureSession()
  if (!okEnsure || !sessionId || !fingerprint) {
    return { ok: false, error: 'Could not open server session' }
  }

  const res = await fetch(`/api/sessions/${sessionId}?fingerprint=${encodeURIComponent(fingerprint)}`)
  const data = (await res.json()) as {
    ok?: boolean
    songMap?: unknown
    hasAudio?: boolean
    error?: string
  }

  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error ?? `Load failed (${res.status})` }
  }

  if (data.songMap == null) {
    return { ok: false, error: 'No saved song on server yet' }
  }

  const jsonStr = JSON.stringify(data.songMap)
  const parsed = parseSongMapJsonString(jsonStr)
  if (!parsed.ok) {
    return { ok: false, error: parsed.error }
  }

  let blob: Blob | null = null
  if (data.hasAudio) {
    const ar = await fetch(`/api/sessions/${sessionId}/audio?fingerprint=${encodeURIComponent(fingerprint)}`)
    if (!ar.ok) {
      return { ok: false, error: 'Saved song references audio, but download failed' }
    }
    blob = await ar.blob()
  }

  const bundle = restorableStateFromJsonAndBlob(jsonStr, blob, sessionId ?? undefined)
  if (!bundle.ok) {
    return { ok: false, error: bundle.error }
  }

  hydrateRestorableSong(bundle.state)
  lastSavedContentKey = contentKey()
  dirty = false
  lastUploadedAudioSha = get(songMap)?.audio?.sha256 ?? null

  return { ok: true }
}

export function startServerAutosave(): void {
  if (!browser || intervalId || autosaveBootInFlight) return
  autosaveCancelled = false
  autosaveBootInFlight = true

  void (async () => {
    try {
      const ok = await ensureSession()
      if (!ok || autosaveCancelled) return

      unsubscribers.push(songMap.subscribe(() => markDirtyIfChanged()))
      unsubscribers.push(audioSession.subscribe(() => markDirtyIfChanged()))

      if (autosaveCancelled) {
        for (const u of unsubscribers) u()
        unsubscribers = []
        return
      }

      intervalId = setInterval(() => void tick(), INTERVAL_MS)

      document.addEventListener('visibilitychange', onVis)
    } finally {
      autosaveBootInFlight = false
    }
  })()
}

function onVis() {
  if (document.visibilityState === 'hidden' && dirty) {
    void flushAutosave(false)
  }
}

export function stopServerAutosave(): void {
  autosaveCancelled = true
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  document.removeEventListener('visibilitychange', onVis)
  for (const u of unsubscribers) u()
  unsubscribers = []
}
