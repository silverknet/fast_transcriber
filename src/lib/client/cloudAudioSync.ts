/**
 * Creator-side upload: turn a song's local HD audio (mix + stems) into the
 * compressed AAC cloud copy and publish it so browser-only members can play.
 *
 * Runs only on the creator's machine (sidecar reachable): transcode via the
 * sidecar → read the AAC bytes → upload to the `project-audio` bucket → write
 * the manifest to `cloud_songs.cloud_audio`. The HD WAV master never leaves disk.
 */
import { get } from 'svelte/store'
import {
  readProjectSong,
  readProjectSongAsset,
  transcodeProjectAudioToAac,
} from './desktopProjectFs'
import { decodeSmapFile } from '$lib/songmap/persist'
import { reconcileSongAudio } from '$lib/project/audioReconcile'
import { project } from '$lib/stores/project'
import {
  buildCloudAudioManifest,
  cloudAudioMixPath,
  cloudAudioStemPath,
  slugStem,
  uploadCloudAudioObject,
  type CloudAudioManifest,
} from './cloudAudio'
import { getSupabaseBrowserClient } from './supabase/browserClient'

export interface CloudAudioUploadTask {
  kind: 'mix' | `stem:${string}`
  stemName?: string
  /** Local source to transcode (WAV/FLAC), relative to the song folder. */
  srcSubpath: string
  /** Local AAC output, relative to the song folder. */
  dstSubpath: string
  /** Object path within the bucket (project id first — RLS depends on it). */
  storagePath: string
}

/**
 * Pure: the transcode+upload task list for one song. Mix first, then each stem.
 * Testable so the src/dst/storage path derivation is pinned independently of I/O.
 */
export function planCloudAudioUpload(input: {
  projectId: string
  songId: string
  mixSrcSubpath: string
  stems: Record<string, string>
}): CloudAudioUploadTask[] {
  const tasks: CloudAudioUploadTask[] = [
    {
      kind: 'mix',
      srcSubpath: input.mixSrcSubpath,
      dstSubpath: 'cloud/mix.m4a',
      storagePath: cloudAudioMixPath(input.projectId, input.songId),
    },
  ]
  for (const [name, src] of Object.entries(input.stems)) {
    tasks.push({
      kind: `stem:${name}`,
      stemName: name,
      srcSubpath: src,
      dstSubpath: `cloud/stems/${slugStem(name)}.m4a`,
      storagePath: cloudAudioStemPath(input.projectId, input.songId, name),
    })
  }
  return tasks
}

/**
 * Transcode + upload one song's mix and stems, then write the manifest.
 * Returns the manifest that was published. Throws on the first failure.
 */
export async function uploadSongCloudAudio(input: {
  osPath: string
  songFolder: string
  /** cloud_projects.id */
  projectId: string
  /** cloud_songs.id */
  songId: string
  /** Local mix source subpath (the song's originalPath, e.g. "audio/foo.wav"). */
  mixSrcSubpath: string
  /** stem slot name → local subpath (e.g. { Bass: "stems/best/bass.wav" }). */
  stems: Record<string, string>
  sourceSha256?: string
  durationSec?: number
  bitrateKbps?: number
  onProgress?: (msg: string) => void
}): Promise<CloudAudioManifest> {
  const tasks = planCloudAudioUpload({
    projectId: input.projectId,
    songId: input.songId,
    mixSrcSubpath: input.mixSrcSubpath,
    stems: input.stems,
  })

  const mixMeta: { bytes?: number; durationSec?: number } = { durationSec: input.durationSec }
  const stemMeta: Record<string, { bytes?: number }> = {}

  for (const task of tasks) {
    input.onProgress?.(`Compressing ${task.kind === 'mix' ? 'mix' : task.stemName}…`)
    const t = await transcodeProjectAudioToAac(
      input.osPath,
      input.songFolder,
      task.srcSubpath,
      task.dstSubpath,
      input.bitrateKbps ?? 128,
    )
    if (!t.ok) throw new Error(`Compressing ${task.kind} failed: ${t.error}`)

    const asset = await readProjectSongAsset(input.osPath, input.songFolder, task.dstSubpath)
    if (!asset.ok) throw new Error(`Reading compressed ${task.kind} failed: ${asset.error}`)

    input.onProgress?.(`Uploading ${task.kind === 'mix' ? 'mix' : task.stemName}…`)
    await uploadCloudAudioObject({ path: task.storagePath, blob: asset.blob })

    if (task.kind === 'mix') mixMeta.bytes = t.bytes
    else if (task.stemName) stemMeta[task.stemName] = { bytes: t.bytes }
  }

  const manifest = buildCloudAudioManifest({
    projectId: input.projectId,
    songId: input.songId,
    sourceSha256: input.sourceSha256,
    mix: mixMeta,
    stems: Object.keys(stemMeta).length ? stemMeta : undefined,
  })

  input.onProgress?.('Publishing…')
  const supa = getSupabaseBrowserClient()
  // `cloud_audio` is a metadata column, separate from `song_map` sync — writing
  // it does not bump the collab revision. RLS lets any project member update.
  const { error } = await supa.from('cloud_songs').update({ cloud_audio: manifest }).eq('id', input.songId)
  if (error) throw new Error(`Publishing cloud audio failed: ${error.message}`)

  return manifest
}

export interface CloudAudioUploadResult {
  songId: string
  title: string
  ok: boolean
  error?: string
  manifest?: CloudAudioManifest
}

/**
 * Prepare + upload compressed cloud audio for every (non-hidden) song in the
 * ACTIVE cloud project. Reads each song's `.smap` for its local mix + stems, so
 * the caller only needs to be in a cloud-linked project with the sidecar up.
 * Returns a per-song result list (a relink-needed song fails softly, others go).
 */
export async function uploadProjectCloudAudio(opts?: {
  /** Process at most this many (non-hidden) songs — e.g. 1 for a cheap test run. */
  limit?: number
  bitrateKbps?: number
  onProgress?: (msg: string) => void
}): Promise<CloudAudioUploadResult[]> {
  const snap = get(project)
  const proj = snap.data
  const osPath = snap.osPath
  if (!proj || !osPath) throw new Error('Open a project first.')
  const cloud = proj.cloud
  if (!cloud) throw new Error('Enable cloud sync for this project first.')

  const results: CloudAudioUploadResult[] = []
  for (const entry of proj.songs) {
    if (entry.hidden) continue
    if (opts?.limit != null && results.length >= opts.limit) break
    const songId = entry.cloudSongId ?? entry.id
    let title = entry.folder
    try {
      const r = await readProjectSong(osPath, entry.folder)
      if (!r.ok) throw new Error(r.error)
      const data = await decodeSmapFile(new Blob([r.bytes as BlobPart], { type: 'application/octet-stream' }))
      const sm = data.project.songMap
      title = sm.metadata?.title || entry.folder
      // Prefer the stamped local pointer. If it's missing (song never opened +
      // saved since the file-reference migration), reconcile against
      // <song>/audio/ by content identity — the same logic the editor's load
      // path uses — and take the strict (sha256) match. This must NOT fall to a
      // loose/duration match: a different, similar-length master would silently
      // upload the wrong audio. Only a byte-identical file is accepted here.
      let originalPath = sm.audio?.originalPath
      if (!originalPath) {
        const outcome = await reconcileSongAudio(sm, osPath, entry.folder)
        if (outcome.kind === 'strict-match') originalPath = `audio/${outcome.fileName}`
      }
      if (!originalPath) {
        results.push({ songId, title, ok: false, error: 'no local audio — relink it first' })
        continue
      }
      const manifest = await uploadSongCloudAudio({
        osPath,
        songFolder: entry.folder,
        projectId: cloud.projectId,
        songId,
        mixSrcSubpath: originalPath,
        stems: sm.stemRefs ?? {},
        sourceSha256: sm.audio?.sha256,
        durationSec: sm.audio?.durationSec,
        bitrateKbps: opts?.bitrateKbps,
        onProgress: (m) => opts?.onProgress?.(`${title}: ${m}`),
      })
      results.push({ songId, title, ok: true, manifest })
    } catch (e) {
      results.push({ songId, title, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return results
}
