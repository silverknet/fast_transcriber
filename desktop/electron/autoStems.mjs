/**
 * Auto stem-separation daemon (sidecar side).
 *
 * This is the BACKGROUND brain for the project-wide "prepare stems
 * automatically" policy. It lives in the sidecar — not the web app — so it
 * keeps working whenever the desktop companion is running, regardless of
 * whether a browser tab is open. The web app only (a) writes the policy into
 * each project's `barbro.project.json` and (b) registers project paths to
 * watch; everything below runs here.
 *
 * Pure, dependency-free decision helpers are exported for unit testing. The
 * daemon itself takes all its I/O via injected `deps` so it never imports
 * `main.mjs` (no cycles) and stays testable.
 *
 * Safety properties (this runs unattended):
 *   - Off unless a watched project's manifest has `autoStems.enabled`.
 *   - Non-hidden songs WITH AUDIO are touched. Analysis (the beat grid) is NOT
 *     required — demucs separates the raw audio and doesn't use the grid.
 *   - Renders the FULL untrimmed source (trim-independent).
 *   - Partial/corrupt stem WAVs (companion killed mid-render) are detected
 *     and re-rendered.
 *   - Per-song attempt cap prevents render loops; one in-flight job per song.
 */

import path from 'node:path'

// ── Pure decision core ──────────────────────────────────────────────────────

/** Lower = higher quality. Mirrors STEM_PRESET_PRIORITY on the web side. */
export const PRESET_RANK = { best: 0, balanced: 1, preview: 2, legacy: 3 }
const UNKNOWN_RANK = 99
const STEM_NAMES = ['vocals', 'drums', 'bass', 'other']

/** `stems/<slug>/` for tagged presets, `stems/` for flat legacy files. */
export function pathPrefixForSlug(slug) {
  return slug === 'legacy' ? 'stems/' : `stems/${slug}/`
}

/** Relative-to-song-folder subpath of a located stem. */
export function stemSubpath(loc) {
  return `${pathPrefixForSlug(loc.slug)}${loc.filename}`
}

/**
 * Best (highest-quality) on-disk copy of each demucs stem from a
 * `stemsByPreset` map. Returns `Map<stemName, {rank, slug, filename}>`.
 */
export function bestStemOnDisk(stemsByPreset) {
  const out = new Map()
  for (const [slug, files] of Object.entries(stemsByPreset ?? {})) {
    if (!Array.isArray(files)) continue
    const rank = PRESET_RANK[slug] ?? UNKNOWN_RANK
    for (const filename of files) {
      const base = String(filename).toLowerCase().replace(/\.[^.]+$/, '')
      if (!STEM_NAMES.includes(base)) continue
      const existing = out.get(base)
      if (!existing || rank < existing.rank) out.set(base, { rank, slug, filename })
    }
  }
  return out
}

/** Configured stems that are missing or only present below the target quality. */
export function computeNeededStems(stemsByPreset, config) {
  const target = PRESET_RANK[config.quality] ?? UNKNOWN_RANK
  const have = bestStemOnDisk(stemsByPreset)
  return (config.stems ?? []).filter((s) => {
    const h = have.get(s)
    return !h || h.rank > target
  })
}

/** WAV-health heuristic — rejects missing / zero / grossly-truncated files. */
export function isStemWavHealthy(info) {
  if (!info) return false
  const { durationSec, sampleRate, channels, fileSize } = info
  if (!(durationSec > 0.5) || !(sampleRate > 0) || !(channels > 0) || !(fileSize > 0)) {
    return false
  }
  const min16BitBytes = durationSec * sampleRate * channels * 2
  return fileSize >= min16BitBytes * 0.5
}

/** A song is renderable once it has a beat grid. */
export function isSongAnalyzed(analyzedFlag, barCount) {
  return analyzedFlag === true || barCount > 0
}

/** Normalize a raw manifest `autoStems` block (defensive). null when off/absent. */
export function normalizeAutoStems(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (raw.enabled !== true) return null
  const stems = Array.isArray(raw.stems)
    ? raw.stems.filter((s) => STEM_NAMES.includes(s))
    : []
  if (stems.length === 0) return null
  const quality = ['best', 'balanced', 'preview'].includes(raw.quality) ? raw.quality : 'balanced'
  return { enabled: true, stems: [...new Set(stems)], quality }
}

// ── Daemon shell ────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 20_000
const MAX_ATTEMPTS = 3

/**
 * @param {Object} deps
 * @param {(projectPath: string) => Promise<any>} deps.readManifest
 * @param {(smapPath: string) => Promise<any>} deps.readSmapHeader  // {metadata,audio,timeline}|null
 * @param {(songFolderAbs: string) => Promise<Record<string,string[]>>} deps.listStemSets
 * @param {(absPath: string) => Promise<{durationSec,sampleRate,channels,fileSize}|null>} deps.wavInfo
 * @param {(args: {inputPath,outputDir,stems:string[],quality:string,songId:string|null}) => string|null} deps.enqueueJob
 * @param {(songId: string) => boolean} deps.hasInflightJobForSong
 * @param {() => string[]} deps.loadWatched
 * @param {(paths: string[]) => void} deps.saveWatched
 * @param {(existsSync: string) => boolean} deps.existsSync
 * @param {(msg: string) => void} deps.log
 * @param {number} [deps.intervalMs]
 */
export function createAutoStemsDaemon(deps) {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS
  /** @type {Set<string>} */
  const watched = new Set()
  /** Per-song (folderAbs) enqueue attempts since last success/reset. */
  const attempts = new Map()
  /**
   * Per-song (folderAbs) status for the web UI — so a song that isn't
   * splitting shows WHY (not analyzed / no audio / gave up after N) instead
   * of silently doing nothing. `{ folder, songId, phase, attempts, reason,
   * stems, updatedAt }`. Phases: blocked | queued | running | ready |
   * failed | abandoned.
   */
  const statuses = new Map()
  /** Last failure reason per song (folderAbs), surfaced on `abandoned`. */
  const lastErrorByKey = new Map()
  /** Per-project normalized-policy fingerprint — reset attempts when it changes. */
  const policyHashByProject = new Map()

  function setStatus(songKey, patch) {
    const prev = statuses.get(songKey) ?? {}
    statuses.set(songKey, { ...prev, ...patch, updatedAt: Date.now() })
  }

  /** Clear attempt budget + status for keys under `projectPath` (or all). */
  function clearBudgets(projectPath) {
    for (const key of [...attempts.keys()]) {
      if (!projectPath || key.startsWith(projectPath)) attempts.delete(key)
    }
    for (const key of [...statuses.keys()]) {
      if (!projectPath || key.startsWith(projectPath)) statuses.delete(key)
    }
    for (const key of [...lastErrorByKey.keys()]) {
      if (!projectPath || key.startsWith(projectPath)) lastErrorByKey.delete(key)
    }
  }
  /** @type {NodeJS.Timeout | null} */
  let timer = null
  let running = false
  let pending = false
  let stopped = true // not armed until start()

  function loadPersisted() {
    try {
      for (const p of deps.loadWatched() ?? []) watched.add(p)
    } catch {
      /* ignore */
    }
  }

  function persist() {
    try {
      deps.saveWatched([...watched])
    } catch {
      /* ignore */
    }
  }

  /** Register a project to keep prepared. Triggers a near-immediate scan. */
  function watchProject(projectPath) {
    if (typeof projectPath !== 'string' || !projectPath) return
    if (!watched.has(projectPath)) {
      watched.add(projectPath)
      persist()
      deps.log(`auto-stems: now watching ${projectPath}`)
    }
    schedule(250)
  }

  function schedule(delay = intervalMs) {
    if (stopped) return // never arm a timer after stop() (e.g. on app quit)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void tick()
    }, delay)
  }

  async function tick() {
    if (running) {
      pending = true
      return
    }
    running = true
    try {
      await runOnce()
    } catch (e) {
      deps.log(`auto-stems: tick error ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      running = false
      // Always re-arm the steady-state interval; collapse a pending burst.
      schedule(pending ? 500 : intervalMs)
      pending = false
    }
  }

  /** One full pass across every watched project. Exposed for tests. */
  async function runOnce() {
    // Don't touch anything unless the stem engine is installed — otherwise we'd
    // spawn failing renders unattended. Also don't pile onto a busy queue: the
    // daemon enqueues at most one job per pass and waits for it to drain.
    if (deps.stemsReady && !deps.stemsReady()) return
    if (deps.anyStemJobActive && deps.anyStemJobActive()) return
    for (const projectPath of [...watched]) {
      if (!deps.existsSync(projectPath)) {
        // Project folder gone (deleted / unmounted) — drop it.
        watched.delete(projectPath)
        persist()
        continue
      }
      let manifest
      try {
        manifest = await deps.readManifest(projectPath)
      } catch {
        continue // unreadable manifest — try again next tick
      }
      const policy = normalizeAutoStems(manifest?.autoStems)

      // Reset attempt budgets when the policy (stems/quality) changes, so
      // songs that were abandoned under the old settings get another shot.
      const policyHash = JSON.stringify(policy)
      if (policyHashByProject.get(projectPath) !== policyHash) {
        clearBudgets(projectPath)
        policyHashByProject.set(projectPath, policyHash)
      }

      if (!policy) continue

      for (const entry of manifest.songs ?? []) {
        if (entry.hidden) continue
        await prepareSong(projectPath, entry, policy)
      }
    }
  }

  async function prepareSong(projectPath, entry, policy) {
    const folderAbs = path.join(projectPath, entry.folder)
    const songKey = folderAbs
    const base = { folder: entry.folder, songId: entry.id ?? null }

    if (entry.id && deps.hasInflightJobForSong(entry.id)) {
      setStatus(songKey, { ...base, phase: 'running' })
      return
    }

    let stemsByPreset
    try {
      stemsByPreset = await deps.listStemSets(folderAbs)
    } catch {
      return
    }

    const needed = computeNeededStems(stemsByPreset, policy)

    // Corruption check on the stems we believe are satisfied.
    const have = bestStemOnDisk(stemsByPreset)
    for (const stem of policy.stems) {
      if (needed.includes(stem)) continue
      const loc = have.get(stem)
      if (!loc) continue
      let info = null
      try {
        info = await deps.wavInfo(path.join(folderAbs, stemSubpath(loc)))
      } catch {
        info = null
      }
      if (!isStemWavHealthy(info)) needed.push(stem)
    }

    if (needed.length === 0) {
      attempts.delete(songKey)
      lastErrorByKey.delete(songKey)
      setStatus(songKey, { ...base, phase: 'ready', attempts: 0, reason: null })
      return
    }

    if ((attempts.get(songKey) ?? 0) >= MAX_ATTEMPTS) {
      setStatus(songKey, {
        ...base,
        phase: 'abandoned',
        attempts: attempts.get(songKey),
        stems: needed,
        reason:
          lastErrorByKey.get(songKey) ??
          `Auto-split gave up after ${MAX_ATTEMPTS} attempts. Use Retry to try again.`,
      })
      return
    }

    // One job at a time: once anything is queued/running (incl. a job we just
    // enqueued earlier in this same pass), stop enqueuing more.
    if (deps.anyStemJobActive && deps.anyStemJobActive()) return

    // Read the smap once to resolve the source audio path. Stem separation
    // (demucs) works on the raw audio and does NOT need the beat grid — so we
    // do NOT gate on `analyzed`; any song with audio can be split.
    const smapPath = path.join(folderAbs, 'song.smap')
    let header
    try {
      header = await deps.readSmapHeader(smapPath)
    } catch {
      return
    }
    if (!header) {
      setStatus(songKey, { ...base, phase: 'blocked', reason: 'Could not read the song.' })
      return
    }
    const sm = header.songMap ?? header // tolerate either shape
    const rel = sm?.audio?.originalPath
    if (!rel) {
      setStatus(songKey, {
        ...base,
        phase: 'blocked',
        reason: 'No audio yet — add or import audio for this song first.',
      })
      return
    }

    const inputPath = path.join(folderAbs, rel)
    if (!deps.existsSync(inputPath)) {
      setStatus(songKey, { ...base, phase: 'blocked', reason: 'Audio file is missing on disk.' })
      return
    }

    const outputDir = path.join(folderAbs, 'stems', policy.quality)
    attempts.set(songKey, (attempts.get(songKey) ?? 0) + 1)
    const jobId = await deps.enqueueJob({
      inputPath,
      outputDir,
      stems: needed,
      quality: policy.quality,
      songId: entry.id ?? null,
    })
    setStatus(songKey, {
      ...base,
      phase: 'queued',
      attempts: attempts.get(songKey),
      stems: needed,
      reason: null,
    })
    if (jobId) {
      deps.log(
        `auto-stems: queued ${needed.join(',')} @ ${policy.quality} for ${entry.folder} (${jobId.slice(0, 8)})`,
      )
    }
  }

  /** Call when a job for a folder succeeds, to clear its attempt budget. */
  function noteSongSatisfied(folderAbs) {
    attempts.delete(folderAbs)
    lastErrorByKey.delete(folderAbs)
    setStatus(folderAbs, { phase: 'ready', attempts: 0, reason: null, stems: [] })
  }

  /** Call when a job for a folder fails, to record why (surfaced on abandon). */
  function noteSongFailed(folderAbs, reason) {
    const msg = typeof reason === 'string' && reason ? reason : 'Stem split failed.'
    lastErrorByKey.set(folderAbs, msg)
    setStatus(folderAbs, { phase: 'failed', reason: msg })
  }

  /** Snapshot of per-song status for the web UI. */
  function getStatuses() {
    return [...statuses.entries()].map(([key, v]) => ({ key, ...v }))
  }

  /**
   * Force a song back into the queue: clears its attempt budget + status so
   * the next pass re-evaluates it. Returns true (always) so the caller can
   * report success. `schedule` triggers a near-immediate re-scan.
   */
  function retrySong(folderAbs) {
    attempts.delete(folderAbs)
    lastErrorByKey.delete(folderAbs)
    statuses.delete(folderAbs)
    schedule(250)
    return true
  }

  /** Clear all attempt budgets (optionally for one project) + re-scan. */
  function resetAttempts(projectPath) {
    clearBudgets(projectPath || undefined)
    schedule(250)
  }

  function start() {
    stopped = false
    loadPersisted()
    schedule(1000)
  }

  function stop() {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
    running = false
    pending = false
  }

  return {
    watchProject,
    start,
    stop,
    runOnce,
    noteSongSatisfied,
    noteSongFailed,
    getStatuses,
    retrySong,
    resetAttempts,
    _watched: watched,
    _attempts: attempts,
    _statuses: statuses,
  }
}
