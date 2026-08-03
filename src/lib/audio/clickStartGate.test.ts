import { describe, expect, it } from 'vitest'
import { mayStartSong } from './clickStartGate'

const base = { liveMode: true, songHasGrid: true, clickLaneReady: false, clickBuildError: null }

describe('a live song with a grid never starts clickless', () => {
  it('REFUSES the cold-open case: live, grid, click not yet registered', () => {
    // The measured failure: ten seconds of clickless song at a rehearsal.
    expect(mayStartSong(base)).toBe(false)
  })

  it('starts the moment the click lane registers', () => {
    expect(mayStartSong({ ...base, clickLaneReady: true })).toBe(true)
  })

  it('a FAILED click build releases the hold — a broken click must not lock a song out', () => {
    expect(mayStartSong({ ...base, clickBuildError: 'could not build' })).toBe(true)
  })

  it('no grid → nothing to click → start freely', () => {
    expect(mayStartSong({ ...base, songHasGrid: false })).toBe(true)
  })

  it('the editor is never held', () => {
    expect(mayStartSong({ ...base, liveMode: false })).toBe(true)
  })
})
