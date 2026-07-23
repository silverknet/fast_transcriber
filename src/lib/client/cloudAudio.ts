/**
 * Cloud audio for browser-only mode: the compressed AAC playback copy (mix +
 * stems) stored in the Supabase `project-audio` bucket (see
 * `db/migrations/016_cloud_audio.sql`).
 *
 * FIDELITY FAILSAFE: `fetchCloudAudioBlob` refuses to run while the desktop
 * client is connected — the local HD master must be used there. See
 * `$lib/audio/resolveAudioSource.ts`. (Upload is unguarded: creators upload from
 * desktop.)
 *
 * The pure helpers below are the RLS-critical part: object paths MUST keep the
 * project id as the first segment, because the bucket policy authorises via
 * `is_project_member((storage.foldername(name))[1])`.
 */
import { getSupabaseBrowserClient } from './supabase/browserClient'
import { assertCloudAudioAccessAllowed } from '$lib/audio/resolveAudioSource'

export const PROJECT_AUDIO_BUCKET = 'project-audio'
export const CLOUD_AUDIO_CODEC = 'aac'
export const CLOUD_AUDIO_BITRATE_KBPS = 128
export const CLOUD_AUDIO_CONTENT_TYPE = 'audio/mp4'

/** Mirrors `cloud_songs.cloud_audio` jsonb. */
export interface CloudAudioObject {
  path: string
  bytes?: number
  durationSec?: number
}
export interface CloudAudioManifest {
  codec: string
  bitrateKbps: number
  /** sha256 of the WAV master this was derived from — identity + mismatch check. */
  sourceSha256?: string
  mix: CloudAudioObject
  stems?: Record<string, CloudAudioObject>
  updatedAt: string
}

// ── Pure path helpers (project id MUST be the first segment — RLS depends on it) ──

/** Filesystem/URL-safe stem slug for a stem slot name ("Bass" → "bass"). */
export function slugStem(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'stem'
}
export function cloudAudioMixPath(projectId: string, songId: string): string {
  return `${projectId}/${songId}/mix.m4a`
}
export function cloudAudioStemPath(projectId: string, songId: string, stem: string): string {
  return `${projectId}/${songId}/stems/${slugStem(stem)}.m4a`
}

/**
 * IndexedDB cache key — keyed by CONTENT (`sourceSha256`) so a re-upload of new
 * audio for the same song misses the old cache and re-downloads.
 */
export function cloudAudioCacheKey(input: {
  songId: string
  sourceSha256?: string
  kind: 'mix' | `stem:${string}`
}): string {
  return `${input.songId}@${input.sourceSha256 ?? 'nosha'}#${input.kind}`
}

/** Build the per-song manifest written to `cloud_songs.cloud_audio`. */
export function buildCloudAudioManifest(input: {
  projectId: string
  songId: string
  sourceSha256?: string
  mix: { bytes?: number; durationSec?: number }
  stems?: Record<string, { bytes?: number }>
  now?: () => string
}): CloudAudioManifest {
  const now = input.now ?? (() => new Date().toISOString())
  const stemEntries = Object.entries(input.stems ?? {}).map(
    ([name, s]) =>
      [name, { path: cloudAudioStemPath(input.projectId, input.songId, name), bytes: s.bytes }] as const,
  )
  return {
    codec: CLOUD_AUDIO_CODEC,
    bitrateKbps: CLOUD_AUDIO_BITRATE_KBPS,
    sourceSha256: input.sourceSha256,
    mix: {
      path: cloudAudioMixPath(input.projectId, input.songId),
      bytes: input.mix.bytes,
      durationSec: input.mix.durationSec,
    },
    stems: stemEntries.length ? Object.fromEntries(stemEntries) : undefined,
    updatedAt: now(),
  }
}

// ── IndexedDB blob cache (thin, defensive) ────────────────────────────────────

const CACHE_DB = 'barbro-cloud-audio'
const CACHE_STORE = 'blobs'

function openCache(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const req = indexedDB.open(CACHE_DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(CACHE_STORE)) req.result.createObjectStore(CACHE_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

async function cacheGet(key: string): Promise<Blob | null> {
  const db = await openCache()
  if (!db) return null
  return new Promise((resolve) => {
    const r = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(key)
    r.onsuccess = () => resolve((r.result as Blob) ?? null)
    r.onerror = () => resolve(null)
  })
}

async function cachePut(key: string, blob: Blob): Promise<void> {
  const db = await openCache()
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite')
    tx.objectStore(CACHE_STORE).put(blob, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

// ── Guarded I/O ───────────────────────────────────────────────────────────────

/**
 * Fetch a compressed cloud audio object as a Blob (IndexedDB-cached).
 * THROWS if the desktop client is connected — the local HD master must be used.
 */
export async function fetchCloudAudioBlob(input: {
  sidecarReachable: boolean
  path: string
  cacheKey: string
}): Promise<Blob> {
  // Failsafe FIRST — before any cache read or network call.
  assertCloudAudioAccessAllowed(input.sidecarReachable)
  const cached = await cacheGet(input.cacheKey)
  if (cached) return cached
  const supa = getSupabaseBrowserClient()
  const { data, error } = await supa.storage.from(PROJECT_AUDIO_BUCKET).download(input.path)
  if (error || !data) throw new Error(`cloud audio download failed: ${error?.message ?? 'no data'}`)
  await cachePut(input.cacheKey, data)
  return data
}

/** Upload one compressed object (creator side; unguarded — creators are on desktop). */
export async function uploadCloudAudioObject(input: { path: string; blob: Blob }): Promise<void> {
  const supa = getSupabaseBrowserClient()
  const { error } = await supa.storage
    .from(PROJECT_AUDIO_BUCKET)
    .upload(input.path, input.blob, { upsert: true, contentType: CLOUD_AUDIO_CONTENT_TYPE })
  if (error) throw new Error(`cloud audio upload failed: ${error.message}`)
}
