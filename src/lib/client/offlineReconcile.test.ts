/**
 * The rules that decide what gets sent home from a gig.
 *
 * Two questions, both of which lose data when answered wrong:
 *
 *  - **Is this song actually different?** Answer "no" wrongly and a night's
 *    edits are never offered, then quietly overwritten by the next cloud pull.
 *  - **Which revision was it based on?** Answer with a number the laptop never
 *    saw and a genuine conflict looks like a clean fast-forward, silently
 *    replacing a bandmate's work.
 */
import { describe, expect, it } from 'vitest'
import { baseRevisionFor, isDirtyAgainstCloud } from './offlineReconcile'
import { newOfflineSession, withTouchedSong } from '$lib/project/offlineSession'

describe('is this song different from what the cloud last saw', () => {
  it('same hash means unchanged', () => {
    expect(isDirtyAgainstCloud('abc', 'abc')).toBe(false)
  })

  it('different hash means changed', () => {
    expect(isDirtyAgainstCloud('abc', 'def')).toBe(true)
  })

  it('NEVER synced counts as changed', () => {
    // There is no hash to compare against, so there is no evidence the cloud
    // has this song at all. Assuming it does is how a song silently never
    // arrives.
    expect(isDirtyAgainstCloud('abc', undefined)).toBe(true)
    expect(isDirtyAgainstCloud('abc', '')).toBe(true)
  })
})

describe('which revision to push against', () => {
  const session = newOfflineSession('2026-08-01T18:00:00.000Z', { 's1': 4 })

  it('uses the session base when the laptop recorded one', () => {
    expect(baseRevisionFor({ id: 's1', lastSyncedRevision: 4 }, session, 99)).toBe(4)
  })

  it('takes the LOWER of the session base and the manifest watermark', () => {
    // The manifest can be advanced by another device after the offline session
    // began. Pushing against that newer number claims to have seen a cloud edit
    // this laptop never had — the server accepts it and the other edit is gone.
    expect(baseRevisionFor({ id: 's1', lastSyncedRevision: 9 }, session, 99)).toBe(4)
  })

  it('still uses the session base when the manifest has no watermark', () => {
    expect(baseRevisionFor({ id: 's1' }, session, 99)).toBe(4)
  })

  it('falls back to the manifest watermark for a song the session never recorded', () => {
    // "Prepare for offline" was skipped, or the song was added afterwards.
    expect(baseRevisionFor({ id: 's2', lastSyncedRevision: 7 }, session, 99)).toBe(7)
  })

  it('falls back to the project revision when the song has nothing at all', () => {
    expect(baseRevisionFor({ id: 's2' }, session, 12)).toBe(12)
  })

  it('handles no session at all', () => {
    expect(baseRevisionFor({ id: 's1', lastSyncedRevision: 3 }, null, 12)).toBe(3)
    expect(baseRevisionFor({ id: 's1' }, null, 12)).toBe(12)
  })

  it('treats revision 0 as a real value, not as absent', () => {
    // A brand-new cloud project sits at 0. `??` handles this correctly and `||`
    // would not — the kind of slip that turns "base 0" into "base 99".
    const zero = newOfflineSession('2026-08-01T18:00:00.000Z', { s1: 0 })
    expect(baseRevisionFor({ id: 's1', lastSyncedRevision: 0 }, zero, 99)).toBe(0)
    expect(baseRevisionFor({ id: 's9', lastSyncedRevision: 0 }, zero, 99)).toBe(0)
  })

  it('a touched-but-unprepared song does not inherit another song\'s base', () => {
    const s = withTouchedSong(newOfflineSession('2026-08-01T18:00:00.000Z', { s1: 4 }), 's2')
    expect(baseRevisionFor({ id: 's2', lastSyncedRevision: 8 }, s, 99)).toBe(8)
  })
})
