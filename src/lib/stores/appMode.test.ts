/**
 * `audioMode` — the canonical per-project audio-mode state machine. This is the
 * single source of truth for "which audio am I hearing + why", and it's what the
 * navbar badge + its action key off. Every state below is a real user situation
 * the app must name clearly instead of the old "Studio if sidecar up" lie.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { get } from 'svelte/store'
import { audioMode } from './appMode'
import { setActiveProject, setBrowserCloudProject, closeProject } from './project'
import { desktopCompanionStatus } from './desktopCompanionStatus'
import { audioSession } from './audioSession'
import { cloudDiskPaths } from './cloudDiskPaths'
import { PROJECT_FILE_VERSION, type ProjectFile } from '$lib/project/types'

function pf(over: Partial<ProjectFile> = {}): ProjectFile {
  return {
    formatVersion: PROJECT_FILE_VERSION,
    id: 'p1',
    name: 'Test',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    songs: [],
    ...over,
  }
}
const setSidecar = (reachable: boolean) => desktopCompanionStatus.update((s) => ({ ...s, reachable }))
const setMissing = (r: 'file-not-found' | 'cloud-audio-unavailable' | undefined) =>
  audioSession.update((s) => ({ ...s, missingReason: r }))

describe('audioMode state machine', () => {
  beforeEach(() => {
    closeProject()
    setSidecar(false)
    setMissing(undefined)
    cloudDiskPaths.set({})
  })
  afterEach(() => {
    closeProject()
    setSidecar(false)
    setMissing(undefined)
    cloudDiskPaths.set({})
  })

  it('no project → no-project', () => {
    expect(get(audioMode).kind).toBe('no-project')
  })

  it('disk project + sidecar up + audio ok → studio-hd (ok)', () => {
    setActiveProject('/Users/x/proj', pf(), {})
    setSidecar(true)
    const m = get(audioMode)
    expect(m.kind).toBe('studio-hd')
    expect(m.tone).toBe('ok')
  })

  it('disk project + sidecar up + local file missing → studio-relink (warn)', () => {
    setActiveProject('/Users/x/proj', pf(), {})
    setSidecar(true)
    setMissing('file-not-found')
    expect(get(audioMode).kind).toBe('studio-relink')
  })

  it('disk project + sidecar DOWN → offline-disk (warn)', () => {
    setActiveProject('/Users/x/proj', pf(), {})
    setSidecar(false)
    expect(get(audioMode).kind).toBe('offline-disk')
  })

  it('browser-cloud + no local copy → collab (info)', () => {
    setBrowserCloudProject(pf({ cloud: { projectId: 'c1', lastSyncedRevision: 0 } }), {})
    setSidecar(true)
    const m = get(audioMode)
    expect(m.kind).toBe('collab')
    expect(m.switchToDiskPath).toBeUndefined()
  })

  it('THE FIX: browser-cloud + sidecar up + a local copy EXISTS → collab-switchable with the disk path', () => {
    setBrowserCloudProject(pf({ cloud: { projectId: 'c1', lastSyncedRevision: 0 } }), {})
    setSidecar(true)
    cloudDiskPaths.set({ c1: '/Users/x/Barbro projects/test1234' })
    const m = get(audioMode)
    expect(m.kind).toBe('collab-switchable')
    expect(m.tone).toBe('warn')
    expect(m.switchToDiskPath).toBe('/Users/x/Barbro projects/test1234')
  })

  it('browser-cloud + cloud audio unavailable → collab-no-audio (error)', () => {
    setBrowserCloudProject(pf({ cloud: { projectId: 'c1', lastSyncedRevision: 0 } }), {})
    setSidecar(true)
    setMissing('cloud-audio-unavailable')
    const m = get(audioMode)
    expect(m.kind).toBe('collab-no-audio')
    expect(m.tone).toBe('error')
  })
})
