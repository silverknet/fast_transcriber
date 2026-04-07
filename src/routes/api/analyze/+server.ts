import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { env as privateEnv } from '$env/dynamic/private'
import { json } from '@sveltejs/kit'
import { getAnalyzeDownbeatsScriptPath } from '$lib/server/analysis/analysisPaths'
import { beatsToSongMap } from '$lib/server/analysis/beatsToSongMap'
import { readWavDurationSec } from '$lib/server/analysis/wavDuration'
import type { AnalyzeFailure, AnalyzeRequest, AnalyzeSuccess } from '$lib/server/analysis/contracts'

/** WAV uploads can be large vs MP3; keep below typical reverse-proxy limits (~100MB). */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
const ALLOWED_TYPES = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'])
const ANALYZE_TIMEOUT_MS = 120_000

/**
 * SvelteKit loads `.env` into `$env/dynamic/private`, not `process.env`. Check both.
 */
function pythonExecutableRaw(): string {
  return (
    privateEnv.PYTHON ??
    privateEnv.BARBRO_PYTHON ??
    process.env.PYTHON ??
    process.env.BARBRO_PYTHON ??
    'python3'
  )
}

function toAbsoluteInterpreterPath(raw: string): string {
  if (raw === 'python3' || raw === 'python') {
    return raw
  }
  if (raw.startsWith('/')) {
    return raw
  }
  if (/^[A-Za-z]:[\\/]/.test(raw)) {
    return raw
  }
  return resolve(process.cwd(), raw)
}

/**
 * Some venvs only ship `.venv/bin/python3`, not `.venv/bin/python`. ENOENT otherwise.
 */
function resolvePythonExecutable(): string {
  const raw = pythonExecutableRaw()
  const candidate = toAbsoluteInterpreterPath(raw)
  if (existsSync(candidate)) {
    return candidate
  }
  if (raw.endsWith('/python') || raw.endsWith('\\python')) {
    const alt = raw.slice(0, -'python'.length) + 'python3'
    const altPath = toAbsoluteInterpreterPath(alt)
    if (existsSync(altPath)) {
      return altPath
    }
  }
  return candidate
}

const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))

/** Map Python stderr / spawn errors to a short, actionable client message. */
function userFacingAnalyzeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/timed out/i.test(msg)) {
    return 'Analysis timed out. Try a shorter clip or increase server resources.'
  }
  if (/ENOENT|spawn .* ENOENT/i.test(msg) || /not found/i.test(msg)) {
    return `Python not found (${pythonExecutableRaw()}). Set PYTHON=.venv/bin/python3 in .env (repo root) and restart dev, or run: bash src/lib/server/analysis/python/install-deps.sh`
  }
  if (/No module named ['"]?madmom['"]?/i.test(msg) || /madmom import failed/i.test(msg)) {
    return (
      'madmom is not installed for the Python used by the server. Run: bash src/lib/server/analysis/python/install-deps.sh — then set PYTHON=.venv/bin/python3 in .env (repo root) and restart npm run dev.'
    )
  }
  return 'Beat detection failed. See the terminal for details.'
}

function runPythonScript(scriptPath: string, wavPath: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const cmd = resolvePythonExecutable()
    console.info('[analyze] spawn', cmd)
    const child = spawn(cmd, [scriptPath, wavPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      if (!settled) {
        settled = true
        reject(new Error(`Python timed out after ${ANALYZE_TIMEOUT_MS}ms`))
      }
    }, ANALYZE_TIMEOUT_MS)

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        reject(err)
      }
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(stderr || `Python exited with code ${code}`))
    })
  })
}

export async function POST({ request }: { request: Request }) {
  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    const body: AnalyzeFailure = { ok: false, error: 'Missing file field' }
    return json(body, { status: 400 })
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    const body: AnalyzeFailure = { ok: false, error: `Unsupported file type: ${file.type}` }
    return json(body, { status: 415 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const body: AnalyzeFailure = {
      ok: false,
      error: `File too large (max ${MAX_UPLOAD_MB} MB after trim). Shorten the selection or raise the limit in /api/analyze.`,
    }
    return json(body, { status: 413 })
  }

  const req: AnalyzeRequest = {
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  }

  const scriptPath = getAnalyzeDownbeatsScriptPath()
  if (!existsSync(scriptPath)) {
    console.error('[analyze] Script not found:', scriptPath)
    const body: AnalyzeFailure = { ok: false, error: 'Analysis script is not available on the server.' }
    return json(body, { status: 500 })
  }

  let workDir: string | undefined

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    workDir = await mkdtemp(join(tmpdir(), 'barbro-analyze-'))
    const wavPath = join(workDir, 'clip.wav')
    await writeFile(wavPath, buf)

    let stdout: string
    let stderr: string
    try {
      ;({ stdout, stderr } = await runPythonScript(scriptPath, wavPath))
    } catch (e) {
      console.error('[analyze] Python failed:', e)
      const body: AnalyzeFailure = { ok: false, error: userFacingAnalyzeError(e) }
      return json(body, { status: 503 })
    }

    if (stderr) {
      console.warn('[analyze] Python stderr:', stderr.slice(0, 2000))
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(stdout.trim())
    } catch {
      console.error('[analyze] Invalid JSON from Python:', stdout.slice(0, 500))
      const body: AnalyzeFailure = { ok: false, error: 'Invalid output from analysis' }
      return json(body, { status: 500 })
    }

    const beatsRaw = parsed as { beats?: unknown }
    if (!Array.isArray(beatsRaw.beats)) {
      const body: AnalyzeFailure = { ok: false, error: 'Analysis returned no beats array' }
      return json(body, { status: 500 })
    }

    const rows = beatsRaw.beats.map((b) => {
      const o = b as Record<string, unknown>
      return {
        time: Number(o.time),
        beatInBar: Number(o.beatInBar),
      }
    })

    let durationSec: number
    try {
      durationSec = readWavDurationSec(buf)
    } catch {
      const lastT = rows.length ? Math.max(...rows.map((r) => r.time)) : 0
      durationSec = lastT + 0.5
    }

    let songMap
    try {
      songMap = beatsToSongMap({
        filename: file.name,
        durationSec,
        mimeType: file.type,
        beats: rows,
      })
    } catch (e) {
      console.error('[analyze] beatsToSongMap:', e)
      const body: AnalyzeFailure = {
        ok: false,
        error: e instanceof Error ? e.message : 'Could not build SongMap',
      }
      return json(body, { status: 500 })
    }

    const res: AnalyzeSuccess = {
      ok: true,
      status: 'complete',
      message: 'Analysis complete',
      request: req,
      songMap,
    }
    return json(res)
  } finally {
    if (workDir) {
      try {
        await rm(workDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
}
