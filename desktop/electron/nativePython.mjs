/**
 * Resolve bundled desktop/native/python paths (dev vs packaged asar.unpacked)
 * and the standardized stems venv under Electron's userData dir.
 */

import { app } from 'electron'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function getNativePythonRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'native', 'python')
  }
  return path.resolve(path.join(__dirname, '..', 'native', 'python'))
}

export function beatsScriptPath() {
  return path.join(getNativePythonRoot(), 'beats', 'analyze_downbeats.py')
}

export function stemsScriptPath() {
  return path.join(getNativePythonRoot(), 'stems', 'demucs_separate.py')
}

/** Section-border suggester (`desktop/native/python/sections/border_suggest.py`). */
export function sectionsScriptPath() {
  return path.join(getNativePythonRoot(), 'sections', 'border_suggest.py')
}

/** Per-beat chroma + key detection (`desktop/native/python/sections/chord_chroma.py`). Reuses the sections venv. */
export function chordChromaScriptPath() {
  return path.join(getNativePythonRoot(), 'sections', 'chord_chroma.py')
}

/** Piper TTS — isolated from beats/stems (`desktop/native/python/piper_tts/`). */
export function piperTtsScriptPath() {
  return path.join(getNativePythonRoot(), 'piper_tts', 'synthesize_wav.py')
}

/**
 * Piper venv under userData (same pattern as stems-venv).
 * `~/Library/Application Support/<app>/python/piper-tts-venv`
 */
export function getPiperTtsVenvDir() {
  return path.join(app.getPath('userData'), 'python', 'piper-tts-venv')
}

export function getPiperTtsVenvPythonExe() {
  const venv = getPiperTtsVenvDir()
  if (process.platform === 'win32') {
    return path.join(venv, 'Scripts', 'python.exe')
  }
  return path.join(venv, 'bin', 'python3')
}

export function piperTtsVenvIsReady() {
  return existsSync(getPiperTtsVenvPythonExe())
}

/** Voice models live next to the venv under userData (downloaded on demand). */
export function getPiperTtsModelDir() {
  return path.join(app.getPath('userData'), 'python', 'piper-tts', 'models')
}

/** Default debug voice (matches Hugging Face piper-voices layout). */
export function getPiperTtsDefaultModelOnnxPath() {
  return path.join(getPiperTtsModelDir(), 'en_US-lessac-medium.onnx')
}

/**
 * Interpreter for Piper: `BARBRO_PYTHON_PIPER_TTS` → venv → `BARBRO_PYTHON` → python3.
 */
export function pythonPiperTtsExe() {
  const override = process.env.BARBRO_PYTHON_PIPER_TTS?.trim()
  if (override) return override
  if (piperTtsVenvIsReady()) return getPiperTtsVenvPythonExe()
  return process.env.BARBRO_PYTHON?.trim() || 'python3'
}

/** Interpreter with madmom — default `BARBRO_PYTHON` or system python3 */
export function pythonBeatsExe() {
  return process.env.BARBRO_PYTHON?.trim() || 'python3'
}

/**
 * Standardized sections venv path under userData. Mirrors the stems / piper
 * venv layout — auto-created via `/native/setup/sections`, survives launches.
 *   ~/Library/Application Support/<app>/python/sections-venv
 */
export function getSectionsVenvDir() {
  return path.join(app.getPath('userData'), 'python', 'sections-venv')
}

export function getSectionsVenvPythonExe() {
  const venv = getSectionsVenvDir()
  if (process.platform === 'win32') {
    return path.join(venv, 'Scripts', 'python.exe')
  }
  return path.join(venv, 'bin', 'python3')
}

export function sectionsVenvIsReady() {
  return existsSync(getSectionsVenvPythonExe())
}

/**
 * Resolution order for the section-borders interpreter:
 *   1. `BARBRO_PYTHON_SECTIONS` env override (power users / CI)
 *   2. The standardized userData venv (auto-installed)
 *   3. `BARBRO_PYTHON` (only useful if librosa is already in that env)
 *   4. `python3` on PATH (last-resort; will likely fail import)
 */
export function pythonSectionsExe() {
  const override = process.env.BARBRO_PYTHON_SECTIONS?.trim()
  if (override) return override
  if (sectionsVenvIsReady()) return getSectionsVenvPythonExe()
  return process.env.BARBRO_PYTHON?.trim() || 'python3'
}

/**
 * Standardized stems venv path under userData. Same path on every run, so
 * once Demucs is pip-installed it survives across launches. Format:
 *   ~/Library/Application Support/<app>/python/stems-venv
 */
export function getStemsVenvDir() {
  return path.join(app.getPath('userData'), 'python', 'stems-venv')
}

/** Platform-specific python3 inside the stems venv. */
export function getStemsVenvPythonExe() {
  const venv = getStemsVenvDir()
  if (process.platform === 'win32') {
    return path.join(venv, 'Scripts', 'python.exe')
  }
  return path.join(venv, 'bin', 'python3')
}

/** True iff the stems venv exists on disk (cheap exec check). */
export function stemsVenvIsReady() {
  return existsSync(getStemsVenvPythonExe())
}

/**
 * Resolution order for the stems interpreter:
 *   1. `BARBRO_PYTHON_STEMS` env override (power users / CI)
 *   2. The standardized userData venv (if pip-installed already)
 *   3. `BARBRO_PYTHON` (fallback to whatever beats uses)
 *   4. `python3` on PATH
 */
export function pythonStemsExe() {
  const override = process.env.BARBRO_PYTHON_STEMS?.trim()
  if (override) return override
  if (stemsVenvIsReady()) return getStemsVenvPythonExe()
  return process.env.BARBRO_PYTHON?.trim() || 'python3'
}

/**
 * The python3 used to *create* the venv. Always falls back to a system
 * interpreter — there's no venv yet at this point.
 */
export function bootstrapPythonExe() {
  return process.env.BARBRO_BOOTSTRAP_PYTHON?.trim() || process.env.BARBRO_PYTHON?.trim() || 'python3'
}

// ── uv (Astral) — Rust-based Python toolchain manager ────────────────────────
//
// uv replaces our old "find a working system Python + ensurepip + pip"
// dance with a single static binary that:
//   • creates virtualenvs (no ensurepip → immune to libexpat / ABI issues)
//   • downloads sealed Python distributions itself when a usable one isn't
//     on the system, so we don't depend on brew / pyenv / apt at all
//   • installs packages 10-50× faster than pip
//
// Apache 2.0 license. Single ~14 MB binary per platform. We download it once
// into userData and reuse forever.

const UV_VERSION = '0.5.18'

export function getUvBinDir() {
  return path.join(app.getPath('userData'), 'python', 'bin')
}

export function getUvBinaryPath() {
  return path.join(getUvBinDir(), process.platform === 'win32' ? 'uv.exe' : 'uv')
}

export function uvBinaryIsReady() {
  return existsSync(getUvBinaryPath())
}

/**
 * Asset filename for the current platform/arch, matching the layout of
 * https://github.com/astral-sh/uv/releases. Returns `null` for unsupported
 * targets so the caller can surface a clear error.
 */
function uvAssetFilename() {
  const p = process.platform
  const a = process.arch
  if (p === 'darwin' && a === 'arm64') return 'uv-aarch64-apple-darwin.tar.gz'
  if (p === 'darwin' && a === 'x64') return 'uv-x86_64-apple-darwin.tar.gz'
  if (p === 'linux' && a === 'x64') return 'uv-x86_64-unknown-linux-gnu.tar.gz'
  if (p === 'linux' && a === 'arm64') return 'uv-aarch64-unknown-linux-gnu.tar.gz'
  if (p === 'win32' && a === 'x64') return 'uv-x86_64-pc-windows-msvc.zip'
  return null
}

export function uvDownloadUrl() {
  const asset = uvAssetFilename()
  if (!asset) return null
  return `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`
}

export const UV_PINNED_VERSION = UV_VERSION

/**
 * Download + extract the uv binary into `getUvBinDir()`. Returns
 * `{ ok: true }` on success or `{ ok: false, error }`. `emit` receives log
 * lines so the install endpoint can stream progress to the UI.
 *
 * Uses Node's built-in `fetch` for the download and the system `tar` (or
 * Windows' bundled `tar`) for extraction. Tarballs contain
 * `uv-<target>/uv` so we strip the top directory.
 */
export async function downloadAndExtractUv(emit = () => {}) {
  const url = uvDownloadUrl()
  if (!url) {
    return {
      ok: false,
      error: `No uv build for ${process.platform}-${process.arch}.`,
    }
  }
  const asset = uvAssetFilename()
  const binDir = getUvBinDir()
  await mkdir(binDir, { recursive: true })

  const tmpFile = path.join(
    await (async () => {
      const { mkdtemp } = await import('node:fs/promises')
      return mkdtemp(path.join(tmpdir(), 'barbro-uv-'))
    })(),
    asset,
  )

  emit({ type: 'log', msg: `Downloading uv ${UV_VERSION} from GitHub releases…` })
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) {
      return { ok: false, error: `uv download HTTP ${res.status}` }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFile(tmpFile, buf)
    emit({ type: 'log', msg: `Downloaded ${(buf.byteLength / 1_048_576).toFixed(1)} MB` })
  } catch (e) {
    return { ok: false, error: `uv download failed: ${e instanceof Error ? e.message : e}` }
  }

  emit({ type: 'log', msg: 'Extracting uv…' })
  const extractArgs = asset.endsWith('.zip')
    ? ['-xf', tmpFile, '-C', binDir]
    : ['-xzf', tmpFile, '-C', binDir, '--strip-components=1']
  const extractCode = await new Promise((resolve) => {
    const c = spawn('tar', extractArgs, { stdio: 'pipe' })
    let stderr = ''
    c.stderr.on('data', (d) => (stderr += d))
    c.on('close', (code) => {
      if (code !== 0) emit({ type: 'log', msg: `tar stderr: ${stderr.trim().slice(0, 240)}` })
      resolve(code)
    })
    c.on('error', () => resolve(1))
  })
  if (extractCode !== 0) {
    return { ok: false, error: `tar extract failed (exit ${extractCode})` }
  }

  // .zip on Windows extracts into uv-<target>/uv.exe; flatten if needed.
  if (asset.endsWith('.zip')) {
    const nested = path.join(binDir, asset.replace('.zip', ''), 'uv.exe')
    if (existsSync(nested)) {
      const { rename } = await import('node:fs/promises')
      await rename(nested, getUvBinaryPath())
    }
  }

  const uvPath = getUvBinaryPath()
  if (!existsSync(uvPath)) {
    return { ok: false, error: 'uv binary not found after extract' }
  }
  if (process.platform !== 'win32') {
    await chmod(uvPath, 0o755)
  }
  await rm(tmpFile, { force: true }).catch(() => {})
  return { ok: true }
}

/**
 * Hash of the requirements.txt content used to build the sections venv.
 * Written to a marker file inside the venv on successful install; checked
 * by `sectionsLibrosaReady()` so that a `requirements.txt` edit (e.g.
 * pinning librosa) automatically invalidates the existing venv and forces
 * a fresh rebuild on next entry to Sections mode.
 */
export function sectionsRequirementsHash() {
  try {
    const reqPath = path.join(getNativePythonRoot(), 'sections', 'requirements.txt')
    const buf = readFileSync(reqPath)
    return createHash('sha256').update(buf).digest('hex').slice(0, 16)
  } catch {
    return 'no-requirements'
  }
}

function getSectionsVenvMarkerFile() {
  return path.join(getSectionsVenvDir(), '.barbro-reqs-hash')
}

export function sectionsVenvMarkerIsCurrent() {
  try {
    const stored = readFileSync(getSectionsVenvMarkerFile(), 'utf8').trim()
    return stored === sectionsRequirementsHash()
  } catch {
    return false
  }
}

/** Write the requirements hash marker after a successful install. */
export async function writeSectionsVenvMarker() {
  try {
    await writeFile(getSectionsVenvMarkerFile(), sectionsRequirementsHash() + '\n')
  } catch {
    /* best-effort — analysis still works without the marker, just won't
       auto-detect future requirement changes. */
  }
}

/**
 * Confirm the resolved sections interpreter can `import librosa, numpy,
 * scipy` AND that the installed packages match the current
 * `requirements.txt` (via the marker file). Used by
 * `/native/setup/sections/status` so a half-broken or out-of-date venv
 * doesn't report `ready: true`.
 *
 * Cheap-ish (~500 ms) on first call; cached for `LIBROSA_PROBE_TTL_MS`.
 * Cache is invalidated by `invalidateSectionsLibrosaCache()` after the
 * install endpoint touches the venv.
 */
const LIBROSA_PROBE_TTL_MS = 30_000
let _librosaReadyCache = null // null | { ready: boolean; checkedAt: number; exe: string }

export function invalidateSectionsLibrosaCache() {
  _librosaReadyCache = null
}

export async function sectionsLibrosaReady() {
  const exe = pythonSectionsExe()
  const now = Date.now()
  if (
    _librosaReadyCache &&
    _librosaReadyCache.exe === exe &&
    now - _librosaReadyCache.checkedAt < LIBROSA_PROBE_TTL_MS
  ) {
    return _librosaReadyCache.ready
  }
  if (!existsSync(exe)) {
    _librosaReadyCache = { ready: false, checkedAt: now, exe }
    return false
  }
  // Stop here if the requirements have changed since the venv was built.
  // The install endpoint will detect this and rebuild from scratch.
  if (!sectionsVenvMarkerIsCurrent()) {
    _librosaReadyCache = { ready: false, checkedAt: now, exe }
    return false
  }
  const ready = await new Promise((resolve) => {
    let settled = false
    const child = spawn(exe, ['-c', 'import librosa, numpy, scipy'], {
      stdio: 'ignore',
      env: process.env,
    })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      resolve(false)
    }, 8_000)
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(code === 0)
    })
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(false)
    })
  })
  _librosaReadyCache = { ready, checkedAt: Date.now(), exe }
  return ready
}

/**
 * @param {string} pyExe
 * @param {string} scriptPath
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {Promise<{ code: number | null; stdout: string; stderr: string }>}
 */
export function runPythonCapture(pyExe, scriptPath, args, timeoutMs = 120_000, stdinPayload) {
  return new Promise((resolve, reject) => {
    const child = spawn(pyExe, [scriptPath, ...args], {
      env: process.env,
      stdio: [stdinPayload != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Python timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout?.on('data', (d) => {
      stdout += d
    })
    child.stderr?.on('data', (d) => {
      stderr += d
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    // `close` fires with (code, signal). When the process is terminated by
    // a signal (SIGKILL, SIGABRT, ...) `code` is `null` and `signal` carries
    // the actual cause — we surface it so callers can log accurately.
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal: signal ?? null, stdout: stdout.trim(), stderr: stderr.trim() })
    })
    if (stdinPayload != null && child.stdin) {
      child.stdin.end(stdinPayload)
    }
  })
}
