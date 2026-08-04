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

import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import archiver from 'archiver'
import yauzl from 'yauzl'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } from 'electron'
import {
  beatsScriptPath,
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
  pythonSectionsExe,
  pythonStemsExe,
  pythonYoutubeImportExe,
  runPythonCapture,
  sectionsScriptPath,
  chordChromaScriptPath,
  alignAudioScriptPath,
  shiftAudioScriptPath,
  transcribeBassScriptPath,
  transcribeDrumsScriptPath,
  getSectionsVenvDir,
  getSectionsVenvPythonExe,
  sectionsLibrosaReady,
  sectionsVenvIsReady,
  invalidateSectionsLibrosaCache,
  writeSectionsVenvMarker,
  uvBinaryIsReady,
  getUvBinaryPath,
  downloadAndExtractUv,
  UV_PINNED_VERSION,
  ensureManagedFfmpegBinary,
  ffmpegExePath,
  getUvBinDir,
  resolveTorchIndex,
  stemsScriptPath,
  stemsVenvIsReady,
  getYoutubeImportVenvDir,
  getYoutubeImportVenvPythonExe,
  youtubeImportScriptPath,
  youtubeImportVenvIsReady,
  getBeatsVenvDir,
  getBeatsVenvPythonExe,
  beatsVenvIsReady,
  beatsMadmomReady,
  invalidateBeatsMadmomCache,
  writeBeatsVenvMarker,
  rubberBandExePath,
  expectedRubberBandBundledPath,
  getLyricsVenvDir,
  getLyricsVenvPythonExe,
  getLyricsModelDir,
  lyricsVenvIsReady,
  pythonLyricsExe,
  transcribeLyricsScriptPath,
} from './nativePython.mjs'
import { createAutoStemsDaemon, isStemWavHealthy } from './autoStems.mjs'
import {
  isSidecarRoute,
  loadOfflineUiHandler,
  prepareOfflineEnv,
  hasOfflineUiBundle,
  offlineBuildState,
  shouldAutoOpenOfflineUi,
} from './offlineUi.mjs'
import {
  RUBBERBAND_RENDER_TIMEOUT_MS,
  RUBBERBAND_TRANSPOSE_ALGO_VERSION,
  buildRubberBandArgs,
  classifyDurationAlignment,
  normalizeTransposeSemitones,
  transposeCacheSubpath,
} from './transposeCache.mjs'
import { createXAirClient, discoverXAirConsoles, isXAirWritableIntAddress } from './xairOsc.mjs'
import { serveFileFromDisk } from './serveFile.mjs'
import {
  atomicWriteFile,
  ensureAbsolutePath,
  slugifyName,
  validateAssetSubpath,
  validateRelSongFolder,
} from './projectPaths.mjs'
import { createProjectAssetRoutes } from './projectAssetRoutes.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('node:http').Server | null} */
let beaconServer = null

/** Keep aligned with web client `BARBRO_DESKTOP_BEACON_PORT`. */
const BARBRO_DESKTOP_BEACON_PORT = 47842

/**
 * The bundled web UI, when this build ships one (the OFFLINE BUILD).
 *
 * Null in the ordinary headless sidecar, which keeps behaving exactly as
 * before. When present, anything that is not a sidecar route is handed to
 * SvelteKit — so the app and the API share one origin and one port.
 */
let offlineUiHandler = null

const LOG_PREFIX = '[barbro-desktop]'
const logInfo = (...args) => console.info(LOG_PREFIX, ...args)
const logWarn = (...args) => console.warn(LOG_PREFIX, ...args)
const logError = (...args) => console.error(LOG_PREFIX, ...args)

/** @type {ReturnType<typeof createXAirClient> | null} */
let xairClient = null
let xairLastMessageAt = null
let xairLastMessage = null
let xairLastError = null
/** What the desk said about itself on the last successful connect. */
let xairInfo = null

// Resilience net: this is a HEADLESS background sidecar. A crash takes down
// the user's desktop client for every feature (analyze, stems, cloud FS), so
// staying alive + logging beats dying on a stray error — e.g. an unhandled
// rejection from a fire-and-forget job or the auto-stems daemon. Node's
// default would exit the process; we log and keep serving instead.
process.on('unhandledRejection', (reason) => {
  logError(
    'Unhandled promise rejection (kept alive):',
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  )
})
process.on('uncaughtException', (err) => {
  logError(
    'Uncaught exception (kept alive):',
    err instanceof Error ? (err.stack ?? err.message) : String(err),
  )
})

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
 * @typedef {'queued' | 'running' | 'paused' | 'done' | 'cancelled' | 'error'} JobState
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
const STEMS_JOB_RECOVERY_VERSION = 1
const RECOVERABLE_STEM_NAMES = new Set(['vocals', 'drums', 'bass', 'other'])
let stemsRecoveryInProgress = false

function stemsJobRecoveryFilePath() {
  return path.join(app.getPath('userData'), 'stems-job-recovery.json')
}

function normalizeRecoverableStemList(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []
  const stems = []
  for (const item of raw) {
    const stem = String(item ?? '').trim().toLowerCase()
    if (RECOVERABLE_STEM_NAMES.has(stem) && !stems.includes(stem)) stems.push(stem)
  }
  return stems.length > 0 ? stems : ['vocals', 'drums', 'bass', 'other']
}

function normalizeRecoverableStemRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const inputPath = typeof raw.inputPath === 'string' ? raw.inputPath.trim() : ''
  const outputDir = typeof raw.outputDir === 'string' ? raw.outputDir.trim() : ''
  if (!path.isAbsolute(inputPath) || !path.isAbsolute(outputDir)) return null
  const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : 'htdemucs_ft'
  const shifts = Math.max(1, Math.min(20, Number.parseInt(String(raw.shifts ?? 5), 10) || 5))
  const overlap = Math.max(0, Math.min(0.95, Number.parseFloat(String(raw.overlap ?? 0.25)) || 0.25))
  const createdAt = Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : Date.now()
  return {
    jobId: typeof raw.jobId === 'string' && raw.jobId ? raw.jobId : randomUUID(),
    inputPath,
    outputDir,
    model,
    shifts,
    overlap,
    stems: normalizeRecoverableStemList(raw.stems),
    songId: typeof raw.songId === 'string' && raw.songId.trim() ? raw.songId.trim() : null,
    createdAt,
  }
}

function readRecoverableStemJobs() {
  try {
    const raw = JSON.parse(readFileSync(stemsJobRecoveryFilePath(), 'utf8'))
    const jobs = Array.isArray(raw) ? raw : Array.isArray(raw?.jobs) ? raw.jobs : []
    return jobs.map(normalizeRecoverableStemRecord).filter(Boolean)
  } catch {
    return []
  }
}

function writeRecoverableStemJobs(records) {
  try {
    const file = stemsJobRecoveryFilePath()
    mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(
      tmp,
      JSON.stringify({ version: STEMS_JOB_RECOVERY_VERSION, jobs: records }, null, 2),
    )
    renameSync(tmp, file)
  } catch (e) {
    logWarn(`stems: could not persist recovery state: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function isRecoverableStemJob(job) {
  return job && (!job.kind || job.kind === 'stems')
}

function rememberRecoverableStemJob(job) {
  if (!isRecoverableStemJob(job)) return
  const record = normalizeRecoverableStemRecord({
    jobId: job.jobId,
    inputPath: job.inputPath,
    outputDir: job.outDir,
    model: job.options?.model,
    shifts: job.options?.shifts,
    overlap: job.options?.overlap,
    stems: job.options?.stems,
    songId: job.songId,
    createdAt: job.createdAt,
  })
  if (!record) return
  const records = readRecoverableStemJobs().filter((r) => r.jobId !== record.jobId)
  records.push(record)
  writeRecoverableStemJobs(records)
}

function forgetRecoverableStemJob(jobOrId) {
  const jobId = typeof jobOrId === 'string' ? jobOrId : jobOrId?.jobId
  if (!jobId) return
  const records = readRecoverableStemJobs()
  const next = records.filter((r) => r.jobId !== jobId)
  if (next.length !== records.length) writeRecoverableStemJobs(next)
}

function isRecoverableStemJobActive(record) {
  const job = stemsJobs.get(record.jobId)
  return isRecoverableStemJob(job) && (job.state === 'queued' || job.state === 'running' || job.state === 'paused')
}

function isRecoveredStemFileHealthy(filePath) {
  try {
    if (!existsSync(filePath)) return false
    const info = readAudioInfo(filePath)
    return isStemWavHealthy({ ...info, fileSize: statSync(filePath).size })
  } catch {
    return false
  }
}

function missingRecoverableStemNames(record) {
  return record.stems.filter((stem) => !isRecoveredStemFileHealthy(path.join(record.outputDir, `${stem}.wav`)))
}

async function recoverInterruptedStemJobs() {
  if (stemsRecoveryInProgress) return
  const allRecords = readRecoverableStemJobs()
  if (allRecords.length === 0) return
  if (!stemsVenvIsReady()) {
    logInfo(`stems: ${allRecords.length} interrupted job(s) waiting for Demucs setup`)
    return
  }

  stemsRecoveryInProgress = true
  try {
    const activeRecords = []
    const staleRecords = []
    for (const record of allRecords) {
      if (isRecoverableStemJobActive(record)) activeRecords.push(record)
      else staleRecords.push(record)
    }
    if (staleRecords.length === 0) return

    const retryRecords = []
    for (const record of staleRecords) {
      if (!existsSync(record.inputPath)) {
        logWarn(`stems: dropping interrupted job; source is missing: ${record.inputPath}`)
        continue
      }
      const missing = missingRecoverableStemNames(record)
      if (missing.length === 0) {
        logInfo(`stems: interrupted job already has healthy output at ${record.outputDir}`)
        continue
      }
      retryRecords.push({ ...record, stems: missing })
    }

    writeRecoverableStemJobs(activeRecords)
    if (retryRecords.length === 0) return

    const failed = []
    let requeued = 0
    for (const record of retryRecords) {
      try {
        const { jobId } = await createStemsJob({
          inputPath: record.inputPath,
          outputDir: record.outputDir,
          model: record.model,
          shifts: record.shifts,
          overlap: record.overlap,
          stems: record.stems.join(','),
          songId: record.songId,
        })
        requeued += 1
        logInfo(`stems: recovered interrupted job ${jobId.slice(0, 8)} (${record.stems.join(', ')})`)
      } catch (e) {
        failed.push(record)
        logWarn(`stems: could not recover interrupted job: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (failed.length > 0) {
      writeRecoverableStemJobs([...readRecoverableStemJobs(), ...failed])
    }
    if (requeued > 0) logInfo(`stems: requeued ${requeued} interrupted job(s)`)
  } finally {
    stemsRecoveryInProgress = false
  }
}

/** Default Piper voice for debug + future cue tracks (`rhasspy/piper-voices` v1.0.0). */
const PIPER_DEFAULT_VOICE_ID = 'en_US-lessac-medium'
const PIPER_VOICE_DOWNLOAD_BASE =
  'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium'

/** Currently-running HEAVY job id (stems/youtube — concurrency=1). null when idle. */
let activeJobId = null
/** Currently-running LYRICS job id — its own lane, concurrent with the heavy lane. */
let activeLyricsJobId = null

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
    kind: job.kind ?? 'stems',
    songId: job.songId,
    state: job.state,
    files: job.files,
    options: job.options,
    artifact: job.artifact ?? null,
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
    logInfo(`${job.kind ?? 'stems'}: job ${jobId.slice(0, 8)} cleaned up`)
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

function publicXAirStatus() {
  const status = xairClient ? xairClient.status() : { connected: false }
  return {
    kind: 'behringer-xair',
    ...status,
    // The desk's own words. A green dot proves nothing; "XR18 · fw 1.21" proves
    // something answered and that it was an X-Air console.
    info: xairInfo,
    lastMessageAt: xairLastMessageAt,
    lastMessage: xairLastMessage,
    lastError: xairLastError,
  }
}

function parseXAirPort(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback
  const port = Number.parseInt(String(value), 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('XR18 port must be 1..65535')
  }
  return port
}

function requireXAirClient() {
  if (!xairClient || !xairClient.status().connected) {
    throw new Error('XR18 is not connected')
  }
  return xairClient
}

function attachXAirEventLogging(client) {
  client.events.on('message', (message) => {
    xairLastMessageAt = new Date().toISOString()
    xairLastMessage = {
      address: message.address,
      args: message.args,
      remote: message.remote,
    }
    xairLastError = null
  })
  client.events.on('error', (e) => {
    xairLastError = e instanceof Error ? e.message : String(e)
    logWarn('xair: event error:', xairLastError)
  })
  client.events.on('state', (state) => {
    logInfo(`xair: ${state.connected ? 'connected' : 'disconnected'} ${state.host}:${state.port}`)
  })
}

function closeXAirClient() {
  // Cleared unconditionally: a stale identity outliving the connection would let
  // the page keep showing "XR18 · fw 1.21" after the desk was gone.
  xairInfo = null
  if (!xairClient) return
  try {
    xairClient.close()
  } catch (e) {
    logWarn('xair: close failed:', e instanceof Error ? e.message : String(e))
  }
  xairClient = null
}

function sendHardwareError(res, cors, e, status = 400) {
  sendJson(
    res,
    status,
    {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      xair: publicXAirStatus(),
    },
    cors,
  )
}

/**
 * The hardware-control routes drive a LIVE console over the network, so — unlike
 * the rest of the loopback sidecar (`Access-Control-Allow-Origin: *`) — they must
 * NOT be reachable from any random page the user has open. Server-side origin
 * gate (independent of CORS, which only governs response readability): allow
 * same-origin/non-browser (no Origin), localhost dev, BarBro's Netlify prod, and
 * anything in `BARBRO_HARDWARE_ORIGINS`. Everything else is refused BEFORE it can
 * touch a fader. Deliberately permissive enough to never break the real rig.
 */
function isHardwareOriginAllowed(origin) {
  if (!origin || typeof origin !== 'string') return true // curl / Electron / same-origin
  try {
    const u = new URL(origin)
    const host = u.hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
    if (u.protocol === 'https:' && host.endsWith('.netlify.app')) return true // BarBro prod
    const extra = String(process.env.BARBRO_HARDWARE_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return extra.includes(origin)
  } catch {
    return false
  }
}

/** `GET /native/hardware/status` — current sidecar hardware bridge state. */
function handleHardwareStatus(res, cors) {
  sendJson(
    res,
    200,
    {
      ok: true,
      midi: { supported: false, devices: [] },
      xair: publicXAirStatus(),
    },
    cors,
  )
}

/** `POST /native/hardware/xair/connect` — body `{ host, port? }`. */
async function handleXAirConnect(req, res, cors) {
  const body = await readRequestJson(req)
  if (!body || typeof body !== 'object') {
    return sendHardwareError(res, cors, new Error('Expected JSON body `{ host, port? }`'))
  }
  if (typeof body.host !== 'string' || body.host.trim().length === 0) {
    return sendHardwareError(res, cors, new Error('XR18 host is required'))
  }
  const host = body.host.trim()
  let port
  try {
    port = parseXAirPort(body.port)
  } catch (e) {
    return sendHardwareError(res, cors, e)
  }

  const nextClient = createXAirClient({ host, ...(port ? { port } : {}) })
  attachXAirEventLogging(nextClient)
  try {
    closeXAirClient()
    xairLastMessageAt = null
    xairLastMessage = null
    xairLastError = null
    xairInfo = null
    await nextClient.open()
    // PROVE IT. `open()` only binds a local UDP socket, which succeeds for any
    // address that parses — so without this, a typo reported "Connected" and you
    // found out at the venue when a fader did nothing. `identify()` waits for the
    // desk's own `/xinfo` reply.
    const info = await nextClient.identify()
    if (!info) {
      try {
        nextClient.close()
      } catch {
        /* nothing to clean up */
      }
      xairInfo = null
      logError(`xair: no /xinfo reply from ${host}:${nextClient.port}`)
      return sendHardwareError(
        res,
        cors,
        new Error(
          `No reply from ${host}:${nextClient.port}. Check the IP, and that this Mac is on the desk's network — the USB cable carries audio only.`,
        ),
      )
    }
    xairClient = nextClient
    xairInfo = info
    logInfo(
      `xair: identified ${info.model ?? 'desk'} "${info.name ?? '?'}" fw ${info.firmware ?? '?'} at ${host}:${nextClient.port}`,
    )
    sendJson(res, 200, { ok: true, xair: publicXAirStatus() }, cors)
  } catch (e) {
    try {
      nextClient.close()
    } catch {
      /* ignore cleanup failure */
    }
    xairLastError = e instanceof Error ? e.message : String(e)
    sendHardwareError(res, cors, e, 500)
  }
}

/** `POST /native/hardware/xair/disconnect` — close XR18 UDP control. */
async function handleXAirDisconnect(req, res, cors) {
  await readRequestBody(req).catch(() => Buffer.alloc(0))
  closeXAirClient()
  sendJson(res, 200, { ok: true, xair: publicXAirStatus() }, cors)
}

/** `POST /native/hardware/xair/main-fader` — body `{ value }`, clamped 0..1. */
async function handleXAirMainFader(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    const client = requireXAirClient()
    if (!body || typeof body !== 'object' || body.value === undefined) throw new Error('Expected JSON body `{ value }`')
    client.setMainFader(body.value)
    logInfo(`xair write: /lr/mix/fader ${body.value}`)
    sendJson(res, 200, { ok: true, xair: publicXAirStatus() }, cors)
  } catch (e) {
    sendHardwareError(res, cors, e)
  }
}

/** `POST /native/hardware/xair/channel-fader` — body `{ channel, value }`, clamped 0..1. */
async function handleXAirChannelFader(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    const client = requireXAirClient()
    if (!body || typeof body !== 'object') throw new Error('Expected JSON body `{ channel, value }`')
    client.setChannelFader(body.channel, body.value)
    logInfo(`xair write: channel ${body.channel} fader ${body.value}`)
    sendJson(res, 200, { ok: true, xair: publicXAirStatus() }, cors)
  } catch (e) {
    sendHardwareError(res, cors, e)
  }
}

/** `POST /native/hardware/xair/channel-on` — body `{ channel, on }`. */
async function handleXAirChannelOn(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    const client = requireXAirClient()
    if (!body || typeof body !== 'object' || typeof body.on !== 'boolean') {
      throw new Error('Expected JSON body `{ channel, on }`')
    }
    client.setChannelOn(body.channel, body.on)
    logInfo(`xair write: channel ${body.channel} ${body.on ? 'on' : 'off'}`)
    sendJson(res, 200, { ok: true, xair: publicXAirStatus() }, cors)
  } catch (e) {
    sendHardwareError(res, cors, e)
  }
}

/** `POST /native/hardware/xair/bus-send` — body `{ channel, bus, value }`, clamped 0..1. */
async function handleXAirBusSend(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    const client = requireXAirClient()
    if (!body || typeof body !== 'object') throw new Error('Expected JSON body `{ channel, bus, value }`')
    client.setChannelBusSend(body.channel, body.bus, body.value)
    logInfo(`xair write: channel ${body.channel} bus ${body.bus} send ${body.value}`)
    sendJson(res, 200, { ok: true, xair: publicXAirStatus() }, cors)
  } catch (e) {
    sendHardwareError(res, cors, e)
  }
}

/** `POST /native/hardware/xair/channel-main-assign` — body `{ channel, on }`. The
 *  FOH-safety control: `on:false` takes a channel OFF the main/LR (house) bus. */
async function handleXAirChannelMainAssign(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    const client = requireXAirClient()
    if (!body || typeof body !== 'object' || typeof body.on !== 'boolean') {
      throw new Error('Expected JSON body `{ channel, on }`')
    }
    client.setChannelMainAssign(body.channel, body.on)
    logInfo(`xair write: channel ${body.channel} main-assign ${body.on ? 'ON' : 'OFF (house-safe)'}`)
    sendJson(res, 200, { ok: true, xair: publicXAirStatus() }, cors)
  } catch (e) {
    sendHardwareError(res, cors, e)
  }
}

/** `POST /native/hardware/xair/bus-fader` — body `{ bus, value }`, clamped 0..1. */
async function handleXAirBusFader(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    const client = requireXAirClient()
    if (!body || typeof body !== 'object') throw new Error('Expected JSON body `{ bus, value }`')
    client.setBusFader(body.bus, body.value)
    logInfo(`xair write: bus ${body.bus} master ${body.value}`)
    sendJson(res, 200, { ok: true, xair: publicXAirStatus() }, cors)
  } catch (e) {
    sendHardwareError(res, cors, e)
  }
}

/** `POST /native/hardware/xair/refresh` — query the desk + return per-channel
 *  state (lr/on/fader). Powers the "prove it" FOH-safety read-back. */
/**
 * `POST /native/hardware/xair/query` — body `{ addresses: string[], waitMs? }`.
 *
 * READ-ONLY. Sends each address with no arguments, which on OSC is a question,
 * and returns whatever the desk said. Deliberately generic on the READ side:
 * discovering what a desk actually reports is how BarBro avoids guessing at a
 * firmware's vocabulary. The WRITE side stays narrow and typed — see below.
 */
async function handleXAirQuery(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    const addresses = Array.isArray(body?.addresses) ? body.addresses : null
    if (!addresses || addresses.length === 0) {
      throw new Error('Expected JSON body `{ addresses: string[] }`')
    }
    if (addresses.length > 64) throw new Error('Too many addresses in one query')
    const client = requireXAirClient()
    const waitMs = Number.isFinite(body?.waitMs) ? Math.min(2000, Math.max(50, body.waitMs)) : 300
    const replies = await client.queryPaths(addresses, { waitMs })
    logInfo(`xair query: ${addresses.length} asked, ${Object.keys(replies).length} answered`)
    sendJson(res, 200, { ok: true, xair: publicXAirStatus(), replies }, cors)
  } catch (e) {
    sendHardwareError(res, cors, e)
  }
}

/**
 * `POST /native/hardware/xair/osc-int` — body `{ address, value }`.
 *
 * Writes ONE integer to ONE whitelisted address, then reads it back and returns
 * before/after. The read-back is the point: X-AIR ignores addresses it does not
 * have, silently, so "the command was sent" is not evidence that anything
 * happened. That is how a whole afternoon went into a routing model the desk
 * had never implemented.
 *
 * The whitelist is deliberately tiny. This server is reachable by any page in
 * any browser on the machine, and a generic "write any OSC" endpoint would let
 * a random website reconfigure a mixer. Only the two USB-input settings are
 * allowed, and neither can make a sound on its own — they choose a SOURCE, not
 * a level.
 */
async function handleXAirOscInt(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    const address = typeof body?.address === 'string' ? body.address.trim() : ''
    if (!isXAirWritableIntAddress(address)) {
      throw new Error(`Address not writable through this endpoint: ${address || '(empty)'}`)
    }
    if (!Number.isInteger(body?.value) || body.value < 0 || body.value > 63) {
      throw new Error('value must be an integer 0..63')
    }
    const client = requireXAirClient()

    const before = await client.queryPaths([address], { waitMs: 250 })
    client.send(address, [{ type: 'i', value: body.value }])
    const after = await client.queryPaths([address], { waitMs: 350 })

    logInfo(`xair write ${address} = ${body.value} (was ${JSON.stringify(before[address] ?? null)}, now ${JSON.stringify(after[address] ?? null)})`)
    sendJson(
      res,
      200,
      { ok: true, xair: publicXAirStatus(), address, before: before[address] ?? null, after: after[address] ?? null },
      cors,
    )
  } catch (e) {
    sendHardwareError(res, cors, e)
  }
}

/**
 * `POST /native/hardware/xair/discover` — find every X-Air on the network.
 *
 * READ-ONLY and connectionless: it broadcasts `/xinfo`, which is a question.
 * Nothing is connected to and nothing is changed.
 *
 * Exists because the desk has no screen. Typing an IP at load-in is how you end
 * up connected to nothing, and a wrong address looks exactly like a desk that is
 * switched off — UDP reports neither.
 */
async function handleXAirDiscover(req, res, cors) {
  try {
    await readRequestJson(req).catch(() => null)
    const consoles = await discoverXAirConsoles({ waitMs: 1500 })
    logInfo(`xair discover: ${consoles.length} console(s) — ${consoles.map((c) => `${c.ip} (${c.model ?? '?'})`).join(', ') || 'none'}`)
    sendJson(res, 200, { ok: true, consoles }, cors)
  } catch (e) {
    sendHardwareError(res, cors, e)
  }
}

async function handleXAirRefresh(req, res, cors) {
  try {
    await readRequestJson(req).catch(() => null)
    const client = requireXAirClient()
    const state = await client.refreshChannelState()
    sendJson(res, 200, { ok: true, xair: publicXAirStatus(), channels: state.channels }, cors)
  } catch (e) {
    sendHardwareError(res, cors, e)
  }
}

/**
 * `POST /native/hardware/xair/meters` — what the desk is HEARING, right now.
 *
 * READ-ONLY, and the only evidence that BarBro's audio actually ARRIVED. A
 * successful write proves nothing (X-Air ignores unknown addresses in silence),
 * and a meter on our own output proves only what we sent. This is the desk's own
 * report, which is why a monitor can be called working rather than assumed to be.
 *
 * The first call starts the subscription and there is nothing to return yet, so
 * it waits briefly for the first frame rather than answering "no signal" for a
 * rig that is fine. `ageMs` is returned with every reply: stale meters must be
 * distinguishable from silence, because a false red costs nearly as much as a
 * false green.
 */
async function handleXAirMeters(req, res, cors) {
  try {
    await readRequestJson(req).catch(() => null)
    const client = requireXAirClient()
    client.subscribeMeters()
    let m = client.getMeters()
    if (m.levels === null) {
      await new Promise((r) => setTimeout(r, 400))
      m = client.getMeters()
    }
    sendJson(res, 200, { ok: true, xair: publicXAirStatus(), ...m }, cors)
  } catch (e) {
    sendHardwareError(res, cors, e)
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
const PROJECT_FILE_VERSION = 1
const SONG_SMAP_FILENAME = 'song.smap'
const SONG_ALS_FILENAME = 'song.als'

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

const AUTO_STEM_NAMES = ['vocals', 'drums', 'bass', 'other']
const AUTO_STEM_QUALITIES = ['best', 'balanced', 'preview']

/**
 * Parse the optional `autoStems` policy block, mirroring `parseAutoStems` in
 * src/lib/project/parse.ts. Returns undefined for absent/malformed blocks.
 * CRUCIAL: without this, a manifest round-trip through `parseManifestObject`
 * (every sidecar manifest write) would strip the policy the web app saved.
 */
function parseManifestAutoStems(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const enabled = raw.enabled === true
  const stems = []
  if (Array.isArray(raw.stems)) {
    for (const s of raw.stems) {
      if (typeof s === 'string' && AUTO_STEM_NAMES.includes(s) && !stems.includes(s)) stems.push(s)
    }
  }
  const quality = AUTO_STEM_QUALITIES.includes(raw.quality) ? raw.quality : 'balanced'
  return { enabled, stems, quality }
}

/**
 * Parse the optional `cloud` collab-link block, mirroring the cloud parse in
 * src/lib/project/parse.ts. Returns undefined when absent/malformed.
 * CRUCIAL: without this, every sidecar manifest write strips the cloud link,
 * silently "un-sharing" the project — "Enable cloud sync" appears to work in
 * memory, then breaks after the store reloads from disk.
 */
function parseManifestCloud(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  if (typeof raw.projectId !== 'string' || raw.projectId.length === 0) return undefined
  if (typeof raw.lastSyncedRevision !== 'number' || !Number.isFinite(raw.lastSyncedRevision)) {
    return undefined
  }
  const cloud = { projectId: raw.projectId, lastSyncedRevision: raw.lastSyncedRevision }
  if (typeof raw.pendingChanges === 'number' && Number.isFinite(raw.pendingChanges)) {
    cloud.pendingChanges = raw.pendingChanges
  }
  if (typeof raw.lastPushedAt === 'string') cloud.lastPushedAt = raw.lastPushedAt
  if (typeof raw.lastPulledAt === 'string') cloud.lastPulledAt = raw.lastPulledAt
  return cloud
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
    // Preserve cloud-collab linkage on round-trip — without this, a manifest
    // write through the sidecar would strip the cloud link and the project
    // would silently "un-share". Mirrors src/lib/project/parse.ts.
    if (typeof e.cloudSongId === 'string' && e.cloudSongId.length > 0) {
      entry.cloudSongId = e.cloudSongId
    }
    if (typeof e.lastSyncedRevision === 'number' && Number.isFinite(e.lastSyncedRevision)) {
      entry.lastSyncedRevision = e.lastSyncedRevision
    }
    if (typeof e.lastSyncedContentHash === 'string' && e.lastSyncedContentHash.length > 0) {
      entry.lastSyncedContentHash = e.lastSyncedContentHash
    }
    songs.push(entry)
  }
  const autoStems = parseManifestAutoStems(raw.autoStems)
  const cloud = parseManifestCloud(raw.cloud)
  const defaults = parseManifestDefaults(raw.defaults)
  const mastering = parseManifestMastering(raw.mastering)
  const performers = parseManifestPerformers(raw.performers)
  const performerMixes = parseManifestPerformerMixes(raw.performerMixes)
  const liveRig = parseManifestLiveRig(raw.liveRig)
  return {
    formatVersion: PROJECT_FILE_VERSION,
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    songs,
    ...(autoStems ? { autoStems } : {}),
    ...(cloud ? { cloud } : {}),
    ...(defaults ? { defaults } : {}),
    ...(mastering ? { mastering } : {}),
    ...(performers ? { performers } : {}),
    ...(performerMixes ? { performerMixes } : {}),
    ...(liveRig ? { liveRig } : {}),
  }
}

/**
 * The band roster.
 *
 * ADDING A TOP-LEVEL FIELD TO `ProjectFile` IS NOT ENOUGH — it must be listed
 * here too, or every manifest write through the sidecar silently deletes it.
 * `performers` was added to the web app and never added here, so performers
 * could be created, saved, and were gone the moment anything wrote the
 * manifest. On desktop that is every save. It looked like the save button did
 * nothing, ten times over.
 *
 * `desktop/electron/manifestRoundTrip.test.mjs` now fails if this list falls
 * behind the type again.
 */
/**
 * Per-performer monitor mixes. Same defensive rules as the web parser: a level
 * that is not a finite number is DROPPED (it falls back to the default at
 * resolve time), never coerced to 0 — a parser must not mute anyone's monitor.
 * This object literal is a whitelist: a field missing here is deleted on every
 * sidecar round-trip, which is exactly how `performers` was silently eaten.
 */
function parseManifestPerformerMixes(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const clamp = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined)
  const out = {}
  for (const [performerId, rawMix] of Object.entries(raw)) {
    if (!rawMix || typeof rawMix !== 'object') continue
    const stems = {}
    if (rawMix.stems && typeof rawMix.stems === 'object') {
      for (const [name, v] of Object.entries(rawMix.stems)) {
        const lv = clamp(v)
        if (lv !== undefined) stems[name] = lv
      }
    }
    const mix = { stems }
    for (const key of ['original', 'click', 'cue', 'fallback']) {
      const lv = clamp(rawMix[key])
      if (lv !== undefined) mix[key] = lv
    }
    out[performerId] = mix
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseManifestPerformers(raw) {
  if (!Array.isArray(raw)) return undefined
  const out = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    if (typeof r.id !== 'string' || !r.id) continue
    if (typeof r.name !== 'string') continue
    const p = { id: r.id, name: r.name }
    if (typeof r.role === 'string' && r.role.trim()) p.role = r.role
    if (typeof r.userId === 'string' && r.userId) p.userId = r.userId
    // 1..6 — the XR18's six aux buses, one per in-ear pack.
    if (typeof r.monitorBus === 'number' && r.monitorBus >= 1 && r.monitorBus <= 6) {
      p.monitorBus = Math.round(r.monitorBus)
    }
    // Desk inputs (the band's patch plan) — mirrors src/lib/project/parse.ts
    // parsePerformerInputs. 1 channel = mono, 2 = stereo pair; junk dropped.
    if (Array.isArray(r.inputs)) {
      const inputs = []
      for (const i of r.inputs) {
        if (!i || typeof i !== 'object') continue
        if (typeof i.id !== 'string' || !i.id) continue
        if (typeof i.label !== 'string') continue
        if (!Array.isArray(i.channels)) continue
        const channels = i.channels
          .filter((c) => typeof c === 'number' && Number.isInteger(c) && c >= 1 && c <= 16)
          .slice(0, 2)
        if (channels.length < 1 || new Set(channels).size !== channels.length) continue
        inputs.push({ id: i.id, label: i.label, channels })
      }
      if (inputs.length > 0) p.inputs = inputs
    }
    out.push(p)
  }
  return out.length > 0 ? out : undefined
}

/** The live rig: desk routes, per-performer monitor sends, bus masters. */
function parseManifestLiveRig(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const out = {}

  if (Array.isArray(raw.routes)) {
    const routes = []
    for (const r of raw.routes) {
      if (!r || typeof r !== 'object' || typeof r.laneKey !== 'string' || !r.laneKey) continue
      const channels = Array.isArray(r.channels)
        ? [...new Set(r.channels.filter((n) => Number.isInteger(n) && n >= 1 && n <= 16))].sort(
            (a, b) => a - b,
          )
        : []
      const entry = { laneKey: r.laneKey, channels }
      if (typeof r.followVolume === 'boolean') entry.followVolume = r.followVolume
      if (typeof r.followMute === 'boolean') entry.followMute = r.followMute
      routes.push(entry)
    }
    if (routes.length > 0) out.routes = routes
  }

  const level = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null)

  if (raw.monitorSends && typeof raw.monitorSends === 'object') {
    const sends = {}
    for (const [busKey, lanes] of Object.entries(raw.monitorSends)) {
      const bus = Number(busKey)
      if (!Number.isInteger(bus) || bus < 1 || bus > 6) continue
      if (!lanes || typeof lanes !== 'object') continue
      const perLane = {}
      for (const [laneKey, v] of Object.entries(lanes)) {
        const lv = level(v)
        if (laneKey && lv !== null) perLane[laneKey] = lv
      }
      if (Object.keys(perLane).length > 0) sends[bus] = perLane
    }
    if (Object.keys(sends).length > 0) out.monitorSends = sends
  }

  if (raw.busMaster && typeof raw.busMaster === 'object') {
    const masters = {}
    for (const [busKey, v] of Object.entries(raw.busMaster)) {
      const bus = Number(busKey)
      const lv = level(v)
      if (Number.isInteger(bus) && bus >= 1 && bus <= 6 && lv !== null) masters[bus] = lv
    }
    if (Object.keys(masters).length > 0) out.busMaster = masters
  }

  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Parse the optional `defaults` block (project-wide count-in + pre-count-in
 * cue). Preserved on round-trip so a sidecar manifest write never drops the
 * shared project config (same class of bug as autoStems/cloud stripping).
 */
function parseManifestDefaults(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const out = {}
  if (typeof raw.countInBeats === 'number' && Number.isInteger(raw.countInBeats) && raw.countInBeats >= 0) {
    out.countInBeats = raw.countInBeats
  }
  // Which stems start audible in live. The web parser dropped this too, so the
  // project-wide setting silently did not survive a load at either end.
  if (Array.isArray(raw.liveStems)) {
    const order = ['vocals', 'drums', 'bass', 'other']
    const seen = new Set(raw.liveStems.filter((v) => order.includes(v)))
    // An empty array means "every stem starts muted" — a real choice, kept.
    out.liveStems = order.filter((n) => seen.has(n))
  }
  // The per-BUTTON start state (successor to liveStems). Must be mirrored here
  // or the sidecar deletes it on every manifest write, like liveStems was.
  if (Array.isArray(raw.liveSlots)) {
    const SLOTS = ['drums', 'bass', 'vocals', 'other', 'guitar', 'fx', 'click', 'cue', 'custom1', 'custom2']
    const seen = new Set(raw.liveSlots.filter((v) => SLOTS.includes(v)))
    out.liveSlots = SLOTS.filter((n) => seen.has(n))
  }
  const pc = raw.preCountInCue
  // 'auto' and 'triggered' are the CURRENT modes; 'title'/'custom' are legacy
  // spellings the web side migrates to 'auto'. This list had only the legacy
  // three, so a project using the modern 'auto' had its song announcement
  // quietly deleted every time the sidecar rewrote the manifest.
  const CUE_MODES = ['off', 'auto', 'triggered', 'title', 'custom']
  if (pc && typeof pc === 'object' && CUE_MODES.includes(pc.mode)) {
    out.preCountInCue = { mode: pc.mode }
    if (typeof pc.text === 'string') out.preCountInCue.text = pc.text
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Parse the optional `mastering` block (project sound: loudness matching +
 * per-stem dynamics). Preserved on round-trip so a sidecar manifest write
 * never drops the shared project config (same class of bug as autoStems).
 */
function parseManifestMastering(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.enabled !== 'boolean') return undefined
  const out = { enabled: raw.enabled }
  if (typeof raw.matchLoudness === 'boolean') out.matchLoudness = raw.matchLoudness
  if (typeof raw.masterGlue === 'boolean') out.masterGlue = raw.masterGlue
  if (raw.stems && typeof raw.stems === 'object') {
    const stems = {}
    for (const name of ['vocals', 'drums', 'bass', 'other']) {
      const v = raw.stems[name]
      // Legacy shape: bare intensity string.
      if (v === 'off' || v === 'light' || v === 'firm') {
        stems[name] = { intensity: v }
        continue
      }
      if (!v || typeof v !== 'object') continue
      const entry = {}
      if (v.intensity === 'off' || v.intensity === 'light' || v.intensity === 'firm') {
        entry.intensity = v.intensity
      }
      if (typeof v.trimDb === 'number' && Number.isFinite(v.trimDb)) {
        entry.trimDb = Math.max(-9, Math.min(9, v.trimDb))
      }
      if (v.tone === 'natural' || v.tone === 'shaped') entry.tone = v.tone
      if (Object.keys(entry).length > 0) stems[name] = entry
    }
    if (Object.keys(stems).length > 0) out.stems = stems
  }
  return out
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
 *
 * Supports both container versions:
 *   - v1: 28-byte header (magic + version + flags + jsonLen + audioLen),
 *         json begins at offset 28.
 *   - v2: 16-byte header (magic + version + jsonLen), json begins at
 *         offset 16. No audio chunk — audio lives at `<song>/audio/<file>`.
 */
async function readSmapHeaderJson(smapPath) {
  try {
    const st = await stat(smapPath)
    if (st.size < 16) return null
    const fh = await import('node:fs/promises').then((m) => m.open(smapPath, 'r'))
    try {
      const probe = Buffer.alloc(8)
      await fh.read(probe, 0, 8, 0)
      if (probe.toString('ascii', 0, 4) !== 'SMAP') return null
      const version = probe.readUInt32LE(4)

      let headerLen
      let jsonLenOffset
      if (version === 2) {
        headerLen = 16
        jsonLenOffset = 8
      } else if (version === 1) {
        headerLen = 28
        jsonLenOffset = 12
      } else {
        return null
      }
      if (st.size < headerLen) return null

      const headerBuf = Buffer.alloc(headerLen)
      await fh.read(headerBuf, 0, headerLen, 0)
      const jsonLen = Number(headerBuf.readBigUInt64LE(jsonLenOffset))
      if (jsonLen <= 0 || jsonLen > 10 * 1024 * 1024) return null
      if (headerLen + jsonLen > st.size) return null

      const jsonBuf = Buffer.alloc(jsonLen)
      await fh.read(jsonBuf, 0, jsonLen, headerLen)
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
  // Auto-detected key (low-confidence detections live only in chordHints —
  // without surfacing it here, a project refresh wipes detected keys off the
  // cards because the scan replaces the web's metadata cache wholesale).
  const dk = map.chordHints?.detectedKey
  if (dk && typeof dk === 'object' && typeof dk.root === 'string' && typeof dk.mode === 'string') {
    out.detectedKey = {
      root: dk.root,
      ...(dk.accidental ? { accidental: dk.accidental } : {}),
      mode: dk.mode,
    }
  }
  out.analyzed =
    md.analyzed === true ||
    (Array.isArray(map.timeline?.bars) && map.timeline.bars.length > 0)
  if (
    map.transpose &&
    typeof map.transpose === 'object' &&
    Number.isInteger(map.transpose.baseSemitones) &&
    map.transpose.baseSemitones !== 0
  ) {
    out.transposeSemitones = map.transpose.baseSemitones
  }
  if (typeof md.bpm === 'number') out.bpm = md.bpm
  if (typeof map.countInBeats === 'number' && map.countInBeats > 0) out.countInBeats = map.countInBeats
  // True when the SongMap names an audio source — covers both v1 baked
  // audio (`fileName` set) and v2 disk-stored audio (`originalPath` set).
  // Stub songs added via "Add empty" have no `audio` block at all.
  const a = map.audio
  if (a && typeof a === 'object' && (typeof a.fileName === 'string' || typeof a.originalPath === 'string')) {
    out.hasAudio = true
    // WHERE the original lives, so the live prefetcher can warm it. Same
    // resolution the editor uses: v2 disk path first, else the conventional
    // audio/<fileName> location.
    const sub = typeof a.originalPath === 'string' && a.originalPath
      ? a.originalPath
      : (typeof a.fileName === 'string' && a.fileName ? `audio/${a.fileName}` : undefined)
    if (sub) out.audioSubpath = sub
    if (typeof a.durationSec === 'number' && Number.isFinite(a.durationSec) && a.durationSec > 0) {
      out.audioDurationSec = a.durationSec
    }
  }
  if (map.stemRefs && typeof map.stemRefs === 'object') out.stemRefs = { ...map.stemRefs }
  return out
}

/** Known preset slugs (kept in sync with web-side STEM_QUALITY_PRESETS). */
const KNOWN_STEM_PRESETS = new Set(['best', 'balanced', 'preview'])

/**
 * Audio file extensions accepted as stems. Demucs produces WAVs; users may
 * drop in MP3 / FLAC / etc. exported from elsewhere — all decode fine via
 * the browser's AudioContext, so we accept them all here.
 */
const STEM_AUDIO_EXTENSIONS = ['.wav', '.mp3', '.flac', '.m4a', '.ogg', '.aif', '.aiff']

function isStemAudioFile(name) {
  const lower = name.toLowerCase()
  for (const ext of STEM_AUDIO_EXTENSIONS) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

/**
 * Scan `<songFolder>/stems/` for stem renderings, grouped by preset.
 *
 * Two layouts are supported simultaneously so older songs keep working:
 *  - **Per-preset subfolders**: `stems/best/vocals.wav`, `stems/preview/...`
 *  - **Flat (legacy)**: `stems/vocals.wav` directly under `stems/`. These
 *    get reported under the `'legacy'` slug — lowest quality fallback.
 *
 * Returns `Record<presetSlug, sortedAudioBasenames>`. Empty object when no
 * stems exist. Empty presets (subfolders with no audio inside) are skipped.
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
  const flatAudio = []
  for (const ent of entries) {
    if (ent.isFile() && isStemAudioFile(ent.name)) {
      flatAudio.push(ent.name)
      continue
    }
    if (ent.isDirectory()) {
      const sub = path.join(stemsDir, ent.name)
      try {
        const inner = await readdir(sub)
        const audio = dedupeStemsByLowerCase(inner.filter(isStemAudioFile))
        if (audio.length > 0) out[ent.name] = audio
      } catch {
        /* unreadable subfolder — skip */
      }
    }
  }
  if (flatAudio.length > 0) out['legacy'] = dedupeStemsByLowerCase(flatAudio)
  return out
}

/**
 * Read `stems/<slug>/provenance.json` for every preset subfolder — the stamp
 * demucs_separate.py writes recording HOW the stems were made (model, shifts,
 * overlap). The auto-stems daemon uses this to detect stems that were split
 * with weaker/unknown settings and quietly re-split them in the background.
 *
 * Returns `Record<slug, payload|null>` — `null` for a preset dir with no (or
 * unparseable) stamp, so the daemon treats those stems as unproven.
 */
async function readStemProvenance(songFolderAbs) {
  const stemsDir = path.join(songFolderAbs, 'stems')
  /** @type {Record<string, object|null>} */
  const out = {}
  let entries
  try {
    const { readdir } = await import('node:fs/promises')
    entries = await readdir(stemsDir, { withFileTypes: true })
  } catch {
    return out
  }
  const { readFile } = await import('node:fs/promises')
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    try {
      const raw = await readFile(path.join(stemsDir, ent.name, 'provenance.json'), 'utf8')
      const parsed = JSON.parse(raw)
      out[ent.name] = parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      out[ent.name] = null // missing/corrupt stamp → stems are unproven
    }
  }
  return out
}

async function hasRenderedCueTrack(songFolderAbs) {
  if (existsSync(path.join(songFolderAbs, 'cue', 'cue-track.wav'))) return true
  const tracksDir = path.join(songFolderAbs, 'cue', 'tracks')
  let entries
  try {
    entries = await readdir(tracksDir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    if (existsSync(path.join(tracksDir, ent.name, 'cue-track.wav'))) return true
  }
  return false
}

/**
 * Stems can end up duplicated in two ways:
 *   1. Different case for the same name: `bass.wav` + `Bass.wav`.
 *   2. Same stem in multiple formats: `bass.wav` + `bass.mp3` (e.g. after a
 *      previous Ableton export wrote an MP3 sibling).
 *
 * Both forms collapse to the same mixer slot, so we dedupe here by
 * case-folded basename (without extension) and keep the highest-quality
 * format. Lossless beats lossy, then alphabetical name as a tiebreaker
 * (lowercase wins over uppercase since it sorts later).
 */
const STEM_FORMAT_PRIORITY = ['.wav', '.flac', '.aif', '.aiff', '.m4a', '.ogg', '.mp3']

function stemFormatScore(name) {
  const lower = name.toLowerCase()
  for (let i = 0; i < STEM_FORMAT_PRIORITY.length; i++) {
    if (lower.endsWith(STEM_FORMAT_PRIORITY[i])) return i
  }
  return STEM_FORMAT_PRIORITY.length
}

function dedupeStemsByLowerCase(names) {
  /** @type {Map<string, string>} */
  const byBase = new Map()
  for (const name of names) {
    const key = name.replace(/\.[^.]+$/, '').toLowerCase()
    const existing = byBase.get(key)
    if (!existing) {
      byBase.set(key, name)
      continue
    }
    const challengerScore = stemFormatScore(name)
    const existingScore = stemFormatScore(existing)
    if (challengerScore < existingScore) {
      byBase.set(key, name)
    } else if (challengerScore === existingScore && name > existing) {
      // Same format — prefer the lowercase variant (sorts later in ASCII).
      byBase.set(key, name)
    }
  }
  return [...byBase.values()].sort()
}

function nowIso() {
  return new Date().toISOString()
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
 * `{ ok, manifest, songsMetadata: Record<folder, { title, artist?, keyDetail?, bpm?, countInBeats?, hasAudio?, hasSmap, hasAls, hasCueTrack, hasClickTrack, stemsByPreset: Record<presetSlug, sortedWavBasenames>, stemRefs? }> }`.
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
      const clickPath = path.join(folderAbs, 'cue', 'click-track.wav')
      const hasSmap = existsSync(smapPath)
      const hasAls = existsSync(alsPath)
      const hasCueTrack = await hasRenderedCueTrack(folderAbs)
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
    // Range-aware, fails cleanly on a mid-stream read error (see serveFile.mjs).
    serveFileFromDisk(req, res, smapPath, { contentType: 'application/octet-stream', cors })
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

function safeYoutubeTitleFragment(title) {
  const raw = String(title ?? '').normalize('NFKC')
  const withoutPathChars = raw.replace(/[\/\\\x00-\x1f]/g, ' ')
  const cleaned = withoutPathChars
    .replace(/[^\p{L}\p{N}\s_.-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[-_.]{2,}/g, '-')
    .slice(0, 60)
    .replace(/^[-_.]+|[-_.]+$/g, '')
  return cleaned || 'audio'
}

function safeYoutubeAudioFilename(meta, jobId) {
  const videoId = typeof meta?.videoId === 'string' && meta.videoId.trim()
    ? meta.videoId.trim().replace(/[^\w-]/g, '').slice(0, 32)
    : jobId.slice(0, 8)
  const title = safeYoutubeTitleFragment(meta?.titleHint)
  return `yt-${videoId}-${title}.wav`
}

function uniqueAudioSubpath(projectPath, songFolder, preferredFileName) {
  const dot = preferredFileName.toLowerCase().endsWith('.wav') ? preferredFileName.slice(0, -4) : preferredFileName
  for (let i = 0; i < 100; i++) {
    const suffix = i === 0 ? '' : `-${i + 1}`
    const fileName = `${dot}${suffix}.wav`
    const subpath = validateAssetSubpath(`audio/${fileName}`)
    const abs = path.join(projectPath, songFolder, subpath)
    if (!existsSync(abs)) return { fileName, subpath, abs }
  }
  throw new Error('Could not find a free audio filename')
}

async function atomicCopyFile(srcAbs, targetAbs) {
  const dir = path.dirname(targetAbs)
  await mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(targetAbs)}.${randomUUID().slice(0, 8)}.tmp`)
  try {
    await copyFile(srcAbs, tmp)
    await rename(tmp, targetAbs)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

function normalizeYoutubeVideoUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return { ok: false, code: 'INVALID_URL', error: 'Enter a YouTube URL.' }
  }
  let u
  try {
    u = new URL(rawUrl.trim())
  } catch {
    return { ok: false, code: 'INVALID_URL', error: 'That does not look like a valid URL.' }
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, code: 'INVALID_URL', error: 'Use an http or https YouTube URL.' }
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  let videoId = ''
  if (host === 'youtu.be') {
    videoId = u.pathname.split('/').filter(Boolean)[0] ?? ''
  } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') {
      videoId = u.searchParams.get('v') ?? ''
    } else {
      const parts = u.pathname.split('/').filter(Boolean)
      if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') && parts[1]) {
        videoId = parts[1]
      }
    }
  } else {
    return { ok: false, code: 'UNSUPPORTED_URL', error: 'Use a YouTube video URL.' }
  }
  videoId = videoId.trim()
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    return { ok: false, code: 'UNSUPPORTED_URL', error: 'Use a single YouTube video URL.' }
  }
  return { ok: true, url: `https://www.youtube.com/watch?v=${videoId}`, videoId }
}

// The asset read/write/remove endpoints live in projectAssetRoutes.mjs so they
// can be booted over a real HTTP server in tests (projectAssetRoutes.test.mjs).
// HTTP plumbing is injected; path safety + atomic write come from projectPaths.
const projectAssetRoutes = createProjectAssetRoutes({ sendJson, readRequestJson })

/**
 * `POST /native/project/song/audio/relink` — open an OS file picker, copy
 * the user-chosen file to `<song>/audio/<filename>`, compute its SHA-256,
 * and return the relative path + hash. Used by the relink banner when the
 * SongMap's `audio.originalPath` doesn't resolve on disk anymore.
 *
 * Request body: `{ projectPath, songFolder, defaultName?, expected?, strict? }`.
 *
 * When `expected.sha256` is present and `strict === true`, the picked
 * file's sha256 must match before we write anything. On mismatch we
 * return `{ ok: false, mismatch: { expected, got } }` and leave disk
 * untouched — this is the Phase 6 "I have a different master" guard.
 * When `strict === false` (default) we always write, regardless of
 * `expected`, and just include the comparison fields in the response so
 * the UI can surface a soft warning.
 *
 * Response: one of:
 *   `{ ok: true, relPath, fileName, sha256, size, identityMatched? }`
 *   `{ ok: false, cancelled: true }`
 *   `{ ok: false, mismatch: { expected, got } }`
 *   `{ ok: false, error }`
 */
async function handleProjectSongAudioRelink(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (!existsSync(projectPath)) {
      return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
    }
    const songFolder = validateRelSongFolder(body.songFolder)
    const defaultName = typeof body.defaultName === 'string' ? body.defaultName : null
    const expected = body.expected && typeof body.expected === 'object' ? body.expected : null
    const strict = body.strict === true

    focusSidecarApp()
    const dlg = await dialog.showOpenDialog({
      title: 'Locate audio file',
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'aif', 'aiff'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    if (dlg.canceled || !dlg.filePaths[0]) {
      return sendJson(res, 200, { ok: false, cancelled: true }, cors)
    }
    const src = dlg.filePaths[0]
    const srcInfo = statSync(src)
    if (!srcInfo.isFile()) {
      return sendJson(res, 400, { ok: false, error: 'Selected path is not a file' }, cors)
    }

    // Name the destination file. Prefer the explicit defaultName when provided
    // (so a re-relink keeps the SongMap's audio.fileName stable); otherwise
    // sanitize the picker's basename.
    const baseFromPicker = path.basename(src)
    const desiredRaw = (defaultName && defaultName.trim()) || baseFromPicker
    const desired = desiredRaw.replace(/[/\\ -]/g, '_').trim() || 'audio.bin'
    const relPath = `audio/${desired}`
    const destAbs = path.join(projectPath, songFolder, relPath)

    // Hash + identity BEFORE writing so we can refuse strict mismatches
    // without leaving a stray file behind.
    const bytes = await readFile(src)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    let info = null
    try { info = readAudioInfo(src) } catch { info = null }

    const expectedSha = typeof expected?.sha256 === 'string' && expected.sha256.length > 0
      ? expected.sha256
      : typeof expected?.originalSha256 === 'string' && expected.originalSha256.length > 0
        ? expected.originalSha256
        : null
    const shaMatches = expectedSha ? expectedSha === sha256 : null

    if (strict && expectedSha && !shaMatches) {
      return sendJson(res, 200, {
        ok: false,
        mismatch: {
          expected: { sha256: expectedSha },
          got: { sha256, fileSize: bytes.byteLength, durationSec: info?.durationSec },
        },
      }, cors)
    }

    await atomicWriteFile(destAbs, bytes)
    sendJson(res, 200, {
      ok: true,
      relPath,
      fileName: desired,
      sha256,
      size: bytes.byteLength,
      fileSize: bytes.byteLength,
      durationSec: info?.durationSec,
      sampleRate: info?.sampleRate,
      channels: info?.channels,
      // Tri-state: true if the sha matched expected, false if it didn't
      // (but strict was off so we wrote anyway), undefined if no expected
      // sha was provided. Lets the UI show a soft mismatch warning.
      identityMatched: shaMatches,
    }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 400, { ok: false, error: msg }, cors)
  }
}

/**
 * `POST /native/project/asset/write` — body `{ projectPath, subpath, contentBase64 }`.
 * Writes a single file at the PROJECT ROOT (e.g. `<projectName>.als`).
 * Validated like the song-level variant — no `..`, no leading `/`, no `\\`.
 * Intermediate directories are created.
 */
async function handleProjectAssetWrite(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (!existsSync(projectPath)) {
      return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
    }
    const subpath = validateAssetSubpath(body.subpath)
    if (typeof body.contentBase64 !== 'string') {
      return sendJson(res, 400, { ok: false, error: 'contentBase64 is required' }, cors)
    }
    const targetAbs = path.join(projectPath, subpath)
    const bytes = Buffer.from(body.contentBase64, 'base64')
    await atomicWriteFile(targetAbs, bytes)
    sendJson(res, 200, { ok: true }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 400, { ok: false, error: msg }, cors)
  }
}

/**
 * Read a WAV header and return `{ durationSec, sampleRate, channels }`.
 * Minimal parser — handles the standard RIFF/WAVE 'fmt '/'data' chunks.
 * Throws on unsupported / corrupt files.
 */
function parseWavHeader(filePath) {
  const fd = openSync(filePath, 'r')
  try {
    // First 12 bytes: RIFF<size>WAVE
    const head = Buffer.alloc(12)
    readSync(fd, head, 0, 12, 0)
    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error('Not a RIFF/WAVE file')
    }
    let cursor = 12
    let fmt = null
    let dataSize = null
    const chunkHeader = Buffer.alloc(8)
    while (true) {
      const got = readSync(fd, chunkHeader, 0, 8, cursor)
      if (got < 8) break
      const id = chunkHeader.toString('ascii', 0, 4)
      const size = chunkHeader.readUInt32LE(4)
      cursor += 8
      if (id === 'fmt ') {
        const fmtBuf = Buffer.alloc(size)
        readSync(fd, fmtBuf, 0, size, cursor)
        fmt = {
          format: fmtBuf.readUInt16LE(0),
          channels: fmtBuf.readUInt16LE(2),
          sampleRate: fmtBuf.readUInt32LE(4),
          byteRate: fmtBuf.readUInt32LE(8),
          blockAlign: fmtBuf.readUInt16LE(12),
          bitsPerSample: fmtBuf.readUInt16LE(14),
        }
      } else if (id === 'data') {
        dataSize = size
        break // duration only needs fmt + data size, stop here
      }
      cursor += size
      if (size % 2 === 1) cursor += 1 // RIFF chunk padding
    }
    if (!fmt) throw new Error('Missing fmt chunk')
    if (dataSize == null) throw new Error('Missing data chunk')
    const bytesPerSample = fmt.bitsPerSample / 8
    const totalSamples = dataSize / (bytesPerSample * fmt.channels)
    const durationSec = totalSamples / fmt.sampleRate
    return {
      durationSec,
      sampleRate: fmt.sampleRate,
      channels: fmt.channels,
      frames: totalSamples,
    }
  } finally {
    closeSync(fd)
  }
}

/**
 * Read an MP3 file's duration, sample rate, and channel count.
 *
 * Skips any ID3v2 tag at the start, then reads the first MPEG-1/2 frame
 * header to get sample rate + channel mode. If the first frame contains
 * a Xing / Info / VBRI VBR header, uses its total-frames field for an
 * accurate duration. Otherwise falls back to a CBR estimate:
 * `durationSec = (fileSize - id3Size) / (bitrate / 8)`.
 *
 * Demucs MP3 output is CBR at 320 kbps — handled by the fallback path.
 */
function parseMp3Duration(filePath) {
  const fileSize = statSync(filePath).size
  const fd = openSync(filePath, 'r')
  try {
    // -- Skip ID3v2 tag if present ---------------------------------------
    let cursor = 0
    const head = Buffer.alloc(10)
    readSync(fd, head, 0, 10, 0)
    if (head.toString('ascii', 0, 3) === 'ID3') {
      // Synchsafe int: 4 bytes, each holds 7 bits of size data.
      const sz = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f)
      cursor = 10 + sz
    }

    // -- Find the first MPEG sync word (0xFFFB / 0xFFFA / etc.) ----------
    const SCAN = 4096
    const scanBuf = Buffer.alloc(SCAN)
    let frameStart = -1
    const got = readSync(fd, scanBuf, 0, SCAN, cursor)
    for (let i = 0; i < got - 1; i++) {
      if (scanBuf[i] === 0xff && (scanBuf[i + 1] & 0xe0) === 0xe0) {
        frameStart = cursor + i
        break
      }
    }
    if (frameStart < 0) throw new Error('No MPEG audio frame sync found')

    // -- Parse the first frame's header ----------------------------------
    const hdrBuf = Buffer.alloc(4)
    readSync(fd, hdrBuf, 0, 4, frameStart)
    const b1 = hdrBuf[1], b2 = hdrBuf[2], b3 = hdrBuf[3]
    const versionBits = (b1 >> 3) & 0x03 // 00=MPEG2.5, 10=MPEG2, 11=MPEG1
    const layerBits = (b1 >> 1) & 0x03 // 01=Layer3, 10=Layer2, 11=Layer1
    const bitrateIndex = (b2 >> 4) & 0x0f
    const sampleRateIndex = (b2 >> 2) & 0x03
    const padding = (b2 >> 1) & 0x01
    const channelMode = (b3 >> 6) & 0x03

    if (layerBits !== 0x01) throw new Error('Only MPEG Layer III (MP3) supported')

    // Bitrate tables (kbps). Index 0 = free, 15 = invalid.
    const BITRATE_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1]
    const BITRATE_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1]
    const SAMPLE_RATES_MPEG1 = [44100, 48000, 32000, 0]
    const SAMPLE_RATES_MPEG2 = [22050, 24000, 16000, 0]
    const SAMPLE_RATES_MPEG25 = [11025, 12000, 8000, 0]

    const isMpeg1 = versionBits === 0x03
    const isMpeg2 = versionBits === 0x02
    const bitrate = (isMpeg1 ? BITRATE_MPEG1_L3 : BITRATE_MPEG2_L3)[bitrateIndex] * 1000
    if (!(bitrate > 0)) throw new Error('Invalid MP3 bitrate index')
    const sampleRate = (isMpeg1
      ? SAMPLE_RATES_MPEG1
      : isMpeg2
        ? SAMPLE_RATES_MPEG2
        : SAMPLE_RATES_MPEG25)[sampleRateIndex]
    if (!(sampleRate > 0)) throw new Error('Invalid MP3 sample rate index')
    const samplesPerFrame = isMpeg1 ? 1152 : 576
    const channels = channelMode === 0x03 ? 1 : 2 // 11=mono, others=stereo-ish

    // -- VBR header (Xing / Info / VBRI) ---------------------------------
    // For MPEG1 stereo, side-info starts at offset 36 from frame; for MPEG1
    // mono or MPEG2, offset 21. The VBR header tag sits right after that.
    const sideInfoOffset = isMpeg1 ? (channels === 1 ? 17 : 32) : (channels === 1 ? 9 : 17)
    const probe = Buffer.alloc(160)
    readSync(fd, probe, 0, 160, frameStart + 4 + sideInfoOffset)
    let totalFrames = 0
    for (let i = 0; i + 8 <= probe.length; i++) {
      const tag = probe.toString('ascii', i, i + 4)
      if (tag === 'Xing' || tag === 'Info') {
        const flags = probe.readUInt32BE(i + 4)
        if (flags & 0x01) {
          totalFrames = probe.readUInt32BE(i + 8)
        }
        break
      }
      if (tag === 'VBRI') {
        totalFrames = probe.readUInt32BE(i + 14)
        break
      }
    }

    let durationSec
    if (totalFrames > 0) {
      durationSec = (totalFrames * samplesPerFrame) / sampleRate
    } else {
      // CBR fallback — `bitrate` (bits/sec) lets us compute duration directly
      // from the audio-payload bytes.
      const audioBytes = fileSize - frameStart
      durationSec = audioBytes / (bitrate / 8)
    }

    return { durationSec, sampleRate, channels }
  } finally {
    closeSync(fd)
  }
}

/** Dispatch by file extension. Adds new formats here as needed. */
function readAudioInfo(filePath) {
  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  if (ext === 'wav') return parseWavHeader(filePath)
  if (ext === 'mp3') return parseMp3Duration(filePath)
  throw new Error(`Unsupported audio format: .${ext}`)
}

/**
 * `POST /native/project/wav-info/batch` — body
 *   `{ projectPath, files: [{ songFolder, subpath }, ...], withSha?: boolean }`.
 *
 * Returns
 *   `{ ok: true, items: [{ songFolder, subpath, durationSec, sampleRate, channels, fileSize, sha256? } | { songFolder, subpath, error }] }`.
 *
 * `withSha` opts into per-file SHA-256 computation. We don't do it by
 * default — hashing 50× WAVs at every project open is too slow. The
 * Phase 3 migration sweep and the Phase 5 reconciler request it
 * explicitly; the general `refreshProjectInfo` call does not.
 *
 * Despite the legacy "/wav-info/" path, handles MP3 as well — dispatch
 * by file extension. Per-file errors don't abort the batch.
 */
async function handleProjectWavInfoBatch(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (!existsSync(projectPath)) {
      return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
    }
    if (!Array.isArray(body.files)) {
      return sendJson(res, 400, { ok: false, error: 'files must be an array' }, cors)
    }
    const withSha = body.withSha === true
    const items = []
    for (const f of body.files) {
      const songFolder = f?.songFolder
      const subpath = f?.subpath
      try {
        validateRelSongFolder(songFolder)
        validateAssetSubpath(subpath)
        const abs = path.join(projectPath, songFolder, subpath)
        if (!existsSync(abs)) {
          items.push({ songFolder, subpath, error: 'File not found' })
          continue
        }
        const info = readAudioInfo(abs)
        const fileSize = statSync(abs).size
        const item = { songFolder, subpath, ...info, fileSize }
        if (withSha) {
          // Streamed hashing so we don't OOM on big WAVs (50 MB+ is
          // typical for a 5-minute uncompressed file).
          const hash = createHash('sha256')
          await new Promise((resolve, reject) => {
            const s = createReadStream(abs)
            s.on('data', (chunk) => hash.update(chunk))
            s.on('end', resolve)
            s.on('error', reject)
          })
          item.sha256 = hash.digest('hex')
        }
        items.push(item)
      } catch (e) {
        items.push({ songFolder, subpath, error: e instanceof Error ? e.message : String(e) })
      }
    }
    sendJson(res, 200, { ok: true, items }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 400, { ok: false, error: msg }, cors)
  }
}

// ── Audio identity scan (Phase 5 reconcile) ──────────────────────────────
//
// Cached identity probe over `<song>/audio/`. Returns one entry per
// audio file with its full identity bundle (duration, sample rate,
// channels, file size, sha256). The reconciler uses this to find a
// matching local file even when the path recorded in the SongMap
// doesn't resolve (file renamed, copied via a hydration pack, etc.).
//
// Hashing big WAVs at every project open would be painful, so cache
// by (absPath, mtime, size) in memory. We don't persist to disk —
// the cache rebuilds in O(seconds) on next launch which is fine.

/** @type {Map<string, { sha256: string; mtimeMs: number; size: number; durationSec: number; sampleRate: number; channels: number }>} */
const audioIdentityCache = new Map()

async function audioIdentityForFile(absPath) {
  const st = statSync(absPath)
  const cached = audioIdentityCache.get(absPath)
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return {
      sha256: cached.sha256,
      durationSec: cached.durationSec,
      sampleRate: cached.sampleRate,
      channels: cached.channels,
      fileSize: cached.size,
    }
  }
  const info = readAudioInfo(absPath)
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const s = createReadStream(absPath)
    s.on('data', (c) => hash.update(c))
    s.on('end', resolve)
    s.on('error', reject)
  })
  const sha256 = hash.digest('hex')
  audioIdentityCache.set(absPath, {
    sha256,
    mtimeMs: st.mtimeMs,
    size: st.size,
    durationSec: info.durationSec,
    sampleRate: info.sampleRate,
    channels: info.channels,
  })
  return {
    sha256,
    durationSec: info.durationSec,
    sampleRate: info.sampleRate,
    channels: info.channels,
    fileSize: st.size,
  }
}

const SCAN_AUDIO_EXTENSIONS = ['.wav', '.mp3', '.flac', '.m4a', '.ogg', '.aif', '.aiff']

/**
 * `POST /native/project/song/audio/scan` — body
 *   `{ projectPath, songFolder }`.
 *
 * Lists `<projectPath>/<songFolder>/audio/` and returns identity for
 * each audio file. Errors per file don't fail the batch. Used by the
 * Phase 5 reconciler to find files renamed-but-content-matching the
 * SongMap's `expectedAudio` / `audio` identity.
 */
async function handleProjectSongAudioScan(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (!existsSync(projectPath)) {
      return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
    }
    const songFolder = validateRelSongFolder(body.songFolder)
    const audioDir = path.join(projectPath, songFolder, 'audio')
    if (!existsSync(audioDir)) {
      return sendJson(res, 200, { ok: true, items: [] }, cors)
    }
    const entries = await readdir(audioDir, { withFileTypes: true })
    /** @type {Array<{ fileName: string; sha256?: string; durationSec?: number; sampleRate?: number; channels?: number; fileSize?: number; error?: string }>} */
    const items = []
    for (const ent of entries) {
      if (!ent.isFile()) continue
      const lower = ent.name.toLowerCase()
      if (!SCAN_AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue
      const abs = path.join(audioDir, ent.name)
      try {
        const id = await audioIdentityForFile(abs)
        items.push({ fileName: ent.name, ...id })
      } catch (e) {
        items.push({ fileName: ent.name, error: e instanceof Error ? e.message : String(e) })
      }
    }
    sendJson(res, 200, { ok: true, items }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 400, { ok: false, error: msg }, cors)
  }
}

/**
 * `POST /native/project/transcode-to-wav` — body
 * `{ projectPath, songFolder, srcSubpath, dstSubpath }`.
 *
 * Transcodes a compressed audio file (MP3, M4A, …) to 16-bit PCM WAV via
 * ffmpeg. Used by the Ableton setlist export to sidestep MP3 encoder
 * priming, which Ableton plays back as silence at the start of the clip
 * (~13 ms for LAME-encoded files) and which would offset stems vs. the
 * click track.
 *
 * Cache-aware: if `dstSubpath` already exists AND is newer than
 * `srcSubpath`, returns `{ ok: true, cached: true }` without re-running
 * ffmpeg. Otherwise transcodes and returns `{ ok: true, cached: false }`.
 */
async function handleProjectTranscodeToWav(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (!existsSync(projectPath)) {
      return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
    }
    const songFolder = validateRelSongFolder(body.songFolder)
    const srcSubpath = validateAssetSubpath(body.srcSubpath)
    const dstSubpath = validateAssetSubpath(body.dstSubpath)
    const srcAbs = path.join(projectPath, songFolder, srcSubpath)
    const dstAbs = path.join(projectPath, songFolder, dstSubpath)
    if (!existsSync(srcAbs)) {
      return sendJson(res, 404, { ok: false, error: `Source file not found: ${srcAbs}` }, cors)
    }
    // Cache: if dst is newer than src, skip.
    try {
      const srcStat = statSync(srcAbs)
      const dstStat = statSync(dstAbs)
      if (dstStat.mtimeMs >= srcStat.mtimeMs && dstStat.size > 0) {
        return sendJson(res, 200, { ok: true, cached: true }, cors)
      }
    } catch {
      /* dst doesn't exist — proceed to transcode */
    }
    // Spawn ffmpeg.
    const result = await runFfmpegTranscode(srcAbs, dstAbs)
    if (!result.ok) {
      return sendJson(res, 500, { ok: false, error: result.error }, cors)
    }
    sendJson(res, 200, { ok: true, cached: false }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 400, { ok: false, error: msg }, cors)
  }
}

/**
 * `POST /native/project/transcode-to-aac` — body
 * `{ projectPath, songFolder, srcSubpath, dstSubpath, bitrateKbps }`.
 *
 * Transcodes project audio (the mix WAV or a stem WAV) to AAC/m4a — the
 * compressed playback copy uploaded for browser-only ("cloud audio") members.
 * Cache-aware (skips when dst is newer than src). Returns the output byte size
 * for the cloud-audio manifest. This is the ONLY producer of the lossy copy;
 * the HD WAV master never leaves the creator's disk.
 */
async function handleProjectTranscodeToAac(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (!existsSync(projectPath)) {
      return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
    }
    const songFolder = validateRelSongFolder(body.songFolder)
    const srcSubpath = validateAssetSubpath(body.srcSubpath)
    const dstSubpath = validateAssetSubpath(body.dstSubpath)
    const bitrateKbps = Number.isFinite(body.bitrateKbps)
      ? Math.max(64, Math.min(320, Math.round(body.bitrateKbps)))
      : 128
    const srcAbs = path.join(projectPath, songFolder, srcSubpath)
    const dstAbs = path.join(projectPath, songFolder, dstSubpath)
    if (!existsSync(srcAbs)) {
      return sendJson(res, 404, { ok: false, error: `Source file not found: ${srcAbs}` }, cors)
    }
    // Cache: if dst is newer than src, skip re-encoding.
    try {
      const srcStat = statSync(srcAbs)
      const dstStat = statSync(dstAbs)
      if (dstStat.mtimeMs >= srcStat.mtimeMs && dstStat.size > 0) {
        return sendJson(res, 200, { ok: true, cached: true, bytes: dstStat.size }, cors)
      }
    } catch {
      /* dst doesn't exist — proceed to transcode */
    }
    // ffmpeg won't create the output directory (e.g. the new `cloud/` folder) —
    // make it first or ffmpeg exits 254 ("No such file or directory").
    mkdirSync(path.dirname(dstAbs), { recursive: true })
    const result = await runFfmpegToAac(srcAbs, dstAbs, bitrateKbps)
    if (!result.ok) {
      return sendJson(res, 500, { ok: false, error: result.error }, cors)
    }
    let bytes = 0
    try {
      bytes = statSync(dstAbs).size
    } catch {
      /* stat failed — report 0, upload still proceeds */
    }
    sendJson(res, 200, { ok: true, cached: false, bytes }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 400, { ok: false, error: msg }, cors)
  }
}

async function fileHashIdentity(absPath) {
  const st = statSync(absPath)
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const s = createReadStream(absPath)
    s.on('data', (chunk) => hash.update(chunk))
    s.on('end', resolve)
    s.on('error', reject)
  })
  return {
    sha256: hash.digest('hex'),
    fileSize: st.size,
  }
}

function runProcessCapture(exe, args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(exe, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      resolve({ code: null, signal: 'SIGKILL', stdout, stderr, timedOut: true })
    }, timeoutMs)
    child.stdout?.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr?.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: null, signal: null, stdout, stderr, error: err, timedOut: false })
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, signal: signal ?? null, stdout, stderr, timedOut: false })
    })
  })
}

async function resolveRubberBandExecutable() {
  const exe = rubberBandExePath()
  const expected = expectedRubberBandBundledPath()
  if (!exe) {
    return {
      ok: false,
      error: `Rubber Band is not supported on ${process.platform}-${process.arch}.`,
      expectedPath: expected,
    }
  }
  if (path.isAbsolute(exe) && !existsSync(exe)) {
    return {
      ok: false,
      error: `Rubber Band binary not found at ${exe}. Install the licensed CLI at desktop/native/bin/rubberband/<platform>/ or set BARBRO_RUBBERBAND.`,
      path: exe,
      expectedPath: expected,
    }
  }
  if (path.isAbsolute(exe) && process.platform !== 'win32') {
    await chmod(exe, 0o755).catch(() => {})
  }

  const probe = await runProcessCapture(exe, ['--version'], 8_000)
  if (probe.error) {
    const missingLocalCli =
      exe === 'rubberband' && /** @type {{ code?: string }} */ (probe.error).code === 'ENOENT'
    return {
      ok: false,
      error: missingLocalCli
        ? 'Rubber Band CLI not found. Install a licensed binary under desktop/native/bin/rubberband/<platform>/, set BARBRO_RUBBERBAND, or add rubberband to PATH for local development.'
        : `Rubber Band failed to start: ${probe.error.message}`,
      path: exe,
      expectedPath: expected,
    }
  }
  if (probe.timedOut) {
    return {
      ok: false,
      error: 'Rubber Band version check timed out.',
      path: exe,
      expectedPath: expected,
    }
  }
  if (probe.code !== 0) {
    return {
      ok: false,
      error: `Rubber Band version check failed: ${(probe.stderr || probe.stdout || `exit ${probe.code}`).trim()}`,
      path: exe,
      expectedPath: expected,
    }
  }
  return {
    ok: true,
    path: exe,
    version: (probe.stdout || probe.stderr).trim().split(/\r?\n/)[0] ?? '',
  }
}

async function handleTransposeStatus(res, cors) {
  try {
    const rb = await resolveRubberBandExecutable()
    if (!rb.ok) {
      sendJson(res, 200, {
        ok: true,
        available: false,
        engine: 'rubberband',
        algo: RUBBERBAND_TRANSPOSE_ALGO_VERSION,
        error: rb.error,
        path: rb.path ?? null,
        expectedPath: rb.expectedPath ?? null,
      }, cors)
      return
    }
    sendJson(res, 200, {
      ok: true,
      available: true,
      engine: 'rubberband',
      algo: RUBBERBAND_TRANSPOSE_ALGO_VERSION,
      path: rb.path,
      version: rb.version,
    }, cors)
  } catch (e) {
    sendJson(res, 200, {
      ok: true,
      available: false,
      engine: 'rubberband',
      algo: RUBBERBAND_TRANSPOSE_ALGO_VERSION,
      error: e instanceof Error ? e.message : String(e),
    }, cors)
  }
}

async function normalizeTransposeInputToWav(srcAbs, tempRoot) {
  const inputWav = path.join(tempRoot, 'transpose-input.wav')
  const result = await runFfmpegTranscode(srcAbs, inputWav)
  if (!result.ok) {
    throw new Error(`Could not prepare transposed audio: ${result.error}`)
  }
  return {
    inputAbs: inputWav,
    sourceInfo: readAudioInfo(inputWav),
  }
}

async function runRubberBandPitchShift(exe, inputAbs, outputAbs, semitones) {
  const tmpOut = path.join(path.dirname(outputAbs), `.${path.basename(outputAbs)}.${randomUUID()}.tmp.wav`)
  await rm(tmpOut, { force: true }).catch(() => {})
  const args = buildRubberBandArgs(inputAbs, tmpOut, semitones)
  const result = await runProcessCapture(exe, args, RUBBERBAND_RENDER_TIMEOUT_MS)
  if (result.error) {
    await rm(tmpOut, { force: true }).catch(() => {})
    return { ok: false, error: `Rubber Band failed to start: ${result.error.message}` }
  }
  if (result.timedOut) {
    await rm(tmpOut, { force: true }).catch(() => {})
    return { ok: false, error: 'Rubber Band timed out while preparing transposed audio.' }
  }
  if (result.code !== 0) {
    await rm(tmpOut, { force: true }).catch(() => {})
    const sigPart = result.signal ? ` (signal ${result.signal})` : ''
    const msg = (result.stderr || result.stdout || `exit ${result.code}${sigPart}`).trim()
    return { ok: false, error: msg }
  }
  if (!existsSync(tmpOut) || statSync(tmpOut).size <= 44) {
    await rm(tmpOut, { force: true }).catch(() => {})
    return { ok: false, error: 'Rubber Band did not produce a valid WAV file.' }
  }
  await rename(tmpOut, outputAbs)
  return { ok: true }
}

function runFfmpegPadTrim(srcAbs, dstAbs, durationSec, sampleRate) {
  return new Promise((resolve) => {
    const targetDuration = Number(durationSec)
    if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
      resolve({ ok: false, error: 'Invalid target duration for transpose cache alignment.' })
      return
    }
    const args = [
      '-y',
      '-i',
      srcAbs,
      '-af',
      `apad,atrim=0:${targetDuration.toFixed(6)}`,
      '-acodec',
      'pcm_s16le',
    ]
    const sr = Number(sampleRate)
    if (Number.isFinite(sr) && sr > 0) args.push('-ar', String(Math.round(sr)))
    args.push(dstAbs)
    const proc = spawn(ffmpegExePath(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (b) => {
      stderr += b.toString()
    })
    proc.on('error', (e) => {
      resolve({ ok: false, error: `ffmpeg failed to start: ${e.message}. Is ffmpeg on PATH?` })
    })
    proc.on('close', (code) => {
      if (code === 0) resolve({ ok: true })
      else resolve({ ok: false, error: `ffmpeg exited ${code}: ${stderr.slice(-2000)}` })
    })
  })
}

async function verifyTransposeCacheDuration(sourceInfo, outputAbs, { repair = false } = {}) {
  if (!existsSync(outputAbs) || statSync(outputAbs).size <= 44) {
    return { ok: false, error: 'cache file is missing or empty' }
  }
  let outputInfo
  try {
    outputInfo = readAudioInfo(outputAbs)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  let alignment
  try {
    alignment = classifyDurationAlignment(sourceInfo, outputInfo)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (alignment.ok && !alignment.needsPadTrim) {
    return { ok: true, info: outputInfo, repaired: false, alignment }
  }
  if (alignment.ok && alignment.needsPadTrim && repair) {
    const tmpFixed = path.join(path.dirname(outputAbs), `.${path.basename(outputAbs)}.${randomUUID()}.aligned.wav`)
    const fix = await runFfmpegPadTrim(outputAbs, tmpFixed, sourceInfo.durationSec, outputInfo.sampleRate)
    if (!fix.ok) {
      await rm(tmpFixed, { force: true }).catch(() => {})
      return { ok: false, error: `Could not align transpose cache duration: ${fix.error}` }
    }
    await rename(tmpFixed, outputAbs)
    const fixedInfo = readAudioInfo(outputAbs)
    const fixedAlignment = classifyDurationAlignment(sourceInfo, fixedInfo)
    if (!fixedAlignment.ok) {
      return {
        ok: false,
        error: `Transpose cache duration drift remains too large (${fixedAlignment.driftSec.toFixed(4)}s).`,
      }
    }
    return { ok: true, info: fixedInfo, repaired: true, alignment: fixedAlignment }
  }
  const drift = alignment.driftSec
  return {
    ok: false,
    error: `Transpose cache duration drift is too large (${drift.toFixed(4)}s).`,
  }
}

/**
 * `POST /native/project/pitch-shift-cache` — body
 * `{ projectPath, songFolder, srcSubpath, semitones }`.
 *
 * Writes a local, disposable, tempo-preserved WAV cache under
 * `cache/transpose/rubberband-r3-v1/<source-sha-size>/<signed-semitones>.wav`. The source
 * audio/stem is never modified, and repeated requests hit the cache.
 */
async function handleProjectPitchShiftCache(req, res, cors) {
  let tempRoot = null
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (!existsSync(projectPath)) {
      return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
    }
    const songFolder = validateRelSongFolder(body.songFolder)
    const srcSubpath = validateAssetSubpath(body.srcSubpath)
    const semitones = normalizeTransposeSemitones(body.semitones, { allowZero: true })
    const srcAbs = path.join(projectPath, songFolder, srcSubpath)
    if (!existsSync(srcAbs)) {
      return sendJson(res, 404, { ok: false, error: `Source file not found: ${srcAbs}` }, cors)
    }
    if (semitones === 0) {
      return sendJson(res, 200, {
        ok: true,
        cached: true,
        bypassed: true,
        relPath: srcSubpath,
        engine: 'original',
        algo: 'none',
      }, cors)
    }

    const rb = await resolveRubberBandExecutable()
    if (!rb.ok) {
      return sendJson(res, 503, { ok: false, error: rb.error }, cors)
    }

    const sourceIdentity = await fileHashIdentity(srcAbs)
    let sourceInfo = null
    let renderInputAbs = srcAbs
    let normalizedInput = false
    try {
      sourceInfo = readAudioInfo(srcAbs)
    } catch {
      tempRoot = await mkdtemp(path.join(tmpdir(), 'barbro-transpose-'))
      const prepared = await normalizeTransposeInputToWav(srcAbs, tempRoot)
      sourceInfo = prepared.sourceInfo
      renderInputAbs = prepared.inputAbs
      normalizedInput = true
    }

    const dstSubpath = validateAssetSubpath(transposeCacheSubpath(sourceIdentity, semitones), 'cache subpath')
    const dstAbs = path.join(projectPath, songFolder, dstSubpath)
    if (existsSync(dstAbs) && statSync(dstAbs).size > 0) {
      const healthy = await verifyTransposeCacheDuration(sourceInfo, dstAbs, { repair: true })
      if (healthy.ok) {
        return sendJson(res, 200, {
          ok: true,
          cached: true,
          relPath: dstSubpath,
          engine: 'rubberband',
          algo: RUBBERBAND_TRANSPOSE_ALGO_VERSION,
          sampleRate: healthy.info.sampleRate,
          durationSec: healthy.info.durationSec,
          frames: healthy.info.frames,
          repaired: healthy.repaired,
        }, cors)
      }
      logWarn(`pitch-shift-cache: rejecting stale/bad cache ${dstSubpath}: ${healthy.error}`)
      await rm(dstAbs, { force: true }).catch(() => {})
    }

    await mkdir(path.dirname(dstAbs), { recursive: true })
    let rendered = await runRubberBandPitchShift(rb.path, renderInputAbs, dstAbs, semitones)
    if (!rendered.ok && !normalizedInput) {
      logWarn(`pitch-shift-cache: Rubber Band failed on source, retrying normalized WAV: ${rendered.error.slice(0, 500)}`)
      if (!tempRoot) tempRoot = await mkdtemp(path.join(tmpdir(), 'barbro-transpose-'))
      const prepared = await normalizeTransposeInputToWav(srcAbs, tempRoot)
      sourceInfo = prepared.sourceInfo
      renderInputAbs = prepared.inputAbs
      normalizedInput = true
      rendered = await runRubberBandPitchShift(rb.path, renderInputAbs, dstAbs, semitones)
    }
    if (!rendered.ok) {
      logWarn(`pitch-shift-cache: Rubber Band failed: ${rendered.error.slice(0, 2000)}`)
      return sendJson(res, 503, {
        ok: false,
        error: `Could not prepare transposed audio: ${rendered.error}`,
      }, cors)
    }

    const healthy = await verifyTransposeCacheDuration(sourceInfo, dstAbs, { repair: true })
    if (!healthy.ok) {
      await rm(dstAbs, { force: true }).catch(() => {})
      return sendJson(res, 503, { ok: false, error: `Could not prepare transposed audio: ${healthy.error}` }, cors)
    }

    sendJson(res, 200, {
      ok: true,
      cached: false,
      relPath: dstSubpath,
      engine: 'rubberband',
      algo: RUBBERBAND_TRANSPOSE_ALGO_VERSION,
      sampleRate: healthy.info.sampleRate,
      durationSec: healthy.info.durationSec,
      frames: healthy.info.frames,
      repaired: healthy.repaired,
      normalizedInput,
    }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 400, { ok: false, error: msg }, cors)
  } finally {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
}

/** Run `ffmpeg -y -i SRC -acodec pcm_s16le -ar 44100 DST`. ffmpeg must be on PATH. */
function runFfmpegTranscode(srcAbs, dstAbs) {
  return new Promise((resolve) => {
    const args = ['-y', '-i', srcAbs, '-acodec', 'pcm_s16le', '-ar', '44100', dstAbs]
    const proc = spawn(ffmpegExePath(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (b) => {
      stderr += b.toString()
    })
    proc.on('error', (e) => {
      resolve({ ok: false, error: `ffmpeg failed to start: ${e.message}. Is ffmpeg on PATH?` })
    })
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true })
      } else {
        resolve({
          ok: false,
          error: `ffmpeg exited ${code}: ${stderr.slice(-2000)}`,
        })
      }
    })
  })
}

/**
 * Run `ffmpeg -y -i SRC -map 0:a:0 -vn -c:a aac -b:a {bitrate}k -movflags +faststart DST`.
 * Produces the compressed AAC/m4a playback copy for browser-only cloud audio.
 * `-map 0:a:0 -vn` takes ONLY the first audio stream and drops any embedded
 * cover art / video — otherwise ffmpeg re-encodes the attached picture to h264
 * and the `.m4a` (ipod) container rejects it (exit 234). `+faststart` moves the
 * moov atom to the front so it streams/decodes without the whole file. ffmpeg
 * must be on PATH.
 */
function runFfmpegToAac(srcAbs, dstAbs, bitrateKbps) {
  return new Promise((resolve) => {
    const args = ['-y', '-i', srcAbs, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', `${bitrateKbps}k`, '-movflags', '+faststart', dstAbs]
    const proc = spawn(ffmpegExePath(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (b) => {
      stderr += b.toString()
    })
    proc.on('error', (e) => {
      resolve({ ok: false, error: `ffmpeg failed to start: ${e.message}. Is ffmpeg on PATH?` })
    })
    proc.on('close', (code) => {
      if (code === 0) resolve({ ok: true })
      else resolve({ ok: false, error: `ffmpeg exited ${code}: ${stderr.slice(-2000)}` })
    })
  })
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
/**
 * Bring the headless sidecar app to focus so the next OS dialog appears
 * on top instead of behind the user's browser.
 */
function focusSidecarApp() {
  try {
    if (process.platform === 'darwin' && app.dock && !app.dock.isVisible()) {
      app.dock.show().catch(() => {})
    }
  } catch {
    /* ignore */
  }
  try {
    app.focus({ steal: true })
  } catch {
    /* older Electron — no steal option */
  }
}

async function handlePickFolder(req, res, cors) {
  logInfo('pick-folder: request received')
  const body = await readRequestJson(req)
  const title = typeof body?.title === 'string' ? body.title : 'Select folder'
  const defaultPath = typeof body?.defaultPath === 'string' ? body.defaultPath : undefined
  try {
    focusSidecarApp()
    logInfo('pick-folder: showing dialog')
    const r = await dialog.showOpenDialog({
      title,
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    })
    logInfo(`pick-folder: dialog returned canceled=${r.canceled} paths=${r.filePaths.length}`)
    if (r.canceled || !r.filePaths[0]) {
      sendJson(res, 200, { ok: false, cancelled: true }, cors)
      return
    }
    sendJson(res, 200, { ok: true, path: r.filePaths[0] }, cors)
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e)
    logError(`pick-folder: dialog threw: ${msg}`)
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
  }
}

// ── Save / Open file dialogs ──────────────────────────────────────────────
//
// Hydration export needs a "save as…" dialog; import needs a file-open
// dialog. Both wrap Electron's `dialog.show*` calls in the same shape as
// `pick-folder` so the web app calls them the same way.

/**
 * `POST /native/pick-save-file` — body `{ title?, defaultPath?, filters? }`.
 * Returns `{ ok: true, path } | { ok: false, cancelled: true } | { ok: false, error }`.
 */
async function handlePickSaveFile(req, res, cors) {
  const body = await readRequestJson(req)
  const title = typeof body?.title === 'string' ? body.title : 'Save file'
  const defaultPath = typeof body?.defaultPath === 'string' ? body.defaultPath : undefined
  const filters = Array.isArray(body?.filters) ? body.filters : undefined
  try {
    focusSidecarApp()
    const r = await dialog.showSaveDialog({ title, defaultPath, filters })
    if (r.canceled || !r.filePath) {
      sendJson(res, 200, { ok: false, cancelled: true }, cors)
      return
    }
    sendJson(res, 200, { ok: true, path: r.filePath }, cors)
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
  }
}

/**
 * `POST /native/pick-open-file` — body `{ title?, defaultPath?, filters? }`.
 * Returns `{ ok: true, path } | { ok: false, cancelled: true } | { ok: false, error }`.
 */
async function handlePickOpenFile(req, res, cors) {
  const body = await readRequestJson(req)
  const title = typeof body?.title === 'string' ? body.title : 'Open file'
  const defaultPath = typeof body?.defaultPath === 'string' ? body.defaultPath : undefined
  const filters = Array.isArray(body?.filters) ? body.filters : undefined
  try {
    focusSidecarApp()
    const r = await dialog.showOpenDialog({
      title,
      defaultPath,
      filters,
      properties: ['openFile'],
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

// ── Hydration packs ─────────────────────────────────────────────────────
//
// A hydration pack is a zip file containing per-song audio assets
// (originals + stems) so a project owner can hand-deliver heavy assets
// to a collaborator whose project structure already exists (typically
// via cloud sync, but not required — matching falls back to audio
// identity hashes when ids don't line up).
//
// Layout:
//   hydration-manifest.json
//   songs/<songId>/audio/<fileName>
//   songs/<songId>/stems/<preset>/<stemFileName>
//
// On import: only files that don't already exist on disk get written.
// The receiver's stem-quality picker (`listStemSets` → web-side
// preset-priority) then chooses the best variant from the union of
// their own and the pack's contributions. Never destructive.

const HYDRATION_FORMAT_VERSION = 1
const HYDRATION_MANIFEST_FILENAME = 'hydration-manifest.json'

/**
 * Read one song's smap to gather everything we need for a hydration
 * pack entry. Returns null if the smap is unreadable or the audio file
 * referenced by it doesn't exist on disk — we silently skip those
 * songs (the project list view already surfaces them as "audio
 * missing"; no point putting unresolvable entries into a pack).
 */
async function buildHydrationEntryForSong(projectPath, songEntry) {
  const songFolderAbs = path.join(projectPath, songEntry.folder)
  const smapPath = path.join(songFolderAbs, SONG_SMAP_FILENAME)
  const songProject = existsSync(smapPath) ? await readSmapHeaderJson(smapPath) : null
  const songMap = songProject?.songMap
  if (!songMap || typeof songMap !== 'object') return null
  const audio = songMap.audio
  if (!audio || typeof audio !== 'object') return null

  const audioFileName = typeof audio.fileName === 'string' ? audio.fileName : null
  if (!audioFileName) return null

  // Audio file lives at `<song>/audio/<fileName>`. Some legacy songs
  // also have `audio.originalPath` pointing elsewhere on disk — for a
  // hydration pack we only ship the canonical `<song>/audio/` copy.
  const audioAbs = path.join(songFolderAbs, 'audio', audioFileName)
  if (!existsSync(audioAbs)) return null

  const stemSets = await listStemSets(songFolderAbs)
  /** @type {{ preset: string; fileName: string; absPath: string }[]} */
  const stemEntries = []
  for (const [preset, files] of Object.entries(stemSets)) {
    for (const fileName of files) {
      const absPath = preset === 'legacy'
        ? path.join(songFolderAbs, 'stems', fileName)
        : path.join(songFolderAbs, 'stems', preset, fileName)
      if (existsSync(absPath)) stemEntries.push({ preset, fileName, absPath })
    }
  }

  return {
    songId: songEntry.id,
    songFolderAbs,
    title: typeof songMap.metadata?.title === 'string' ? songMap.metadata.title : '',
    audio: {
      fileName: audioFileName,
      absPath: audioAbs,
      // The smap stores sha256 / originalSha256 already; copy them
      // through so the receiver can identity-match without rehashing.
      // If the smap is missing them (older songs), we leave the field
      // out — receiver will fall back to id-only matching.
      sha256: typeof audio.sha256 === 'string' ? audio.sha256 : null,
      originalSha256: typeof audio.originalSha256 === 'string' ? audio.originalSha256 : null,
      durationSec: typeof audio.durationSec === 'number' ? audio.durationSec : null,
      sampleRate: typeof audio.sampleRate === 'number' ? audio.sampleRate : null,
      channels: typeof audio.channels === 'number' ? audio.channels : null,
      fileSize: typeof audio.fileSize === 'number' ? audio.fileSize : null,
      mimeType: typeof audio.mimeType === 'string' ? audio.mimeType : null,
    },
    stems: stemEntries,
  }
}

/**
 * `POST /native/project/hydration/export` — body
 * `{ projectPath, outPath, songIds? }`. Writes a zip to `outPath`
 * containing audio + stems for the requested songs (or all songs if
 * `songIds` is absent). Returns a summary.
 */
async function handleHydrationExport(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath : ''
    const outPath = typeof body.outPath === 'string' ? body.outPath : ''
    const songIdFilter = Array.isArray(body.songIds) ? new Set(body.songIds) : null
    if (!projectPath || !outPath) {
      return sendJson(res, 400, { ok: false, error: 'projectPath and outPath are required' }, cors)
    }
    if (!existsSync(projectPath)) {
      return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
    }

    const projectManifest = await readProjectManifest(projectPath)
    const songsToExport = songIdFilter
      ? projectManifest.songs.filter((s) => songIdFilter.has(s.id))
      : projectManifest.songs

    // Build pack entries (skips songs whose audio file isn't on disk).
    const entries = []
    for (const songEntry of songsToExport) {
      const entry = await buildHydrationEntryForSong(projectPath, songEntry)
      if (entry) entries.push(entry)
    }

    if (entries.length === 0) {
      return sendJson(res, 400, {
        ok: false,
        error: 'No songs in this project have audio on disk to export.',
      }, cors)
    }

    const manifest = {
      formatVersion: HYDRATION_FORMAT_VERSION,
      kind: 'barbro-hydration-pack',
      createdAt: new Date().toISOString(),
      sourceProjectId: projectManifest.id,
      sourceProjectName: projectManifest.name,
      songs: entries.map((e) => ({
        songId: e.songId,
        title: e.title,
        audio: {
          fileName: e.audio.fileName,
          sha256: e.audio.sha256,
          originalSha256: e.audio.originalSha256,
          durationSec: e.audio.durationSec,
          sampleRate: e.audio.sampleRate,
          channels: e.audio.channels,
          fileSize: e.audio.fileSize,
          mimeType: e.audio.mimeType,
        },
        stems: e.stems.map((s) => ({
          preset: s.preset,
          fileName: s.fileName,
        })),
      })),
    }

    // Stream to disk. Audio is already compressed — use store-only
    // (level 0) so we don't burn CPU re-deflating MP3/WAV.
    const output = createWriteStream(outPath)
    const archive = archiver('zip', { zlib: { level: 0 } })
    /** @type {Promise<void>} */
    const done = new Promise((resolve, reject) => {
      output.on('close', () => resolve())
      output.on('error', reject)
      archive.on('error', reject)
      archive.on('warning', (e) => {
        if (e.code !== 'ENOENT') reject(e)
      })
    })
    archive.pipe(output)

    archive.append(JSON.stringify(manifest, null, 2), { name: HYDRATION_MANIFEST_FILENAME })
    for (const e of entries) {
      archive.file(e.audio.absPath, { name: `songs/${e.songId}/audio/${e.audio.fileName}` })
      for (const s of e.stems) {
        archive.file(s.absPath, { name: `songs/${e.songId}/stems/${s.preset}/${s.fileName}` })
      }
    }
    await archive.finalize()
    await done

    const packSize = (await stat(outPath)).size
    const totalStems = entries.reduce((sum, e) => sum + e.stems.length, 0)
    logInfo(`hydration export: ${entries.length} song(s), ${totalStems} stem file(s) → ${outPath} (${(packSize / 1_048_576).toFixed(1)} MB)`)
    sendJson(res, 200, {
      ok: true,
      outPath,
      packSize,
      songCount: entries.length,
      audioCount: entries.length,
      stemCount: totalStems,
    }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError(`hydration export: ${msg}`)
    sendJson(res, 500, { ok: false, error: msg }, cors)
  }
}

/**
 * Resolve the receiver-side song that matches a pack entry. Priority:
 *  1. Same `ProjectSongEntry.id` (cloud-collab case).
 *  2. Same audio `sha256` or `originalSha256` (content match).
 * The audio-identity fallback handles the case where two projects
 * were built independently but happen to reference the same masters.
 *
 * @returns {string | null} — the matched receiver song's `folder`, or null.
 */
function findReceiverMatch(packSong, receiverIndex) {
  // Try id first.
  if (receiverIndex.byId.has(packSong.songId)) {
    return receiverIndex.byId.get(packSong.songId)
  }
  const packShas = new Set(
    [packSong.audio?.sha256, packSong.audio?.originalSha256].filter(
      (s) => typeof s === 'string' && s.length > 0,
    ),
  )
  if (packShas.size === 0) return null
  for (const [sha, folder] of receiverIndex.byAudioSha) {
    if (packShas.has(sha)) return folder
  }
  return null
}

/**
 * Build a lookup index of the receiver project's songs so we don't
 * re-read smaps once per pack entry. `byAudioSha` includes both
 * `sha256` and `originalSha256` for each song that has them set.
 */
async function buildReceiverIndex(projectPath, projectManifest) {
  /** @type {Map<string, string>} id → folder */
  const byId = new Map()
  /** @type {Map<string, string>} sha → folder */
  const byAudioSha = new Map()
  for (const s of projectManifest.songs) {
    byId.set(s.id, s.folder)
    const smapPath = path.join(projectPath, s.folder, SONG_SMAP_FILENAME)
    if (!existsSync(smapPath)) continue
    const songProject = await readSmapHeaderJson(smapPath)
    const audio = songProject?.songMap?.audio
    if (!audio) continue
    if (typeof audio.sha256 === 'string' && audio.sha256) byAudioSha.set(audio.sha256, s.folder)
    if (typeof audio.originalSha256 === 'string' && audio.originalSha256) byAudioSha.set(audio.originalSha256, s.folder)
  }
  return { byId, byAudioSha }
}

/**
 * Read just `hydration-manifest.json` from a zip without decompressing
 * the heavy entries. Returns the parsed manifest plus the open yauzl
 * `zipFile` so callers can keep streaming entries from it.
 */
function openHydrationPack(packPath) {
  return new Promise((resolve, reject) => {
    // autoClose:false is REQUIRED — we read every entry to 'end' first, then
    // stream them for extraction later in the import handler. With yauzl's
    // default autoClose:true the zip closes as soon as the last entry is read,
    // so the subsequent openReadStream calls throw "closed" and nothing
    // extracts. The caller closes the zip explicitly when done.
    yauzl.open(packPath, { lazyEntries: true, autoClose: false }, (err, zipFile) => {
      if (err || !zipFile) {
        reject(err ?? new Error('Could not open hydration pack'))
        return
      }
      /** @type {Array<{ entry: yauzl.Entry }>} */
      const entries = []
      let manifestEntry = null
      zipFile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipFile.readEntry()
          return
        }
        if (entry.fileName === HYDRATION_MANIFEST_FILENAME) {
          manifestEntry = entry
        }
        entries.push({ entry })
        zipFile.readEntry()
      })
      zipFile.on('end', async () => {
        if (!manifestEntry) {
          zipFile.close()
          reject(new Error(`Pack is missing ${HYDRATION_MANIFEST_FILENAME}`))
          return
        }
        // Read manifest now.
        try {
          const manifest = await readZipEntryAsJson(zipFile, manifestEntry)
          resolve({ zipFile, manifest, entries: entries.map((e) => e.entry) })
        } catch (e) {
          zipFile.close()
          reject(e)
        }
      })
      zipFile.on('error', reject)
      zipFile.readEntry()
    })
  })
}

function readZipEntryAsJson(zipFile, entry) {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error('No read stream'))
        return
      }
      /** @type {Buffer[]} */
      const chunks = []
      stream.on('data', (c) => chunks.push(c))
      stream.on('error', reject)
      stream.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')))
        } catch (e) {
          reject(e)
        }
      })
    })
  })
}

function extractZipEntryToFile(zipFile, entry, targetAbs) {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, async (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error('No read stream'))
        return
      }
      try {
        await mkdir(path.dirname(targetAbs), { recursive: true })
        const out = createWriteStream(targetAbs)
        stream.pipe(out)
        out.on('finish', () => resolve())
        out.on('error', reject)
        stream.on('error', reject)
      } catch (e) {
        reject(e)
      }
    })
  })
}

/**
 * `POST /native/project/hydration/import` — body
 * `{ projectPath, packPath }`. Extracts the pack into the project,
 * skipping any file that already exists. Returns a per-song summary.
 */
async function handleHydrationImport(req, res, cors) {
  /** @type {{ zipFile?: import('yauzl').ZipFile }} */
  const scope = {}
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath : ''
    const packPath = typeof body.packPath === 'string' ? body.packPath : ''
    if (!projectPath || !packPath) {
      return sendJson(res, 400, { ok: false, error: 'projectPath and packPath are required' }, cors)
    }
    if (!existsSync(projectPath)) {
      return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
    }
    if (!existsSync(packPath)) {
      return sendJson(res, 404, { ok: false, error: `packPath not found: ${packPath}` }, cors)
    }

    const projectManifest = await readProjectManifest(projectPath)
    const receiverIndex = await buildReceiverIndex(projectPath, projectManifest)

    const { zipFile, manifest, entries } = await openHydrationPack(packPath)
    scope.zipFile = zipFile
    if (manifest?.kind !== 'barbro-hydration-pack') {
      throw new Error('Not a BarBro hydration pack')
    }
    if (manifest.formatVersion !== HYDRATION_FORMAT_VERSION) {
      throw new Error(
        `Unsupported hydration pack version: ${manifest.formatVersion} (expected ${HYDRATION_FORMAT_VERSION})`,
      )
    }

    /** @type {Array<{ songId: string; title: string; matched: boolean; receiverFolder: string | null; audioImported: boolean; audioSkipped: boolean; stemsImported: number; stemsSkipped: number; notes?: string }>} */
    const results = []

    // Group zip entries by songId for fast lookup.
    /** @type {Map<string, yauzl.Entry[]>} */
    const entriesBySongId = new Map()
    for (const entry of entries) {
      const m = entry.fileName.match(/^songs\/([^/]+)\//)
      if (!m) continue
      const list = entriesBySongId.get(m[1]) ?? []
      list.push(entry)
      entriesBySongId.set(m[1], list)
    }

    for (const packSong of manifest.songs ?? []) {
      const songId = typeof packSong.songId === 'string' ? packSong.songId : null
      if (!songId) continue
      const receiverFolder = findReceiverMatch(packSong, receiverIndex)
      const result = {
        songId,
        title: typeof packSong.title === 'string' ? packSong.title : '',
        matched: receiverFolder !== null,
        receiverFolder,
        audioImported: false,
        audioSkipped: false,
        stemsImported: 0,
        stemsSkipped: 0,
      }
      if (!receiverFolder) {
        result.notes = 'no matching song in this project'
        results.push(result)
        continue
      }

      const receiverFolderAbs = path.join(projectPath, receiverFolder)
      const songEntries = entriesBySongId.get(songId) ?? []
      for (const entry of songEntries) {
        // Strip `songs/<songId>/` prefix to get the path inside the song folder.
        const rel = entry.fileName.replace(/^songs\/[^/]+\//, '')
        if (!rel || rel === HYDRATION_MANIFEST_FILENAME) continue
        const targetAbs = path.join(receiverFolderAbs, rel)

        // Defence in depth: reject path-escape attempts.
        if (!targetAbs.startsWith(receiverFolderAbs + path.sep)) continue

        if (existsSync(targetAbs)) {
          if (rel.startsWith('audio/')) result.audioSkipped = true
          else if (rel.startsWith('stems/')) result.stemsSkipped++
          continue
        }

        await extractZipEntryToFile(zipFile, entry, targetAbs)
        if (rel.startsWith('audio/')) result.audioImported = true
        else if (rel.startsWith('stems/')) result.stemsImported++
      }
      results.push(result)
    }

    zipFile.close()
    scope.zipFile = undefined

    const matchedCount = results.filter((r) => r.matched).length
    const audioWritten = results.filter((r) => r.audioImported).length
    const stemsWritten = results.reduce((s, r) => s + r.stemsImported, 0)
    logInfo(`hydration import: matched ${matchedCount}/${results.length} song(s), wrote ${audioWritten} audio file(s) + ${stemsWritten} stem(s)`)
    sendJson(res, 200, {
      ok: true,
      results,
      summary: {
        packSongCount: results.length,
        matchedCount,
        unmatchedCount: results.length - matchedCount,
        audioImported: audioWritten,
        stemsImported: stemsWritten,
      },
    }, cors)
  } catch (e) {
    try { scope.zipFile?.close() } catch { /* ignore */ }
    const msg = e instanceof Error ? e.message : String(e)
    logError(`hydration import: ${msg}`)
    sendJson(res, 500, { ok: false, error: msg }, cors)
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
 * `POST /native/suggest-section-borders` — lightweight section-border
 * suggester. Request body is raw WAV bytes (same pattern as
 * /native/analyze-downbeats). Bar timing data is supplied via the
 * `X-Bars-Json` header — URL-encoded JSON of shape
 * `{ "bars": [{ "startSec": number }, ...] }`.
 *
 * Response: `{ ok: true, data: { borders: [{ bar, confidence }] } }`.
 *
 * librosa lives in the beats venv, so the same `BARBRO_PYTHON` interpreter
 * powers this endpoint by default.
 */
async function handleSuggestSectionBorders(req, res, cors) {
  let workDir = null
  const t0 = Date.now()
  try {
    const headerValue = req.headers['x-bars-json']
    if (!headerValue || typeof headerValue !== 'string') {
      sendJson(res, 400, { ok: false, error: 'Missing X-Bars-Json header' }, cors)
      return
    }
    let barsPayload
    try {
      barsPayload = decodeURIComponent(headerValue)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: 'X-Bars-Json header not URL-decodable' }, cors)
      return
    }
    // Sanity-check it parses as the expected shape — fail fast vs. having
    // Python sigh and return empty borders.
    try {
      const parsed = JSON.parse(barsPayload)
      if (!parsed || !Array.isArray(parsed.bars)) {
        throw new Error('expected { bars: [...] }')
      }
    } catch (e) {
      sendJson(
        res,
        400,
        { ok: false, error: `X-Bars-Json not valid JSON: ${e instanceof Error ? e.message : e}` },
        cors,
      )
      return
    }

    const buf = await readRequestBody(req)
    logInfo(
      `suggest-section-borders: received ${(buf.byteLength / (1024 * 1024)).toFixed(1)} MB audio`,
    )
    if (buf.byteLength === 0) {
      sendJson(res, 400, { ok: false, error: 'Empty audio body' }, cors)
      return
    }

    const script = sectionsScriptPath()
    if (!existsSync(script)) {
      logError(`suggest-section-borders: missing script ${script}`)
      sendJson(res, 500, { ok: false, error: `Missing script: ${script}` }, cors)
      return
    }

    workDir = await mkdtemp(path.join(tmpdir(), 'barbro-sections-'))
    const wavPath = path.join(workDir, 'clip.wav')
    await writeFile(wavPath, buf)

    const { code, signal, stdout, stderr } = await runPythonCapture(
      pythonSectionsExe(),
      script,
      [wavPath],
      120_000,
      barsPayload,
    )
    if (code !== 0) {
      const sigPart = signal ? ` (signal ${signal})` : ''
      logWarn(
        `suggest-section-borders: python exit ${code}${sigPart}: ${stderr?.slice(0, 2000) ?? ''}`,
      )
      const errMsg = stderr
        ? stderr
        : signal
          ? `Python killed by ${signal} (no stderr — likely crashed in a native lib).`
          : `Python exited with code ${code} and no stderr.`
      sendJson(res, 503, { ok: false, error: errMsg }, cors)
      return
    }

    let data
    try {
      data = JSON.parse(stdout)
    } catch {
      logError('suggest-section-borders: invalid JSON from analyzer')
      sendJson(res, 500, { ok: false, error: 'Invalid JSON from analyzer' }, cors)
      return
    }
    const borderCount = Array.isArray(data?.borders) ? data.borders.length : 0
    logInfo(
      `suggest-section-borders: done — ${borderCount} borders in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    )
    sendJson(res, 200, { ok: true, data }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError(`suggest-section-borders: ${msg}`)
    sendJson(res, 500, { ok: false, error: msg }, cors)
  } finally {
    if (workDir) {
      rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/**
 * `POST /native/analyze-chord-chroma` — per-beat 12-d chroma + song-level
 * key detection.
 *
 * The body is length-prefixed binary:
 *   [uint32 LE = N]  // beats-JSON byte length
 *   [N bytes      ]  // UTF-8 JSON: see shapes below
 *   [rest of body ]  // raw WAV bytes (optional; see stemAbsPath path)
 *
 * Headers won't fit the beats list — 1000+ beats blows past Node's 8 KB
 * header cap with HTTP 431 — so we pack them into the body.
 *
 * Two input shapes are supported:
 *
 *   1. Full-mix path (legacy): `{ beats: [...] }` plus a raw WAV body.
 *      Used when stems aren't on disk.
 *
 *   2. Stem-source path (preferred): `{ beats: [...], stemAbsPath: "..." }`
 *      with an empty audio body. The sidecar reads the file directly off
 *      disk instead of round-tripping bytes through HTTP. Used when the
 *      caller has identified an isolated harmonic stem
 *      (`<song>/stems/best/other.wav` from demucs) — eliminates
 *      drum/vocal bleed and is the single biggest chord-detection
 *      accuracy unlock. Path is validated to be absolute + readable.
 *
 * Response: `{ ok: true, data: { beatChroma: number[][], detectedKey: { tonic, mode, confidence } | null } }`.
 *
 * Reuses the sections venv (same numpy+librosa deps as border_suggest.py).
 */
/**
 * `POST /native/analyze-drums` — transcribe drum hits from an on-disk drum
 * stem. JSON body `{ stemAbsPath }`; JSON response
 * `{ ok, data: { events, classCounts, durationSec, analyzerVersion } }`.
 * One-shot like chord-chroma (runs in seconds); reuses the sections venv.
 */
async function handleAnalyzeDrums(req, res, cors) {
  const t0 = Date.now()
  try {
    const body = await readRequestJson(req)
    const stemAbsPath = body && typeof body.stemAbsPath === 'string' ? body.stemAbsPath : ''
    if (!stemAbsPath || !path.isAbsolute(stemAbsPath)) {
      sendJson(res, 400, { ok: false, error: 'stemAbsPath must be an absolute path' }, cors)
      return
    }
    if (!existsSync(stemAbsPath)) {
      sendJson(res, 404, { ok: false, error: `Stem file not found: ${stemAbsPath}` }, cors)
      return
    }
    const script = transcribeDrumsScriptPath()
    if (!existsSync(script)) {
      sendJson(res, 500, { ok: false, error: `Missing script: ${script}` }, cors)
      return
    }
    logInfo(`analyze-drums: ${stemAbsPath}`)
    const { code, signal, stdout, stderr } = await runPythonCapture(
      pythonSectionsExe(),
      script,
      [stemAbsPath],
      240_000,
    )
    if (code !== 0) {
      const tail = (stderr || '').split('\n').filter(Boolean).slice(-6).join('; ')
      logWarn(`analyze-drums: exit ${code}${signal ? ` (signal ${signal})` : ''}: ${tail}`)
      sendJson(res, 503, { ok: false, error: tail || `Drum detection failed (exit ${code})` }, cors)
      return
    }
    let data
    try {
      data = JSON.parse(stdout)
    } catch {
      sendJson(res, 502, { ok: false, error: 'Drum detection returned unreadable output' }, cors)
      return
    }
    logInfo(`analyze-drums: ${data?.events?.length ?? 0} events in ${Date.now() - t0}ms`)
    sendJson(res, 200, { ok: true, data }, cors)
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
  }
}

/**
 * `POST /native/analyze-bass` — transcribe bass notes from an on-disk bass
 * stem. JSON body `{ stemAbsPath }`; JSON response
 * `{ ok, data: { notes, noteCount, durationSec, analyzerVersion } }`.
 * One-shot like analyze-drums; reuses the sections venv (YIN pitch tracking).
 */
async function handleAnalyzeBass(req, res, cors) {
  const t0 = Date.now()
  try {
    const body = await readRequestJson(req)
    const stemAbsPath = body && typeof body.stemAbsPath === 'string' ? body.stemAbsPath : ''
    if (!stemAbsPath || !path.isAbsolute(stemAbsPath)) {
      sendJson(res, 400, { ok: false, error: 'stemAbsPath must be an absolute path' }, cors)
      return
    }
    if (!existsSync(stemAbsPath)) {
      sendJson(res, 404, { ok: false, error: `Stem file not found: ${stemAbsPath}` }, cors)
      return
    }
    const script = transcribeBassScriptPath()
    if (!existsSync(script)) {
      sendJson(res, 500, { ok: false, error: `Missing script: ${script}` }, cors)
      return
    }
    logInfo(`analyze-bass: ${stemAbsPath}`)
    const { code, signal, stdout, stderr } = await runPythonCapture(
      pythonSectionsExe(),
      script,
      [stemAbsPath],
      240_000,
    )
    if (code !== 0) {
      const tail = (stderr || '').split('\n').filter(Boolean).slice(-6).join('; ')
      logWarn(`analyze-bass: exit ${code}${signal ? ` (signal ${signal})` : ''}: ${tail}`)
      sendJson(res, 503, { ok: false, error: tail || `Bass detection failed (exit ${code})` }, cors)
      return
    }
    let data
    try {
      data = JSON.parse(stdout)
    } catch {
      sendJson(res, 502, { ok: false, error: 'Bass detection returned unreadable output' }, cors)
      return
    }
    logInfo(`analyze-bass: ${data?.notes?.length ?? 0} notes in ${Date.now() - t0}ms`)
    sendJson(res, 200, { ok: true, data }, cors)
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
  }
}

async function handleAnalyzeChordChroma(req, res, cors) {
  let workDir = null
  const t0 = Date.now()
  try {
    const buf = await readRequestBody(req)
    if (buf.byteLength < 4) {
      sendJson(res, 400, { ok: false, error: 'Body too small to contain length prefix' }, cors)
      return
    }
    const jsonLen = buf.readUInt32LE(0)
    if (jsonLen <= 0 || jsonLen > buf.byteLength - 4) {
      sendJson(res, 400, { ok: false, error: `Invalid beats-JSON length prefix (${jsonLen})` }, cors)
      return
    }
    const beatsPayload = buf.slice(4, 4 + jsonLen).toString('utf8')
    let stemAbsPath = null
    try {
      const parsed = JSON.parse(beatsPayload)
      if (!parsed || !Array.isArray(parsed.beats)) {
        throw new Error('expected { beats: [...] }')
      }
      if (typeof parsed.stemAbsPath === 'string' && parsed.stemAbsPath.length > 0) {
        stemAbsPath = parsed.stemAbsPath
      }
    } catch (e) {
      sendJson(
        res,
        400,
        { ok: false, error: `Beats payload not valid JSON: ${e instanceof Error ? e.message : e}` },
        cors,
      )
      return
    }

    const audioBuf = buf.slice(4 + jsonLen)

    const script = chordChromaScriptPath()
    if (!existsSync(script)) {
      logError(`analyze-chord-chroma: missing script ${script}`)
      sendJson(res, 500, { ok: false, error: `Missing script: ${script}` }, cors)
      return
    }

    // Resolve the audio path the analyzer will read.
    //
    //   - stemAbsPath set: use the on-disk file directly. Validates it's
    //     absolute and readable so a malformed caller can't trick us
    //     into pointing at /etc/passwd or similar.
    //   - else: write the WAV body to a temp file (legacy full-mix path).
    let audioPath
    if (stemAbsPath !== null) {
      if (!path.isAbsolute(stemAbsPath)) {
        sendJson(res, 400, { ok: false, error: `stemAbsPath must be absolute: ${stemAbsPath}` }, cors)
        return
      }
      if (!existsSync(stemAbsPath)) {
        sendJson(res, 404, { ok: false, error: `Stem file not found: ${stemAbsPath}` }, cors)
        return
      }
      audioPath = stemAbsPath
      logInfo(
        `analyze-chord-chroma: using stem ${stemAbsPath} + ${jsonLen}B beats JSON`,
      )
    } else {
      if (audioBuf.byteLength === 0) {
        sendJson(res, 400, { ok: false, error: 'Empty audio body and no stemAbsPath supplied' }, cors)
        return
      }
      logInfo(
        `analyze-chord-chroma: received ${(audioBuf.byteLength / (1024 * 1024)).toFixed(1)} MB audio + ${jsonLen}B beats JSON`,
      )
      workDir = await mkdtemp(path.join(tmpdir(), 'barbro-chord-chroma-'))
      audioPath = path.join(workDir, 'clip.wav')
      await writeFile(audioPath, audioBuf)
    }

    const { code, signal, stdout, stderr } = await runPythonCapture(
      pythonSectionsExe(),
      script,
      [audioPath],
      180_000,
      beatsPayload,
    )
    if (code !== 0) {
      const sigPart = signal ? ` (signal ${signal})` : ''
      logWarn(
        `analyze-chord-chroma: python exit ${code}${sigPart}: ${stderr?.slice(0, 2000) ?? ''}`,
      )
      const errMsg = stderr
        ? stderr
        : signal
          ? `Python killed by ${signal} (no stderr — likely crashed in a native lib).`
          : `Python exited with code ${code} and no stderr.`
      sendJson(res, 503, { ok: false, error: errMsg }, cors)
      return
    }

    let data
    try {
      data = JSON.parse(stdout)
    } catch {
      logError('analyze-chord-chroma: invalid JSON from analyzer')
      sendJson(res, 500, { ok: false, error: 'Invalid JSON from analyzer' }, cors)
      return
    }
    const beatCount = Array.isArray(data?.beatChroma) ? data.beatChroma.length : 0
    const keyDesc = data?.detectedKey
      ? `${data.detectedKey.tonic}/${data.detectedKey.mode} (${data.detectedKey.confidence})`
      : 'none'
    logInfo(
      `analyze-chord-chroma: done — ${beatCount} beats, key=${keyDesc}, ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    )
    sendJson(res, 200, { ok: true, data }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError(`analyze-chord-chroma: ${msg}`)
    sendJson(res, 500, { ok: false, error: msg }, cors)
  } finally {
    if (workDir) {
      rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/**
 * `POST /native/align-audio` — body `{ refPath, targetPath }` (absolute OS
 * paths). Computes the constant time offset that maps `targetPath` onto
 * `refPath`'s timeline, plus a same-recording confidence and a drift measure.
 *
 * Sign contract (mirrors align_audio.py): `t_ref = t_target + offsetSec`.
 * offset > 0 ⇒ the target starts earlier (delay/pad it to align); offset < 0 ⇒
 * the target starts later (trim it). No audio crosses HTTP — both files are on
 * the desktop's own disk. Reuses the sections venv (numpy + scipy + librosa).
 */
async function handleAlignAudio(req, res, cors) {
  const t0 = Date.now()
  try {
    const body = await readRequestJson(req)
    const refPath = typeof body?.refPath === 'string' ? body.refPath.trim() : ''
    const targetPath = typeof body?.targetPath === 'string' ? body.targetPath.trim() : ''
    try {
      ensureAbsolutePath(refPath, 'refPath')
      ensureAbsolutePath(targetPath, 'targetPath')
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
      return
    }
    if (!existsSync(refPath)) {
      sendJson(res, 404, { ok: false, error: `ref audio not found: ${refPath}` }, cors)
      return
    }
    if (!existsSync(targetPath)) {
      sendJson(res, 404, { ok: false, error: `target audio not found: ${targetPath}` }, cors)
      return
    }
    const script = alignAudioScriptPath()
    if (!existsSync(script)) {
      logError(`align-audio: missing script ${script}`)
      sendJson(res, 500, { ok: false, error: `Missing script: ${script}` }, cors)
      return
    }

    const { code, signal, stdout, stderr } = await runPythonCapture(
      pythonSectionsExe(),
      script,
      [refPath, targetPath],
      300_000,
    )
    if (code !== 0) {
      const sigPart = signal ? ` (signal ${signal})` : ''
      logWarn(`align-audio: python exit ${code}${sigPart}: ${stderr?.slice(0, 2000) ?? ''}`)
      const errMsg = stderr || (signal ? `Python killed by ${signal}.` : `Python exited ${code}.`)
      sendJson(res, 503, { ok: false, error: errMsg }, cors)
      return
    }
    let data
    try {
      data = JSON.parse(stdout)
    } catch {
      logError('align-audio: invalid JSON from aligner')
      sendJson(res, 500, { ok: false, error: 'Invalid JSON from aligner' }, cors)
      return
    }
    if (!data?.ok) {
      sendJson(res, 422, { ok: false, error: data?.error || 'alignment failed' }, cors)
      return
    }
    logInfo(
      `align-audio: offset=${data.offsetSec}s conf=${data.confidence} drift=${data.driftSec}s same=${data.sameRecording} ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    )
    sendJson(res, 200, { ok: true, data }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError(`align-audio: ${msg}`)
    sendJson(res, 500, { ok: false, error: msg }, cors)
  }
}

/**
 * `POST /native/shift-audio` — body `{ srcPath, dstPath, offsetSec,
 * targetDurationSec? }` (absolute OS paths). Writes `srcPath` shifted onto a
 * reference timeline by `offsetSec` (same sign contract as align-audio) to
 * `dstPath`, sample-accurate. Used to drop an aligned upload / vocal stem onto
 * an existing song's grid. `dstPath`'s parent dir must exist.
 */
async function handleShiftAudio(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    const srcPath = typeof body?.srcPath === 'string' ? body.srcPath.trim() : ''
    const dstPath = typeof body?.dstPath === 'string' ? body.dstPath.trim() : ''
    const offsetSec = Number(body?.offsetSec)
    const targetDurationSec = body?.targetDurationSec == null ? null : Number(body.targetDurationSec)
    try {
      ensureAbsolutePath(srcPath, 'srcPath')
      ensureAbsolutePath(dstPath, 'dstPath')
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
      return
    }
    if (!Number.isFinite(offsetSec)) {
      sendJson(res, 400, { ok: false, error: 'offsetSec must be a finite number' }, cors)
      return
    }
    if (!existsSync(srcPath)) {
      sendJson(res, 404, { ok: false, error: `src audio not found: ${srcPath}` }, cors)
      return
    }
    const script = shiftAudioScriptPath()
    if (!existsSync(script)) {
      sendJson(res, 500, { ok: false, error: `Missing script: ${script}` }, cors)
      return
    }
    await mkdir(path.dirname(dstPath), { recursive: true })
    const args = [srcPath, dstPath, String(offsetSec)]
    if (targetDurationSec != null && Number.isFinite(targetDurationSec)) args.push(String(targetDurationSec))
    // speedRatio is POSITIONAL after targetDurationSec — pass an explicit
    // "null" placeholder when the duration is absent so the ratio still lands
    // in the right slot.
    const speedRatio = Number(body?.speedRatio)
    if (Number.isFinite(speedRatio) && Math.abs(speedRatio - 1) > 1e-6) {
      if (args.length === 3) args.push('null')
      args.push(String(speedRatio))
    }
    const { code, signal, stdout, stderr } = await runPythonCapture(
      pythonSectionsExe(),
      script,
      args,
      180_000,
    )
    if (code !== 0) {
      const errMsg = stderr || (signal ? `Python killed by ${signal}.` : `Python exited ${code}.`)
      logWarn(`shift-audio: python exit ${code}: ${stderr?.slice(0, 1000) ?? ''}`)
      sendJson(res, 503, { ok: false, error: errMsg }, cors)
      return
    }
    let data
    try {
      data = JSON.parse(stdout)
    } catch {
      sendJson(res, 500, { ok: false, error: 'Invalid JSON from shifter' }, cors)
      return
    }
    if (!data?.ok) {
      sendJson(res, 422, { ok: false, error: data?.error || 'shift failed' }, cors)
      return
    }
    sendJson(res, 200, { ok: true, data }, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError(`shift-audio: ${msg}`)
    sendJson(res, 500, { ok: false, error: msg }, cors)
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
    forgetRecoverableStemJob(job)
    scheduleJobCleanup(job.jobId)
    tryRunNext()
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
    forgetRecoverableStemJob(job)
    scheduleJobCleanup(job.jobId)
    tryRunNext()
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

  const child = spawn(pythonStemsExe(), args, {
    // The managed audio-converter dir rides along so the stem engine (and
    // the tools it spawns) can find it on machines with no system copy.
    env: { ...process.env, BARBRO_FFMPEG_DIR: getUvBinDir() },
  })
  job.child = child

  // Stall watchdog. A hung/zombie Demucs child that never exits and never
  // emits output would block the whole queue forever (activeJobId stuck),
  // which is exactly how auto-stems "gets stuck". Demucs streams progress
  // steadily, so NO output for STALL_TIMEOUT_MS means it's wedged — kill it
  // and let the job finish as an error so the queue moves on.
  const STALL_TIMEOUT_MS = 15 * 60 * 1000
  let stallTimer = null
  let timedOut = false
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = setTimeout(() => {
      timedOut = true
      logWarn(`stems[${job.jobId.slice(0, 8)}] no progress for 15 min — killing (assumed stuck)`)
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }, STALL_TIMEOUT_MS)
  }
  const disarmStall = () => {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
  }
  // Any output (progress or logs) counts as "alive" and resets the timer.
  // Extra listeners are fine — they don't interfere with the parsing ones.
  child.stdout.on('data', armStall)
  child.stderr.on('data', armStall)
  armStall()

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
      disarmStall()
      lastError = { msg: err instanceof Error ? err.message : String(err) }
      emitJobEvent(job, { type: 'error', msg: lastError.msg })
      resolve()
    })
    child.on('close', (code) => {
      disarmStall()
      if (timedOut && !lastError) {
        lastError = { msg: 'Stem render timed out (no progress for 15 min) — skipped this song.' }
      }
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

  // Feed the outcome back to the auto-stems daemon so it can clear a song's
  // attempt budget on success, or record WHY it failed (surfaced to the user
  // as the "abandoned" reason instead of a silent stall). Only for jobs whose
  // output follows the `<songFolder>/stems/<quality>` convention.
  if (autoStemsDaemon && job.outDir && path.basename(path.dirname(job.outDir)) === 'stems') {
    const songFolderAbs = path.dirname(path.dirname(job.outDir))
    if (job.state === 'done') autoStemsDaemon.noteSongSatisfied(songFolderAbs)
    else if (job.state === 'error') {
      autoStemsDaemon.noteSongFailed(songFolderAbs, job.lastErrorMsg ?? 'Stem split failed.')
    }
  }

  forgetRecoverableStemJob(job)
  activeJobId = null
  scheduleJobCleanup(job.jobId)
  tryRunNext()
}

async function runQueuedYoutubeImportJob(job) {
  job.state = 'running'
  job.startedAt = Date.now()
  activeJobId = job.jobId
  emitJobEvent(job, { type: 'state', state: 'running' })
  logInfo(`youtube-import: job ${job.jobId.slice(0, 8)} started`)

  const script = youtubeImportScriptPath()
  if (!existsSync(script)) {
    job.state = 'error'
    job.lastErrorMsg = `Missing script: ${script}`
    job.finishedAt = Date.now()
    emitJobEvent(job, { type: 'error', code: 'YTDLP_MISSING', msg: job.lastErrorMsg })
    emitJobEvent(job, { type: 'state', state: 'error' })
    activeJobId = null
    scheduleJobCleanup(job.jobId)
    tryRunNext()
    return
  }
  if (!youtubeImportVenvIsReady()) {
    job.state = 'error'
    job.lastErrorMsg = 'Audio import tools are not prepared yet.'
    job.finishedAt = Date.now()
    emitJobEvent(job, { type: 'error', code: 'YTDLP_MISSING', msg: job.lastErrorMsg })
    emitJobEvent(job, { type: 'state', state: 'error' })
    activeJobId = null
    scheduleJobCleanup(job.jobId)
    tryRunNext()
    return
  }

  const outWav = path.join(job.tempRoot, 'artifact.wav')
  const child = spawn(pythonYoutubeImportExe(), [
    script,
    job.url,
    '--work-dir',
    job.tempRoot,
    '--output-wav',
    outWav,
  ], { env: process.env })
  job.child = child

  let buffer = ''
  let lastDone = null
  let lastError = null

  const handleLine = (line) => {
    if (!line) return
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      emitJobEvent(job, { type: 'log', msg: line })
      return
    }
    if (obj && typeof obj === 'object') {
      if (obj.type === 'done') {
        lastDone = obj
        return
      } else if (obj.type === 'error') lastError = obj
      emitJobEvent(job, obj)
    }
  }

  child.stdout.setEncoding('utf-8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let idx = buffer.indexOf('\n')
    while (idx !== -1) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      idx = buffer.indexOf('\n')
      handleLine(line)
    }
  })
  child.stderr.setEncoding('utf-8')
  child.stderr.on('data', (chunk) => {
    for (const raw of String(chunk).split('\n')) {
      const line = raw.trim()
      if (line) {
        emitJobEvent(job, { type: 'log', msg: line })
        logWarn(`youtube-import[${job.jobId.slice(0, 8)}] ${line}`)
      }
    }
  })

  await new Promise((resolve) => {
    child.on('error', (err) => {
      lastError = { code: 'YTDLP_MISSING', msg: err instanceof Error ? err.message : String(err) }
      emitJobEvent(job, { type: 'error', code: lastError.code, msg: lastError.msg })
      resolve()
    })
    child.on('close', async (code) => {
      const tail = buffer.trim()
      if (tail) handleLine(tail)
      if (job.state === 'cancelled') {
        // Cancellation already emitted state.
      } else if (lastError) {
        job.state = 'error'
        job.lastErrorMsg = lastError.msg ?? 'YouTube import failed.'
      } else if (code !== 0) {
        job.state = 'error'
        job.lastErrorMsg = `Audio import exited ${code}`
        emitJobEvent(job, { type: 'error', code: 'NETWORK_FAILURE', msg: job.lastErrorMsg })
      } else if (!existsSync(outWav) || !lastDone?.artifact) {
        job.state = 'error'
        job.lastErrorMsg = 'Audio import did not create an artifact.'
        emitJobEvent(job, { type: 'error', code: 'CONVERSION_FAILED', msg: job.lastErrorMsg })
      } else {
        try {
          const baseArtifact = lastDone.artifact
          const preferredFileName = safeYoutubeAudioFilename(baseArtifact, job.jobId)
          let fileName = preferredFileName
          let projectSubpath = null
          let tempArtifactUrl = `/native/import/youtube/artifact/${encodeURIComponent(job.jobId)}`
          let artifactPath = outWav

          if (job.output?.kind === 'project-audio') {
            const { projectPath, songFolder } = job.output
            const target = uniqueAudioSubpath(projectPath, songFolder, preferredFileName)
            await atomicCopyFile(outWav, target.abs)
            fileName = target.fileName
            projectSubpath = target.subpath
            tempArtifactUrl = null
            artifactPath = target.abs
          }

          const st = statSync(artifactPath)
          job.artifactPath = artifactPath
          job.artifact = {
            fileName,
            mimeType: 'audio/wav',
            durationSec: Number(baseArtifact.durationSec),
            sampleRate: Number(baseArtifact.sampleRate),
            channels: Number(baseArtifact.channels),
            fileSize: st.size,
            sha256: String(baseArtifact.sha256 ?? ''),
            originalSha256: String(baseArtifact.sha256 ?? ''),
            source: 'import',
            titleHint: typeof baseArtifact.titleHint === 'string' ? baseArtifact.titleHint : undefined,
            ...(tempArtifactUrl ? { tempArtifactUrl } : {}),
            ...(projectSubpath ? { projectSubpath } : {}),
          }
          job.state = 'done'
          emitJobEvent(job, { type: 'done', artifact: job.artifact })
        } catch (e) {
          job.state = 'error'
          job.lastErrorMsg = e instanceof Error ? e.message : String(e)
          emitJobEvent(job, { type: 'error', code: 'PROJECT_WRITE_FAILED', msg: job.lastErrorMsg })
        }
      }
      job.finishedAt = Date.now()
      job.child = null
      emitJobEvent(job, { type: 'state', state: job.state })
      resolve()
    })
  })

  if (job.state === 'done') {
    logInfo(`youtube-import: job ${job.jobId.slice(0, 8)} done — ${job.artifact?.fileName ?? 'audio.wav'}`)
  } else {
    logWarn(`youtube-import: job ${job.jobId.slice(0, 8)} finished as ${job.state}${job.lastErrorMsg ? ' — ' + job.lastErrorMsg : ''}`)
  }

  activeJobId = null
  scheduleJobCleanup(job.jobId)
  tryRunNext()
}

/**
 * Drain the queues. Two independent serial lanes:
 *  - HEAVY lane (stems, youtube import) — gated by `activeJobId`.
 *  - LYRICS lane — gated by `activeLyricsJobId`, runs CONCURRENTLY with the
 *    heavy lane. Auto-stems keeps the heavy lane busy for long stretches;
 *    a 1–3 min transcription must not starve behind hours of stem prep.
 *    Whisper (int8 CPU) alongside Demucs just shares cores — both proceed.
 * Safe to call concurrently — only the first caller actually runs jobs.
 */
function tryRunNext() {
  if (activeJobId === null) {
    for (const job of stemsJobs.values()) {
      if (job.state === 'queued' && job.kind !== 'lyrics-transcribe') {
        if (job.kind === 'youtube-import') void runQueuedYoutubeImportJob(job)
        else void runQueuedJob(job)
        break
      }
    }
  }
  if (activeLyricsJobId === null) {
    for (const job of stemsJobs.values()) {
      if (job.state === 'queued' && job.kind === 'lyrics-transcribe') {
        void runQueuedLyricsJob(job)
        break
      }
    }
  }
}

// ── Python deps health check ──────────────────────────────────────────────
//
// Each analysis endpoint (analyze-downbeats, suggest-section-borders,
// chord-chroma, stems separation) uses a specific Python interpreter
// (system or a per-task venv). When the matching venv is missing or
// has missing modules (the canonical case being "numpy not found"
// because pip-install was interrupted), the analyze endpoint fails
// with an unhelpful exit code. The web app should detect this proactively
// and redirect to /download so the user knows something's broken before
// they hit "Analyze" and get nothing.
//
// `getHealthStatus()` probes each interpreter by spawning
// `python -c "import <modules>"` once per kind. The result is cached
// for HEALTH_CACHE_TTL_MS so the web app polling every 12s only spawns
// a fresh check once per minute. Per-check timeout = 5s; a hung
// interpreter doesn't block the whole check.

const HEALTH_CACHE_TTL_MS = 60_000

/** @type {{ result: { ok: boolean, checks: Array<{ name: string, ok: boolean, error?: string }> } | null, expiresAt: number }} */
let healthCache = { result: null, expiresAt: 0 }

// madmom 0.16.1 needs runtime patches to import on Python 3.10+
// (collections ABC move, np.float/int aliases removed). The patches
// live in analyze_downbeats.py; reproduce the import-side bits here so
// health checks don't false-negative on a working venv.
const BEATS_HEALTH_PROBE = [
  'import collections, collections.abc',
  'collections.MutableSequence = collections.abc.MutableSequence',
  'import numpy as np',
  'np.float = np.float64',
  'np.int = np.int64',
  'np.bool = np.bool_',
  'import scipy',
  'from madmom.features.downbeats import DBNDownBeatTrackingProcessor, RNNDownBeatProcessor',
].join('; ')

/**
 * Run `python -c "<script>"` against the given interpreter.
 * Returns a CheckResult — never rejects. If `script` is provided it's
 * used verbatim; otherwise we synthesise `import a; import b; …` from
 * `modules`.
 *
 * @param {string} name
 * @param {string | null | undefined} exe
 * @param {string[]} modules
 * @param {string} [script]
 * @returns {Promise<{ name: string, ok: boolean, error?: string }>}
 */
function checkPythonImports(name, exe, modules, script) {
  return new Promise((resolve) => {
    if (!exe) {
      resolve({ name, ok: false, error: 'no interpreter resolved' })
      return
    }
    const code = script ?? modules.map((m) => `import ${m}`).join('; ')
    let proc
    try {
      proc = spawn(exe, ['-c', code], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ name, ok: false, error: e instanceof Error ? e.message : String(e) })
      return
    }
    let stderr = ''
    let done = false
    const finish = (result) => {
      if (done) return
      done = true
      try { proc?.kill() } catch { /* ignore */ }
      resolve(result)
    }
    // 20s, not 5: a COLD import of numpy+scipy+madmom on a busy machine
    // (autosaves running, audio playing) legitimately takes >5s, and the 5s
    // verdict was indistinguishable from "modules missing" — it told a user
    // mid-edit to REINSTALL over a disk-cache warmup. Checks run once a
    // minute and in parallel, so the longer ceiling costs nothing.
    const timer = setTimeout(
      () => finish({ name, ok: false, timedOut: true, error: 'no answer in 20s — the computer may just be busy; press Check again' }),
      20_000,
    )
    proc.stderr?.on('data', (b) => {
      stderr += b.toString('utf-8')
    })
    proc.on('error', (e) => {
      clearTimeout(timer)
      finish({ name, ok: false, error: e.message })
    })
    proc.on('close', (rc) => {
      clearTimeout(timer)
      if (rc === 0) finish({ name, ok: true })
      else finish({ name, ok: false, error: stderr.trim() || `exit ${rc}` })
    })
  })
}

async function getHealthStatus() {
  const now = Date.now()
  if (healthCache.result && now < healthCache.expiresAt) {
    return healthCache.result
  }
  // While auto-setup is running, health is "installing" rather than
  // "broken" — return early so the client UI shows progress instead of
  // the generic deps-broken error.
  if (autoSetupState.running) {
    return {
      ok: false,
      installing: true,
      checks: [],
    }
  }
  const checks = await Promise.all([
    // Beats: only probe when the venv exists. Otherwise the system
    // python3 fallback would happily report numpy ok (without madmom)
    // and we'd incorrectly classify beats as "ok" while analyze fails.
    checkPythonImports(
      'beats',
      beatsVenvIsReady() ? pythonBeatsExe() : null,
      ['numpy', 'madmom'],
      BEATS_HEALTH_PROBE,
    ),
    checkPythonImports('sections', pythonSectionsExe(), ['numpy', 'librosa', 'scipy']),
    // Stems is intentionally not in the auto-setup loop (too heavy),
    // so we don't report it as broken at the health level — the Stems
    // dialog handles its own missing-deps UX.
    checkPythonImports(
      'piper-tts',
      piperTtsVenvIsReady() ? pythonPiperTtsExe() : null,
      ['piper'],
    ),
  ])
  // piper is optional — having it broken doesn't block analyze. Only
  // beats / sections being broken triggers the "deps broken" lock.
  const ok = checks.filter((c) => c.name !== 'piper-tts').every((c) => c.ok)
  const result = { ok, installing: false, checks }
  // A TIMEOUT verdict must not be pinned for a whole minute: it usually means
  // "the machine was busy right then", and caching it kept the reinstall page
  // up for 60s after the machine recovered. Real failures (import errors)
  // cache normally; timeouts retry on the next poll.
  const anyTimeout = checks.some((c) => c.timedOut === true)
  healthCache = { result, expiresAt: now + (anyTimeout ? 5_000 : HEALTH_CACHE_TTL_MS) }
  return result
}

function invalidateHealthCache() {
  healthCache = { result: null, expiresAt: 0 }
}

async function handleHealth(res, cors) {
  const status = await getHealthStatus()
  sendJson(
    res,
    200,
    { ok: status.ok, installing: status.installing ?? false, checks: status.checks },
    cors,
  )
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
/**
 * Build + enqueue a stems job into the shared serial queue. Used by BOTH the
 * HTTP handler and the auto-stems daemon, so the two never diverge. Caller is
 * responsible for having validated `inputPath` exists. Returns
 * `{ jobId, queuePosition }`; throws only on filesystem failure (mkdir /
 * mkdtemp). Behaviour is identical to the pre-refactor inline body.
 *
 * @param {{ inputPath: string, outputDir: string, model?: string, shifts?: number,
 *           overlap?: number, stems?: string, songId?: string | null }} args
 */
async function createStemsJob(args) {
  const inputPath = args.inputPath
  const outputDir = args.outputDir
  const model = typeof args.model === 'string' && args.model.trim() ? args.model.trim() : 'htdemucs_ft'
  const shifts = Math.max(1, Math.min(20, Number.parseInt(String(args.shifts ?? 5), 10) || 5))
  const overlap = Math.max(0, Math.min(0.95, Number.parseFloat(String(args.overlap ?? 0.25)) || 0.25))
  const stems = (typeof args.stems === 'string' && args.stems.trim()) ? args.stems.trim() : 'vocals,drums,bass,other'
  const songId = typeof args.songId === 'string' && args.songId.trim() ? args.songId.trim() : null

  await mkdir(outputDir, { recursive: true })
  // tempRoot holds only intermediate Demucs artifacts; final stems land in
  // the caller-provided outputDir.
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'barbro-stems-'))

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
  rememberRecoverableStemJob(job)
  emitJobEvent(job, { type: 'state', state: 'queued' })

  const queuedAhead = [...stemsJobs.values()].filter(
    (j) => j.state === 'queued' && j.kind !== 'lyrics-transcribe' && j.jobId !== jobId,
  ).length
  const runningAhead = activeJobId !== null ? 1 : 0
  tryRunNext()
  return { jobId, queuePosition: queuedAhead + runningAhead }
}

/** True when a song already has a non-terminal stems job (avoid double-queue). */
function hasInflightStemJobForSong(songId) {
  if (!songId) return false
  for (const j of stemsJobs.values()) {
    if (j.songId !== songId) continue
    if (j.state === 'queued' || j.state === 'running' || j.state === 'paused') return true
  }
  return false
}

async function handleSeparateStems(req, res, cors) {
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

    let result
    try {
      result = await createStemsJob({
        inputPath,
        outputDir,
        model: body.model,
        shifts: body.shifts,
        overlap: body.overlap,
        stems: body.stems,
        songId: body.songId,
      })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: `Could not start stems job: ${e instanceof Error ? e.message : String(e)}` }, cors)
      return
    }

    logInfo(
      `separate-stems: enqueued ${result.jobId.slice(0, 8)} input=${path.basename(inputPath)} out=${outputDir}; position ${result.queuePosition}`,
    )
    sendJson(
      res,
      202,
      { ok: true, jobId: result.jobId, state: 'queued', queuePosition: result.queuePosition },
      cors,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 500, { ok: false, error: msg }, cors)
  }
}

async function handleYoutubeImport(req, res, cors) {
  let tempRoot = null
  try {
    const body = await readRequestJson(req)
    if (!body) {
      sendJson(res, 400, { ok: false, code: 'INVALID_URL', error: 'Body must be JSON' }, cors)
      return
    }
    const normalized = normalizeYoutubeVideoUrl(body.url)
    if (!normalized.ok) {
      sendJson(res, 400, { ok: false, code: normalized.code, error: normalized.error }, cors)
      return
    }

    const outputRaw = body.output
    let output = { kind: 'temp' }
    if (outputRaw && typeof outputRaw === 'object' && outputRaw.kind === 'project-audio') {
      const projectPath = typeof outputRaw.projectPath === 'string' ? outputRaw.projectPath.trim() : ''
      ensureAbsolutePath(projectPath, 'projectPath')
      if (!existsSync(projectPath)) {
        sendJson(res, 404, { ok: false, code: 'PROJECT_WRITE_FAILED', error: `projectPath not found: ${projectPath}` }, cors)
        return
      }
      const songFolder = validateRelSongFolder(outputRaw.songFolder)
      const songFolderAbs = path.join(projectPath, songFolder)
      if (!existsSync(songFolderAbs)) {
        sendJson(res, 404, { ok: false, code: 'PROJECT_WRITE_FAILED', error: `song folder not found: ${songFolder}` }, cors)
        return
      }
      output = { kind: 'project-audio', projectPath, songFolder }
    }

    const status = await probeYoutubeImportTools()
    if (!status.ready) {
      sendJson(res, 409, {
        ok: false,
        code: 'YTDLP_MISSING',
        error: status.reason ?? 'Audio import tools are not prepared yet.',
      }, cors)
      return
    }

    tempRoot = await mkdtemp(path.join(tmpdir(), 'barbro-youtube-import-'))
    const jobId = randomUUID()
    const job = {
      kind: 'youtube-import',
      jobId,
      songId: null,
      state: 'queued',
      tempRoot,
      inputPath: normalized.url,
      outDir: tempRoot,
      files: [],
      options: { url: normalized.url, outputKind: output.kind },
      output,
      url: normalized.url,
      videoId: normalized.videoId,
      artifact: null,
      artifactPath: null,
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
      (j) => j.state === 'queued' && j.kind !== 'lyrics-transcribe' && j.jobId !== jobId,
    ).length
    const runningAhead = activeJobId !== null ? 1 : 0
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
    sendJson(res, 500, { ok: false, code: 'NETWORK_FAILURE', error: msg }, cors)
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => {})
    }
  }
}

function handleGetYoutubeImportArtifact(req, res, cors, jobId) {
  const job = stemsJobs.get(jobId)
  if (!job || job.kind !== 'youtube-import') {
    sendJson(res, 404, { ok: false, error: 'Unknown jobId' }, cors)
    return
  }
  if (job.state !== 'done' || !job.artifactPath || !existsSync(job.artifactPath)) {
    sendJson(res, 404, { ok: false, error: 'Imported audio is not available' }, cors)
    return
  }
  let size = 0
  try {
    size = statSync(job.artifactPath).size
  } catch {
    /* ignore */
  }
  res.writeHead(200, {
    ...cors,
    'Content-Type': 'audio/wav',
    ...(size > 0 ? { 'Content-Length': String(size) } : {}),
  })
  createReadStream(job.artifactPath).pipe(res)
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
    forgetRecoverableStemJob(job)
    scheduleJobCleanup(jobId)
    logInfo(`${job.kind ?? 'stems'}: job ${jobId.slice(0, 8)} cancelled (was queued)`)
    sendJson(res, 200, { ok: true, state: 'cancelled' }, cors)
    return
  }

  if (job.state === 'running' || job.state === 'paused') {
    const wasPaused = job.state === 'paused'
    job.state = 'cancelled'
    job.lastErrorMsg = 'Cancelled mid-run'
    emitJobEvent(job, { type: 'state', state: 'cancelled' })
    forgetRecoverableStemJob(job)
    try {
      // A SIGSTOPped process won't act on SIGTERM until it's resumed —
      // SIGCONT first, then SIGTERM, otherwise cancel-from-paused hangs.
      if (wasPaused) job.child?.kill('SIGCONT')
      job.child?.kill('SIGTERM')
    } catch {
      /* ignore */
    }
    logInfo(`${job.kind ?? 'stems'}: job ${jobId.slice(0, 8)} cancellation signal sent (${wasPaused ? 'was paused' : 'running'})`)
    sendJson(res, 200, { ok: true, state: 'cancelled' }, cors)
    return
  }

  // Terminal: act as cleanup.
  await destroyStemsJob(jobId)
  sendJson(res, 200, { ok: true, state: 'destroyed' }, cors)
}

/**
 * `POST /native/jobs/:jobId/pause` — suspend a running Demucs subprocess
 * via SIGSTOP. CPU/GPU drop to zero immediately; the kernel pipe holds
 * any pending stdout until SIGCONT.
 *
 * Limitations:
 *  - macOS/Linux only (Windows ignores POSIX signals on `child.kill`).
 *  - Does NOT survive sidecar/app quit — the subprocess dies with us.
 *  - The queue worker still treats the slot as occupied while paused, so
 *    other queued jobs wait their turn. Cancel the paused job first if
 *    you'd rather let the next one through.
 */
async function handlePauseJob(res, cors, jobId) {
  if (process.platform === 'win32') {
    sendJson(res, 501, { ok: false, error: "Pausing isn't available on this computer." }, cors)
    return
  }
  const job = stemsJobs.get(jobId)
  if (!job) {
    sendJson(res, 404, { ok: false, error: 'Unknown jobId' }, cors)
    return
  }
  if (job.state !== 'running') {
    sendJson(res, 409, { ok: false, error: `Cannot pause from state '${job.state}'` }, cors)
    return
  }
  if (!job.child) {
    sendJson(res, 409, { ok: false, error: 'No active child process' }, cors)
    return
  }
  try {
    job.child.kill('SIGSTOP')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 500, { ok: false, error: msg }, cors)
    return
  }
  job.state = 'paused'
  emitJobEvent(job, { type: 'state', state: 'paused' })
  logInfo(`stems: job ${jobId.slice(0, 8)} paused`)
  sendJson(res, 200, { ok: true, state: 'paused' }, cors)
}

/**
 * `POST /native/jobs/:jobId/resume` — thaw a paused Demucs subprocess via
 * SIGCONT. Buffered stdout drains naturally as Demucs writes new lines.
 */
async function handleResumeJob(res, cors, jobId) {
  if (process.platform === 'win32') {
    sendJson(res, 501, { ok: false, error: "Pausing isn't available on this computer." }, cors)
    return
  }
  const job = stemsJobs.get(jobId)
  if (!job) {
    sendJson(res, 404, { ok: false, error: 'Unknown jobId' }, cors)
    return
  }
  if (job.state !== 'paused') {
    sendJson(res, 409, { ok: false, error: `Cannot resume from state '${job.state}'` }, cors)
    return
  }
  if (!job.child) {
    sendJson(res, 409, { ok: false, error: 'No active child process' }, cors)
    return
  }
  try {
    job.child.kill('SIGCONT')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    sendJson(res, 500, { ok: false, error: msg }, cors)
    return
  }
  job.state = 'running'
  emitJobEvent(job, { type: 'state', state: 'running' })
  logInfo(`stems: job ${jobId.slice(0, 8)} resumed`)
  sendJson(res, 200, { ok: true, state: 'running' }, cors)
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
    // ── Phase 1 — make sure uv is available (same pattern as sections /
    //    lyrics / beats; removes any dependency on a system Python, which
    //    plainly does not exist on a fresh Windows machine). ──
    if (!uvBinaryIsReady()) {
      emit({
        type: 'progress',
        label: `Downloading uv ${UV_PINNED_VERSION} (~14 MB)…`,
        current: 0,
        overall: 3,
      })
      const r = await downloadAndExtractUv(emit)
      if (!r.ok) {
        emit({ type: 'error', msg: r.error })
        emit({ type: 'state', state: 'error' })
        res.end()
        return
      }
    }
    const uvBin = getUvBinaryPath()
    emit({ type: 'log', msg: `Using uv at ${uvBin}` })
    emit({ type: 'progress', label: 'uv ready', current: 100, overall: 8 })

    // ── Phase 2 — nuke a stale/broken venv (probe: can it import demucs?).
    //    Healthy venvs from the old pip-based installer pass and are reused.
    if (existsSync(venvPython)) {
      const probe = await runPipelineNdjson(venvPython, ['-c', 'import demucs, torch'], emit)
      if (probe.code !== 0) {
        emit({ type: 'log', msg: 'Existing setup is incomplete — rebuilding it.' })
        await rm(venvDir, { recursive: true, force: true })
      }
    }

    // ── Phase 3 — create the venv (uv downloads a sealed Python 3.12 when
    //    no usable interpreter exists on the system). ──
    if (!existsSync(venvPython)) {
      emit({
        type: 'progress',
        label: 'Setting up the audio engine…',
        current: 0,
        overall: 12,
      })
      const v = await runPipelineNdjson(uvBin, ['venv', '--python', '3.12', venvDir], emit)
      if (v.code !== 0 || !existsSync(venvPython)) {
        emit({
          type: 'error',
          msg: `Environment setup failed (exit ${v.code}). Check the log above for the underlying reason.`,
        })
        emit({ type: 'state', state: 'error' })
        res.end()
        return
      }
      emit({ type: 'progress', label: 'Environment ready', current: 100, overall: 20 })
    } else {
      emit({ type: 'log', msg: 'Environment already exists — re-using.' })
    }

    // ── Phase 4 — Windows + NVIDIA: install the GPU build of the audio
    //    engine first, from the dedicated wheel index. The pins match
    //    requirements.txt, so the later `-r` install sees them satisfied
    //    and does not downgrade. BARBRO_TORCH_INDEX overrides ('off' → CPU).
    const torchIndex = await resolveTorchIndex()
    if (torchIndex) {
      emit({
        type: 'progress',
        label: 'Preparing graphics card acceleration (large download — several minutes)…',
        current: 0,
        overall: 25,
      })
      // If a CPU-only build is already present (installed before the GPU
      // existed), force the swap.
      const cudaProbe = await runPipelineNdjson(
        venvPython,
        ['-c', 'import torch; print(torch.version.cuda or "")'],
        () => {},
      )
      const needsSwap = cudaProbe.code === 0
      const args = ['pip', 'install', '--python', venvPython, '--index-url', torchIndex]
      if (needsSwap) args.push('--reinstall-package', 'torch', '--reinstall-package', 'torchaudio')
      args.push('torch==2.6.0', 'torchaudio==2.6.0')
      const gpu = await runPipelineNdjson(uvBin, args, emit)
      if (gpu.code !== 0) {
        emit({ type: 'error', msg: `Graphics-card setup failed (exit ${gpu.code}).` })
        emit({ type: 'state', state: 'error' })
        res.end()
        return
      }
      emit({ type: 'progress', label: 'Graphics card ready', current: 100, overall: 55 })
    }

    // ── Phase 5 — install requirements. Slowest step on CPU-only machines.
    if (!existsSync(reqPath)) {
      emit({ type: 'error', msg: `Missing requirements.txt at ${reqPath}` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({
      type: 'progress',
      label: 'Installing the stem engine (large download — this can take several minutes)…',
      current: 0,
      overall: torchIndex ? 60 : 30,
    })
    const inst = await runPipelineNdjson(
      uvBin,
      ['pip', 'install', '--python', venvPython, '-r', reqPath],
      emit,
    )
    if (inst.code !== 0) {
      emit({ type: 'error', msg: `Install failed (exit ${inst.code}).` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({ type: 'progress', label: 'Dependencies installed', current: 100, overall: 90 })

    // ── Phase 6 — smoke test + device report. The device line answers
    //    "did the graphics card take?" without waiting for a first job.
    const smoke = await runPipelineNdjson(venvPython, ['-m', 'demucs', '--help'], emit)
    if (smoke.code !== 0) {
      emit({ type: 'error', msg: `Stem engine smoke test failed (exit ${smoke.code})` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    let deviceLine = ''
    await runPipelineNdjson(
      venvPython,
      [
        '-c',
        "import torch; print('cuda' if torch.cuda.is_available() else ('mps' if getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available() else 'cpu'))",
      ],
      (ev) => {
        if (ev.type === 'log' && ev.msg) deviceLine = ev.msg.trim()
      },
    )
    if (deviceLine) emit({ type: 'log', msg: `Compute device: ${deviceLine}` })

    // Make the bundled audio converter spawnable under a canonical name
    // (used by MP3 transcodes and demucs on machines without a system copy).
    await ensureManagedFfmpegBinary().catch(() => null)

    emit({ type: 'progress', label: 'Done', current: 100, overall: 100 })
    emit({ type: 'done', venvPython })
    emit({ type: 'state', state: 'done' })
    logInfo(`setup/stems: venv ready at ${venvPython}`)
    void recoverInterruptedStemJobs().catch((e) => {
      logWarn(`stems: recovery after setup failed: ${e instanceof Error ? e.message : String(e)}`)
    })
    res.end()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError(`setup/stems: ${msg}`)
    emit({ type: 'error', msg })
    emit({ type: 'state', state: 'error' })
    res.end()
  }
}

async function probeYoutubeImportTools() {
  const exe = youtubeImportVenvIsReady() ? getYoutubeImportVenvPythonExe() : null
  if (!exe) return { ready: false, reason: 'Audio import tools are not prepared yet.' }
  const code = [
    'import json',
    'import yt_dlp',
    'import yt_dlp.version',
    'import imageio_ffmpeg',
    'ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()',
    'print(json.dumps({"ytDlpVersion": yt_dlp.version.__version__, "ffmpeg": ffmpeg}))',
  ].join('; ')
  return await new Promise((resolve) => {
    let proc
    try {
      proc = spawn(exe, ['-c', code], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ ready: false, reason: e instanceof Error ? e.message : String(e) })
      return
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { proc?.kill() } catch { /* ignore */ }
      resolve({ ready: false, reason: 'Audio import readiness check timed out.' })
    }, 10_000)
    proc.stdout?.on('data', (b) => { stdout += b.toString('utf-8') })
    proc.stderr?.on('data', (b) => { stderr += b.toString('utf-8') })
    proc.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ready: false, reason: e.message })
    })
    proc.on('close', (rc) => {
      clearTimeout(timer)
      if (rc !== 0) {
        resolve({ ready: false, reason: stderr.trim() || `Audio import readiness check exited ${rc}` })
        return
      }
      try {
        const parsed = JSON.parse(stdout.trim())
        const ffmpegReady = typeof parsed.ffmpeg === 'string' && parsed.ffmpeg.length > 0
        if (!ffmpegReady) {
          resolve({ ready: false, reason: 'Audio conversion tool is missing.' })
          return
        }
        resolve({
          ready: true,
          ytDlpVersion: typeof parsed.ytDlpVersion === 'string' ? parsed.ytDlpVersion : undefined,
          ffmpegReady,
        })
      } catch {
        resolve({ ready: false, reason: 'Audio import readiness check returned invalid data.' })
      }
    })
  })
}

async function handleYoutubeImportSetupStatus(res, cors) {
  const status = await probeYoutubeImportTools()
  sendJson(
    res,
    200,
    status.ready
      ? {
          ok: true,
          ready: true,
          venvDir: getYoutubeImportVenvDir(),
          venvPython: getYoutubeImportVenvPythonExe(),
          ytDlpVersion: status.ytDlpVersion,
          ffmpegReady: status.ffmpegReady === true,
        }
      : {
          ok: true,
          ready: false,
          venvDir: getYoutubeImportVenvDir(),
          venvPython: youtubeImportVenvIsReady() ? getYoutubeImportVenvPythonExe() : null,
          reason: status.reason,
        },
    cors,
  )
}

async function handleSetupYoutubeImport(req, res, cors) {
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

  const venvDir = getYoutubeImportVenvDir()
  const venvPython = getYoutubeImportVenvPythonExe()
  const reqPath = path.join(getNativePythonRoot(), 'youtube', 'requirements.txt')

  try {
    if (!uvBinaryIsReady()) {
      emit({ type: 'progress', label: 'Preparing audio import', current: 0, overall: 5 })
      const r = await downloadAndExtractUv(emit)
      if (!r.ok) {
        emit({ type: 'error', msg: r.error })
        emit({ type: 'state', state: 'error' })
        res.end()
        return
      }
    }
    const uvBin = getUvBinaryPath()

    if (!existsSync(venvPython)) {
      emit({ type: 'progress', label: 'Preparing audio import', current: 0, overall: 15 })
      const { code } = await runPipelineNdjson(uvBin, ['venv', '--python', '3.12', venvDir], emit)
      if (code !== 0 || !existsSync(venvPython)) {
        emit({ type: 'error', msg: `Could not prepare audio import tools (exit ${code}).` })
        emit({ type: 'state', state: 'error' })
        res.end()
        return
      }
    }

    if (!existsSync(reqPath)) {
      emit({ type: 'error', msg: `Missing audio import requirements at ${reqPath}` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({ type: 'progress', label: 'Installing audio import tools', current: 0, overall: 45 })
    const inst = await runPipelineNdjson(
      uvBin,
      ['pip', 'install', '--python', venvPython, '-r', reqPath],
      emit,
    )
    if (inst.code !== 0) {
      emit({ type: 'error', msg: `Could not install audio import tools (exit ${inst.code}).` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }

    emit({ type: 'progress', label: 'Checking audio import tools', current: 0, overall: 90 })
    const ready = await probeYoutubeImportTools()
    if (!ready.ready) {
      emit({ type: 'error', msg: ready.reason ?? 'Audio import tools are not ready.' })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }

    // Expose the bundled audio converter under a canonical spawnable name.
    await ensureManagedFfmpegBinary().catch(() => null)

    emit({ type: 'progress', label: 'Audio import ready', current: 100, overall: 100 })
    emit({ type: 'done', venvPython })
    emit({ type: 'state', state: 'done' })
    logInfo(`setup/youtube-import: ready at ${venvPython}`)
    res.end()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError(`setup/youtube-import: ${msg}`)
    emit({ type: 'error', msg })
    emit({ type: 'state', state: 'error' })
    res.end()
  }
}

/**
 * `GET /native/setup/sections/status` — confirms the sections interpreter
 * can actually `import librosa, numpy, scipy`. A "venv exists" check isn't
 * enough: a failed earlier pip install can leave a stub venv that still
 * exists but has nothing inside it, and the UI would then skip auto-install.
 */
async function handleSectionsSetupStatus(res, cors) {
  const ready = await sectionsLibrosaReady()
  sendJson(
    res,
    200,
    {
      ok: true,
      ready,
      venvDir: getSectionsVenvDir(),
      venvPython: ready ? getSectionsVenvPythonExe() : null,
    },
    cors,
  )
}

/**
 * `POST /native/setup/sections` — create the sections venv under userData
 * and pip-install librosa + scipy + numpy. NDJSON event stream (same shape
 * as `/native/setup/stems`). Idempotent — re-running is safe.
 *
 * Footprint is much smaller than stems (no torch / madmom). Typically
 * finishes in under a minute on a fresh install.
 */
async function handleSetupSections(req, res, cors) {
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

  const venvDir = getSectionsVenvDir()
  const venvPython = getSectionsVenvPythonExe()
  const reqPath = path.join(getNativePythonRoot(), 'sections', 'requirements.txt')

  emit({ type: 'log', msg: `Sections venv target: ${venvDir}` })

  try {
    // ── Phase 1 — make sure uv is available ────────────────────────────
    if (!uvBinaryIsReady()) {
      emit({
        type: 'progress',
        label: `Downloading uv ${UV_PINNED_VERSION} (~14 MB)…`,
        current: 0,
        overall: 5,
      })
      const r = await downloadAndExtractUv(emit)
      if (!r.ok) {
        emit({ type: 'error', msg: r.error })
        emit({ type: 'state', state: 'error' })
        res.end()
        return
      }
    }
    const uvBin = getUvBinaryPath()
    emit({ type: 'log', msg: `Using uv at ${uvBin}` })
    emit({ type: 'progress', label: 'uv ready', current: 100, overall: 15 })

    // ── Phase 2 — nuke any stale / broken venv ─────────────────────────
    if (existsSync(venvDir)) {
      const aliveAndWorking = await sectionsLibrosaReady()
      if (!aliveAndWorking) {
        emit({ type: 'log', msg: 'Existing venv is incomplete — removing it.' })
        await rm(venvDir, { recursive: true, force: true })
        invalidateSectionsLibrosaCache()
      }
    }

    // ── Phase 3 — create the venv. uv will download a sealed
    //    Python 3.12 from python-build-standalone if no usable one is
    //    on the system, so we never depend on system Python health. ──
    if (!existsSync(venvPython)) {
      emit({
        type: 'progress',
        label: 'Setting up Python 3.12 (uv downloads it if missing)…',
        current: 0,
        overall: 25,
      })
      const v = await runPipelineNdjson(
        uvBin,
        ['venv', '--python', '3.12', venvDir],
        emit,
      )
      if (v.code !== 0 || !existsSync(venvPython)) {
        emit({
          type: 'error',
          msg: `uv venv failed (exit ${v.code}). Check the log above for the underlying reason.`,
        })
        emit({ type: 'state', state: 'error' })
        res.end()
        return
      }
      emit({ type: 'progress', label: 'Venv ready', current: 100, overall: 50 })
    } else {
      emit({ type: 'log', msg: 'Venv already exists — re-using.' })
    }

    // ── Phase 4 — install requirements ────────────────────────────────
    if (!existsSync(reqPath)) {
      emit({ type: 'error', msg: `Missing requirements.txt at ${reqPath}` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({
      type: 'progress',
      label: 'Installing librosa + scipy + numpy (≈ 60 MB)…',
      current: 0,
      overall: 60,
    })
    const inst = await runPipelineNdjson(
      uvBin,
      ['pip', 'install', '--python', venvPython, '-r', reqPath],
      emit,
    )
    if (inst.code !== 0) {
      emit({ type: 'error', msg: `uv pip install failed (exit ${inst.code}).` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({ type: 'progress', label: 'Dependencies installed', current: 100, overall: 90 })

    // ── Phase 5 — smoke test ──────────────────────────────────────────
    const smoke = await runPipelineNdjson(
      venvPython,
      ['-c', "import librosa, scipy; print('librosa', librosa.__version__)"],
      emit,
    )
    if (smoke.code !== 0) {
      emit({ type: 'error', msg: `sections audio smoke test failed (exit ${smoke.code}).` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }

    await writeSectionsVenvMarker()
    invalidateSectionsLibrosaCache()
    emit({ type: 'progress', label: 'Done', current: 100, overall: 100 })
    emit({ type: 'done', venvPython })
    emit({ type: 'state', state: 'done' })
    logInfo(`setup/sections: venv ready at ${venvPython}`)
    res.end()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError(`setup/sections: ${msg}`)
    emit({ type: 'error', msg })
    emit({ type: 'state', state: 'error' })
    res.end()
  }
}

// ── Lyrics transcription (isolated `lyrics/` module) ─────────────────────────

/**
 * `GET /native/setup/lyrics/status` — is the lyrics venv (speech recognizer)
 * installed? The model itself downloads on first transcription (into
 * `getLyricsModelDir()`), so `ready` here means "venv importable".
 */
async function handleLyricsSetupStatus(res, cors) {
  const ready = lyricsVenvIsReady()
  sendJson(
    res,
    200,
    {
      ok: true,
      ready,
      venvDir: getLyricsVenvDir(),
      venvPython: ready ? getLyricsVenvPythonExe() : null,
      modelDir: getLyricsModelDir(),
    },
    cors,
  )
}

/**
 * `POST /native/setup/lyrics` — create the lyrics venv and install
 * faster-whisper. NDJSON stream, same shape as `/native/setup/sections`.
 * The speech model (~250 MB) is NOT downloaded here — it downloads on the
 * first transcription so setup stays quick.
 */
async function handleSetupLyrics(req, res, cors) {
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

  const venvDir = getLyricsVenvDir()
  const venvPython = getLyricsVenvPythonExe()
  const reqPath = path.join(getNativePythonRoot(), 'lyrics', 'requirements.txt')

  emit({ type: 'log', msg: `Lyrics venv target: ${venvDir}` })

  try {
    if (!uvBinaryIsReady()) {
      emit({ type: 'progress', label: `Downloading uv ${UV_PINNED_VERSION} (~14 MB)…`, current: 0, overall: 5 })
      const r = await downloadAndExtractUv(emit)
      if (!r.ok) {
        emit({ type: 'error', msg: r.error })
        emit({ type: 'state', state: 'error' })
        res.end()
        return
      }
    }
    const uvBin = getUvBinaryPath()
    emit({ type: 'progress', label: 'uv ready', current: 100, overall: 15 })

    if (!existsSync(venvPython)) {
      emit({ type: 'progress', label: 'Setting up Python 3.12 (uv downloads it if missing)…', current: 0, overall: 25 })
      const v = await runPipelineNdjson(uvBin, ['venv', '--python', '3.12', venvDir], emit)
      if (v.code !== 0 || !existsSync(venvPython)) {
        emit({ type: 'error', msg: `uv venv failed (exit ${v.code}).` })
        emit({ type: 'state', state: 'error' })
        res.end()
        return
      }
      emit({ type: 'progress', label: 'Venv ready', current: 100, overall: 45 })
    } else {
      emit({ type: 'log', msg: 'Venv already exists — re-using.' })
    }

    if (!existsSync(reqPath)) {
      emit({ type: 'error', msg: `Missing requirements.txt at ${reqPath}` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({ type: 'progress', label: 'Installing speech recognizer (≈ 150 MB)…', current: 0, overall: 55 })
    const inst = await runPipelineNdjson(uvBin, ['pip', 'install', '--python', venvPython, '-r', reqPath], emit)
    if (inst.code !== 0) {
      emit({ type: 'error', msg: `uv pip install failed (exit ${inst.code}).` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({ type: 'progress', label: 'Dependencies installed', current: 100, overall: 90 })

    const smoke = await runPipelineNdjson(
      venvPython,
      ['-c', "import faster_whisper; print('faster-whisper ok')"],
      emit,
    )
    if (smoke.code !== 0) {
      emit({ type: 'error', msg: `lyrics smoke test failed (exit ${smoke.code}).` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }

    emit({ type: 'progress', label: 'Done', current: 100, overall: 100 })
    emit({ type: 'done', venvPython })
    emit({ type: 'state', state: 'done' })
    logInfo(`setup/lyrics: venv ready at ${venvPython}`)
    res.end()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError(`setup/lyrics: ${msg}`)
    emit({ type: 'error', msg })
    emit({ type: 'state', state: 'error' })
    res.end()
  }
}

/**
 * Run a queued lyrics-transcription job: spawn the recognizer with
 * `--stream-progress`, pipe params via stdin, drain NDJSON to the job's
 * event buffer. The final `done` event carries the recognized words —
 * clients read them from the event stream (no separate result endpoint).
 */
async function runQueuedLyricsJob(job) {
  job.state = 'running'
  job.startedAt = Date.now()
  activeLyricsJobId = job.jobId
  emitJobEvent(job, { type: 'state', state: 'running' })
  logInfo(`lyrics: job ${job.jobId.slice(0, 8)} started`)

  const script = transcribeLyricsScriptPath()
  if (!existsSync(script) || !existsSync(job.inputPath)) {
    job.state = 'error'
    job.lastErrorMsg = !existsSync(script) ? `Missing script: ${script}` : `Input not found: ${job.inputPath}`
    job.finishedAt = Date.now()
    emitJobEvent(job, { type: 'error', msg: job.lastErrorMsg })
    emitJobEvent(job, { type: 'state', state: 'error' })
    activeLyricsJobId = null
    scheduleJobCleanup(job.jobId)
    tryRunNext()
    return
  }

  const child = spawn(pythonLyricsExe(), [script, job.inputPath, '--stream-progress'], {
    env: process.env,
  })
  job.child = child
  try {
    child.stdin.write(
      JSON.stringify({
        modelDir: getLyricsModelDir(),
        // Larger model by default — recognition (not matching) is the fit
        // bottleneck; measured 54%→65% word-anchor over the library. Downloads
        // on first use (transcribe.py streams progress). Callers may override.
        model: job.options?.model || 'mobiuslabsgmbh/faster-whisper-large-v3-turbo',
        // Language hint derived from the imported lyrics — avoids Whisper
        // mis-detecting sung audio (e.g. Swedish → Norwegian). Omitted when unset.
        language: job.options?.language,
      }),
    )
    child.stdin.end()
  } catch {
    /* child gone already — close handler settles the job */
  }

  // Stall watchdog (model download on first run can take a while; transcription
  // itself streams segments steadily).
  const STALL_TIMEOUT_MS = 20 * 60 * 1000
  let stallTimer = null
  let timedOut = false
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = setTimeout(() => {
      timedOut = true
      logWarn(`lyrics[${job.jobId.slice(0, 8)}] no progress for 20 min — killing (assumed stuck)`)
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }, STALL_TIMEOUT_MS)
  }
  const disarmStall = () => {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
  }
  child.stdout.on('data', armStall)
  child.stderr.on('data', armStall)
  armStall()

  let buffer = ''
  let lastDone = null
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
    for (const raw of String(chunk).split(/\r|\n/)) {
      const line = raw.trim()
      if (line) {
        emitJobEvent(job, { type: 'log', msg: line })
        logWarn(`lyrics[${job.jobId.slice(0, 8)}] ${line}`)
      }
    }
  })

  await new Promise((resolve) => {
    child.on('error', (err) => {
      disarmStall()
      lastError = { msg: err instanceof Error ? err.message : String(err) }
      emitJobEvent(job, { type: 'error', msg: lastError.msg })
      resolve()
    })
    child.on('close', (code) => {
      disarmStall()
      if (timedOut && !lastError) {
        lastError = { msg: 'Transcription timed out (no progress for 20 min).' }
      }
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
        /* already settled */
      } else if (lastError) {
        job.state = 'error'
        job.lastErrorMsg = lastError.msg ?? null
      } else if (code !== 0) {
        job.state = 'error'
        job.lastErrorMsg = `Python exited ${code}`
        emitJobEvent(job, { type: 'error', msg: job.lastErrorMsg })
      } else {
        job.state = 'done'
      }
      job.finishedAt = Date.now()
      job.child = null
      emitJobEvent(job, { type: 'state', state: job.state })
      resolve()
    })
  })

  if (job.state === 'done') {
    const wordCount = Array.isArray(lastDone?.words) ? lastDone.words.length : 0
    logInfo(`lyrics: job ${job.jobId.slice(0, 8)} done — ${wordCount} words`)
  } else {
    logWarn(`lyrics: job ${job.jobId.slice(0, 8)} finished as ${job.state}${job.lastErrorMsg ? ' — ' + job.lastErrorMsg : ''}`)
  }

  activeLyricsJobId = null
  scheduleJobCleanup(job.jobId)
  tryRunNext()
}

/**
 * `POST /native/transcribe-lyrics` — enqueue a word-timestamp transcription
 * of an on-disk audio file (vocals stem preferred). Body:
 * `{ audioAbsPath: string }`. Responds `202 { ok, jobId, state:'queued' }`;
 * progress + the final `done` event (carrying `words`) stream from
 * `GET /native/jobs/:jobId/events`.
 */
async function handleTranscribeLyrics(req, res, cors) {
  let tempRoot = null
  try {
    const body = await readRequestJson(req)
    if (!body || typeof body.audioAbsPath !== 'string' || !body.audioAbsPath.trim()) {
      sendJson(res, 400, { ok: false, error: 'Body must be JSON with audioAbsPath' }, cors)
      return
    }
    const audioAbsPath = body.audioAbsPath.trim()
    ensureAbsolutePath(audioAbsPath, 'audioAbsPath')
    if (!existsSync(audioAbsPath)) {
      sendJson(res, 404, { ok: false, error: `audio not found: ${audioAbsPath}` }, cors)
      return
    }
    if (!lyricsVenvIsReady() && !process.env.BARBRO_PYTHON_LYRICS) {
      sendJson(
        res,
        409,
        { ok: false, code: 'LYRICS_NOT_READY', error: 'Lyrics engine is not prepared yet.', hint: 'POST /native/setup/lyrics' },
        cors,
      )
      return
    }

    tempRoot = await mkdtemp(path.join(tmpdir(), 'barbro-lyrics-'))
    const jobId = randomUUID()
    const job = {
      kind: 'lyrics-transcribe',
      jobId,
      songId: null,
      state: 'queued',
      tempRoot,
      inputPath: audioAbsPath,
      outDir: tempRoot,
      files: [],
      options: { audioAbsPath, model: body.model, language: body.language },
      artifact: null,
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

    // Lyrics run in their OWN lane (concurrent with stems), so the queue
    // position only counts other lyrics work.
    const queuedAhead = [...stemsJobs.values()].filter(
      (j) => j.state === 'queued' && j.kind === 'lyrics-transcribe' && j.jobId !== jobId,
    ).length
    const runningAhead = activeLyricsJobId !== null ? 1 : 0
    sendJson(res, 202, { ok: true, jobId, state: 'queued', queuePosition: queuedAhead + runningAhead }, cors)
    tryRunNext()
  } catch (e) {
    if (tempRoot) rm(tempRoot, { recursive: true, force: true }).catch(() => {})
    const msg = e instanceof Error ? e.message : String(e)
    logError(`transcribe-lyrics: ${msg}`)
    sendJson(res, 500, { ok: false, error: msg }, cors)
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
    if (!uvBinaryIsReady()) {
      emit({ type: 'progress', label: 'Preparing the voice engine…', current: 0, overall: 5 })
      const r = await downloadAndExtractUv(emit)
      if (!r.ok) {
        emit({ type: 'error', msg: r.error })
        emit({ type: 'state', state: 'error' })
        res.end()
        return
      }
    }
    const uvBin = getUvBinaryPath()

    if (!existsSync(venvPython)) {
      emit({ type: 'progress', label: 'Preparing the voice engine…', current: 0, overall: 15 })
      const { code } = await runPipelineNdjson(uvBin, ['venv', '--python', '3.12', venvDir], emit)
      if (code !== 0 || !existsSync(venvPython)) {
        emit({
          type: 'error',
          msg: `Voice engine setup failed (exit ${code}). Check the log above for the underlying reason.`,
        })
        emit({ type: 'state', state: 'error' })
        res.end()
        return
      }
      emit({ type: 'progress', label: 'Environment ready', current: 100, overall: 30 })
    } else {
      emit({ type: 'log', msg: 'Piper venv already present — skipping create' })
    }

    if (!existsSync(reqPath)) {
      emit({ type: 'error', msg: `Missing requirements.txt at ${reqPath}` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({
      type: 'progress',
      label: 'Installing the voice engine (may take a minute)…',
      current: 0,
      overall: 50,
    })
    const inst = await runPipelineNdjson(
      uvBin,
      ['pip', 'install', '--python', venvPython, '-r', reqPath],
      emit,
    )
    if (inst.code !== 0) {
      emit({ type: 'error', msg: `Install failed (exit ${inst.code})` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({ type: 'progress', label: 'Voice engine installed', current: 100, overall: 75 })

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

// ── Beats venv setup (madmom + numpy + scipy) ─────────────────────────────
//
// Madmom is finicky: it builds against the installed numpy ABI at install
// time (its setup.py uses `numpy.get_include()`), so it needs
// `--no-build-isolation` AND numpy already in the venv. The two-pass
// install below handles that. Also pins numpy < 1.24 because madmom 0.16's
// Cython code uses APIs removed in newer numpy.

function handleBeatsSetupStatus(res, cors) {
  const ready = beatsVenvIsReady()
  sendJson(
    res,
    200,
    {
      ok: true,
      ready,
      venvDir: getBeatsVenvDir(),
      venvPython: ready ? getBeatsVenvPythonExe() : null,
    },
    cors,
  )
}

async function handleSetupBeats(req, res, cors) {
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

  const venvDir = getBeatsVenvDir()
  const venvPython = getBeatsVenvPythonExe()
  const reqPath = path.join(getNativePythonRoot(), 'beats', 'requirements.txt')

  emit({ type: 'log', msg: `Beats venv target: ${venvDir}` })

  try {
    // Phase 1 — uv (same sealed-Python download as sections setup).
    if (!uvBinaryIsReady()) {
      emit({
        type: 'progress',
        label: `Downloading uv ${UV_PINNED_VERSION} (~14 MB)…`,
        current: 0,
        overall: 5,
      })
      const r = await downloadAndExtractUv(emit)
      if (!r.ok) {
        emit({ type: 'error', msg: r.error })
        emit({ type: 'state', state: 'error' })
        res.end()
        return
      }
    }
    const uvBin = getUvBinaryPath()
    emit({ type: 'progress', label: 'uv ready', current: 100, overall: 15 })

    // Phase 2 — nuke broken venv if smoke test fails.
    if (existsSync(venvDir)) {
      const ok = await beatsMadmomReady()
      if (!ok) {
        emit({ type: 'log', msg: 'Existing beats venv is incomplete — removing it.' })
        await rm(venvDir, { recursive: true, force: true })
        invalidateBeatsMadmomCache()
      }
    }

    // Phase 3 — create venv.
    if (!existsSync(venvPython)) {
      emit({
        type: 'progress',
        label: 'Creating venv…',
        current: 0,
        overall: 25,
      })
      // Pin to Python 3.10:
      //  - numpy 1.21.x ships macOS arm64 wheels for 3.8-3.10 only; no
      //    3.11 backport. madmom's array code is incompatible with
      //    numpy >= 1.22's strict np.delete axis checks, so we're stuck
      //    on numpy 1.21 → forced down to Python 3.10.
      //  - madmom main also doesn't build cleanly on Python 3.12+.
      // 3.10 is the only version where every pin lines up cleanly.
      const v = await runPipelineNdjson(uvBin, ['venv', '--python', '3.10', venvDir], emit)
      if (v.code !== 0 || !existsSync(venvPython)) {
        emit({ type: 'error', msg: `uv venv failed (exit ${v.code})` })
        emit({ type: 'state', state: 'error' })
        res.end()
        return
      }
      emit({ type: 'progress', label: 'Venv ready', current: 100, overall: 40 })
    }

    // Phase 4 — install build deps + numpy + scipy from requirements.txt.
    if (!existsSync(reqPath)) {
      emit({ type: 'error', msg: `Missing requirements.txt at ${reqPath}` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({
      type: 'progress',
      label: 'Installing build deps + numpy + scipy…',
      current: 0,
      overall: 45,
    })
    const baseInstall = await runPipelineNdjson(
      uvBin,
      ['pip', 'install', '--python', venvPython, '-r', reqPath],
      emit,
    )
    if (baseInstall.code !== 0) {
      emit({ type: 'error', msg: `Base install failed (exit ${baseInstall.code})` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({ type: 'progress', label: 'Base deps installed', current: 100, overall: 75 })

    // Phase 5 — install madmom 0.16.1 from PyPI.
    //
    // We pin to the 2018 release rather than the git `main` branch on
    // purpose. The two known-broken things in 0.16.1 (`from collections
    // import MutableSequence`, `np.float`/`np.int` aliases, the
    // numpy 1.20+ DBN process incompat) are all patched at runtime in
    // `analyze_downbeats.py`. main has churned past that snapshot in
    // ways that make its array code incompatible with numpy 1.22+'s
    // stricter np.delete axis checks (`numpy.AxisError: axis 1 is out
    // of bounds`), which we hit in the field.
    //
    // --no-build-isolation because madmom's setup.py imports
    // `numpy.get_include()` at build time — numpy must already exist
    // in the venv (it does, from Phase 4).
    // Windows has no madmom wheel on PyPI and end users have no compiler —
    // the desktop release CI builds a cp310 win_amd64 wheel and attaches it
    // to every release; install that instead of the sdist there.
    const madmomSpec =
      process.platform === 'win32'
        ? process.env.BARBRO_MADMOM_WHEEL?.trim() ||
          'https://github.com/silverknet/fast_transcriber/releases/latest/download/madmom-0.16.1-cp310-cp310-win_amd64.whl'
        : 'madmom==0.16.1'
    emit({
      type: 'progress',
      label:
        process.platform === 'win32'
          ? 'Installing the beat engine…'
          : 'Compiling madmom 0.16.1 (~30–60 s)…',
      current: 0,
      overall: 80,
    })
    const madmomInstall = await runPipelineNdjson(
      uvBin,
      ['pip', 'install', '--python', venvPython, '--no-build-isolation', madmomSpec],
      emit,
    )
    if (madmomInstall.code !== 0) {
      emit({ type: 'error', msg: `madmom install failed (exit ${madmomInstall.code})` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }
    emit({ type: 'progress', label: 'madmom installed', current: 100, overall: 95 })

    // Phase 6 — smoke test. Bare `import madmom` would fail on 0.16.1
    // (collections.MutableSequence, np.float/int aliases). Apply the
    // same runtime patches we use in analyze_downbeats.py before
    // importing, and exercise DBNDownBeatTrackingProcessor /
    // RNNDownBeatProcessor — those are the symbols the analyzer
    // actually uses, and they trip a separate numpy ABI mismatch if
    // numpy/scipy got pulled to wheels with a wrong-ABI build of
    // madmom's Cython extensions.
    const smokeScript = [
      'import collections, collections.abc',
      'collections.MutableSequence = collections.abc.MutableSequence',
      'import numpy as np',
      'np.float = np.float64',
      'np.int = np.int64',
      'np.bool = np.bool_',
      'import scipy',
      'from madmom.features.downbeats import DBNDownBeatTrackingProcessor, RNNDownBeatProcessor',
      'import madmom',
      'print("ok", madmom.__version__)',
    ].join('; ')
    const smoke = await runPipelineNdjson(
      venvPython,
      ['-c', smokeScript],
      emit,
    )
    if (smoke.code !== 0) {
      emit({ type: 'error', msg: `Beats smoke test failed (exit ${smoke.code})` })
      emit({ type: 'state', state: 'error' })
      res.end()
      return
    }

    await writeBeatsVenvMarker()
    invalidateBeatsMadmomCache()
    emit({ type: 'progress', label: 'Done', current: 100, overall: 100 })
    emit({ type: 'done', venvPython })
    emit({ type: 'state', state: 'done' })
    logInfo(`setup/beats: venv ready at ${venvPython}`)
    res.end()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError(`setup/beats: ${msg}`)
    emit({ type: 'error', msg })
    emit({ type: 'state', state: 'error' })
    res.end()
  }
}

// ── Auto-setup orchestrator ─────────────────────────────────────────────────
//
// Fires at sidecar boot. Probes which managed venvs are missing/broken,
// then sequentially POSTs each one's /native/setup/<name> endpoint via
// loopback fetch and pipes its NDJSON event stream into `autoSetupState`.
// The web app polls `/native/setup/status` to render a "setting up audio
// engine…" UI on the download page instead of the generic "broken" lock.
//
// Reuses the existing setup handlers verbatim (no duplicated install
// logic). Loopback is up by the time `runAutoSetup` fires (caller awaits
// `startBeaconServer` first).

/** @typedef {{ name: string; status: 'pending'|'running'|'done'|'error'|'skipped'; label?: string; progress?: number; error?: string }} AutoSetupStage */

const autoSetupState = /** @type {{ running: boolean; startedAt: number | null; completedAt: number | null; overall: number; stages: AutoSetupStage[]; lastError: string | null }} */ ({
  running: false,
  startedAt: null,
  completedAt: null,
  overall: 0,
  stages: [],
  lastError: null,
})

function publicAutoSetupState() {
  return { ...autoSetupState, stages: autoSetupState.stages.map((s) => ({ ...s })) }
}

function handleAutoSetupStatus(res, cors) {
  sendJson(res, 200, { ok: true, ...publicAutoSetupState() }, cors)
}

async function runAutoSetupOne(stage, urlPath) {
  stage.status = 'running'
  stage.progress = 0
  const url = `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}${urlPath}`
  let res
  try {
    res = await fetch(url, { method: 'POST', cache: 'no-store' })
  } catch (e) {
    stage.status = 'error'
    stage.error = e instanceof Error ? e.message : String(e)
    return
  }
  if (!res.ok || !res.body) {
    stage.status = 'error'
    stage.error = `HTTP ${res.status}`
    return
  }
  // Parse NDJSON stream from the setup handler's `emit()` events.
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx = buffer.indexOf('\n')
    while (idx !== -1) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      idx = buffer.indexOf('\n')
      if (!line) continue
      try {
        const ev = JSON.parse(line)
        if (ev.type === 'progress') {
          stage.label = ev.label
          stage.progress = ev.overall ?? stage.progress
        } else if (ev.type === 'error') {
          stage.error = ev.msg
        } else if (ev.type === 'state' && (ev.state === 'done' || ev.state === 'error')) {
          stage.status = ev.state
        }
      } catch {
        /* ignore non-json line */
      }
    }
  }
  // Fallback: if `state` event never arrived (caller-side bail) decide
  // from whether an error was recorded.
  if (stage.status === 'running') {
    stage.status = stage.error ? 'error' : 'done'
  }
}

/**
 * Idempotent — safe to call repeatedly. Re-running while a previous
 * autoSetup is in flight is a no-op.
 */
export async function runAutoSetup() {
  if (autoSetupState.running) return
  // Probe what needs setup.
  const stages = []
  if (!beatsVenvIsReady() || !(await beatsMadmomReady())) {
    stages.push({ name: 'beats', path: '/native/setup/beats' })
  }
  if (!sectionsVenvIsReady() || !(await sectionsLibrosaReady())) {
    stages.push({ name: 'sections', path: '/native/setup/sections' })
  }
  if (!stemsVenvIsReady()) {
    // Stems is heavy (~1 GB torch). Defer to user click rather than
    // auto-installing — most projects don't need stems and pre-pulling
    // adds minutes to first-launch. The Stems dialog still surfaces
    // "Set up dependencies" for users who want it.
    stages.push({ name: 'stems', path: null })
  }
  if (stages.length === 0) {
    autoSetupState.running = false
    autoSetupState.stages = []
    autoSetupState.completedAt = Date.now()
    autoSetupState.overall = 100
    return
  }

  autoSetupState.running = true
  autoSetupState.startedAt = Date.now()
  autoSetupState.completedAt = null
  autoSetupState.lastError = null
  autoSetupState.stages = stages.map((s) => ({
    name: s.name,
    status: s.path ? 'pending' : 'skipped',
    progress: 0,
  }))
  autoSetupState.overall = 0
  logInfo(`auto-setup: ${stages.length} stage(s) needed`)

  let i = 0
  for (const s of stages) {
    if (!s.path) {
      i++
      continue
    }
    const stage = autoSetupState.stages[i]
    await runAutoSetupOne(stage, s.path)
    if (stage.status === 'error') {
      autoSetupState.lastError = `${s.name}: ${stage.error ?? 'unknown'}`
      logWarn(`auto-setup: ${s.name} failed — ${stage.error ?? 'unknown'}`)
    } else {
      logInfo(`auto-setup: ${s.name} ready`)
    }
    // Recompute overall as average of stage progress (count skipped as 100).
    const done = autoSetupState.stages
      .map((st) => (st.status === 'done' || st.status === 'skipped' ? 100 : st.progress ?? 0))
      .reduce((a, b) => a + b, 0)
    autoSetupState.overall = Math.round(done / autoSetupState.stages.length)
    i++
  }
  autoSetupState.running = false
  autoSetupState.completedAt = Date.now()
  // Invalidate health cache so /native/health re-probes fresh.
  invalidateHealthCache()
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

/**
 * Load the bundled web app, if this build has one.
 *
 * Best-effort by design: a failure here must leave a working sidecar rather
 * than a dead app. The normal desktop build ships no bundle and takes the
 * early return.
 */
/**
 * Mount the bundled web app, ON DEMAND.
 *
 * Called when the user switches to offline mode — not at launch. Until then
 * this process is the sidecar and nothing about the app is loaded, which keeps
 * the two modes genuinely separate rather than merely differently rendered.
 *
 * Idempotent: switching back and forth reuses the mounted handler, so only the
 * first switch pays the import.
 */
async function initOfflineUi() {
  if (offlineUiHandler) return true
  // Order matters: the environment is put into its offline shape BEFORE the
  // SvelteKit handler is imported, because the handler reads `process.env` as
  // it initialises. Preparing afterwards would leave a module that had already
  // seen a configured cloud.
  const info = prepareOfflineEnv()
  const handler = await loadOfflineUiHandler()
  if (!handler) return false
  offlineUiHandler = handler
  logInfo(
    `Offline app mounted. No sign-in; cloud config ${info.removed.length ? `removed (${info.removed.join(', ')})` : 'absent'}.`,
  )
  if (info.cloudConfigured) {
    // Should be unreachable — `prepareOfflineEnv` deletes these. If it ever
    // fires, the build can present a sign-in it cannot complete.
    logError('Offline app: cloud config survived into the environment. Sign-in may appear.')
  }
  return true
}

/** The window onto the locally-served app. Absent in plain sidecar mode. */
let offlineWindow = null

function openOfflineWindow() {
  if (!offlineUiHandler || offlineWindow) return
  offlineWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'BarBro',
    backgroundColor: '#ffffff',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  offlineWindow.on('closed', () => {
    offlineWindow = null
    broadcastStatus()
  })
  void offlineWindow.loadURL(`http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}/`)
}

// ── The status window: which mode am I in, and the switch ──────────────────
//
// BarBro Desktop is a SIDECAR — the thing you download from barbro.app so the
// website can analyse, split stems and reach your files. It is also, since the
// offline work, able to serve the app to itself for a gig.
//
// Two modes in one process needs a face, or it is guesswork. Before this, the
// sidecar had no window and no tray on macOS: the only way to know it was alive
// was to load the website and see whether it complained. Then a second mode
// appeared and a window started opening with nothing to explain which thing you
// were looking at.
//
// So: one small window, always, naming the mode and offering the switch.

/** True once the loopback server is actually accepting connections. */
let beaconListening = false

/**
 * When a BROWSER last talked to us, as opposed to our own offline window.
 *
 * Used to warn before opening offline mode on a project a browser is already
 * editing. The website polls `/ping` every 12 s, so a live tab keeps this fresh
 * without any extra traffic; the window is set wider than that poll so a tab
 * that is merely idle still counts as present.
 */
let lastForeignOriginAt = 0
const FOREIGN_ORIGIN_WINDOW_MS = 30_000
const OWN_ORIGINS = new Set([
  `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`,
  `http://localhost:${BARBRO_DESKTOP_BEACON_PORT}`,
])

function noteForeignOrigin(origin) {
  if (!origin || OWN_ORIGINS.has(origin)) return
  lastForeignOriginAt = Date.now()
}

function webActiveRecently() {
  return lastForeignOriginAt > 0 && Date.now() - lastForeignOriginAt < FOREIGN_ORIGIN_WINDOW_MS
}

let statusWindow = null
/** Surfaced in the status window rather than only in a terminal nobody reads. */
let offlineError = null
/** See `offlineBuildState` — cached because it walks `src/`. */
let offlineBuildCache = { available: false, builtAt: null, unstamped: false, stale: false }

function refreshOfflineBuildState() {
  try {
    offlineBuildCache = offlineBuildState()
  } catch {
    /* unreadable tree — leave the last known state rather than crash the app */
  }
  return offlineBuildCache
}

function statusState() {
  return {
    version: readDesktopVersion(),
    port: BARBRO_DESKTOP_BEACON_PORT,
    sidecarReady: beaconListening,
    offlineAvailable: hasOfflineUiBundle(),
    // Is the bundle we would serve actually current? Recomputed only when the
    // status window opens and when Open is clicked — walking `src/` on the 5 s
    // broadcast would be thousands of stats for a value that rarely changes.
    build: offlineBuildCache,
    offlineOpen: offlineWindow !== null,
    // A browser has been talking to us in the last 30 s. Opening offline mode
    // now would put two editors on one project folder.
    webActive: webActiveRecently(),
    offlineError,
  }
}

function broadcastStatus() {
  if (!statusWindow || statusWindow.isDestroyed()) return
  try {
    statusWindow.webContents.send('barbro:state', statusState())
  } catch {
    /* window went away mid-send — nothing to do */
  }
}

function createStatusWindow() {
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.show()
    statusWindow.focus()
    return
  }
  statusWindow = new BrowserWindow({
    width: 420,
    height: 340,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'BarBro Desktop',
    // `titleBarStyle: hidden` + the CSS drag region gives a clean panel rather
    // than a chrome-heavy window for six lines of text.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#fdfcf7',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'statusPreload.cjs'),
    },
  })
  refreshOfflineBuildState()
  statusWindow.once('ready-to-show', () => statusWindow?.show())
  // `webActive` decays with time rather than with an event, so nothing would
  // ever clear the warning without a tick. Cheap: one small IPC message every
  // 5 s, only while the window is actually open.
  const poll = setInterval(broadcastStatus, 5000)
  statusWindow.on('closed', () => clearInterval(poll))
  statusWindow.on('closed', () => {
    statusWindow = null
  })
  void statusWindow.loadFile(path.join(__dirname, 'status.html'))
}

ipcMain.handle('barbro:state', () => statusState())

ipcMain.handle('barbro:open-offline', async () => {
  offlineError = null
  // Right before serving it is exactly when "is this bundle current?" matters.
  refreshOfflineBuildState()
  try {
    const mounted = await initOfflineUi()
    if (!mounted) {
      offlineError = 'No offline app is bundled with this build.'
    } else {
      openOfflineWindow()
    }
  } catch (err) {
    // Never let this take the sidecar down with it — someone may be mid-render
    // on the website when they click.
    offlineError = err?.message ?? String(err)
    logError(`Offline app failed to open: ${offlineError}`)
  }
  broadcastStatus()
  return statusState()
})

ipcMain.handle('barbro:close-offline', () => {
  // Only the window closes. The handler stays mounted so re-opening is instant,
  // and the sidecar is untouched throughout — someone could be working on the
  // website in a browser right now.
  offlineWindow?.close()
  offlineWindow = null
  broadcastStatus()
  return statusState()
})

function startBeaconServer() {
  const version = readDesktopVersion()
  beaconServer = http.createServer((req, res) => {
    // The other half of ONE BARBRO AT A TIME. The website standing down when the
    // offline app opens protects the gig; this protects the other direction —
    // opening the offline app on a project a browser is already editing.
    //
    // A same-origin GET sends no `Origin` header and a same-origin POST sends
    // our own loopback origin, so anything else is a browser somewhere: the
    // deployed site, or `localhost:5173` in development.
    noteForeignOrigin(req.headers?.origin)

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Bars-Json, X-Beats-Json',
      // Private Network Access (PNA): when an HTTPS public origin
      // (the deployed web app) reaches a private/loopback address
      // (this sidecar on 127.0.0.1), Safari and Chrome both require
      // the server to explicitly opt in. Without this header Safari
      // blocks every request with "Not allowed to request resource"
      // and the web app permanently shows "isn't running".
      'Access-Control-Allow-Private-Network': 'true',
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
        platform: process.platform,
        // Semantic capability flags — the web gates UI on these, so a future
        // Windows suspend implementation flips one boolean, no web release.
        capabilities: { pauseResume: process.platform !== 'win32' },
        // ONE BARBRO AT A TIME. The website stands down while the offline app is
        // open, because both are editors writing the same `song.smap` from their
        // own copy in memory and the loser's edits vanish with no dialog. This
        // process is the only thing that knows both facts, so it arbitrates.
        // See src/lib/client/editingLock.ts.
        offlineAppOpen: offlineWindow !== null,
      })
      res.writeHead(200, {
        ...cors,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      })
      res.end(body)
      return
    }

    if (req.method === 'GET' && req.url === '/native/health') {
      void handleHealth(res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/analyze-downbeats') {
      void handleAnalyzeDownbeats(req, res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/suggest-section-borders') {
      void handleSuggestSectionBorders(req, res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/analyze-chord-chroma') {
      void handleAnalyzeChordChroma(req, res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/align-audio') {
      void handleAlignAudio(req, res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/shift-audio') {
      void handleShiftAudio(req, res, cors)
      return
    }

    if (req.method === 'POST' && (req.url === '/native/separate-stems' || req.url?.startsWith('/native/separate-stems?'))) {
      void handleSeparateStems(req, res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/auto-stems/watch') {
      void handleAutoStemsWatch(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/auto-stems/unwatch') {
      void handleAutoStemsUnwatch(req, res, cors)
      return
    }
    if (req.method === 'GET' && req.url === '/native/auto-stems/status') {
      const statuses = autoStemsDaemon ? autoStemsDaemon.getStatuses() : []
      const watched = autoStemsDaemon ? [...autoStemsDaemon._watched] : []
      sendJson(res, 200, { ok: true, statuses, watched }, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/auto-stems/retry') {
      void handleAutoStemsRetry(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/auto-stems/restart') {
      void handleAutoStemsRestart(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/update/install') {
      void handleUpdateInstall(req, res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/import/youtube') {
      void handleYoutubeImport(req, res, cors)
      return
    }

    if (req.method === 'GET' && req.url?.startsWith('/native/import/youtube/artifact/')) {
      const m = req.url.match(/^\/native\/import\/youtube\/artifact\/([^/?]+)(?:\?.*)?$/)
      if (m?.[1]) {
        handleGetYoutubeImportArtifact(req, res, cors, decodeURIComponent(m[1]))
        return
      }
    }

    if (req.method === 'GET' && req.url === '/native/setup/sections/status') {
      handleSectionsSetupStatus(res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/analyze-bass') {
      void handleAnalyzeBass(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/analyze-drums') {
      void handleAnalyzeDrums(req, res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/setup/sections') {
      void handleSetupSections(req, res, cors)
      return
    }

    if (req.method === 'GET' && req.url === '/native/setup/lyrics/status') {
      void handleLyricsSetupStatus(res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/setup/lyrics') {
      void handleSetupLyrics(req, res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/transcribe-lyrics') {
      void handleTranscribeLyrics(req, res, cors)
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

    if (req.method === 'GET' && req.url === '/native/setup/youtube-import/status') {
      void handleYoutubeImportSetupStatus(res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/setup/youtube-import') {
      void handleSetupYoutubeImport(req, res, cors)
      return
    }

    if (req.method === 'GET' && req.url === '/native/setup/beats/status') {
      handleBeatsSetupStatus(res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/setup/beats') {
      void handleSetupBeats(req, res, cors)
      return
    }
    // Aggregated auto-setup state. The web app polls this to render
    // the "setting up audio engine…" UI while runAutoSetup() walks the
    // missing venvs at sidecar boot.
    if (req.method === 'GET' && req.url === '/native/setup/status') {
      handleAutoSetupStatus(res, cors)
      return
    }

    // Live-console control is origin-gated (see isHardwareOriginAllowed) — a
    // random page must never be able to move the desk's faders.
    if (req.url?.startsWith('/native/hardware/') && !isHardwareOriginAllowed(req.headers.origin)) {
      logWarn(`xair: refused hardware request from origin ${req.headers.origin}`)
      sendJson(res, 403, { ok: false, error: 'Origin not allowed for hardware control' }, cors)
      return
    }

    if (req.method === 'GET' && req.url === '/native/hardware/status') {
      handleHardwareStatus(res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/hardware/xair/connect') {
      void handleXAirConnect(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/hardware/xair/disconnect') {
      void handleXAirDisconnect(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/hardware/xair/main-fader') {
      void handleXAirMainFader(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/hardware/xair/channel-fader') {
      void handleXAirChannelFader(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/hardware/xair/channel-on') {
      void handleXAirChannelOn(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/hardware/xair/bus-send') {
      void handleXAirBusSend(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/hardware/xair/channel-main-assign') {
      void handleXAirChannelMainAssign(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/hardware/xair/bus-fader') {
      void handleXAirBusFader(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/hardware/xair/refresh') {
      void handleXAirRefresh(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/hardware/xair/query') {
      void handleXAirQuery(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/hardware/xair/meters') {
      void handleXAirMeters(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/hardware/xair/discover') {
      void handleXAirDiscover(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/hardware/xair/osc-int') {
      void handleXAirOscInt(req, res, cors)
      return
    }

    if (req.method === 'POST' && req.url === '/native/pick-folder') {
      void handlePickFolder(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/pick-save-file') {
      void handlePickSaveFile(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/pick-open-file') {
      void handlePickOpenFile(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/hydration/export') {
      void handleHydrationExport(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/hydration/import') {
      void handleHydrationImport(req, res, cors)
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
      void projectAssetRoutes.write(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/song/asset/remove') {
      void projectAssetRoutes.remove(req, res, cors)
      return
    }
    if (req.method === 'GET' && req.url?.startsWith('/native/project/song/asset/read')) {
      const u = new URL(req.url, `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`)
      projectAssetRoutes.read(req, res, cors, u)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/song/audio/relink') {
      void handleProjectSongAudioRelink(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/asset/write') {
      void handleProjectAssetWrite(req, res, cors)
      return
    }
    if (req.method === 'GET' && req.url?.startsWith('/native/project/asset/read')) {
      const u = new URL(req.url, `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`)
      projectAssetRoutes.readRoot(req, res, cors, u)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/asset/remove') {
      void projectAssetRoutes.removeRoot(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/song/audio/scan') {
      void handleProjectSongAudioScan(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/wav-info/batch') {
      void handleProjectWavInfoBatch(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/transcode-to-wav') {
      void handleProjectTranscodeToWav(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/transcode-to-aac') {
      void handleProjectTranscodeToAac(req, res, cors)
      return
    }
    if (req.method === 'POST' && req.url === '/native/project/pitch-shift-cache') {
      void handleProjectPitchShiftCache(req, res, cors)
      return
    }
    if (req.method === 'GET' && req.url === '/native/transpose/status') {
      void handleTransposeStatus(res, cors)
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
    // /native/jobs/:jobId/pause              (POST)  — SIGSTOP the child
    // /native/jobs/:jobId/resume             (POST)  — SIGCONT the child
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
      if (req.method === 'POST' && sub === 'pause') {
        void handlePauseJob(res, cors, jobId)
        return
      }
      if (req.method === 'POST' && sub === 'resume') {
        void handleResumeJob(res, cors, jobId)
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

    // Not a sidecar route. In the gig build the bundled app answers it; the
    // headless sidecar has nothing to serve and still 404s.
    if (offlineUiHandler && !isSidecarRoute(req.url ?? '/')) {
      // No `cors` here on purpose: this is same-origin, and SvelteKit sets its
      // own headers.
      offlineUiHandler(req, res, () => {
        res.writeHead(404, cors)
        res.end()
      })
      return
    }

    res.writeHead(404, cors)
    res.end()
  })

  // ONE error handler. There were two — one logging, one quitting — which meant
  // a port conflict produced two different messages and it was never obvious
  // which behaviour won.
  beaconServer.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE') {
      logError(`Port ${BARBRO_DESKTOP_BEACON_PORT} is already in use — another copy is running. Quitting.`)
      // SAY SO before disappearing. Quitting silently is how this turns into
      // "I launched BarBro Desktop and a window flashed up saying the desktop
      // app wasn't connected" — the window had loaded from the OTHER copy, and
      // this one vanished without ever explaining itself.
      try {
        dialog.showErrorBox(
          'BarBro Desktop is already running',
          `Another copy is using port ${BARBRO_DESKTOP_BEACON_PORT}.\n\n` +
            'Quit the other one first — check your Dock, and any terminal running ' +
            '`npm run dev --prefix desktop`.',
        )
      } catch {
        /* no display available — the log line above is the fallback */
      }
      app.quit()
      return
    }
    logError(`Beacon server error: ${e instanceof Error ? e.message : String(e)}`)
  })
  beaconServer.listen(BARBRO_DESKTOP_BEACON_PORT, '127.0.0.1', () => {
    beaconListening = true
    broadcastStatus()
    logInfo(`Beacon listening on 127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`)
    // Kick off auto-setup right after the loopback is reachable. It
    // hits its own setup endpoints via fetch, so the listener must be
    // up first. Runs in the background — doesn't block boot.
    void runAutoSetup().catch((e) => {
      logError(`auto-setup: ${e instanceof Error ? e.message : String(e)}`)
    })
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

// ── Window lifecycle: closing a window must NEVER stop the sidecar ─────────
//
// Electron's default is to quit when the last window closes. That default is
// actively dangerous here: somebody can be mid-session on barbro.app in their
// browser, close the little status window because it is in the way, and the
// analysis/stems/file endpoints the website depends on would vanish under them.
// The website would then say "BarBro Desktop isn't running" with no clue why.
//
// So the app outlives its windows, and quitting is an explicit act: Cmd+Q or
// the dock menu on macOS, the tray on Windows.
app.on('window-all-closed', () => {
  // Deliberately empty. Do not call app.quit().
})

// macOS: clicking the dock icon with no windows open brings the status window
// back. Without this the window would be gone for good once closed, and there
// would be no way to reach the offline-mode switch again.
app.on('activate', () => {
  createStatusWindow()
})

// ── Auto stem-separation daemon ─────────────────────────────────────────────
//
// The BACKGROUND brain for the project-wide "prepare stems automatically"
// policy. Lives here (not the web app) so it keeps working while the desktop
// app runs, regardless of whether a browser tab is open. Off unless a watched
// project's manifest has `autoStems.enabled`. See autoStems.mjs.

/** @type {ReturnType<typeof createAutoStemsDaemon> | null} */
let autoStemsDaemon = null

/** Maps the project's quality slug → demucs args (mirrors STEM_QUALITY_PRESETS). */
const AUTO_STEM_PRESET_ARGS = {
  best: { model: 'htdemucs_ft', shifts: 10, overlap: 0.5 },
  balanced: { model: 'htdemucs_ft', shifts: 5, overlap: 0.25 },
  preview: { model: 'htdemucs', shifts: 1, overlap: 0.25 },
}

function autoStemsWatchFilePath() {
  return path.join(app.getPath('userData'), 'auto-stems-watch.json')
}

function setupAutoStemsDaemon() {
  if (autoStemsDaemon) return
  autoStemsDaemon = createAutoStemsDaemon({
    readManifest: (projectPath) => readProjectManifest(projectPath),
    readSmapHeader: (smapPath) => readSmapHeaderJson(smapPath),
    listStemSets: (folderAbs) => listStemSets(folderAbs),
    readStemProvenance: (folderAbs) => readStemProvenance(folderAbs),
    wavInfo: (abs) => {
      try {
        if (!existsSync(abs)) return null
        const info = readAudioInfo(abs)
        return { ...info, fileSize: statSync(abs).size }
      } catch {
        return null
      }
    },
    enqueueJob: async ({ inputPath, outputDir, stems, quality, songId }) => {
      const preset = AUTO_STEM_PRESET_ARGS[quality] ?? AUTO_STEM_PRESET_ARGS.balanced
      try {
        const { jobId } = await createStemsJob({
          inputPath,
          outputDir,
          model: preset.model,
          shifts: preset.shifts,
          overlap: preset.overlap,
          stems: stems.join(','),
          songId: songId ?? null,
        })
        return jobId
      } catch (e) {
        logWarn(`auto-stems: enqueue failed: ${e instanceof Error ? e.message : String(e)}`)
        return null
      }
    },
    hasInflightJobForSong: (songId) => hasInflightStemJobForSong(songId),
    // Safety filters: don't auto-run the stem engine when it isn't installed
    // (repeated failed spawns), and never pile onto a busy queue — the daemon
    // enqueues at most one job at a time and waits for it to drain.
    stemsReady: () => stemsVenvIsReady(),
    anyStemJobActive: () => {
      for (const j of stemsJobs.values()) {
        if (j.state === 'queued' || j.state === 'running' || j.state === 'paused') return true
      }
      return false
    },
    loadWatched: () => {
      try {
        const raw = JSON.parse(readFileSync(autoStemsWatchFilePath(), 'utf8'))
        return Array.isArray(raw) ? raw.filter((p) => typeof p === 'string') : []
      } catch {
        return []
      }
    },
    saveWatched: (paths) => {
      try {
        writeFileSync(autoStemsWatchFilePath(), JSON.stringify(paths, null, 2))
      } catch (e) {
        logWarn(`auto-stems: could not persist watch list: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
    existsSync,
    log: logInfo,
  })
  autoStemsDaemon.start()
}

/**
 * `POST /native/auto-stems/watch` — body `{ projectPath }`. Registers a
 * project for background stem preparation. The daemon reads the project's
 * `autoStems` policy from its manifest each pass, so enabling/disabling is a
 * manifest write (no separate call). Idempotent; persisted across restarts.
 */
async function handleAutoStemsWatch(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (!existsSync(projectPath)) {
      return sendJson(res, 404, { ok: false, error: `projectPath not found: ${projectPath}` }, cors)
    }
    if (!autoStemsDaemon) setupAutoStemsDaemon()
    autoStemsDaemon.watchProject(projectPath)
    sendJson(res, 200, { ok: true }, cors)
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
  }
}

/**
 * `POST /native/auto-stems/unwatch` — body `{ projectPath }`. Per-machine
 * opt-OUT: this device stops auto-preparing stems for the project (the shared
 * project config is untouched). Lets a collaborator wait for a package instead
 * of grinding on splits.
 */
async function handleAutoStemsUnwatch(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (autoStemsDaemon) autoStemsDaemon.unwatchProject(projectPath)
    sendJson(res, 200, { ok: true }, cors)
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
  }
}

/**
 * `POST /native/auto-stems/retry` — body `{ projectPath, folder }`. Clears one
 * song's attempt budget + status so the daemon re-evaluates it on the next
 * pass (used by the per-song "Retry" button after an abandon/failure).
 */
async function handleAutoStemsRetry(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    const folder = typeof body.folder === 'string' ? body.folder.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (!folder) return sendJson(res, 400, { ok: false, error: 'folder is required' }, cors)
    if (!autoStemsDaemon) setupAutoStemsDaemon()
    autoStemsDaemon.retrySong(path.join(projectPath, folder))
    sendJson(res, 200, { ok: true }, cors)
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
  }
}

/**
 * `POST /native/auto-stems/restart` — body `{ projectPath }`. Clears every
 * attempt budget for a project + re-scans, so all abandoned songs get another
 * shot ("Restart auto-split").
 */
async function handleAutoStemsRestart(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    if (!body) return sendJson(res, 400, { ok: false, error: 'Body must be JSON' }, cors)
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    ensureAbsolutePath(projectPath, 'projectPath')
    if (!autoStemsDaemon) setupAutoStemsDaemon()
    autoStemsDaemon.resetAttempts(projectPath)
    sendJson(res, 200, { ok: true }, cors)
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
  }
}

/**
 * `POST /native/update/install` — body `{ artifacts }` (the web's
 * `desktop-downloads.json` artifacts map). Downloads the DMG matching THIS
 * machine's arch and opens it in Finder so the user can drag-install and
 * relaunch. This is the "one-click update" — as close to auto-update as we
 * can get without code-signing/notarization (which macOS requires for true
 * silent updates).
 */
async function handleUpdateInstall(req, res, cors) {
  try {
    const body = await readRequestJson(req)
    const artifacts = body && typeof body.artifacts === 'object' && body.artifacts ? body.artifacts : {}
    const key = process.platform === 'win32' ? 'win-x64' : `darwin-${process.arch}`
    const entry = artifacts[key]
    const url = entry && typeof entry.url === 'string' ? entry.url.trim() : ''
    if (!/^https:\/\//i.test(url)) {
      return sendJson(res, 400, { ok: false, error: `No download available for ${key}` }, cors)
    }
    logInfo(`update: downloading ${url}`)
    let dl
    try {
      dl = await fetch(url, { redirect: 'follow' })
    } catch (e) {
      return sendJson(res, 502, { ok: false, error: `Download failed: ${e instanceof Error ? e.message : String(e)}` }, cors)
    }
    if (!dl.ok) {
      return sendJson(res, 502, { ok: false, error: `Download failed: HTTP ${dl.status}` }, cors)
    }
    const bytes = Buffer.from(await dl.arrayBuffer())
    const dir = await mkdtemp(path.join(tmpdir(), 'barbro-update-'))
    const installerPath = path.join(
      dir,
      process.platform === 'win32' ? 'BarBro-Desktop-update.exe' : 'BarBro-Desktop-update.dmg',
    )
    await writeFile(installerPath, bytes)
    logInfo(`update: opening installer ${installerPath} (${(bytes.length / 1_048_576).toFixed(1)} MB)`)
    const openErr = await shell.openPath(installerPath)
    if (openErr) {
      return sendJson(res, 500, { ok: false, error: `Could not open installer: ${openErr}` }, cors)
    }
    sendJson(res, 200, { ok: true }, cors)
    if (process.platform === 'win32') {
      // NSIS can't replace files of a running app — quit shortly after
      // responding; runAfterFinish relaunches the new build.
      setTimeout(() => app.quit(), 1500)
    }
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }, cors)
  }
}

/**
 * Windows quit affordance. The sidecar is headless (no window, and Windows
 * has no dock), so without a tray icon the only way to stop it would be
 * Task Manager. 16×16 PNG embedded as base64 — no packaged asset needed.
 */
let trayRef = null // module-level: prevents GC from eating the tray icon
function createTrayIfNeeded() {
  if (process.platform !== 'win32') return
  try {
    // Solid orange square with a dark border — legible at 16px on light and
    // dark taskbars.
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVR4nGP8z8Dwn4ECwESJ5lED' +
      'GBhYGBgYGP7DwH+kAIwMDIwMlLpg1IBRAxgZKc7OTJQaMPDZGQC66Qsjw1a1BQAAAABJRU5ErkJg' +
      'gg=='
    const icon = nativeImage.createFromDataURL(`data:image/png;base64,${png}`)
    trayRef = new Tray(icon)
    const version = readDesktopVersion()
    trayRef.setToolTip(`BarBro Desktop v${version}`)
    trayRef.setContextMenu(
      Menu.buildFromTemplate([
        { label: `BarBro Desktop v${version}`, enabled: false },
        { type: 'separator' },
        // Windows has no dock to click, so the tray is the only way back to the
        // status window — and therefore to the offline-mode switch — once it
        // has been closed.
        { label: 'Show BarBro Desktop', click: () => createStatusWindow() },
        { type: 'separator' },
        { label: 'Quit BarBro Desktop', click: () => app.quit() },
      ]),
    )
  } catch (e) {
    logWarn(`tray: ${e instanceof Error ? e.message : String(e)}`)
  }
}

app.whenReady().then(async () => {
  // Existing installs: surface the bundled audio converter under its
  // canonical name (pure fs copy; no-op when absent or already done).
  void ensureManagedFfmpegBinary().catch(() => null)

  createTrayIfNeeded()

  const version = readDesktopVersion()
  logInfo(`BarBro desktop sidecar v${version} starting`)
  logInfo(`PID ${process.pid} · Node ${process.versions.node} · Electron ${process.versions.electron}`)

  // ALWAYS start as the sidecar. That is what BarBro Desktop is: the thing you
  // download from barbro.app so the website can analyse, split stems and reach
  // your files. Offline mode is a switch in the status window, never a decision
  // the app makes on your behalf.
  startBeaconServer()
  logInfo(`Sidecar. Reachable at http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}/`)
  createStatusWindow()

  // The one exception, for developing offline mode: `npm run offline:desktop`
  // sets BARBRO_OFFLINE_UI=1 so it goes straight in instead of needing a click.
  if (shouldAutoOpenOfflineUi()) {
    if (await initOfflineUi()) openOfflineWindow()
    broadcastStatus()
  }

  logInfo(`Endpoints:`)
  logInfo(`  GET    /ping`)
  logInfo(`  POST   /native/analyze-downbeats`)
  logInfo(`  POST   /native/suggest-section-borders  (X-Bars-Json header; body = WAV)`)
  logInfo(`  POST   /native/analyze-chord-chroma     (X-Beats-Json header; body = WAV)`)
  logInfo(`  POST   /native/analyze-drums            (JSON {stemAbsPath} → drum hits)`)
  logInfo(`  POST   /native/analyze-bass             (JSON {stemAbsPath} → bass notes)`)
  logInfo(`  GET    /native/setup/sections/status    (check librosa venv readiness)`)
  logInfo(`  POST   /native/setup/sections           (create venv + pip install librosa)`)
  logInfo(`  POST   /native/separate-stems        (returns jobId immediately; queue runs serially)`)
  logInfo(`  GET    /native/jobs`)
  logInfo(`  GET    /native/jobs/:jobId/events    (NDJSON stream + replay)`)
  logInfo(`  POST   /native/jobs/:jobId/pause     (SIGSTOP the Demucs child)`)
  logInfo(`  POST   /native/jobs/:jobId/resume    (SIGCONT to thaw)`)
  logInfo(`  DELETE /native/jobs/:jobId           (cancel queued / running / paused)`)
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
  logInfo(`  POST   /native/project/song/audio/relink (OS file picker → copy into <song>/audio + SHA)`)
  logInfo(`  POST   /native/project/asset/write     (write file at project root, e.g. setlist .als)`)
  logInfo(`  GET    /native/project/asset/read      (stream a file at project root, e.g. offline-session.json)`)
  logInfo(`  POST   /native/project/asset/remove    (delete a file at project root)`)
  logInfo(`  POST   /native/project/wav-info/batch  (batched WAV header info — duration/sr/channels)`)
  logInfo(`  POST   /native/project/transcode-to-wav (ffmpeg: MP3→WAV for setlist export)`)
  logInfo(`  POST   /native/project/transcode-to-aac (ffmpeg: mix/stem WAV→AAC for cloud audio)`)
  logInfo(`  GET    /native/transpose/status          (Rubber Band availability)`)
  logInfo(`  POST   /native/project/pitch-shift-cache (Rubber Band transpose cache)`)
  logInfo(`  GET    /native/hardware/status           (MIDI/XR18 bridge state)`)
  logInfo(`  POST   /native/hardware/xair/connect     (JSON {host, port?})`)
  logInfo(`  POST   /native/hardware/xair/disconnect`)
  logInfo(`  POST   /native/hardware/xair/main-fader`)
  logInfo(`  POST   /native/hardware/xair/channel-fader`)
  logInfo(`  POST   /native/hardware/xair/channel-on`)
  logInfo(`  POST   /native/hardware/xair/bus-send`)
  logInfo(`  POST   /native/hardware/xair/channel-main-assign (FOH-safety: off the house bus)`)
  logInfo(`  POST   /native/hardware/xair/bus-fader`)
  logInfo(`  POST   /native/hardware/xair/refresh   (read desk state back — proves FOH safety)`)
  logInfo(`  GET    /native/setup/youtube-import/status`)
  logInfo(`  POST   /native/setup/youtube-import (prepare YouTube audio import)`)
  logInfo(`  POST   /native/import/youtube       (queued YouTube audio import)`)
  logInfo(`  GET    /native/import/youtube/artifact/:jobId`)
  logInfo(`  GET    /native/setup/piper-tts/status`)
  logInfo(`  POST   /native/setup/piper-tts       (venv + piper-tts + default voice)`)
  logInfo(`  GET    /native/tts/hello-world         (debug WAV: "Hello world.")`)
  logInfo(`  POST   /native/tts/synthesize          (JSON {text} → WAV)`)
  logInfo(`  POST   /native/auto-stems/watch      (register a project for background stem prep)`)
  logInfo(`Stems venv ${stemsVenvIsReady() ? 'READY' : 'NOT INSTALLED'}: ${getStemsVenvDir()}`)
  logInfo(`YouTube import ${youtubeImportVenvIsReady() ? 'READY' : 'NOT INSTALLED'}: ${getYoutubeImportVenvDir()}`)
  logInfo(`Piper TTS ${piperTtsVenvIsReady() ? 'venv OK' : 'venv missing'} · ${getPiperTtsVenvDir()}`)
  // Resume background stem prep for projects watched in a previous session.
  setupAutoStemsDaemon()
  void recoverInterruptedStemJobs().catch((e) => {
    logWarn(`stems: recovery failed: ${e instanceof Error ? e.message : String(e)}`)
  })
})

app.on('before-quit', () => {
  logInfo('Shutting down')
  closeXAirClient()
  if (autoStemsDaemon) autoStemsDaemon.stop()
  stopBeaconServer()
  // Wipe any pending stems temp dirs synchronously-ish — fire-and-forget,
  // but at least clear the map so timers don't fire after quit.
  for (const jobId of [...stemsJobs.keys()]) {
    void destroyStemsJob(jobId)
  }
})
