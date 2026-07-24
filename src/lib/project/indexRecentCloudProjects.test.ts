/**
 * The startup recents scan that lets the app KNOW a browser-cloud project also
 * has a local HD copy here — the input to the `collab-switchable` badge state and
 * the reload arbiter's disk-preference. Reads each recent project's manifest via
 * the (mocked) sidecar and records `cloudProjectId → disk folder`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

vi.mock('$lib/client/desktopProjectFs', async (importActual) => ({
  ...(await importActual<typeof import('$lib/client/desktopProjectFs')>()),
  getProjectInfo: vi.fn(),
}))

import { indexRecentCloudProjects, RECENT_PROJECTS_KEY } from './commit'
import { getProjectInfo } from '$lib/client/desktopProjectFs'
import { cloudDiskPaths, diskPathForCloudId } from '$lib/stores/cloudDiskPaths'

describe('indexRecentCloudProjects', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    })
    cloudDiskPaths.set({})
    vi.clearAllMocks()
  })

  it('maps cloud-linked recents to their disk folder; skips non-cloud + missing folders', async () => {
    localStorage.setItem(
      RECENT_PROJECTS_KEY,
      JSON.stringify(['/a/cloudproj', '/b/localonly', '/c/gone']),
    )
    vi.mocked(getProjectInfo).mockImplementation(async (path: string) => {
      if (path === '/a/cloudproj')
        return { ok: true, manifest: { cloud: { projectId: 'cloud-a' } }, songsMetadata: {} } as never
      if (path === '/b/localonly')
        return { ok: true, manifest: {}, songsMetadata: {} } as never // no cloud link
      throw new Error('folder gone') // /c/gone → sidecar error, skipped
    })

    await indexRecentCloudProjects()

    expect(diskPathForCloudId('cloud-a')).toBe('/a/cloudproj')
    expect(get(cloudDiskPaths)).toEqual({ 'cloud-a': '/a/cloudproj' })
  })

  it('no recents → no-op, no throw', async () => {
    await expect(indexRecentCloudProjects()).resolves.toBeUndefined()
    expect(get(cloudDiskPaths)).toEqual({})
  })
})
