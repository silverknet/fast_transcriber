import { browser } from '$app/environment'
import { get } from 'svelte/store'
import {
  exportSongMapJson,
  parseSongMapJsonString,
  restorableStateFromJsonAndBlob,
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
  const checkedAt = new Date().toISOString()

  const res = await fetch('/api/sessions/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fingerprint }),
  })

  if (!res.ok) {
    serverAutosaveStatus.update((s) => ({
      ...s,
      enabled: false,
      lastCheckedAt: checkedAt,
      lastError: res.status === 503 ? 'Server autosave off (no database)' : `ensure failed (${res.status})`,
    }))
    return false
  }

  const data = (await res.json()) as { ok?: boolean; sessionId?: string }
  if (!data.ok || !data.sessionId) {
    serverAutosaveStatus.update((s) => ({
      ...s,
      enabled: false,
      lastCheckedAt: checkedAt,
      lastError: 'Invalid ensure response',
    }))
    return false
  }

  writeMeta({ sessionId: data.sessionId, fingerprint: fingerprint! })

  const sid = data.sessionId
  sessionId = sid
  serverAutosaveStatus.update((s) => ({
    ...s,
    enabled: true,
    lastCheckedAt: checkedAt,
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

  const json = exportSongMapJson(sm, false)

  serverAutosaveStatus.update((s) => ({ ...s, saving: true, lastError: null }))

  // SongMap JSON only — audio is never sent to the server. The sidecar owns
  // the user's audio files; the DB just persists the musical document.
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PUT',
    headers: {
      'X-BarBro-Fingerprint': fingerprint,
      'Content-Type': 'application/json',
    },
    body: json,
  })

  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    updatedAt?: string
    error?: string
  }

  if (!res.ok || !payload.ok) {
    const msg = payload.error ?? `Save failed (${res.status})`
    serverAutosaveStatus.update((s) => ({ ...s, saving: false, lastError: msg }))
    return { ok: false, error: msg }
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

  // No audio comes from the server. Reconstruct the editor state with JSON
  // only; the user will be prompted to relink the original audio file
  // through the desktop sidecar (see RelinkAudioBanner work in Phase 3 of
  // the .smap v2 plan).
  const bundle = restorableStateFromJsonAndBlob(jsonStr, null, sessionId ?? undefined)
  if (!bundle.ok) {
    return { ok: false, error: bundle.error }
  }

  hydrateRestorableSong(bundle.state)
  lastSavedContentKey = contentKey()
  dirty = false

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

export async function fetchAutosaveInfo(): Promise<{
  hasSongMap: boolean
  updatedAt: string | null
}> {
  if (!browser) return { hasSongMap: false, updatedAt: null }

  // Populate module-level sessionId / fingerprint from localStorage if not already set
  if (!sessionId || !fingerprint) {
    try {
      const raw = localStorage.getItem(META_KEY)
      if (raw) {
        const meta = JSON.parse(raw) as LocalMeta
        sessionId = meta.sessionId
        fingerprint = meta.fingerprint
      }
    } catch {
      // ignore
    }
  }

  if (!sessionId || !fingerprint) {
    const ok = await ensureSession()
    if (!ok || !sessionId || !fingerprint) return { hasSongMap: false, updatedAt: null }
  }

  const res = await fetch(
    `/api/sessions/${sessionId}?fingerprint=${encodeURIComponent(fingerprint)}`,
  )
  if (!res.ok) return { hasSongMap: false, updatedAt: null }

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    songMap?: unknown
    updatedAt?: string
  }
  return {
    hasSongMap: !!data.ok && data.songMap != null,
    updatedAt: data.updatedAt ?? null,
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
