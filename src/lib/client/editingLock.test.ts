/**
 * The one-BarBro-at-a-time interlock.
 *
 * Two editors on one `song.smap` lose data with no dialog and no trace — the
 * conflict machinery only covers the cloud. So the pause has to be right in both
 * directions: fail to pause and a gig's edits vanish; pause when you shouldn't
 * and the app silently stops saving, which is the same disaster wearing a
 * different hat.
 */
import { describe, expect, it } from 'vitest'
import { editingLock, isEditingPaused } from './editingLock'

const base = { offlineAppOpen: false, isOfflineApp: false, hasLocalProject: true }

describe('when the website must stand down', () => {
  it('pauses when the offline app is open on a disk project', () => {
    const lock = editingLock({ ...base, offlineAppOpen: true })
    expect(lock.paused).toBe(true)
  })

  it('says how to undo it, not just that it happened', () => {
    // A banner that says "editing is disabled" and nothing else reads as a bug
    // and gets ignored or worked around.
    const lock = editingLock({ ...base, offlineAppOpen: true })
    if (!lock.paused) throw new Error('expected paused')
    expect(lock.detail).toMatch(/close the offline app/i)
  })
})

describe('when it must NOT stand down', () => {
  it('does not pause the offline app itself', () => {
    // The offline app sees its own window in /ping. Pausing here would stop the
    // gig machine from saving — the exact opposite of the point.
    expect(isEditingPaused({ offlineAppOpen: true, isOfflineApp: true, hasLocalProject: true })).toBe(
      false,
    )
  })

  it('does not pause when the offline app is closed', () => {
    expect(isEditingPaused(base)).toBe(false)
  })

  it('does not pause a browser-mode session with no folder on disk', () => {
    // Nothing to collide over locally, and its cloud pushes go through the real
    // 409 / merge path rather than a silent overwrite.
    expect(
      isEditingPaused({ offlineAppOpen: true, isOfflineApp: false, hasLocalProject: false }),
    ).toBe(false)
  })

  it('never pauses on the offline app regardless of the other inputs', () => {
    for (const offlineAppOpen of [true, false]) {
      for (const hasLocalProject of [true, false]) {
        expect(isEditingPaused({ offlineAppOpen, isOfflineApp: true, hasLocalProject })).toBe(false)
      }
    }
  })
})

describe('the whole truth table', () => {
  it('pauses in exactly one of the eight states', () => {
    const paused: string[] = []
    for (const offlineAppOpen of [true, false]) {
      for (const isOfflineApp of [true, false]) {
        for (const hasLocalProject of [true, false]) {
          if (isEditingPaused({ offlineAppOpen, isOfflineApp, hasLocalProject })) {
            paused.push(`offlineAppOpen=${offlineAppOpen} isOfflineApp=${isOfflineApp} hasLocalProject=${hasLocalProject}`)
          }
        }
      }
    }
    expect(paused).toEqual(['offlineAppOpen=true isOfflineApp=false hasLocalProject=true'])
  })
})
