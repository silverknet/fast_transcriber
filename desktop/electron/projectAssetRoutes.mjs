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

  /**
   * `GET /native/project/asset/read?projectPath=&subpath=` — stream a single
   * file from the PROJECT ROOT. The read twin of the existing root write
   * (`/native/project/asset/write`), which until now had no counterpart.
   *
   * Added for the offline session marker: the desktop client writes
   * `offline-session.json` at the project root while you play, and the browser
   * has to read it back to know there are offline edits to reconcile. A file at
   * the root is not reachable through the song-scoped endpoint, and inventing a
   * fake song folder to reach it would defeat that endpoint's path validation.
   *
   * Same traversal protection: `validateAssetSubpath` rejects `..`, leading `/`
   * and backslashes, so this can only ever read inside the project folder.
   */
  function readRoot(req, res, cors, url) {
    try {
      const projectPath = url.searchParams.get('projectPath') ?? ''
      const subpath = url.searchParams.get('subpath') ?? ''
      ensureAbsolutePath(projectPath, 'projectPath')
      validateAssetSubpath(subpath)
      const filePath = path.join(projectPath, subpath)
      if (!existsSync(filePath)) {
        // A 404 here is ORDINARY — most projects have never been taken offline.
        // The caller treats it as "no marker", not as an error worth showing.
        sendJson(res, 404, { ok: false, error: 'File not found' }, cors)
        return
      }
      const isJson = subpath.toLowerCase().endsWith('.json')
      serveFileFromDisk(req, res, filePath, {
        contentType: isJson ? 'application/json' : 'application/octet-stream',
        cors,
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
    }
  }

  /**
   * `POST /native/project/asset/remove` — body `{ projectPath, subpath }`.
   * Delete a file at the project root. Used to clear the offline session marker
   * once its edits have been reconciled; a marker that cannot be cleared would
   * make the review dialog reappear forever.
   */
  async function removeRoot(req, res, cors) {
    try {
      const body = await readRequestJson(req)
      if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
      ensureAbsolutePath(projectPath, 'projectPath')
      if (!existsSync(projectPath)) {
        return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
      }
      const subpath = validateAssetSubpath(body.subpath)
      await rm(path.join(projectPath, subpath), { recursive: false, force: true })
      sendJson(res, 200, { ok: true }, cors)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      sendJson(res, 400, { ok: false, error: msg }, cors)
    }
  }

  return { read, write, remove, readRoot, removeRoot }
}
