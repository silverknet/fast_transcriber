/**
 * Project-filesystem path safety + atomic write, extracted from main.mjs so the
 * security-critical bits (path-traversal validation, the atomic replace used by
 * "Replace audio") are unit-testable without booting Electron.
 *
 * These mirror the web-side guards in src/lib/project/types.ts and
 * src/lib/songmap/persist.ts. A bug here means the loopback sidecar could read,
 * overwrite, or delete files OUTSIDE the project — so it's exactly the code that
 * deserves tests.
 */
import path from 'node:path'
import { mkdir, writeFile, rm, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

export const PROJECT_SONGS_DIR = 'songs'

/** Mirrors `safeExportBasename()` in src/lib/songmap/persist.ts. */
export function slugifyName(s) {
  const t = String(s).trim() || 'project'
  const out = t.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 80)
  return out || 'project'
}

/** Require an absolute path. Throws with a labeled message otherwise. */
export function ensureAbsolutePath(p, label) {
  if (typeof p !== 'string' || !p.trim()) {
    throw new Error(`${label} is required`)
  }
  if (!path.isAbsolute(p)) {
    throw new Error(`${label} must be an absolute path`)
  }
}

/**
 * Validate a `songs/<leaf>` style relative path. Throws on violation.
 * Mirrors `validateProjectFolderPath` in src/lib/project/types.ts.
 */
export function validateRelSongFolder(p, label = 'songFolder') {
  if (typeof p !== 'string' || p.length === 0) {
    throw new Error(`Invalid ${label}: must be a non-empty string`)
  }
  if (p.startsWith('/')) throw new Error(`Invalid ${label}: must not start with "/"`)
  if (p.includes('\\')) throw new Error(`Invalid ${label}: must use forward slashes`)
  if (p.endsWith('/')) throw new Error(`Invalid ${label}: must not end with "/"`)
  if (p.includes('//')) throw new Error(`Invalid ${label}: must not contain "//"`)
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new Error(`Invalid ${label}: must not contain "." or ".." segments`)
    }
  }
  if (!p.startsWith(`${PROJECT_SONGS_DIR}/`)) {
    throw new Error(`Invalid ${label}: must start with "${PROJECT_SONGS_DIR}/"`)
  }
  return p
}

/** Validate a relative asset subpath under a song folder. Throws on traversal. */
export function validateAssetSubpath(p, label = 'subpath') {
  if (typeof p !== 'string' || p.length === 0) {
    throw new Error(`Invalid ${label}: must be a non-empty string`)
  }
  if (p.startsWith('/')) throw new Error(`Invalid ${label}: must not start with "/"`)
  if (p.includes('\\')) throw new Error(`Invalid ${label}: must use forward slashes`)
  if (p.endsWith('/')) throw new Error(`Invalid ${label}: must not end with "/"`)
  if (p.includes('//')) throw new Error(`Invalid ${label}: must not contain "//"`)
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new Error(`Invalid ${label}: must not contain "." or ".." segments`)
    }
  }
  return p
}

/**
 * The single choke-point for locating a file inside a song folder: validate all
 * three inputs, then join. Guarantees the result stays under
 * `<projectPath>/<songFolder>/`. Use this everywhere instead of hand-rolling
 * `path.join(projectPath, songFolder, subpath)` next to ad-hoc validation.
 */
export function resolveSongAssetPath(projectPath, songFolder, subpath) {
  ensureAbsolutePath(projectPath, 'projectPath')
  const folder = validateRelSongFolder(songFolder)
  const sub = validateAssetSubpath(subpath)
  return path.join(projectPath, folder, sub)
}

/** Atomic file write: write a sibling temp file then rename over the target. */
export async function atomicWriteFile(targetPath, bytes) {
  const dir = path.dirname(targetPath)
  await mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(targetPath)}.${randomUUID().slice(0, 8)}.tmp`)
  await writeFile(tmp, bytes)
  try {
    await rename(tmp, targetPath)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}
