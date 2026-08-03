/**
 * The save-evidence verdict. The 'danger' rules encode a real loss: a browser
 * session whose every push silently returned (editing-pause) while the editor
 * accepted chord edits for half an hour.
 */
import { describe, expect, it } from 'vitest'
import { PERSIST_GRACE_MS, persistVerdict } from './persistStatus'

const T = 1_000_000

describe('persistVerdict', () => {
  it('clean session: nothing pending, nothing attempted → saved', () => {
    expect(persistVerdict({ disk: null, cloud: null, dirtySince: null }, T)).toBe('saved')
  })

  it('edits within the grace window → saving (no false alarm during debounce)', () => {
    expect(persistVerdict({ disk: null, cloud: null, dirtySince: T - 5000 }, T)).toBe('saving')
  })

  it('THE INCIDENT: pushes silently paused, edits pending past grace → danger', () => {
    expect(
      persistVerdict({ disk: null, cloud: null, dirtySince: T - PERSIST_GRACE_MS - 1 }, T),
    ).toBe('danger')
  })

  it('an explicit FAILED save is danger IMMEDIATELY — no grace for a known failure', () => {
    expect(
      persistVerdict(
        { disk: null, cloud: { at: T, ok: false, error: 'paused' }, dirtySince: T - 100 },
        T,
      ),
    ).toBe('danger')
    expect(
      persistVerdict({ disk: { at: T, ok: false }, cloud: null, dirtySince: null }, T),
    ).toBe('danger')
  })

  it('a successful save clears the pending state → saved', () => {
    expect(
      persistVerdict(
        { disk: { at: T, ok: true }, cloud: { at: T, ok: true, revision: 829 }, dirtySince: null },
        T,
      ),
    ).toBe('saved')
  })
})
