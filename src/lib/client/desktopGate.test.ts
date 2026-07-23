import { describe, expect, it } from 'vitest'
import {
  isSidecarActionAvailable,
  sidecarActionGateReason,
  SIDECAR_ACTIONS,
} from './desktopGate'

describe('desktop gate', () => {
  it('EVERY sidecar action is blocked in browser mode', () => {
    for (const action of SIDECAR_ACTIONS) {
      expect(isSidecarActionAvailable(action, false)).toBe(false)
    }
  })

  it('every sidecar action is available in desktop mode', () => {
    for (const action of SIDECAR_ACTIONS) {
      expect(isSidecarActionAvailable(action, true)).toBe(true)
    }
  })

  it('the split includes the compute + local-FS actions we mean to gate', () => {
    // Guards against silently dropping a gate if the enum is edited.
    for (const a of ['analyze', 'separateStems', 'transcribeLyrics', 'ttsCue', 'youtubeImport', 'openLocalFolder'] as const) {
      expect(SIDECAR_ACTIONS).toContain(a)
    }
  })

  it('gives a non-empty, desktop-pointing reason for each action', () => {
    for (const action of SIDECAR_ACTIONS) {
      const reason = sidecarActionGateReason(action)
      expect(reason.length).toBeGreaterThan(0)
      expect(reason).toMatch(/desktop app/i)
    }
  })
})
