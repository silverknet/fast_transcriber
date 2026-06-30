import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { stemJobs, reapOrphanedJobs, type StemJobEntry } from './stemJobs'
import type { StemJobState } from '$lib/client/desktopBridge'

function entry(jobId: string, state: StemJobState): StemJobEntry {
  return {
    jobId,
    songId: 'song-1',
    state,
    label: '',
    stems: [],
    currentPct: 0,
    overallPct: 0,
    log: [],
    files: [],
    error: null,
    createdAt: '',
    startedAt: null,
    finishedAt: null,
    unsubscribe: null,
  }
}

beforeEach(() => stemJobs.set(new Map()))

describe('reapOrphanedJobs — never-stuck guarantee', () => {
  it('reaps non-terminal jobs the sidecar no longer reports', () => {
    stemJobs.set(
      new Map([
        ['a', entry('a', 'running')],
        ['b', entry('b', 'queued')],
        ['c', entry('c', 'paused')],
      ]),
    )
    // Only 'b' is still live on the sidecar.
    reapOrphanedJobs(new Set(['b']))
    const m = get(stemJobs)
    expect(m.has('a')).toBe(false) // running + gone → reaped, frees the song
    expect(m.has('b')).toBe(true) // still live → kept
    expect(m.has('c')).toBe(false) // paused + gone → reaped
  })

  it('never reaps terminal jobs, even when absent', () => {
    stemJobs.set(
      new Map([
        ['done', entry('done', 'done')],
        ['err', entry('err', 'error')],
        ['cancelled', entry('cancelled', 'cancelled')],
      ]),
    )
    reapOrphanedJobs(new Set())
    const m = get(stemJobs)
    expect(m.has('done')).toBe(true)
    expect(m.has('err')).toBe(true)
    expect(m.has('cancelled')).toBe(true)
  })

  it('keeps a job that is still live', () => {
    stemJobs.set(new Map([['a', entry('a', 'running')]]))
    reapOrphanedJobs(new Set(['a']))
    expect(get(stemJobs).has('a')).toBe(true)
  })
})
