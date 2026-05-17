/**
 * BarBro desktop — headless sidecar.
 *
 * No window, no renderer. All capabilities (beats analysis, stem
 * separation, Piper TTS, …) are exposed as loopback HTTP endpoints on
 * `127.0.0.1:BARBRO_DESKTOP_BEACON_PORT`, consumed by the BarBro web app.
 * Console logging is the only user-visible affordance — run from a
 * terminal to see startup + per-job activity.
 *
 * Must not import from the repo-root SvelteKit app (`../../src`).
 * Port must stay in sync with `src/lib/client/desktopBeacon.ts`.
 */

import { app, BrowserWindow, dialog } from 'electron'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  beatsScriptPath,
  bootstrapPythonExe,
  getNativePythonRoot,
  getPiperTtsDefaultModelOnnxPath,
  getPiperTtsModelDir,
  getPiperTtsVenvDir,
  getPiperTtsVenvPythonExe,
  getStemsVenvDir,
  getStemsVenvPythonExe,
  piperTtsScriptPath,
  piperTtsVenvIsReady,
  pythonBeatsExe,
  pythonPiperTtsExe,
  pythonStemsExe,
  runPythonCapture,
  stemsScriptPath,
  stemsVenvIsReady,
} from './nativePython.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('node:http').Server | null} */
let beaconServer = null

/** Keep aligned with web client `BARBRO_DESKTOP_BEACON_PORT`. */
const BARBRO_DESKTOP_BEACON_PORT = 47842

const LOG_PREFIX = '[barbro-desktop]'
const logInfo = (...args) => console.info(LOG_PREFIX, ...args)
const logWarn = (...args) => console.warn(LOG_PREFIX, ...args)
const logError = (...args) => console.error(LOG_PREFIX, ...args)

function readDesktopVersion() {
  try {
    const p = path.join(__dirname, '..', 'package.json')
    const j = JSON.parse(readFileSync(p, 'utf8'))
    return typeof j.version === 'string' ? j.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Cap on inbound request body size (200 MB). Stems input can be a full song. */
const MAX_REQUEST_BYTES = 200 * 1024 * 1024

/**
 * Stem-separation jobs keyed by jobId. v2: jobs are queued and run serially
 * (concurrency=1) so the user can fire several from the web app without
 * thrashing the machine. Each job retains its event log so late subscribers
 * can replay progress.
 *
 * Terminal jobs (`done`/`cancelled`/`error`) keep their temp dir until the
 * web client fetches the stems and calls `DELETE`, or the 30-min TTL fires.
 *
 * @typedef {'queued' | 'running' | 'done' | 'cancelled' | 'error'} JobState
 *
 * @typedef {Object} StemsJob
 * @property {string} jobId
 * @property {string | null} songId  Web-side identifier the client passed at
 *                                    enqueue time. Lets the web app match a
 *                                    completed-but-not-fetched job back to
 *                                    its song after a reload.
 * @property {JobState} state
 * @property {string} tempRoot       Path to job's working dir.
 * @property {string} inputPath      WAV bytes already written.
 * @property {string} outDir         Where exported stems land.
 * @property {string[]} files        Exported filenames (filled after run).
 * @property {object} options        Demucs args (model/shifts/overlap/stems).
 * @property {number} createdAt
 * @property {number | null} startedAt
 * @property {number | null} finishedAt
 * @property {object[]} events       Full NDJSON event buffer for replay.
 * @property {Set<(ev: object) => void>} subscribers
 * @property {string | null} lastErrorMsg
 * @property {import('node:child_process').ChildProcess | null} child
 * @property {NodeJS.Timeout | null} cleanupTimer
 *
 * @type {Map<string, StemsJob>}
 */
const stemsJobs = new Map()
const STEMS_JOB_TTL_MS = 30 * 60 * 1000

/** Default Piper voice for debug + future cue tracks (`rhasspy/piper-voices` v1.0.0). */
const PIPER_DEFAULT_VOICE_ID = 'en_US-lessac-medium'
const PIPER_VOICE_DOWNLOAD_BASE =
  'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium'

/** Currently-running job id (concurrency=1). null when idle. */
let activeJobId = null

function isTerminalState(state) {
  return state === 'done' || state === 'cancelled' || state === 'error'
}

function emitJobEvent(job, ev) {
  job.events.push(ev)
  for (const fn of job.subscribers) {
    try {
      fn(ev)
    } catch {
      /* subscriber broken — drop on error in its own loop */
    }
  }
}

function publicJobView(job) {
  return {
    jobId: job.jobId,
    songId: job.songId,
    state: job.state,
    files: job.files,
    options: job.options,
    createdAt: new Date(job.createdAt).toISOString(),
    startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : null,
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    error: job.lastErrorMsg,
  }
}

function scheduleJobCleanup(jobId) {
  const job = stemsJobs.get(jobId)
  if (!job) return
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer)
  job.cleanupTimer = setTimeout(() => {
    void destroyStemsJob(jobId).catch(() => {})
  }, STEMS_JOB_TTL_MS)
}

async function destroyStemsJob(jobId) {
  const job = stemsJobs.get(jobId)
  if (!job) return
  stemsJobs.delete(jobId)
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer)
  for (const fn of job.subscribers) {
    try {
      fn({ type: 'cleanup', jobId })
    } catch {
      /* ignore */
    }
  }
  job.subscribers.clear()
  try {
    await rm(job.tempRoot, { recursive: true, force: true })
    logInfo(`stems: job ${jobId.slice(0, 8)} cleaned up`)
  } catch {
    /* ignore */
  }
}

/** Read full request body to a Buffer, rejecting once total exceeds the cap. */
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let aborted = false
    req.on('data', (chunk) => {
      if (aborted) return
      total += chunk.length
      if (total > MAX_REQUEST_BYTES) {
        aborted = true
        reject(new Error(`Request body exceeds ${MAX_REQUEST_BYTES} bytes`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks))
    })
    req.on('error', (e) => {
      if (!aborted) reject(e)
    })
  })
}

function sendJson(res, status, payload, cors) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    ...cors,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Read request body and JSON-parse. Returns `null` on parse failure. */
async function readRequestJson(req) {
  const buf = await readRequestBody(req)
  if (buf.byteLength === 0) return null
  try {
    return JSON.parse(buf.toString('utf-8'))
  } catch {
    return null
  }
}

/**
 * Slice the audio chunk out of a `.smap` container straight to a WAV file.
 *
 * `.smap` binary layout (see `src/lib/songmap/smapFile.ts`):
 *   bytes 0..3   magic "SMAP"
 *   bytes 4..7   version uint32 LE
 *   bytes 8..11  flags uint32 LE (bit 0 = hasAudio)
 *   bytes 12..19 jsonLength uint64 LE
 *   bytes 20..27 audioLength uint64 LE
 *   then JSON, then audio
 *
 * Returns the path to the extracted WAV (always WAV-ish; the .smap stores
 * whatever bytes were originally inserted but for BarBro projects this is
 * typically the upload's reference MP3 or a trimmed WAV).
 */
async function extractAudioFromSmap(smapPath, destPath) {
  const buf = await readFile(smapPath)
  if (buf.length < 28) throw new Error('.smap too short (header)')
  if (buf.toString('ascii', 0, 4) !== 'SMAP') throw new Error('.smap missing magic bytes')
  const flags = buf.readUInt32LE(8)
  const hasAudio = (flags & 1) !== 0
  if (!hasAudio) throw new Error('.smap has no audio chunk')
  const jsonLen = Number(buf.readBigUInt64LE(12))
  const audioLen = Number(buf.readBigUInt64LE(20))
  const audioStart = 28 + jsonLen
  const audioEnd = audioStart + audioLen
  if (audioEnd > buf.length) throw new Error('.smap declared audio bytes past end of file')
  await writeFile(destPath, buf.subarray(audioStart, audioEnd))
}

// ── Project I/O helpers ──────────────────────────────────────────────────────

/** Project manifest filename, must match `src/lib/project/types.ts` PROJECT_FILENAME. */
const PROJECT_FILENAME = 'barbro.project.json'
const PROJECT_SONGS_DIR = 'songs'
const PROJECT_FILE_VERSION = 1
const SONG_SMAP_FILENAME = 'song.smap'
const SONG_ALS_FILENAME = 'song.als'

/** Mirrors `safeExportBasename()` in src/lib/songmap/persist.ts. */
function slugifyName(s) {
  const t = String(s).trim() || 'project'
  const out = t.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 80)
  return out || 'project'
}

/**
 * Validate `songs/<leaf>` style relative path. Throws on violation.
 * Mirrors `validateProjectFolderPath` in src/lib/project/types.ts.
 */
function validateRelSongFolder(p, label = 'songFolder') {
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

/** Atomic file write: write a sibling temp file then rename over the target. */
async function atomicWriteFile(targetPath, bytes) {
  const dir = path.dirname(targetPath)
  await mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(targetPath)}.${randomUUID().slice(0, 8)}.tmp`)
  await writeFile(tmp, bytes)
  try {
    const { rename } = await import('node:fs/promises')
    await rename(tmp, targetPath)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

/** Recursively sort object keys (mirrors web-side `sortKeysDeep`). */
function sortKeysDeep(x) {
  if (x === undefined) return undefined
  if (x === null || typeof x !== 'object') return x
  if (Array.isArray(x)) return x.map(sortKeysDeep)
  const out = {}
  for (const k of Object.keys(x).sort()) {
    const v = x[k]
    if (v === undefined) continue
    const inner = sortKeysDeep(v)
    if (inner !== undefined) out[k] = inner
  }
  return out
}

function serializeProject(manifest) {
  return JSON.stringify(sortKeysDeep(manifest), null, 2)
}

/**
 * Validate + parse a manifest object (after JSON.parse). Throws on schema
 * violation. Mirrors the parser in src/lib/project/parse.ts.
 */
function parseManifestObject(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid barbro.project.json: root must be an object')
  }
  if (raw.formatVersion !== PROJECT_FILE_VERSION) {
    throw new Error(`Unsupported project formatVersion: ${raw.formatVersion} (expected ${PROJECT_FILE_VERSION})`)
  }
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new Error('Invalid barbro.project.json: missing or invalid `id`')
  }
  if (typeof raw.name !== 'string') {
    throw new Error('Invalid barbro.project.json: missing or invalid `name`')
  }
  if (typeof raw.createdAt !== 'string') {
    throw new Error('Invalid barbro.project.json: missing or invalid `createdAt`')
  }
  if (typeof raw.updatedAt !== 'string') {
    throw new Error('Invalid barbro.project.json: missing or invalid `updatedAt`')
  }
  if (!Array.isArray(raw.songs)) {
    throw new Error('Invalid barbro.project.json: `songs` must be an array')
  }
  const songs = []
  for (let i = 0; i < raw.songs.length; i++) {
    const e = raw.songs[i]
    if (!e || typeof e !== 'object') throw new Error(`Invalid songs[${i}]: must be an object`)
    if (typeof e.id !== 'string' || e.id.length === 0) {
      throw new Error(`Invalid songs[${i}].id: must be a non-empty string`)
    }
    const folder = validateRelSongFolder(e.folder, `songs[${i}].folder`)
    const entry = { id: e.id, folder }
    if (typeof e.hidden === 'boolean' && e.hidden) entry.hidden = true
    songs.push(entry)
  }
  return {
    formatVersion: PROJECT_FILE_VERSION,
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    songs,
  }
}

async function readProjectManifest(projectPath) {
  const p = path.join(projectPath, PROJECT_FILENAME)
  const text = await readFile(p, 'utf-8')
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(`Invalid ${PROJECT_FILENAME}: not valid JSON`)
  }
  return parseManifestObject(raw)
}

/**
 * Read just the JSON chunk from a .smap on disk. Used to populate the
 * project list view without paying for the audio bytes. Returns null on any
 * error (truncated file, bad magic, unsupported version, bad JSON) — callers
 * treat that as "song.smap unreadable" and surface in the songsMetadata.
 */
async function readSmapHeaderJson(smapPath) {
  try {
    // Open by stat to bound reads.
    const st = await stat(smapPath)
    if (st.size < 28) return null
    const fh = await import('node:fs/promises').then((m) => m.open(smapPath, 'r'))
    try {
      const headerBuf = Buffer.alloc(28)
      await fh.read(headerBuf, 0, 28, 0)
      if (headerBuf.toString('ascii', 0, 4) !== 'SMAP') return null
      const version = headerBuf.readUInt32LE(4)
      if (version !== 1) return null
      const jsonLen = Number(headerBuf.readBigUInt64LE(12))
      if (jsonLen <= 0 || jsonLen > 10 * 1024 * 1024) return null
      if (28 + jsonLen > st.size) return null
      const jsonBuf = Buffer.alloc(jsonLen)
      await fh.read(jsonBuf, 0, jsonLen, 28)
      const text = jsonBuf.toString('utf-8')
      return JSON.parse(text)
    } finally {
      await fh.close()
    }
  } catch {
    return null
  }
}

/** Pull the lite fields used by the project list from a parsed SongProject. */
function extractSongMetadataLite(songProject) {
  if (!songProject || typeof songProject !== 'object') return null
  const map = songProject.songMap
  if (!map || typeof map !== 'object') return null
  const md = map.metadata ?? {}
  const out = { title: typeof md.title === 'string' ? md.title : '' }
  if (typeof md.artist === 'string') out.artist = md.artist
  if (md.keyDetail) out.keyDetail = md.keyDetail
  if (typeof md.bpm === 'number') out.bpm = md.bpm
  if (map.stemRefs && typeof map.stemRefs === 'object') out.stemRefs = { ...map.stemRefs }
  return out
}

/** Known preset slugs (kept in sync with web-side STEM_QUALITY_PRESETS). */
const KNOWN_STEM_PRESETS = new Set(['best', 'balanced', 'preview'])

/**
 * Scan `<songFolder>/stems/` for stem renderings, grouped by preset.
 *
 * Two layouts are supported simultaneously so older songs keep working:
 *  - **Per-preset subfolders**: `stems/best/vocals.wav`, `stems/preview/...`
 *  - **Flat (legacy)**: `stems/vocals.wav` directly under `stems/`. These
 *    get reported under the `'legacy'` slug — lowest quality fallback.
 *
 * Returns `Record<presetSlug, sortedWavBasenames>`. Empty object when no
 * stems exist. Empty presets (subfolders with no WAVs inside) are skipped.
 */
async function listStemSets(songFolderAbs) {
  const stemsDir = path.join(songFolderAbs, 'stems')
  /** @type {Record<string, string[]>} */
  const out = {}
  let entries
  try {
    const { readdir } = await import('node:fs/promises')
    entries = await readdir(stemsDir, { withFileTypes: true })
  } catch {
    return out
  }
  const flatWavs = []
  for (const ent of entries) {
    if (ent.isFile() && ent.name.toLowerCase().endsWith('.wav')) {
      flatWavs.push(ent.name)
      continue
    }
    if (ent.isDirectory()) {
      const sub = path.join(stemsDir, ent.name)
      try {
        const inner = await readdir(sub)
        const wavs = inner.filter((f) => f.toLowerCase().endsWith('.wav')).sort()
        if (wavs.length > 0) out[ent.name] = wavs
      } catch {
        /* unreadable subfolder — skip */
      }
    }
  }
  if (flatWavs.length > 0) out['legacy'] = flatWavs.sort()
  return out
}

function nowIso() {
  return new Date().toISOString()
}

function ensureAbsolutePath(p, label) {
  if (typeof p !== 'string' || !p.trim()) {
    throw new Error(`${label} is required`)
  }
  if (!path.isAbsolute(p)) {
    throw new Error(`${label} must be an absolute path`)
  }
}

/**
 * `POST /native/project/create` — body `{ parentPath, name }`. Creates a
 * project folder under `parentPath` with a slugified name, writes an empty
 * `barbro.project.json`, returns `{ ok, projectPath, manifest }`.
 *
 * If the slugified folder name already exists in `parentPath`, retries with
 * an `-id` suffix up to 3 times before giving up.
 */
async function handleProjectCreate(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const parentPath = typeof body.parentPath === 'string' ? body.parentPath.trim() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    ensureAbsolutePath(parentPath, 'parentPath')
    if (!name) return sendJson(res, 400, { ok: false, error: 'name is required' }, cors)
    if (!existsSync(parentPath)) {
      return sendJson(res, 404, { ok: false, error: `parentPath not found: ${parentPath}` }, cors)
    }

    const baseSlug = slugifyName(name)
    let chosen = baseSlug
    let projectPath = path.join(parentPath, chosen)
    let attempts = 0
    while (existsSync(projectPath)) {
      attempts++
      if (attempts > 3) {
        return sendJson(res, 409, { ok: false, error: `Folder name already exists: ${chosen}` }, cors)
      }
      const suffix = randomUUID().slice(0, 8)
      chosen = `${baseSlug}-${suffix}`
      projectPath = path.join(parentPath, chosen)
    }

    await mkdir(projectPath, { recursive: false })

    const manifest = {
      formatVersion: PROJECT_FILE_VERSION,
      id: randomUUID(),
      name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      songs: [],
    }
    await atomicWriteFile(path.join(projectPath, PROJECT_FILENAME), serializeProject(manifest))

    logInfo(`project/create: ${projectPath}`)
    sendJson(res, 200, { ok: true, projectPath, manifest }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError(`project/create: ${msg}`)
    sendJson(res, 500, { ok: false, error: msg }, cors)
  }
}

/**
 * `POST /native/project/info` — body `{ projectPath }`. Reads the manifest,
 * for each entry scans the song folder for `song.smap` header (title, etc),
 * `song.als` presence, and stems WAVs. Returns
 * `{ ok, manifest, songsMetadata: Record<folder, { title, artist?, keyDetail?, bpm?, hasSmap, hasAls, hasCueTrack, hasClickTrack, stemsByPreset: Record<presetSlug, sortedWavBasenames>, stemRefs? }> }`.
 *
 * `stemsByPreset` groups stem WAVs by quality preset (`best`/`balanced`/
 * `preview`) corresponding to `<song>/stems/<preset>/<file>.wav`. Flat-
 * layout legacy files (`<song>/stems/<file>.wav`) appear under the
 * `'legacy'` key.
 */
async function handleProjectInfo(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (!existsSync(projectPath)) {
      return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
    }

    const manifest = await readProjectManifest(projectPath)
    const songsMetadata = {}
    for (const entry of manifest.songs) {
      const folderAbs = path.join(projectPath, entry.folder)
      const smapPath = path.join(folderAbs, SONG_SMAP_FILENAME)
      const alsPath = path.join(folderAbs, SONG_ALS_FILENAME)
      const cuePath = path.join(folderAbs, 'cue', 'cue-track.wav')
      const clickPath = path.join(folderAbs, 'cue', 'click-track.wav')
      const hasSmap = existsSync(smapPath)
      const hasAls = existsSync(alsPath)
      const hasCueTrack = existsSync(cuePath)
      const hasClickTrack = existsSync(clickPath)
      const songProject = hasSmap ? await readSmapHeaderJson(smapPath) : null
      const lite = extractSongMetadataLite(songProject) ?? { title: entry.folder }
      const stemsByPreset = await listStemSets(folderAbs)
      songsMetadata[entry.folder] = { ...lite, hasSmap, hasAls, hasCueTrack, hasClickTrack, stemsByPreset }
    }

    sendJson(res, 200, { ok: true, manifest, songsMetadata }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 400, { ok: false, error: msg }, cors)
  }
}

/**
 * `POST /native/project/manifest/write` — body `{ projectPath, manifest }`.
 * Validates the manifest then atomically rewrites `barbro.project.json`.
 */
async function handleProjectManifestWrite(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (!existsSync(projectPath)) {
      return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
    }
    const manifest = parseManifestObject(body.manifest)
    await atomicWriteFile(path.join(projectPath, PROJECT_FILENAME), serializeProject(manifest))
    sendJson(res, 200, { ok: true }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 400, { ok: false, error: msg }, cors)
  }
}

/**
 * `POST /native/project/song/create` — body `{ projectPath, songFolder, smapBase64 }`.
 * Creates the song folder if missing and atomically writes `song.smap`.
 * Errors if the folder already contains a `song.smap` (caller must use
 * `song/write` for overwrites).
 */
async function handleProjectSongCreate(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (!existsSync(projectPath)) {
      return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
    }
    const songFolder = validateRelSongFolder(body.songFolder)
    if (typeof body.smapBase64 !== 'string' || !body.smapBase64) {
      return sendJson(res, 400, { ok: false, error: 'smapBase64 is required' }, cors)
    }
    const smapBytes = Buffer.from(body.smapBase64, 'base64')
    const folderAbs = path.join(projectPath, songFolder)
    const smapPath = path.join(folderAbs, SONG_SMAP_FILENAME)
    if (existsSync(smapPath)) {
      return sendJson(res, 409, { ok: false, error: `${SONG_SMAP_FILENAME} already exists in ${songFolder}` }, cors)
    }
    await mkdir(folderAbs, { recursive: true })
    await atomicWriteFile(smapPath, smapBytes)
    sendJson(res, 200, { ok: true }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 400, { ok: false, error: msg }, cors)
  }
}

/**
 * `GET /native/project/song/read?projectPath=...&songFolder=...` — streams
 * the song's `song.smap` bytes. 404 if missing.
 */
function handleProjectSongRead(req, res, cors, url) {
  try {
    const projectPath = url.searchParams.get('projectPath') ?? ''
    const songFolder = url.searchParams.get('songFolder') ?? ''
    ensureAbsolutePath(projectPath, 'projectPath')
    validateRelSongFolder(songFolder)
    const smapPath = path.join(projectPath, songFolder, SONG_SMAP_FILENAME)
    if (!existsSync(smapPath)) {
      sendJson(res, 404, { ok: false, error: `${SONG_SMAP_FILENAME} not found` }, cors)
      return
    }
    let size = 0
    try {
      size = statSync(smapPath).size
    } catch {
      /* ignore */
    }
    res.writeHead(200, {
      ...cors,
      'Content-Type': 'application/octet-stream',
      ...(size > 0 ? { 'Content-Length': String(size) } : {}),
    })
    const stream = createReadStream(smapPath)
    stream.on('error', () => {
      try {
        res.end()
      } catch {
        /* ignore */
      }
    })
    stream.pipe(res)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 400, { ok: false, error: msg }, cors)
  }
}

/**
 * `POST /native/project/song/write` — body `{ projectPath, songFolder, smapBase64 }`.
 * Atomic overwrite of an existing `song.smap`. Returns 404 if the song
 * folder doesn't exist.
 */
async function handleProjectSongWrite(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (!existsSync(projectPath)) {
      return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
    }
    const songFolder = validateRelSongFolder(body.songFolder)
    if (typeof body.smapBase64 !== 'string' || !body.smapBase64) {
      return sendJson(res, 400, { ok: false, error: 'smapBase64 is required' }, cors)
    }
    const folderAbs = path.join(projectPath, songFolder)
    if (!existsSync(folderAbs)) {
      return sendJson(res, 404, { ok: false, error: `song folder not found: ${songFolder}` }, cors)
    }
    const smapBytes = Buffer.from(body.smapBase64, 'base64')
    await atomicWriteFile(path.join(folderAbs, SONG_SMAP_FILENAME), smapBytes)
    sendJson(res, 200, { ok: true }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 400, { ok: false, error: msg }, cors)
  }
}

/**
 * `POST /native/project/song/asset/write` — body
 * `{ projectPath, songFolder, subpath, contentBase64 }`. Writes a single
 * file under the song folder (e.g. `cue/cue-track.wav`). `subpath` is
 * validated like `songFolder` — no `..`, no leading `/`, no `\\`.
 * Intermediate directories are created on demand.
 */
function validateAssetSubpath(p, label = 'subpath') {
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
 * `GET /native/project/song/asset/read?projectPath=...&songFolder=...&subpath=...`
 * — stream a single file from under the song folder. Path traversal blocked
 * via the same validator as the write endpoint.
 */
function handleProjectSongAssetRead(req, res, cors, url) {
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
    let size = 0
    try {
      size = statSync(filePath).size
    } catch {
      /* ignore */
    }
    const isWav = subpath.toLowerCase().endsWith('.wav')
    res.writeHead(200, {
      ...cors,
      'Content-Type': isWav ? 'audio/wav' : 'application/octet-stream',
      ...(size > 0 ? { 'Content-Length': String(size) } : {}),
    })
    const stream = createReadStream(filePath)
    stream.on('error', () => {
      try {
        res.end()
      } catch {
        /* ignore */
      }
    })
    stream.pipe(res)
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
  }
}

async function handleProjectSongAssetWrite(req, res, cors) {
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
 * `POST /native/project/song/remove` — body `{ projectPath, songFolder, deleteFiles }`.
 * If `deleteFiles` is true, recursively removes the song folder. Otherwise
 * a no-op (manifest mutation happens via /manifest/write). Always returns ok.
 */
async function handleProjectSongRemove(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (!existsSync(projectPath)) {
      return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
    }
    const songFolder = validateRelSongFolder(body.songFolder)
    const deleteFiles = body.deleteFiles === true
    if (deleteFiles) {
      const folderAbs = path.join(projectPath, songFolder)
      await rm(folderAbs, { recursive: true, force: true })
    }
    sendJson(res, 200, { ok: true }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 400, { ok: false, error: msg }, cors)
  }
}

/**
 * `POST /native/pick-folder` — open the OS folder picker and return the
 * chosen absolute path. Used by the web app for projects that need an OS
 * path (e.g. so the sidecar can read/write directly without having to
 * receive bytes over HTTP).
 *
 * Request body (optional JSON): `{ title?: string; defaultPath?: string }`
 * Response: `{ ok: true, path } | { ok: false, cancelled: true } | { ok: false, error }`
 */
async function handlePickFolder(req, res, cors) {
  const body = await readRequestJson(req)
  const title = typeof body?.title === 'string' ? body.title : 'Select folder'
  const defaultPath = typeof body?.defaultPath === 'string' ? body.defaultPath : undefined
  try {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined
    const r = await dialog.showOpenDialog(parent, {
      title,
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || !r.filePaths[0]) {
      sendJson(res, 200, { ok: false, cancelled: true }, cors)
      return
    }
    sendJson(res, 200, { ok: true, path: r.filePaths[0] }, cors)
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
  }
}

/**
 * `POST /native/analyze-downbeats` — request body is raw WAV bytes; response
 * is the analyzer's JSON (`{ beats: [{ time, beatInBar }, ...] }`) wrapped in
 * `{ ok: true, data }`. Bytes are written to an OS temp file because madmom
 * needs a file path; the temp dir is removed in `finally`.
 */
async function handleAnalyzeDownbeats(req, res, cors) {
  let workDir = null
  const t0 = Date.now()
  try {
    const buf = await readRequestBody(req)
    logInfo(`analyze-downbeats: received ${(buf.byteLength / (1024 * 1024)).toFixed(1)} MB`)
    if (buf.byteLength === 0) {
      sendJson(res, 400, { ok: false, error: 'Empty request body' }, cors)
      return
    }
    const script = beatsScriptPath()
    if (!existsSync(script)) {
      logError(`analyze-downbeats: missing script ${script}`)
      sendJson(res, 500, { ok: false, error: `Missing script: ${script}` }, cors)
      return
    }
    workDir = await mkdtemp(path.join(tmpdir(), 'barbro-analyze-'))
    const wavPath = path.join(workDir, 'clip.wav')
    await writeFile(wavPath, buf)

    const { code, stdout, stderr } = await runPythonCapture(pythonBeatsExe(), script, [wavPath], 120_000)
    if (code !== 0) {
      logWarn(`analyze-downbeats: python exit ${code}: ${stderr?.slice(0, 200) ?? ''}`)
      sendJson(res, 503, { ok: false, error: stderr || `exit ${code}` }, cors)
      return
    }
    let data
    try {
      data = JSON.parse(stdout)
    } catch {
      logError('analyze-downbeats: invalid JSON from analyzer')
      sendJson(res, 500, { ok: false, error: 'Invalid JSON from analyzer' }, cors)
      return
    }
    const beatCount = Array.isArray(data?.beats) ? data.beats.length : 0
    logInfo(`analyze-downbeats: done — ${beatCount} beats in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    sendJson(res, 200, { ok: true, data }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError(`analyze-downbeats: ${msg}`)
    sendJson(res, 500, { ok: false, error: msg }, cors)
  } finally {
    if (workDir) {
      rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/**
 * Run a queued stems job. Updates state, spawns Python with
 * `--stream-progress`, drains its stdout to the per-job event buffer, and
 * settles the job on close. Concurrency is enforced by the worker loop —
 * `runQueuedJob` itself doesn't check.
 *
 * If the job's source is a `.smap` container, the audio chunk is extracted
 * to a temp WAV inside the job's `tempRoot` before Demucs is invoked. On
 * success the exported stem files are flattened from Demucs' nested
 * `<model>/<song-basename>/<stem>.wav` layout into the caller-provided
 * `finalOutputDir` (typically the song's `stems/` folder on disk).
 */
async function runQueuedJob(job) {
  job.state = 'running'
  job.startedAt = Date.now()
  activeJobId = job.jobId
  emitJobEvent(job, { type: 'state', state: 'running' })
  logInfo(`stems: job ${job.jobId.slice(0, 8)} started`)

  const script = stemsScriptPath()
  if (!existsSync(script)) {
    job.state = 'error'
    job.lastErrorMsg = `Missing script: ${script}`
    job.finishedAt = Date.now()
    emitJobEvent(job, { type: 'error', msg: job.lastErrorMsg })
    emitJobEvent(job, { type: 'state', state: 'error' })
    activeJobId = null
    scheduleJobCleanup(job.jobId)
    return
  }

  // If the source is a `.smap`, extract its audio chunk to a temp WAV
  // before handing it to Demucs.
  let demucsInput = job.inputPath
  try {
    if (job.inputPath.toLowerCase().endsWith('.smap')) {
      const extractedPath = path.join(job.tempRoot, 'input.audio')
      emitJobEvent(job, { type: 'log', msg: `Extracting audio from ${path.basename(job.inputPath)}…` })
      await extractAudioFromSmap(job.inputPath, extractedPath)
      demucsInput = extractedPath
    } else if (!existsSync(job.inputPath)) {
      throw new Error(`Input not found: ${job.inputPath}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    job.state = 'error'
    job.lastErrorMsg = msg
    job.finishedAt = Date.now()
    emitJobEvent(job, { type: 'error', msg })
    emitJobEvent(job, { type: 'state', state: 'error' })
    activeJobId = null
    scheduleJobCleanup(job.jobId)
    return
  }

  const { model, shifts, overlap, stems } = job.options
  const args = [
    script,
    demucsInput,
    '--out-dir', job.outDir,
    '--model', model,
    '--shifts', String(shifts),
    '--overlap', String(overlap),
    '--stems', stems,
    '--stream-progress',
  ]

  const child = spawn(pythonStemsExe(), args, { env: process.env })
  job.child = child

  let buffer = ''
  /** @type {{ files?: string[] } | null} */
  let lastDone = null
  /** @type {{ msg?: string } | null} */
  let lastError = null

  child.stdout.setEncoding('utf-8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let idx = buffer.indexOf('\n')
    while (idx !== -1) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      idx = buffer.indexOf('\n')
      if (!line) continue
      let obj
      try {
        obj = JSON.parse(line)
      } catch {
        emitJobEvent(job, { type: 'log', msg: line })
        continue
      }
      if (obj && typeof obj === 'object') {
        if (obj.type === 'done') lastDone = obj
        else if (obj.type === 'error') lastError = obj
        emitJobEvent(job, obj)
      }
    }
  })
  child.stderr.setEncoding('utf-8')
  child.stderr.on('data', (chunk) => {
    for (const raw of String(chunk).split('\n')) {
      const line = raw.trim()
      if (line) {
        emitJobEvent(job, { type: 'log', msg: line })
        // Mirror to sidecar console so `npm run dev --prefix desktop`
        // surfaces the actual Python error when stems fail.
        logWarn(`stems[${job.jobId.slice(0, 8)}] ${line}`)
      }
    }
  })

  await new Promise((resolve) => {
    child.on('error', (err) => {
      lastError = { msg: err instanceof Error ? err.message : String(err) }
      emitJobEvent(job, { type: 'error', msg: lastError.msg })
      resolve()
    })
    child.on('close', (code) => {
      const tail = buffer.trim()
      if (tail) {
        try {
          const obj = JSON.parse(tail)
          if (obj && typeof obj === 'object') {
            if (obj.type === 'done') lastDone = obj
            else if (obj.type === 'error') lastError = obj
            emitJobEvent(job, obj)
          }
        } catch {
          emitJobEvent(job, { type: 'log', msg: tail })
        }
      }
      if (job.state === 'cancelled') {
        // Cancellation already set the state and emitted; nothing to do.
      } else if (lastError) {
        job.state = 'error'
        job.lastErrorMsg = lastError.msg ?? null
      } else if (code !== 0) {
        job.state = 'error'
        job.lastErrorMsg = `Python exited ${code}`
        emitJobEvent(job, { type: 'error', msg: job.lastErrorMsg })
      } else {
        job.state = 'done'
        job.files = Array.isArray(lastDone?.files) ? /** @type {string[]} */ (lastDone.files) : []
      }
      job.finishedAt = Date.now()
      job.child = null
      emitJobEvent(job, { type: 'state', state: job.state })
      resolve()
    })
  })

  if (job.state === 'done') {
    logInfo(`stems: job ${job.jobId.slice(0, 8)} done — ${job.files.length} file(s)`)
  } else {
    logWarn(`stems: job ${job.jobId.slice(0, 8)} finished as ${job.state}${job.lastErrorMsg ? ' — ' + job.lastErrorMsg : ''}`)
  }

  activeJobId = null
  scheduleJobCleanup(job.jobId)
}

/**
 * Drain the queue serially. Safe to call concurrently — only the first
 * caller actually runs jobs; subsequent calls are no-ops while busy.
 */
function tryRunNext() {
  if (activeJobId !== null) return
  for (const job of stemsJobs.values()) {
    if (job.state === 'queued') {
      void runQueuedJob(job)
      return
    }
  }
}

/**
 * `POST /native/separate-stems` — body is JSON:
 *   `{ inputPath, outputDir, model?, shifts?, overlap?, stems?, songId? }`
 *
 * `inputPath` is an absolute OS path to either an audio file or a BarBro
 * `.smap` container (the sidecar extracts the audio chunk). `outputDir`
 * is an absolute OS path where the exported stems land flat
 * (`vocals.wav`, `drums.wav`, …). The sidecar creates `outputDir` if
 * missing.
 *
 * Returns `{ ok, jobId, state, queuePosition }` immediately; progress
 * streams via `GET /native/jobs/:jobId/events`. No audio bytes ever cross
 * the HTTP boundary — the desktop owns the filesystem for both input and
 * output.
 */
async function handleSeparateStems(req, res, cors) {
  /** @type {string | null} */
  let tempRoot = null
  try {
    const body = await readRequestJson(req)
    if (!body) {
      sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
      return
    }
    const inputPath = typeof body.inputPath === 'string' ? body.inputPath.trim() : ''
    const outputDir = typeof body.outputDir === 'string' ? body.outputDir.trim() : ''
    if (!inputPath || !outputDir) {
      sendJson(res, 400, { ok: false, error: 'inputPath and outputDir are required' }, cors)
      return
    }
    if (!existsSync(inputPath)) {
      sendJson(res, 404, { ok: false, error: `inputPath not found: ${inputPath}` }, cors)
      return
    }
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'htdemucs_ft'
    const shifts = Math.max(1, Math.min(20, Number.parseInt(String(body.shifts ?? 5), 10) || 5))
    const overlap = Math.max(0, Math.min(0.95, Number.parseFloat(String(body.overlap ?? 0.25)) || 0.25))
    const stems = (typeof body.stems === 'string' && body.stems.trim()) ? body.stems.trim() : 'vocals,drums,bass,other'
    const songId = typeof body.songId === 'string' && body.songId.trim() ? body.songId.trim() : null

    // Ensure outputDir exists.
    try {
      await mkdir(outputDir, { recursive: true })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: `Could not create outputDir: ${e instanceof Error ? e.message : String(e)}` }, cors)
      return
    }

    // Job's tempRoot only holds intermediate Demucs artifacts (model
    // download cache, extracted .smap audio, etc.) — final stems land in
    // the user-provided outputDir.
    tempRoot = await mkdtemp(path.join(tmpdir(), 'barbro-stems-'))

    const jobId = randomUUID()
    /** @type {StemsJob} */
    const job = {
      jobId,
      songId,
      state: 'queued',
      tempRoot,
      inputPath,
      outDir: outputDir,
      files: [],
      options: { model, shifts, overlap, stems },
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      events: [],
      subscribers: new Set(),
      lastErrorMsg: null,
      child: null,
      cleanupTimer: null,
    }
    stemsJobs.set(jobId, job)
    emitJobEvent(job, { type: 'state', state: 'queued' })

    const queuedAhead = [...stemsJobs.values()].filter(
      (j) => j.state === 'queued' && j.jobId !== jobId,
    ).length
    const runningAhead = activeJobId !== null ? 1 : 0
    logInfo(
      `separate-stems: enqueued ${jobId.slice(0, 8)} input=${path.basename(inputPath)} out=${outputDir}; position ${queuedAhead + runningAhead}`,
    )

    sendJson(
      res,
      202,
      {
        ok: true,
        jobId,
        state: 'queued',
        queuePosition: queuedAhead + runningAhead,
      },
      cors,
    )
    tryRunNext()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 500, { ok: false, error: msg }, cors)
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/** `GET /native/jobs` — snapshot of all known stems jobs. */
function handleListJobs(res, cors) {
  const jobs = [...stemsJobs.values()].map(publicJobView)
  sendJson(res, 200, { ok: true, jobs }, cors)
}

/**
 * `GET /native/jobs/:jobId/events` — NDJSON stream subscription.
 *
 * Replays the job's full event buffer first, then keeps the connection
 * open and forwards new events as the worker emits them. Closes when the
 * job reaches a terminal state. Multiple subscribers can attach in
 * parallel (e.g. two browser tabs).
 */
function handleJobEvents(req, res, cors, jobId) {
  const job = stemsJobs.get(jobId)
  if (!job) {
    sendJson(res, 404, { ok: false, error: 'Unknown jobId' }, cors)
    return
  }

  res.writeHead(200, {
    ...cors,
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  })

  const writeLine = (ev) => {
    try {
      res.write(JSON.stringify(ev) + '\n')
    } catch {
      /* socket closed */
    }
  }

  // Replay buffered events so late subscribers catch up immediately.
  for (const ev of job.events) writeLine(ev)

  if (isTerminalState(job.state)) {
    res.end()
    return
  }

  const sub = (ev) => {
    writeLine(ev)
    if (ev.type === 'state' && isTerminalState(ev.state)) {
      job.subscribers.delete(sub)
      res.end()
    }
    if (ev.type === 'cleanup') {
      job.subscribers.delete(sub)
      res.end()
    }
  }
  job.subscribers.add(sub)

  // Clean up the subscription on client disconnect.
  req.on('close', () => {
    job.subscribers.delete(sub)
  })
}

/**
 * `DELETE /native/jobs/:jobId` — cancel a queued or running job. For a
 * running job, kills the python child; the close handler sees
 * `state === 'cancelled'` and skips error reporting. Done/error jobs are
 * cleaned up immediately (same as the stems-temp DELETE).
 */
async function handleCancelJob(res, cors, jobId) {
  const job = stemsJobs.get(jobId)
  if (!job) {
    sendJson(res, 404, { ok: false, error: 'Unknown jobId' }, cors)
    return
  }

  if (job.state === 'queued') {
    job.state = 'cancelled'
    job.finishedAt = Date.now()
    job.lastErrorMsg = 'Cancelled before start'
    emitJobEvent(job, { type: 'state', state: 'cancelled' })
    scheduleJobCleanup(jobId)
    logInfo(`stems: job ${jobId.slice(0, 8)} cancelled (was queued)`)
    sendJson(res, 200, { ok: true, state: 'cancelled' }, cors)
    return
  }

  if (job.state === 'running') {
    job.state = 'cancelled'
    job.lastErrorMsg = 'Cancelled mid-run'
    emitJobEvent(job, { type: 'state', state: 'cancelled' })
    try {
      job.child?.kill('SIGTERM')
    } catch {
      /* ignore */
    }
    logInfo(`stems: job ${jobId.slice(0, 8)} cancellation signal sent (running)`)
    sendJson(res, 200, { ok: true, state: 'cancelled' }, cors)
    return
  }

  // Terminal: act as cleanup.
  await destroyStemsJob(jobId)
  sendJson(res, 200, { ok: true, state: 'destroyed' }, cors)
}

/**
 * `GET /native/setup/stems/status` — quick capability probe. Returns
 * `{ ok, ready, venvPython, hasDemucs }`. `ready` is true iff the standard
 * venv exists; the web client uses this for pre-flight UI.
 */
function handleStemsSetupStatus(res, cors) {
  const ready = stemsVenvIsReady()
  sendJson(
    res,
    200,
    {
      ok: true,
      ready,
      venvDir: getStemsVenvDir(),
      venvPython: ready ? getStemsVenvPythonExe() : null,
    },
    cors,
  )
}

/**
 * Run a child process and pipe stdout/stderr line-by-line to NDJSON `log`
 * events on `emit`. Resolves with `{ code }` when the child closes.
 */
function runPipelineNdjson(exe, args, emit) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(exe, args, { env: process.env })
    } catch (e) {
      emit({ type: 'log', msg: `[spawn error] ${e instanceof Error ? e.message : String(e)}` })
      resolve({ code: 1 })
      return
    }
    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (chunk) => {
      for (const raw of String(chunk).split('\n')) {
        const line = raw.replace(/\r$/, '').trimEnd()
        if (line) emit({ type: 'log', msg: line })
      }
    })
    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', (chunk) => {
      for (const raw of String(chunk).split('\n')) {
        const line = raw.replace(/\r$/, '').trimEnd()
        if (line) emit({ type: 'log', msg: line })
      }
    })
    child.on('error', (err) => {
      emit({ type: 'log', msg: `[spawn error] ${err.message}` })
      resolve({ code: 1 })
    })
    child.on('close', (code) => resolve({ code }))
  })
}

/**
 * `POST /native/setup/stems` — create the stems venv under userData (if
 * missing) and pip-install dependencies. NDJSON stream of `log` /
 * `progress` / `done` / `error` events; same shape the StemSplitter UI
 * already knows. Idempotent — re-running is safe (and fast when deps are
 * already there).
 */
async function handleSetupStems(req, res, cors) {
  res.writeHead(200, {
    ...cors,
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  })
  const emit = (ev) => {
    try {
      res.write(JSON.stringify(ev) + '\n')
    } catch {
      /* socket closed */
    }
  }

  const venvDir = getStemsVenvDir()
  const venvPython = getStemsVenvPythonExe()
  const reqPath = path.join(getNativePythonRoot(), 'stems', 'requirements.txt')

  emit({ type: 'log', msg: `Stems venv target: ${venvDir}` })

  try {
    // Step 1 — create venv if missing.
    if (!existsSync(venvPython)) {
      const seed = bootstrapPythonExe()
      emit({ type: 'progress', label: 'Creating venv…', current: 0, overall: 10 })
      logInfo(`setup/stems: creating venv with ${seed}`)
      const { code } = await runPipelineNdjson(seed, ['-m', 'venv', venvDir], emit)
      if (code !== 0 || !existsSync(venvPython)) {
        emit({ type: 'error', msg: `Could not create Python venv (exit ${code}). Make sure Python 3.10+ is installed.` })
        emit({ type: 'state', state: 'error' })
        res.end()
        return
      }
      emit({ type: 'progress', label: 'Venv created', current: 100, overall: 25 })
    } else {
      emit({ type: 'log', msg: 'Venv already present — skipping create' })
    }

    // Step 2 — upgrade pip.
    emit({ type: 'progress', label: 'Upgrading pip…', current: 0, overall: 30 })
    const pipUp = await runPipelineNdjson(venvPython, ['-m', 'pip', 'install', '-U', 'pip'], emit)
    if (pipUp.code !== 0) {
      emit({ type: 'error', msg: `Failed to upgrade pip (exit ${pipUp.code})` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({ type: 'progress', label: 'pip upgraded', current: 100, overall: 40 })

    // Step 3 — install requirements (demucs + certifi). Slowest step.
    if (!existsSync(reqPath)) {
      emit({ type: 'error', msg: `Missing requirements.txt at ${reqPath}` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({
      type: 'progress',
      label: 'Installing Demucs (downloads ~1 GB of torch — this can take several minutes)…',
      current: 0,
      overall: 45,
    })
    const inst = await runPipelineNdjson(venvPython, ['-m', 'pip', 'install', '-r', reqPath], emit)
    if (inst.code !== 0) {
      emit({ type: 'error', msg: `pip install failed (exit ${inst.code})` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({ type: 'progress', label: 'Dependencies installed', current: 100, overall: 95 })

    // Step 4 — smoke test.
    const smoke = await runPipelineNdjson(venvPython, ['-m', 'demucs', '--help'], emit)
    if (smoke.code !== 0) {
      emit({ type: 'error', msg: `Demucs smoke test failed (exit ${smoke.code})` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }

    emit({ type: 'progress', label: 'Done', current: 100, overall: 100 })
    emit({ type: 'done', venvPython })
    emit({ type: 'state', state: 'done' })
    logInfo(`setup/stems: venv ready at ${venvPython}`)
    res.end()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError(`setup/stems: ${msg}`)
    emit({ type: 'error', msg })
    emit({ type: 'state', state: 'error' })
    res.end()
  }
}

// ── Piper TTS (isolated `piper_tts/` module) ─────────────────────────────────

/**
 * `GET /native/setup/piper-tts/status` — venv + bundled default voice ONNX present?
 */
function handlePiperTtsSetupStatus(res, cors) {
  const venvReady = piperTtsVenvIsReady()
  const modelOnnx = getPiperTtsDefaultModelOnnxPath()
  const modelJson = modelOnnx.replace(/\.onnx$/i, '.onnx.json')
  const modelPresent = existsSync(modelOnnx) && existsSync(modelJson)
  sendJson(
    res,
    200,
    {
      ok: true,
      ready: venvReady && modelPresent,
      venvDir: getPiperTtsVenvDir(),
      venvPython: venvReady ? getPiperTtsVenvPythonExe() : null,
      modelDir: getPiperTtsModelDir(),
      modelPath: modelOnnx,
      modelPresent,
      voiceId: PIPER_DEFAULT_VOICE_ID,
    },
    cors,
  )
}

/**
 * Download default Piper voice files into userData (idempotent).
 * @param {(ev: { type: string; msg?: string }) => void} emit
 */
async function downloadPiperDefaultVoice(emit) {
  const dir = getPiperTtsModelDir()
  const onnx = path.join(dir, `${PIPER_DEFAULT_VOICE_ID}.onnx`)
  const json = path.join(dir, `${PIPER_DEFAULT_VOICE_ID}.onnx.json`)
  if (existsSync(onnx) && existsSync(json)) {
    emit({ type: 'log', msg: `Voice ${PIPER_DEFAULT_VOICE_ID} already on disk` })
    return
  }
  await mkdir(dir, { recursive: true })
  const base = `${PIPER_VOICE_DOWNLOAD_BASE}/${PIPER_DEFAULT_VOICE_ID}`
  emit({ type: 'log', msg: `Downloading ${PIPER_DEFAULT_VOICE_ID}.onnx…` })
  {
    const url = `${base}.onnx`
    const r = await fetch(url, { redirect: 'follow' })
    if (!r.ok) throw new Error(`Voice download failed HTTP ${r.status}: ${url}`)
    await writeFile(onnx, Buffer.from(await r.arrayBuffer()))
  }
  emit({ type: 'log', msg: `Downloading ${PIPER_DEFAULT_VOICE_ID}.onnx.json…` })
  {
    const url = `${base}.onnx.json`
    const r = await fetch(url, { redirect: 'follow' })
    if (!r.ok) throw new Error(`Voice config download failed HTTP ${r.status}: ${url}`)
    await writeFile(json, Buffer.from(await r.arrayBuffer()))
  }
}

/**
 * `POST /native/setup/piper-tts` — venv + pip install `piper-tts` + default voice download.
 * NDJSON stream matches stems setup (`log` / `progress` / `done` / `error` / `state`).
 */
async function handleSetupPiperTts(req, res, cors) {
  res.writeHead(200, {
    ...cors,
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  })
  const emit = (ev) => {
    try {
      res.write(JSON.stringify(ev) + '\n')
    } catch {
      /* socket closed */
    }
  }

  const venvDir = getPiperTtsVenvDir()
  const venvPython = getPiperTtsVenvPythonExe()
  const reqPath = path.join(getNativePythonRoot(), 'piper_tts', 'requirements.txt')

  emit({ type: 'log', msg: `Piper TTS venv target: ${venvDir}` })

  try {
    if (!existsSync(venvPython)) {
      const seed = bootstrapPythonExe()
      emit({ type: 'progress', label: 'Creating Piper venv…', current: 0, overall: 15 })
      logInfo(`setup/piper-tts: creating venv with ${seed}`)
      const { code } = await runPipelineNdjson(seed, ['-m', 'venv', venvDir], emit)
      if (code !== 0 || !existsSync(venvPython)) {
        emit({
          type: 'error',
          msg: `Could not create Python venv (exit ${code}). Install Python 3.10+ and retry.`,
        })
        emit({ type: 'state', state: 'error' })
        res.end()
        return
      }
      emit({ type: 'progress', label: 'Venv created', current: 100, overall: 30 })
    } else {
      emit({ type: 'log', msg: 'Piper venv already present — skipping create' })
    }

    emit({ type: 'progress', label: 'Upgrading pip…', current: 0, overall: 35 })
    const pipUp = await runPipelineNdjson(venvPython, ['-m', 'pip', 'install', '-U', 'pip'], emit)
    if (pipUp.code !== 0) {
      emit({ type: 'error', msg: `Failed to upgrade pip (exit ${pipUp.code})` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({ type: 'progress', label: 'pip upgraded', current: 100, overall: 45 })

    if (!existsSync(reqPath)) {
      emit({ type: 'error', msg: `Missing requirements.txt at ${reqPath}` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({
      type: 'progress',
      label: 'Installing piper-tts (downloads wheels — may take a minute)…',
      current: 0,
      overall: 50,
    })
    const inst = await runPipelineNdjson(venvPython, ['-m', 'pip', 'install', '-r', reqPath], emit)
    if (inst.code !== 0) {
      emit({ type: 'error', msg: `pip install failed (exit ${inst.code})` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({ type: 'progress', label: 'piper-tts installed', current: 100, overall: 75 })

    emit({ type: 'progress', label: 'Downloading default voice…', current: 0, overall: 80 })
    await downloadPiperDefaultVoice(emit)
    emit({ type: 'progress', label: 'Voice ready', current: 100, overall: 95 })

    const script = piperTtsScriptPath()
    if (!existsSync(script)) {
      emit({ type: 'error', msg: `Missing script: ${script}` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    const smokeOut = path.join(tmpdir(), `barbro-piper-smoke-${randomUUID()}.wav`)
    const { code: sCode, stderr: sErr } = await runPythonCapture(
      pythonPiperTtsExe(),
      script,
      ['--model', getPiperTtsDefaultModelOnnxPath(), '--output', smokeOut, '--text', 'Hi.'],
      120_000,
    )
    try {
      await rm(smokeOut, { force: true })
    } catch {
      /* ignore */
    }
    if (sCode !== 0) {
      emit({ type: 'error', msg: sErr || `Piper smoke test failed (exit ${sCode})` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }

    emit({ type: 'progress', label: 'Done', current: 100, overall: 100 })
    emit({ type: 'done', venvPython })
    emit({ type: 'state', state: 'done' })
    logInfo(`setup/piper-tts: ready — ${venvPython}`)
    res.end()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError(`setup/piper-tts: ${msg}`)
    emit({ type: 'error', msg })
    emit({ type: 'state', state: 'error' })
    res.end()
  }
}

/**
 * `GET /native/tts/hello-world` — WAV bytes, fixed phrase for web debug (`/texttospeech`).
 */
async function handleTtsHelloWorld(res, cors) {
  const script = piperTtsScriptPath()
  if (!existsSync(script)) {
    sendJson(res, 500, { ok: false, error: `Missing Piper script: ${script}` }, cors)
    return
  }
  if (!piperTtsVenvIsReady()) {
    sendJson(
      res,
      503,
      { ok: false, error: 'Piper venv not installed', hint: 'POST /native/setup/piper-tts' },
      cors,
    )
    return
  }
  const modelPath = getPiperTtsDefaultModelOnnxPath()
  const modelJson = modelPath.replace(/\.onnx$/i, '.onnx.json')
  if (!existsSync(modelPath) || !existsSync(modelJson)) {
    sendJson(
      res,
      503,
      { ok: false, error: 'Voice model files missing', hint: 'POST /native/setup/piper-tts' },
      cors,
    )
    return
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'barbro-tts-'))
  const outWav = path.join(workDir, 'hello.wav')
  try {
    const { code, stderr } = await runPythonCapture(
      pythonPiperTtsExe(),
      script,
      ['--model', modelPath, '--output', outWav, '--text', 'Hello world.'],
      120_000,
    )
    if (code !== 0) {
      sendJson(res, 503, { ok: false, error: stderr || `Piper exit ${code}` }, cors)
      return
    }
    const buf = await readFile(outWav)
    res.writeHead(200, {
      ...cors,
      'Content-Type': 'audio/wav',
      'Content-Length': String(buf.length),
    })
    res.end(buf)
    logInfo('tts: hello-world sent')
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
  } finally {
    rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * `POST /native/tts/synthesize` — JSON `{ "text": "..." }` → WAV (Piper). Text read from a temp file
 * so long phrases do not hit OS argv limits.
 */
async function handleTtsSynthesize(req, res, cors) {
  const script = piperTtsScriptPath()
  if (!existsSync(script)) {
    sendJson(res, 500, { ok: false, error: `Missing Piper script: ${script}` }, cors)
    return
  }
  if (!piperTtsVenvIsReady()) {
    sendJson(
      res,
      503,
      { ok: false, error: 'Piper venv not installed', hint: 'POST /native/setup/piper-tts' },
      cors,
    )
    return
  }
  const modelPath = getPiperTtsDefaultModelOnnxPath()
  const modelJson = modelPath.replace(/\.onnx$/i, '.onnx.json')
  if (!existsSync(modelPath) || !existsSync(modelJson)) {
    sendJson(
      res,
      503,
      { ok: false, error: 'Voice model files missing', hint: 'POST /native/setup/piper-tts' },
      cors,
    )
    return
  }

  const payload = await readRequestJson(req)
  if (!payload || typeof payload.text !== 'string') {
    sendJson(res, 400, { ok: false, error: 'JSON body must include string "text"' }, cors)
    return
  }
  const text = String(payload.text).trim().replace(/\u0000/g, '')
  if (!text.length) {
    sendJson(res, 400, { ok: false, error: 'text is empty' }, cors)
    return
  }
  if (text.length > 480) {
    sendJson(res, 400, { ok: false, error: 'text exceeds 480 characters' }, cors)
    return
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'barbro-tts-'))
  const phrasePath = path.join(workDir, 'phrase.txt')
  const outWav = path.join(workDir, 'out.wav')
  try {
    await writeFile(phrasePath, text, 'utf8')
    const { code, stderr } = await runPythonCapture(
      pythonPiperTtsExe(),
      script,
      ['--model', modelPath, '--output', outWav, '--text-file', phrasePath],
      120_000,
    )
    if (code !== 0) {
      sendJson(res, 503, { ok: false, error: stderr || `Piper exit ${code}` }, cors)
      return
    }
    const buf = await readFile(outWav)
    res.writeHead(200, {
      ...cors,
      'Content-Type': 'audio/wav',
      'Content-Length': String(buf.length),
    })
    res.end(buf)
    logInfo(`tts: synthesized ${text.length} chars`)
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
  } finally {
    rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

/** `GET /native/stems/:jobId/:filename` — stream one exported stem WAV. */
function handleGetStem(req, res, cors, jobId, filename) {
  const job = stemsJobs.get(jobId)
  if (!job) {
    sendJson(res, 404, { ok: false, error: 'Unknown jobId' }, cors)
    return
  }
  // Prevent path traversal: only allow filenames from the recorded list.
  if (!job.files.includes(filename)) {
    sendJson(res, 404, { ok: false, error: 'Unknown stem' }, cors)
    return
  }
  const filePath = path.join(job.outDir, filename)
  if (!existsSync(filePath)) {
    sendJson(res, 404, { ok: false, error: 'File missing on disk' }, cors)
    return
  }
  let size = 0
  try {
    size = statSync(filePath).size
  } catch {
    /* ignore — Content-Length will be omitted */
  }
  res.writeHead(200, {
    ...cors,
    'Content-Type': 'audio/wav',
    ...(size > 0 ? { 'Content-Length': String(size) } : {}),
  })
  const stream = createReadStream(filePath)
  stream.on('error', () => {
    try {
      res.end()
    } catch {
      /* ignore */
    }
  })
  stream.pipe(res)
}

/** `DELETE /native/stems/:jobId` — remove the temp dir for a completed job. */
async function handleDeleteStems(res, cors, jobId) {
  await destroyStemsJob(jobId)
  sendJson(res, 200, { ok: true }, cors)
}

function startBeaconServer() {
  const version = readDesktopVersion()
  beaconServer = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      res.end()
      return
    }

    if (req.method === 'GET' && (req.url === '/ping' || req.url?.startsWith('/ping?'))) {
      const body = JSON.stringify({
        ok: true,
        name: 'barbro-desktop',
        version,
      })
      res.writeHead(200, {
        ...cors,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      })
      res.end(body)
      return
    }

    if (req.method === 'POST' && req.url === '/native/analyze-downbeats') {
      void handleAnalyzeDownbeats(req, res, cors)
      return
    }

    if (req.method === 'POST' && (req.url === '/native/separate-stems' || req.url?.startsWith('/native/separate-stems?'))) {
      void handleSeparateStems(req, res, cors)
      return
    }

    if (req.method === 'GET' && req.url === '/native/setup/stems/status') {
      handleStemsSetupStatus(res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/setup/stems') {
      void handleSetupStems(req, res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/pick-folder') {
      void handlePickFolder(req, res, cors)
      return
    }

    // /native/project/* — project-folder I/O over loopback HTTP. The web app
    // never touches the filesystem for project I/O; the sidecar is the disk.
    if (req.method === 'POST' && req.url === '/native/project/create') {
      void handleProjectCreate(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/info') {
      void handleProjectInfo(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/manifest/write') {
      void handleProjectManifestWrite(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/song/create') {
      void handleProjectSongCreate(req, res, cors)
      return
    }
    if (req.method === 'GET' && req.url?.startsWith('/native/project/song/read')) {
      const u = new URL(req.url, `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`)
      handleProjectSongRead(req, res, cors, u)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/song/write') {
      void handleProjectSongWrite(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/song/remove') {
      void handleProjectSongRemove(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/song/asset/write') {
      void handleProjectSongAssetWrite(req, res, cors)
      return
    }
    if (req.method === 'GET' && req.url?.startsWith('/native/project/song/asset/read')) {
      const u = new URL(req.url, `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`)
      handleProjectSongAssetRead(req, res, cors, u)
      return
    }

    if (req.method === 'GET' && req.url === '/native/setup/piper-tts/status') {
      handlePiperTtsSetupStatus(res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/setup/piper-tts') {
      void handleSetupPiperTts(req, res, cors)
      return
    }

    if (req.method === 'GET' && req.url === '/native/tts/hello-world') {
      void handleTtsHelloWorld(res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/tts/synthesize') {
      void handleTtsSynthesize(req, res, cors)
      return
    }

    // /native/jobs                           (GET)   — list
    // /native/jobs/:jobId/events             (GET)   — NDJSON stream subscription
    // /native/jobs/:jobId                    (DELETE) — cancel
    if (req.method === 'GET' && (req.url === '/native/jobs' || req.url?.startsWith('/native/jobs?'))) {
      handleListJobs(res, cors)
      return
    }
    const jobsMatch = req.url?.match(/^\/native\/jobs\/([^/?]+)(?:\/([^/?]+))?(?:\?.*)?$/)
    if (jobsMatch) {
      const jobId = jobsMatch[1]
      const sub = jobsMatch[2]
      if (req.method === 'GET' && sub === 'events') {
        handleJobEvents(req, res, cors, jobId)
        return
      }
      if (req.method === 'DELETE' && !sub) {
        void handleCancelJob(res, cors, jobId)
        return
      }
    }

    // /native/stems/:jobId/:filename  (GET)  and  /native/stems/:jobId  (DELETE)
    const stemsMatch = req.url?.match(/^\/native\/stems\/([^/?]+)(?:\/([^/?]+))?(?:\?.*)?$/)
    if (stemsMatch) {
      const jobId = stemsMatch[1]
      const filename = stemsMatch[2]
      if (req.method === 'GET' && filename) {
        handleGetStem(req, res, cors, jobId, filename)
        return
      }
      if (req.method === 'DELETE' && !filename) {
        void handleDeleteStems(res, cors, jobId)
        return
      }
    }

    res.writeHead(404, cors)
    res.end()
  })

  beaconServer.on('error', (err) => {
    logError(`Beacon server error: ${err.message}`)
  })

  beaconServer.listen(BARBRO_DESKTOP_BEACON_PORT, '127.0.0.1', () => {
    logInfo(`Beacon listening on 127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`)
  })
}

function stopBeaconServer() {
  if (!beaconServer) return
  try {
    beaconServer.close()
  } catch {
    // ignore
  }
  beaconServer = null
}

// Headless: never create a BrowserWindow. The dock icon (macOS) /
// taskbar entry stays so the user can quit normally via Cmd+Q / right-click.
// `window-all-closed` is intentionally NOT handled — there are no windows
// to close, so it never fires; the process keeps running indefinitely.

app.whenReady().then(() => {
  const version = readDesktopVersion()
  logInfo(`BarBro desktop sidecar v${version} starting`)
  logInfo(`PID ${process.pid} · Node ${process.versions.node} · Electron ${process.versions.electron}`)
  startBeaconServer()
  logInfo(`Headless. Reachable at http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}/`)
  logInfo(`Endpoints:`)
  logInfo(`  GET    /ping`)
  logInfo(`  POST   /native/analyze-downbeats`)
  logInfo(`  POST   /native/separate-stems        (returns jobId immediately; queue runs serially)`)
  logInfo(`  GET    /native/jobs`)
  logInfo(`  GET    /native/jobs/:jobId/events    (NDJSON stream + replay)`)
  logInfo(`  DELETE /native/jobs/:jobId           (cancel queued or running)`)
  logInfo(`  GET    /native/stems/:jobId/:filename`)
  logInfo(`  DELETE /native/stems/:jobId          (cleanup after fetch)`)
  logInfo(`  GET    /native/setup/stems/status    (check Demucs venv readiness)`)
  logInfo(`  POST   /native/setup/stems           (create venv + pip install demucs)`)
  logInfo(`  POST   /native/pick-folder           (Electron folder picker → absolute path)`)
  logInfo(`  POST   /native/project/create        (create new project folder + manifest)`)
  logInfo(`  POST   /native/project/info          (read manifest + per-song lite metadata + stems scan)`)
  logInfo(`  POST   /native/project/manifest/write`)
  logInfo(`  POST   /native/project/song/create   (mkdir + atomic write song.smap)`)
  logInfo(`  GET    /native/project/song/read     (stream song.smap bytes)`)
  logInfo(`  POST   /native/project/song/write    (atomic overwrite song.smap)`)
  logInfo(`  POST   /native/project/song/remove   (optionally delete files from disk)`)
  logInfo(`  POST   /native/project/song/asset/write (write arbitrary file under song folder)`)
  logInfo(`  GET    /native/project/song/asset/read  (stream a single file under song folder)`)
  logInfo(`  GET    /native/setup/piper-tts/status`)
  logInfo(`  POST   /native/setup/piper-tts       (venv + piper-tts + default voice)`)
  logInfo(`  GET    /native/tts/hello-world         (debug WAV: "Hello world.")`)
  logInfo(`  POST   /native/tts/synthesize          (JSON {text} → WAV)`)
  logInfo(`Stems venv ${stemsVenvIsReady() ? 'READY' : 'NOT INSTALLED'}: ${getStemsVenvDir()}`)
  logInfo(`Piper TTS ${piperTtsVenvIsReady() ? 'venv OK' : 'venv missing'} · ${getPiperTtsVenvDir()}`)
})

app.on('before-quit', () => {
  logInfo('Shutting down')
  stopBeaconServer()
  // Wipe any pending stems temp dirs synchronously-ish — fire-and-forget,
  // but at least clear the map so timers don't fire after quit.
  for (const jobId of [...stemsJobs.keys()]) {
    void destroyStemsJob(jobId)
  }
})
