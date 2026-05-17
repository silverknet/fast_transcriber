/**
 * Web ⇄ desktop bridge over the same loopback the `/ping` beacon uses.
 *
 * The desktop client is **headless**: all UI stays in this web app. Native
 * jobs (beats analysis, stems, Piper TTS, OS pickers) are reachable only when the
 * Electron sidecar is running and `desktopCompanionStatus.reachable` is true.
 *
 * Keep the URL base in sync with `desktop/electron/main.mjs` —
 * `BARBRO_DESKTOP_BEACON_PORT` is the single source of truth for the port.
 */

import { BARBRO_DESKTOP_BEACON_PORT } from './desktopBeacon'
import type { RawBeatRow } from '$lib/analysis/beatsToSongMap'

const BASE_URL = `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`

const ANALYZE_DOWNBEATS_URL = `${BASE_URL}/native/analyze-downbeats`
const SEPARATE_STEMS_URL = `${BASE_URL}/native/separate-stems`
const PIPER_TTS_SETUP_STATUS_URL = `${BASE_URL}/native/setup/piper-tts/status`
const PIPER_TTS_SETUP_URL = `${BASE_URL}/native/setup/piper-tts`
const TTS_HELLO_WORLD_URL = `${BASE_URL}/native/tts/hello-world`
const TTS_SYNTHESIZE_URL = `${BASE_URL}/native/tts/synthesize`

export type DesktopAnalyzeResult =
  | { ok: true; beats: RawBeatRow[] }
  | { ok: false; error: string }

/**
 * Send WAV bytes to the desktop sidecar and receive raw beats rows back.
 * Caller is responsible for running `beatsToSongMap()` against the result.
 *
 * Returns a typed Result rather than throwing so the analyze UI can fall
 * back to `/api/analyze` cleanly on any failure (sidecar offline, Python
 * missing, audio rejected, etc.).
 */
export async function analyzeDownbeatsViaDesktop(
  wavBlob: Blob,
  signal?: AbortSignal,
): Promise<DesktopAnalyzeResult> {
  let res: Response
  try {
    res = await fetch(ANALYZE_DOWNBEATS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: wavBlob,
      signal,
      cache: 'no-store',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Desktop sidecar unreachable: ${msg}` }
  }

  let data: unknown
  try {
    data = await res.json()
  } catch {
    return { ok: false, error: `Desktop sidecar returned non-JSON (HTTP ${res.status})` }
  }

  const o = data as { ok?: boolean; error?: string; data?: { beats?: unknown } }

  if (!res.ok || o.ok !== true) {
    return { ok: false, error: o.error ?? `Desktop analyze failed (HTTP ${res.status})` }
  }

  const beatsRaw = o.data?.beats
  if (!Array.isArray(beatsRaw)) {
    return { ok: false, error: 'Desktop analyzer returned no beats array' }
  }

  const beats: RawBeatRow[] = []
  for (const b of beatsRaw) {
    const r = b as Record<string, unknown>
    const time = Number(r.time)
    const beatInBar = Number(r.beatInBar)
    if (Number.isFinite(time) && Number.isFinite(beatInBar)) {
      beats.push({ time, beatInBar })
    }
  }

  return { ok: true, beats }
}

// ── Stem separation ────────────────────────────────────────────────────────

/**
 * Quality presets mirror the Tkinter stem_splitter app. Each preset has a
 * stable `slug` used as the on-disk subfolder name (`<song>/stems/<slug>/`)
 * so a song can hold multiple renderings side by side and the mixer can
 * always pick the highest-quality set available.
 */
export type StemQualityPreset = {
  /** Stable identifier, used as the stems subfolder name and as a quality key. */
  slug: 'best' | 'balanced' | 'preview'
  label: string
  model: string
  shifts: number
  overlap: number
}

export const STEM_QUALITY_PRESETS: StemQualityPreset[] = [
  { slug: 'best',     label: 'Best — htdemucs_ft, shifts 10 (slow)',    model: 'htdemucs_ft', shifts: 10, overlap: 0.5 },
  { slug: 'balanced', label: 'Balanced — htdemucs_ft, shifts 5 (medium)', model: 'htdemucs_ft', shifts: 5, overlap: 0.25 },
  { slug: 'preview',  label: 'Preview — htdemucs, shifts 1 (fast)',       model: 'htdemucs', shifts: 1, overlap: 0.25 },
]

/**
 * Priority order — first wins. The `legacy` slug refers to flat-layout
 * stems left over from before this split (i.e. `<song>/stems/vocals.wav`
 * with no preset subfolder). They're treated as the lowest-quality
 * fallback so a re-render at any tier supersedes them automatically.
 */
export const STEM_PRESET_PRIORITY: readonly string[] = ['best', 'balanced', 'preview', 'legacy']

export type StemName = 'vocals' | 'drums' | 'bass' | 'other'

export type StemJobState = 'queued' | 'running' | 'done' | 'cancelled' | 'error'

/** Lifecycle + content events from the per-job NDJSON subscription. */
export type StemSeparationEvent =
  | { type: 'log'; msg: string }
  | { type: 'progress'; label: string; current: number; overall: number }
  | { type: 'done'; outputDir: string; files: string[] }
  | { type: 'error'; msg: string }
  | { type: 'state'; state: StemJobState }
  | { type: 'cleanup'; jobId: string }

export type EnqueueStemsOptions = {
  /**
   * Absolute OS path the sidecar reads. Either a regular audio file or a
   * BarBro `.smap` container (sidecar extracts the audio chunk).
   */
  inputPath: string
  /**
   * Absolute OS path where final stem WAVs land flat (`vocals.wav`,
   * `drums.wav`, …). The sidecar creates this if missing.
   */
  outputDir: string
  stems: StemName[]
  preset: StemQualityPreset
  /**
   * Web-side identifier (typically a `ProjectSongEntry.id`) the sidecar
   * persists with the job. Lets us match a `done`-but-unfetched job back
   * to a song after the web app reloads.
   */
  songId?: string | null
}

export type EnqueueStemsResult =
  | { ok: true; jobId: string; queuePosition: number }
  | { ok: false; error: string }

/**
 * Enqueue a stem-separation job on the desktop sidecar. **No audio bytes
 * cross HTTP** — the sidecar reads from `inputPath` and writes flat stem
 * files into `outputDir` directly. Returns the jobId immediately; the
 * sidecar runs jobs serially in a queue.
 *
 * Subscribe to progress via `subscribeToJobEvents(jobId)`. On `state:done`
 * the stems are already on disk — no fetch step needed.
 */
export async function enqueueStemSeparation(opts: EnqueueStemsOptions): Promise<EnqueueStemsResult> {
  let res: Response
  try {
    res = await fetch(SEPARATE_STEMS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputPath: opts.inputPath,
        outputDir: opts.outputDir,
        model: opts.preset.model,
        shifts: opts.preset.shifts,
        overlap: opts.preset.overlap,
        stems: opts.stems.join(','),
        songId: opts.songId ?? undefined,
      }),
      cache: 'no-store',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Desktop sidecar unreachable: ${msg}` }
  }
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return { ok: false, error: `Desktop sidecar returned non-JSON (HTTP ${res.status})` }
  }
  const o = data as { ok?: boolean; jobId?: string; queuePosition?: number; error?: string }
  if (!res.ok || o.ok !== true || !o.jobId) {
    return { ok: false, error: o.error ?? `Enqueue failed (HTTP ${res.status})` }
  }
  return { ok: true, jobId: o.jobId, queuePosition: o.queuePosition ?? 0 }
}

/**
 * Subscribe to the NDJSON progress stream for a job. The desktop sidecar
 * replays the full event buffer first, then streams new events live; the
 * connection closes when the job reaches a terminal state.
 *
 * Returns a `disconnect()` function the caller can invoke to abort early.
 */
export function subscribeToJobEvents(
  jobId: string,
  onEvent: (ev: StemSeparationEvent) => void,
  onError?: (err: Error) => void,
): () => void {
  const ctrl = new AbortController()

  void (async () => {
    let res: Response
    try {
      res = await fetch(`${BASE_URL}/native/jobs/${encodeURIComponent(jobId)}/events`, {
        signal: ctrl.signal,
        cache: 'no-store',
      })
    } catch (e) {
      if (!ctrl.signal.aborted) onError?.(e instanceof Error ? e : new Error(String(e)))
      return
    }
    if (!res.ok || !res.body) {
      onError?.(new Error(`Job event subscribe failed (HTTP ${res.status})`))
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    const handle = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return
      let ev: StemSeparationEvent
      try {
        ev = JSON.parse(trimmed) as StemSeparationEvent
      } catch {
        ev = { type: 'log', msg: trimmed }
      }
      onEvent(ev)
    }
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx = buffer.indexOf('\n')
        while (idx !== -1) {
          handle(buffer.slice(0, idx))
          buffer = buffer.slice(idx + 1)
          idx = buffer.indexOf('\n')
        }
      }
      if (buffer.trim()) handle(buffer)
    } catch (e) {
      if (!ctrl.signal.aborted) onError?.(e instanceof Error ? e : new Error(String(e)))
    }
  })()

  return () => ctrl.abort()
}

export type DesktopJobView = {
  jobId: string
  /** Optional songId the web client passed at enqueue time. */
  songId: string | null
  state: StemJobState
  files: string[]
  options: { model: string; shifts: number; overlap: number; stems: string }
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

// ── OS folder picker (via Electron dialog) ─────────────────────────────────

export type PickFolderResult =
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: string }

/**
 * Ask the desktop sidecar to open a native folder picker and return the
 * chosen absolute path. The path can then be sent in subsequent stems
 * requests so the sidecar reads/writes the project filesystem directly,
 * no audio bytes crossing HTTP.
 */
export async function pickFolderViaDesktop(opts?: {
  title?: string
  defaultPath?: string
}): Promise<PickFolderResult> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/native/pick-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts ?? {}),
      cache: 'no-store',
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  try {
    return (await res.json()) as PickFolderResult
  } catch {
    return { ok: false, error: `Picker returned non-JSON (HTTP ${res.status})` }
  }
}

/** Snapshot of all known jobs on the sidecar. Useful on reload. */
export async function listJobsViaDesktop(): Promise<DesktopJobView[]> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/native/jobs`, { cache: 'no-store' })
  } catch {
    return []
  }
  if (!res.ok) return []
  try {
    const data = (await res.json()) as { ok?: boolean; jobs?: DesktopJobView[] }
    return Array.isArray(data.jobs) ? data.jobs : []
  } catch {
    return []
  }
}

/**
 * Cancel a queued or running job (or destroy a terminal one). The sidecar
 * sends SIGTERM if the job is running.
 */
export async function cancelJob(jobId: string): Promise<void> {
  try {
    await fetch(`${BASE_URL}/native/jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
      cache: 'no-store',
    })
  } catch {
    /* best-effort */
  }
}

// ── Stems dependency setup ─────────────────────────────────────────────────

export type StemsSetupStatus = {
  ok: true
  ready: boolean
  venvDir: string
  venvPython: string | null
}

/** Cheap probe — does the sidecar already have a working Demucs venv? */
export async function getStemsSetupStatus(): Promise<StemsSetupStatus | null> {
  try {
    const res = await fetch(`${BASE_URL}/native/setup/stems/status`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as StemsSetupStatus
  } catch {
    return null
  }
}

export type StemsSetupEvent =
  | { type: 'log'; msg: string }
  | { type: 'progress'; label: string; current: number; overall: number }
  | { type: 'done'; venvPython: string }
  | { type: 'error'; msg: string }
  | { type: 'state'; state: 'done' | 'error' }

export type SetupStemsResult =
  | { ok: true; venvPython: string }
  | { ok: false; error: string }

/**
 * Create the stems venv on the sidecar and pip-install Demucs. Streams the
 * same NDJSON shape the stems job uses — callers can drive a progress UI
 * off `onEvent` and the result tells them whether the install succeeded.
 *
 * Re-running when the venv already exists is safe and quick (pip re-checks
 * each package).
 */
export async function setupStemsDeps(
  onEvent: (ev: StemsSetupEvent) => void,
  signal?: AbortSignal,
): Promise<SetupStemsResult> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/native/setup/stems`, {
      method: 'POST',
      cache: 'no-store',
      signal,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Desktop sidecar unreachable: ${msg}` }
  }
  if (!res.ok || !res.body) {
    return { ok: false, error: `Setup failed (HTTP ${res.status})` }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let venvPython: string | null = null
  let errorMsg: string | null = null

  const handle = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let ev: StemsSetupEvent
    try {
      ev = JSON.parse(trimmed) as StemsSetupEvent
    } catch {
      ev = { type: 'log', msg: trimmed }
    }
    if (ev.type === 'done') venvPython = ev.venvPython
    else if (ev.type === 'error') errorMsg = ev.msg
    onEvent(ev)
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx = buffer.indexOf('\n')
      while (idx !== -1) {
        handle(buffer.slice(0, idx))
        buffer = buffer.slice(idx + 1)
        idx = buffer.indexOf('\n')
      }
    }
    if (buffer.trim()) handle(buffer)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Setup stream interrupted: ${msg}` }
  }

  if (errorMsg) return { ok: false, error: errorMsg }
  if (!venvPython) return { ok: false, error: 'Setup did not report a venv path' }
  return { ok: true, venvPython }
}

// ── Piper TTS (desktop `piper_tts/` module) ─────────────────────────────────

export type PiperTtsSetupStatus = {
  ok: true
  ready: boolean
  venvDir: string
  venvPython: string | null
  modelDir: string
  modelPath: string
  modelPresent: boolean
  voiceId: string
}

export async function getPiperTtsSetupStatus(): Promise<PiperTtsSetupStatus | null> {
  try {
    const res = await fetch(PIPER_TTS_SETUP_STATUS_URL, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as PiperTtsSetupStatus
  } catch {
    return null
  }
}

/**
 * Create Piper venv, install `piper-tts`, download default voice. Same NDJSON
 * event shape as {@link setupStemsDeps}.
 */
export async function setupPiperTtsDeps(
  onEvent: (ev: StemsSetupEvent) => void,
  signal?: AbortSignal,
): Promise<SetupStemsResult> {
  let res: Response
  try {
    res = await fetch(PIPER_TTS_SETUP_URL, {
      method: 'POST',
      cache: 'no-store',
      signal,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Desktop sidecar unreachable: ${msg}` }
  }
  if (!res.ok || !res.body) {
    return { ok: false, error: `Piper setup failed (HTTP ${res.status})` }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let venvPython: string | null = null
  let errorMsg: string | null = null

  const handle = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let ev: StemsSetupEvent
    try {
      ev = JSON.parse(trimmed) as StemsSetupEvent
    } catch {
      ev = { type: 'log', msg: trimmed }
    }
    if (ev.type === 'done') venvPython = ev.venvPython
    else if (ev.type === 'error') errorMsg = ev.msg
    onEvent(ev)
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx = buffer.indexOf('\n')
      while (idx !== -1) {
        handle(buffer.slice(0, idx))
        buffer = buffer.slice(idx + 1)
        idx = buffer.indexOf('\n')
      }
    }
    if (buffer.trim()) handle(buffer)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Piper setup stream interrupted: ${msg}` }
  }

  if (errorMsg) return { ok: false, error: errorMsg }
  if (!venvPython) return { ok: false, error: 'Piper setup did not report a venv path' }
  return { ok: true, venvPython }
}

export type TtsHelloWorldResult =
  | { ok: true; blob: Blob }
  | { ok: false; error: string }

/** Debug: WAV from desktop Piper saying “Hello world.” */
export type TtsSynthesizeResult =
  | { ok: true; blob: Blob }
  | { ok: false; error: string }

/** Piper WAV for arbitrary short text (cue-track speech). Desktop sidecar only. */
export async function fetchDesktopTtsSynthesizeWav(
  text: string,
  signal?: AbortSignal,
): Promise<TtsSynthesizeResult> {
  const body = JSON.stringify({ text })
  try {
    const res = await fetch(TTS_SYNTHESIZE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
      cache: 'no-store',
      signal,
    })
    const ct = res.headers.get('content-type') ?? ''
    if (!res.ok) {
      if (ct.includes('application/json')) {
        try {
          const j = (await res.json()) as { error?: string; hint?: string }
          const parts = [j.error, j.hint].filter(Boolean)
          return { ok: false, error: parts.join(' — ') || `HTTP ${res.status}` }
        } catch {
          return { ok: false, error: `HTTP ${res.status}` }
        }
      }
      const t = await res.text()
      return { ok: false, error: t || `HTTP ${res.status}` }
    }
    if (!ct.includes('audio') && !ct.includes('octet-stream')) {
      return { ok: false, error: `Unexpected content type: ${ct || '(none)'}` }
    }
    return { ok: true, blob: await res.blob() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function fetchDesktopTtsHelloWorldWav(signal?: AbortSignal): Promise<TtsHelloWorldResult> {
  try {
    const res = await fetch(TTS_HELLO_WORLD_URL, { cache: 'no-store', signal })
    const ct = res.headers.get('content-type') ?? ''
    if (!res.ok) {
      if (ct.includes('application/json')) {
        try {
          const j = (await res.json()) as { error?: string; hint?: string }
          const parts = [j.error, j.hint].filter(Boolean)
          return { ok: false, error: parts.join(' — ') || `HTTP ${res.status}` }
        } catch {
          return { ok: false, error: `HTTP ${res.status}` }
        }
      }
      const t = await res.text()
      return { ok: false, error: t || `HTTP ${res.status}` }
    }
    if (!ct.includes('audio') && !ct.includes('octet-stream')) {
      return { ok: false, error: `Unexpected content type: ${ct || '(none)'}` }
    }
    return { ok: true, blob: await res.blob() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Best-effort: tell the desktop sidecar to clean up the temp dir for a job. */
export async function releaseStemsJob(jobId: string): Promise<void> {
  try {
    await fetch(`${BASE_URL}/native/stems/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
      cache: 'no-store',
    })
  } catch {
    // The sidecar TTL-cleans abandoned jobs after 30 min, so this is fine.
  }
}
