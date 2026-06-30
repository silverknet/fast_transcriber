/**
 * Web-side mirror of the desktop sidecar's stem-separation job queue.
 *
 * The sidecar holds the source of truth (queue order, running child,
 * event buffer); this store reflects what the UI cares about — per-song
 * status, last log line, progress percentages — and routes
 * lifecycle events to a `finalizer` callback that knows where to write
 * the resulting stems (the song's project folder).
 *
 * Single-concurrency on the sidecar means multiple enqueued jobs run
 * serially; the web store can hold any number of jobs in `queued` or
 * `running` state. Terminal jobs (`done`/`cancelled`/`error`) stay in the
 * store until either the UI dismisses them or `releaseStemsJob` is called
 * during the finalize step.
 */

import { get, writable } from 'svelte/store'
import {
  cancelJob as cancelJobOnSidecar,
  pauseJob as pauseJobOnSidecar,
  resumeJob as resumeJobOnSidecar,
  releaseStemsJob,
  listJobsResult,
  subscribeToJobEvents,
  type DesktopJobView,
  type JobControlResult,
  type StemJobState,
  type StemName,
  type StemSeparationEvent,
} from '$lib/client/desktopBridge'

export interface StemJobEntry {
  jobId: string
  /** The song this job was started from. Used to filter status per card. */
  songId: string | null
  state: StemJobState
  /** Last-known step label from a `progress` event. */
  label: string
  /** Demucs stems this job is rendering. Drives per-stem "in progress" dots. */
  stems: StemName[]
  currentPct: number
  overallPct: number
  /** Trailing log lines (capped) for the in-card log box. */
  log: string[]
  /** Files reported by the sidecar after `done`. */
  files: string[]
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  /** Active subscription disconnector. Internal — UI shouldn't touch. */
  unsubscribe: (() => void) | null
}

const LOG_TAIL = 80

const VALID_STEMS: readonly StemName[] = ['vocals', 'drums', 'bass', 'other']

/** Parse the sidecar's comma-joined `options.stems` back into typed names. */
function parseStemsOption(raw: string | undefined): StemName[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is StemName => (VALID_STEMS as readonly string[]).includes(s))
}

export const stemJobs = writable<Map<string, StemJobEntry>>(new Map())

/**
 * Optional finalizer per jobId — invoked when the job reaches `done`. Lets
 * the song's panel write the stems to its project folder without forcing
 * a parent-child callback chain.
 */
type FinalizerFn = (entry: StemJobEntry) => void | Promise<void>
const finalizers = new Map<string, FinalizerFn>()

/** Replace the entry by jobId, preserving identity if unchanged. */
function patchEntry(jobId: string, patch: Partial<StemJobEntry>): StemJobEntry | null {
  let next: StemJobEntry | null = null
  stemJobs.update((m) => {
    const existing = m.get(jobId)
    if (!existing) return m
    next = { ...existing, ...patch }
    const out = new Map(m)
    out.set(jobId, next)
    return out
  })
  return next
}

function appendLog(jobId: string, msg: string) {
  stemJobs.update((m) => {
    const existing = m.get(jobId)
    if (!existing) return m
    const log = [...existing.log, msg]
    if (log.length > LOG_TAIL) log.splice(0, log.length - LOG_TAIL)
    const out = new Map(m)
    out.set(jobId, { ...existing, log })
    return out
  })
}

function handleEvent(jobId: string, ev: StemSeparationEvent) {
  switch (ev.type) {
    case 'log':
      appendLog(jobId, ev.msg)
      break
    case 'progress':
      patchEntry(jobId, {
        label: ev.label,
        currentPct: Math.max(0, Math.min(100, ev.current)),
        overallPct: Math.max(0, Math.min(100, ev.overall)),
      })
      break
    case 'done':
      patchEntry(jobId, { files: ev.files })
      appendLog(jobId, `Done. ${ev.files.length} stem${ev.files.length === 1 ? '' : 's'} ready.`)
      break
    case 'error':
      patchEntry(jobId, { error: ev.msg })
      appendLog(jobId, `⛔  ${ev.msg}`)
      break
    case 'state': {
      // Track previous state so we can log "Resumed" only when coming back
      // from a pause (not on the initial queued → running transition).
      const prevState = get(stemJobs).get(jobId)?.state ?? null
      patchEntry(jobId, {
        state: ev.state,
        // Only stamp finishedAt for terminal states. `paused` keeps the
        // job mid-flight — we don't want it auto-filed under "done".
        finishedAt:
          ev.state === 'done' || ev.state === 'error' || ev.state === 'cancelled'
            ? new Date().toISOString()
            : null,
      })
      if (ev.state === 'paused') appendLog(jobId, '⏸  Paused.')
      else if (ev.state === 'running' && prevState === 'paused') appendLog(jobId, '▶  Resumed.')
      if (ev.state === 'done') {
        const entry = get(stemJobs).get(jobId)
        const finalize = finalizers.get(jobId)
        if (entry && finalize) {
          finalizers.delete(jobId)
          void Promise.resolve(finalize(entry)).catch(() => {})
        }
      }
      break
    }
    case 'cleanup':
      removeJob(jobId)
      break
  }
}

/** Register a job freshly returned from `enqueueStemSeparation`. */
export function registerStemJob(args: {
  jobId: string
  songId: string | null
  /** Demucs stems this job targets — surfaced as per-stem dots. */
  stems?: StemName[]
  /** Optional: invoked once when state becomes `done`. */
  onDone?: FinalizerFn
}): void {
  const { jobId, songId, stems, onDone } = args
  if (get(stemJobs).has(jobId)) return
  const entry: StemJobEntry = {
    jobId,
    songId,
    state: 'queued',
    label: 'Queued',
    stems: stems ?? [],
    currentPct: 0,
    overallPct: 0,
    log: [],
    files: [],
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    unsubscribe: null,
  }
  if (onDone) finalizers.set(jobId, onDone)
  stemJobs.update((m) => {
    const out = new Map(m)
    out.set(jobId, entry)
    return out
  })
  const unsub = subscribeToJobEvents(
    jobId,
    (ev) => handleEvent(jobId, ev),
    (err) => appendLog(jobId, `(stream error) ${err.message}`),
  )
  patchEntry(jobId, { unsubscribe: unsub })
}

/**
 * Reconcile the store with the sidecar's current view — e.g. on page load
 * after a refresh. Adds any sidecar jobs we don't already track; does not
 * remove jobs that aren't on the sidecar (the cleanup event handles that).
 */
export function hydrateFromSidecar(jobs: DesktopJobView[]): void {
  for (const j of jobs) {
    if (j.kind && j.kind !== 'stems') continue
    if (get(stemJobs).has(j.jobId)) continue
    const entry: StemJobEntry = {
      jobId: j.jobId,
      // Carry the sidecar-persisted songId through (was lost in v1).
      songId: j.songId,
      state: j.state,
      label: j.state === 'running' ? 'Running' : j.state === 'queued' ? 'Queued' : j.state,
      stems: parseStemsOption(j.options?.stems),
      currentPct: 0,
      overallPct: 0,
      log: [],
      files: j.files,
      error: j.error,
      createdAt: j.createdAt,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      unsubscribe: null,
    }
    stemJobs.update((m) => {
      const out = new Map(m)
      out.set(j.jobId, entry)
      return out
    })
    // Only subscribe to non-terminal jobs — terminal ones close immediately
    // after replay so the subscription is moot.
    if (j.state === 'queued' || j.state === 'running') {
      const unsub = subscribeToJobEvents(
        j.jobId,
        (ev) => handleEvent(j.jobId, ev),
        (err) => appendLog(j.jobId, `(stream error) ${err.message}`),
      )
      patchEntry(j.jobId, { unsubscribe: unsub })
    }
  }
}

/**
 * Drop web-side jobs the sidecar no longer knows about. A job left in a
 * non-terminal state (`queued` / `running` / `paused`) after the companion
 * restarted would otherwise block its song forever — `activeJobForSong`
 * keeps returning it and the auto-stems scheduler skips that song. `liveJobIds`
 * MUST come from a successful sidecar response (see `listJobsResult`); never
 * reap on an unreachable blip.
 */
export function reapOrphanedJobs(liveJobIds: Set<string>): void {
  for (const [jobId, e] of get(stemJobs)) {
    const nonTerminal = e.state === 'queued' || e.state === 'running' || e.state === 'paused'
    if (nonTerminal && !liveJobIds.has(jobId)) removeJob(jobId)
  }
}

/**
 * One-shot reconcile against the sidecar: add jobs we don't track yet and
 * reap orphaned non-terminal ones. No-op when the sidecar can't be reached
 * (so a transient failure can't wipe live jobs).
 */
export async function syncStemJobsWithSidecar(): Promise<void> {
  const res = await listJobsResult()
  if (!res.ok) return
  hydrateFromSidecar(res.jobs)
  reapOrphanedJobs(new Set(res.jobs.map((j) => j.jobId)))
}

/** Drop a job from the store (and abort its subscription if any). */
export function removeJob(jobId: string): void {
  const existing = get(stemJobs).get(jobId)
  if (!existing) return
  try {
    existing.unsubscribe?.()
  } catch {
    /* ignore */
  }
  finalizers.delete(jobId)
  stemJobs.update((m) => {
    const out = new Map(m)
    out.delete(jobId)
    return out
  })
}

/** Cancel a job on the sidecar + drop from store after the cancel takes effect. */
export async function cancelStemJob(jobId: string): Promise<void> {
  await cancelJobOnSidecar(jobId)
  // The sidecar emits a `state: 'cancelled'` event followed by `cleanup`
  // after TTL. We don't remove eagerly — the UI can show the cancelled
  // entry briefly so the user sees what happened.
}

/**
 * Pause a running stems job (SIGSTOP on the desktop sidecar). The store
 * updates via the streamed `state: 'paused'` event, not here. Returns the
 * sidecar's reply so the caller can surface invalid-transition errors.
 */
export async function pauseStemJob(jobId: string): Promise<JobControlResult> {
  return pauseJobOnSidecar(jobId)
}

/** Resume a paused stems job (SIGCONT). State update flows in via NDJSON. */
export async function resumeStemJob(jobId: string): Promise<JobControlResult> {
  return resumeJobOnSidecar(jobId)
}

/** Release the sidecar's temp dir (called after stems are fetched). */
export async function releaseStemJob(jobId: string): Promise<void> {
  await releaseStemsJob(jobId)
  removeJob(jobId)
}

/** Convenience selectors. */
export function jobsForSong(songId: string): StemJobEntry[] {
  return [...get(stemJobs).values()].filter((j) => j.songId === songId)
}

/**
 * In-flight = queued, running, or paused. A paused job still occupies the
 * song's slot (the sidecar's queue worker treats it as the current job), so
 * for UI purposes "is this song busy with stems?" is true while paused too.
 */
export function activeJobForSong(songId: string): StemJobEntry | null {
  for (const j of get(stemJobs).values()) {
    if (j.songId !== songId) continue
    if (j.state === 'queued' || j.state === 'running' || j.state === 'paused') {
      return j
    }
  }
  return null
}
