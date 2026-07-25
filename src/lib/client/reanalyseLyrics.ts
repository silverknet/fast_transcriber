/**
 * Project-wide "Reanalyse all lyrics" — re-fit every song's ALREADY-IMPORTED
 * lyrics to its audio with the current recognizer (large-v3-turbo + a language
 * hint read from the lyrics). Only the word TIMINGS are recomputed; the pasted
 * `lyrics.sourceText` is never touched.
 *
 * Sibling of `runKeyBackfill` (chord backfill): serial, best-effort, straight
 * off disk via the sidecar (no upload — it transcribes by absolute path). Disk
 * mode / Studio only — browser-cloud projects have no local stems to hear.
 *
 * Persistence per song: write the `.smap` to disk (source of truth in Studio),
 * then a best-effort cloud push. On a cloud conflict we leave the song
 * disk-ahead — the normal per-song sync reconciles it when it's next opened,
 * exactly as the autosave path does. The per-song sync watermarks are advanced
 * in the store and the manifest is persisted once at the end.
 */
import { get } from 'svelte/store'
import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
import { project, patchMetadataForFolder, setProjectData } from '$lib/stores/project'
import { readProjectSong, writeProjectSong, writeProjectManifest } from '$lib/client/desktopProjectFs'
import { decodeSmapFile, encodeSmapFile } from '$lib/songmap/smapFile'
import {
  getLyricsSetupStatus,
  setupLyricsDeps,
  enqueueLyricsTranscription,
  subscribeToJobEvents,
  type LyricsTranscriptionEvent,
  type LyricsTranscriptionWord,
} from '$lib/client/desktopBridge'
import { pushCloudSong } from '$lib/client/cloudSync'
import { detectLyricsLanguage } from '$lib/lyrics/detectLyricsLanguage'
import { alignLyricsToTranscription, tokenizeLyrics } from '$lib/lyrics/align'
import { metadataLiteFromSongMap, refreshProjectInfo, selectBestStemSet } from '$lib/project/commit'
import { collabContentFingerprint } from '$lib/songmap/collab'
import type { ProjectFile } from '$lib/project/types'
import type { SongMap } from '$lib/songmap/types'

export type ReanalyseStatus = 'ok' | 'skipped' | 'failed'
export type ReanalyseResult = {
  title: string
  folder: string
  status: ReanalyseStatus
  detail: string
  synced?: boolean
}
export type ReanalyseProgress = {
  phase: 'preparing' | 'running' | 'done' | 'error' | 'cancelled'
  total: number
  done: number
  current?: string
  results: ReanalyseResult[]
  error?: string
}

let running = false

/** Await a lyrics transcription job to completion, returning its words. */
function transcribeWords(
  abs: string,
  language: string | undefined,
): Promise<{ ok: true; words: LyricsTranscriptionWord[] } | { ok: false; error: string }> {
  return new Promise(async (resolve) => {
    const enq = await enqueueLyricsTranscription(abs, language ? { language } : {})
    if (!enq.ok) {
      resolve({ ok: false, error: enq.error })
      return
    }
    // Initialized before subscribing so the handler can reference it even if an
    // event arrives synchronously (defensive — real SSE events are async).
    let disconnect: () => void = () => {}
    disconnect = subscribeToJobEvents<LyricsTranscriptionEvent>(
      enq.jobId,
      (ev) => {
        if (ev.type === 'done') {
          disconnect()
          resolve({ ok: true, words: ev.words ?? [] })
        } else if (ev.type === 'error') {
          disconnect()
          resolve({ ok: false, error: ev.msg || 'Transcription failed.' })
        } else if (ev.type === 'state' && (ev.state === 'error' || ev.state === 'cancelled')) {
          disconnect()
          resolve({ ok: false, error: 'Transcription did not finish.' })
        }
      },
      (err) => resolve({ ok: false, error: err.message }),
    )
  })
}

/**
 * Re-fit every song's imported lyrics. `onProgress` is called after each song;
 * `isCancelled` is polled between songs.
 */
export async function reanalyseAllLyrics(
  onProgress: (p: ReanalyseProgress) => void,
  isCancelled: () => boolean = () => false,
): Promise<ReanalyseProgress> {
  const results: ReanalyseResult[] = []
  const emit = (phase: ReanalyseProgress['phase'], done: number, total: number, current?: string, error?: string) =>
    onProgress({ phase, done, total, current, results: [...results], error })

  if (running) return { phase: 'error', done: 0, total: 0, results, error: 'Already running.' }

  const snap0 = get(project)
  const osPath = snap0.osPath
  const proj = snap0.data
  if (!osPath || !proj) {
    return { phase: 'error', done: 0, total: 0, results, error: 'Open this project from disk (Studio) to reanalyse lyrics.' }
  }
  if (!get(desktopCompanionStatus).reachable) {
    return { phase: 'error', done: 0, total: 0, results, error: 'BarBro Desktop isn’t reachable.' }
  }

  running = true
  // Watermarks to persist to the manifest once at the end (song id → rev/hash).
  const synced = new Map<string, { revision: number; hash: string }>()
  try {
    emit('preparing', 0, 0)

    // Lyrics engine ready once (not per song).
    const status = await getLyricsSetupStatus()
    if (!status) {
      running = false
      return { phase: 'error', done: 0, total: 0, results, error: 'BarBro Desktop isn’t reachable.' }
    }
    if (!status.ready) {
      const setup = await setupLyricsDeps(() => {})
      if (!setup.ok) {
        running = false
        return { phase: 'error', done: 0, total: 0, results, error: setup.error }
      }
    }

    // Refresh stem/metadata scan so vocal-stem paths resolve.
    await refreshProjectInfo().catch(() => {})

    const songs = proj.songs.filter((s) => !s.hidden)
    const total = songs.length
    emit('running', 0, total)

    for (let i = 0; i < songs.length; i++) {
      if (isCancelled()) {
        running = false
        await persistWatermarks(synced)
        return { phase: 'cancelled', done: results.length, total, results }
      }
      // Project changed/closed under us — stop.
      if (get(project).osPath !== osPath) break
      const entry = songs[i]!

      // Don't race the editor's autosave on the actively-open song.
      const cur = get(project)
      if (cur.editingMode === 'project-song' && cur.activeSongId === entry.id) {
        results.push({ title: entry.folder, folder: entry.folder, status: 'skipped', detail: 'open in the editor — fit it there' })
        emit('running', i + 1, total)
        continue
      }

      try {
        const r = await readProjectSong(osPath, entry.folder)
        if (!r.ok) {
          results.push({ title: entry.folder, folder: entry.folder, status: 'failed', detail: 'could not read the song' })
          emit('running', i + 1, total)
          continue
        }
        const blob = new Blob([r.bytes as BlobPart], { type: 'application/octet-stream' })
        const data = await decodeSmapFile(blob)
        const sm = data.project.songMap
        const title = sm.metadata.title || entry.folder
        const sourceText = sm.lyrics?.sourceText?.trim()
        if (!sourceText) {
          results.push({ title, folder: entry.folder, status: 'skipped', detail: 'no imported lyrics' })
          emit('running', i + 1, total, title)
          continue
        }

        // Resolve vocals stem (preferred) or the original mix.
        const meta = get(project).metadataByFolder[entry.folder]
        const best = selectBestStemSet(meta)
        const vocalsFile = best?.files.find((f) => /^vocals\.(wav|mp3)$/i.test(f))
        const abs = vocalsFile
          ? `${osPath}/${entry.folder}/${best!.pathPrefix}${vocalsFile}`
          : sm.audio?.originalPath
            ? `${osPath}/${entry.folder}/${sm.audio.originalPath}`
            : null
        if (!abs) {
          results.push({ title, folder: entry.folder, status: 'skipped', detail: 'no audio on disk' })
          emit('running', i + 1, total, title)
          continue
        }

        emit('running', i, total, title)
        const language = detectLyricsLanguage(sourceText)
        const tr = await transcribeWords(abs, language)
        if (!tr.ok) {
          results.push({ title, folder: entry.folder, status: 'failed', detail: tr.error })
          emit('running', i + 1, total, title)
          continue
        }

        const tokens = tokenizeLyrics(sourceText)
        const { words: timed, matchedRows, totalRows } = alignLyricsToTranscription(tokens, tr.words)
        if (timed.length === 0) {
          results.push({ title, folder: entry.folder, status: 'failed', detail: 'could not match the lyrics' })
          emit('running', i + 1, total, title)
          continue
        }

        const nextMap: SongMap = {
          ...sm,
          lyrics: {
            words: timed,
            sourceText: sm.lyrics!.sourceText,
            alignedAt: new Date().toISOString(),
            transcriberVersion: 4,
          },
        }

        // Persist to disk (Studio source of truth).
        const enc = await encodeSmapFile({ project: { ...data.project, songMap: nextMap } })
        const w = await writeProjectSong(osPath, entry.folder, new Uint8Array(await enc.arrayBuffer()))
        if (!w.ok) {
          results.push({ title, folder: entry.folder, status: 'failed', detail: 'could not save the song' })
          emit('running', i + 1, total, title)
          continue
        }
        patchMetadataForFolder(entry.folder, metadataLiteFromSongMap(nextMap))

        // Best-effort cloud push (advance the per-song watermark on success;
        // leave disk-ahead on conflict — the next open reconciles it).
        let cloudSynced = false
        const cloud = get(project).data?.cloud
        if (cloud) {
          try {
            const cloudSongId = entry.cloudSongId ?? entry.id
            const baseRev = entry.lastSyncedRevision ?? cloud.lastSyncedRevision
            const sortOrder = get(project).data!.songs.findIndex((s) => s.id === entry.id)
            const push = await pushCloudSong(cloud.projectId, cloudSongId, nextMap, sortOrder, !!entry.hidden, baseRev)
            if (push.ok) {
              synced.set(entry.id, { revision: push.revision, hash: collabContentFingerprint(nextMap) })
              cloudSynced = true
            }
          } catch {
            /* best-effort — disk write already succeeded */
          }
        }

        const rows = totalRows > 0 ? Math.round((100 * matchedRows) / totalRows) : 0
        results.push({
          title,
          folder: entry.folder,
          status: 'ok',
          detail: `${matchedRows}/${totalRows} lines placed (${rows}%)`,
          synced: cloudSynced,
        })
        emit('running', i + 1, total, title)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        results.push({ title: entry.folder, folder: entry.folder, status: 'failed', detail: msg.slice(0, 120) })
        emit('running', i + 1, total)
      }
    }

    await persistWatermarks(synced)
    const okCount = results.filter((r) => r.status === 'ok').length
    running = false
    return { phase: 'done', done: okCount, total: results.length, results }
  } catch (e) {
    running = false
    const msg = e instanceof Error ? e.message : String(e)
    return { phase: 'error', done: results.length, total: results.length, results, error: msg }
  }
}

/** Fold the successful per-song cloud revisions into the store + manifest once. */
async function persistWatermarks(synced: Map<string, { revision: number; hash: string }>): Promise<void> {
  if (synced.size === 0) return
  const cur = get(project)
  if (!cur.data) return
  const next: ProjectFile = {
    ...cur.data,
    songs: cur.data.songs.map((s) => {
      const mark = synced.get(s.id)
      return mark
        ? { ...s, cloudSongId: s.cloudSongId ?? s.id, lastSyncedRevision: mark.revision, lastSyncedContentHash: mark.hash }
        : s
    }),
  }
  setProjectData(next)
  if (cur.osPath) await writeProjectManifest(cur.osPath, next).catch(() => {})
}
