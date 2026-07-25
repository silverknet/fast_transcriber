/**
 * The `/native/project/song/asset/*` endpoints — reading, writing and removing
 * files under a song folder. This is the exact path "Replace audio" drives, and
 * the one whose serving bug sent us on a hunt, so it's extracted here to be
 * bootable over a real HTTP server in tests (see projectAssetRoutes.test.mjs).
 *
 * The HTTP plumbing (`sendJson`, `readRequestJson`) is injected so this module
 * stays free of the Electron-coupled main.mjs; path safety + atomic write come
 * from the already-tested projectPaths module, and streaming from serveFile.
 */
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { serveFileFromDisk } from './serveFile.mjs'
import {
  atomicWriteFile,
  ensureAbsolutePath,
  validateAssetSubpath,
  validateRelSongFolder,
} from './projectPaths.mjs'

/**
 * @param deps.sendJson  `(res, status, payload, cors) => void`
 * @param deps.readRequestJson  `(req) => Promise<any|null>`
 * @returns `{ read, write, remove }` request handlers
 */
export function createProjectAssetRoutes({ sendJson, readRequestJson }) {
  /**
   * `GET /native/project/song/asset/read?projectPath=&songFolder=&subpath=`
   * — stream a single file from under the song folder. Path traversal blocked
   * via the same validator as the write endpoint.
   */
  function read(req, res, cors, url) {
    try {
      const projectPath = url.searchParams.get('projectPath') ?? ''
      const songFolder = url.searchParams.get('songFolder') ?? ''
      const subpath = url.searchParams.get('subpath') ?? ''
      ensureAbsolutePath(projectPath, 'projectPath')
      validateRelSongFolder(songFolder)
      validateAssetSubpath(subpath)
      const filePath = path.join(projectPath, songFolder, subpath)
      if (!existsSync(filePath)) {
        sendJson(res, 404, { ok: false, error: 'File not found' }, cors)
        return
      }
      const isWav = subpath.toLowerCase().endsWith('.wav')
      // Range-aware, fails cleanly on a mid-stream read error (see serveFile.mjs).
      serveFileFromDisk(req, res, filePath, {
        contentType: isWav ? 'audio/wav' : 'application/octet-stream',
        cors,
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
    }
  }

  /**
   * `POST /native/project/song/asset/write` — body
   * `{ projectPath, songFolder, subpath, contentBase64 }`. Writes a single file
   * under the song folder (e.g. `cue/tracks/main/cue-track.wav`). `subpath` is
   * validated like `songFolder` — no `..`, no leading `/`, no `\\`. Intermediate
   * directories are created on demand.
   */
  async function write(req, res, cors) {
    try {
      const body = await readRequestJson(req)
      if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
      ensureAbsolutePath(projectPath, 'projectPath')
      if (!existsSync(projectPath)) {
        return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
      }
      const songFolder = validateRelSongFolder(body.songFolder)
      const subpath = validateAssetSubpath(body.subpath)
      if (typeof body.contentBase64 !== 'string') {
        return sendJson(res, 400, { ok: false, error: 'contentBase64 is required' }, cors)
      }
      const targetAbs = path.join(projectPath, songFolder, subpath)
      const bytes = Buffer.from(body.contentBase64, 'base64')
      await atomicWriteFile(targetAbs, bytes)
      sendJson(res, 200, { ok: true }, cors)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      sendJson(res, 400, { ok: false, error: msg }, cors)
    }
  }

  /**
   * `POST /native/project/song/asset/remove` — body
   *   `{ projectPath, songFolder, subpath }`.
   *
   * Delete a file OR directory under a song folder (recursive, force). Used by
   * "Replace audio" to wipe stale derived artifacts (`stems/`, `cue/`, the old
   * audio file) so they don't get re-discovered for the new audio. No-op if the
   * target doesn't exist. Same `subpath` validation as asset-write — confined to
   * the song folder, no `..` traversal.
   */
  async function remove(req, res, cors) {
    try {
      const body = await readRequestJson(req)
      if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
      ensureAbsolutePath(projectPath, 'projectPath')
      if (!existsSync(projectPath)) {
        return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
      }
      const songFolder = validateRelSongFolder(body.songFolder)
      const subpath = validateAssetSubpath(body.subpath)
      const targetAbs = path.join(projectPath, songFolder, subpath)
      await rm(targetAbs, { recursive: true, force: true })
      sendJson(res, 200, { ok: true }, cors)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      sendJson(res, 400, { ok: false, error: msg }, cors)
    }
  }

  return { read, write, remove }
}
