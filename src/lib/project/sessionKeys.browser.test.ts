/**
 * Restore-precedence guard (real localStorage, real Chromium).
 *
 * On reload the layout tries the disk restore first, then falls back to the
 * browser-cloud restore. For that to land on the RIGHT session, the two
 * "last session" keys must be MUTUALLY EXCLUSIVE — whichever was opened most
 * recently wins, the other is forgotten. If both were ever set at once, a
 * desktop reload could yank a browser-cloud user back into a stale disk project
 * (or vice versa). These tests lock that invariant.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readLastProjectPath,
  writeLastProjectPath,
  clearLastProjectPath,
  readLastCloudProjectId,
  writeLastCloudProjectId,
  clearLastCloudProjectId,
} from './commit'

describe('last-session keys: disk vs browser-cloud are mutually exclusive', () => {
  beforeEach(() => localStorage.clear())

  it('opening a disk project forgets any browser-cloud session', () => {
    writeLastCloudProjectId('cloud-proj-abc')
    expect(readLastCloudProjectId()).toBe('cloud-proj-abc')

    writeLastProjectPath('/Users/x/BarBro/MySet')
    expect(readLastProjectPath()).toBe('/Users/x/BarBro/MySet')
    expect(readLastCloudProjectId()).toBeNull() // cloud session forgotten
  })

  it('opening a browser-cloud project forgets any disk session', () => {
    writeLastProjectPath('/Users/x/BarBro/MySet')
    expect(readLastProjectPath()).toBe('/Users/x/BarBro/MySet')

    writeLastCloudProjectId('cloud-proj-abc')
    expect(readLastCloudProjectId()).toBe('cloud-proj-abc')
    expect(readLastProjectPath()).toBeNull() // disk session forgotten
  })

  it('never leaves both set at once, regardless of order', () => {
    writeLastProjectPath('/a')
    writeLastCloudProjectId('c1')
    writeLastProjectPath('/b')
    writeLastCloudProjectId('c2')
    const both = [readLastProjectPath(), readLastCloudProjectId()].filter(Boolean)
    expect(both).toEqual(['c2'])
  })

  it('clears are independent and idempotent', () => {
    writeLastCloudProjectId('c1')
    clearLastCloudProjectId()
    expect(readLastCloudProjectId()).toBeNull()
    clearLastCloudProjectId() // no throw on empty
    expect(readLastCloudProjectId()).toBeNull()

    writeLastProjectPath('/a')
    clearLastProjectPath()
    expect(readLastProjectPath()).toBeNull()
  })

  it('reads treat blank/whitespace as absent', () => {
    writeLastCloudProjectId('   ')
    expect(readLastCloudProjectId()).toBeNull()
  })
})
