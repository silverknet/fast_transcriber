/**
 * Resolve bundled desktop/native/python paths (dev vs packaged asar.unpacked)
 * and the standardized stems venv under Electron's userData dir.
 */

import { app } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
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

/**
 * @param {string} pyExe
 * @param {string} scriptPath
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {Promise<{ code: number | null; stdout: string; stderr: string }>}
 */
export function runPythonCapture(pyExe, scriptPath, args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(pyExe, [scriptPath, ...args], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
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
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}
