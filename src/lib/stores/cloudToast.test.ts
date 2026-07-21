/**
 * The anti-spam rule. Collaborators save often, so arrivals must fold into one
 * notice rather than stacking popups — and repeated saves of the SAME song must
 * read as one song, not five.
 */
import { describe, expect, it } from 'vitest'
import { mergeToast, toastMessage, type CloudToast } from './cloudToast'

describe('mergeToast — arrivals coalesce', () => {
  it('opens a notice for the first arrival', () => {
    expect(mergeToast(null, ['Valerie'])).toEqual({ titles: ['Valerie'], arrivals: 1 })
  })

  it('folds a second arrival into the notice already showing', () => {
    const first = mergeToast(null, ['Valerie'])
    expect(mergeToast(first, ['Ramlar'])).toEqual({
      titles: ['Valerie', 'Ramlar'],
      arrivals: 2,
    })
  })

  it('does not repeat a song saved several times in a row', () => {
    // A collaborator hitting save repeatedly is ONE song changing, and the
    // notice should say so.
    let t = mergeToast(null, ['Valerie'])
    t = mergeToast(t, ['Valerie'])
    t = mergeToast(t, ['Valerie'])
    expect(t?.titles).toEqual(['Valerie'])
    expect(t?.arrivals).toBe(3)
  })

  it('de-duplicates within a single arrival too', () => {
    expect(mergeToast(null, ['Valerie', 'Valerie', 'Ramlar'])?.titles).toEqual([
      'Valerie',
      'Ramlar',
    ])
  })

  it('an empty arrival never opens or disturbs a notice', () => {
    // `pullCloudChanges` reports no titles when the only change was our own
    // push echoing back — that must not produce a popup.
    expect(mergeToast(null, [])).toBeNull()
    const existing: CloudToast = { titles: ['Valerie'], arrivals: 1 }
    expect(mergeToast(existing, [])).toBe(existing)
    expect(mergeToast(existing, ['   '])).toBe(existing)
  })

  it('keeps arrival order', () => {
    let t = mergeToast(null, ['B'])
    t = mergeToast(t, ['A'])
    t = mergeToast(t, ['C'])
    expect(t?.titles).toEqual(['B', 'A', 'C'])
  })
})

describe('toastMessage', () => {
  it('names a single song', () => {
    expect(toastMessage({ titles: ['Valerie'], arrivals: 1 })).toBe(
      'Valerie was updated by someone else',
    )
  })

  it('names two songs', () => {
    expect(toastMessage({ titles: ['Valerie', 'Ramlar'], arrivals: 2 })).toBe(
      'Updated by someone else: Valerie, Ramlar',
    )
  })

  it('collapses a long list rather than growing without bound', () => {
    expect(
      toastMessage({ titles: ['A', 'B', 'C', 'D', 'E'], arrivals: 5 }),
    ).toBe('Updated by someone else: A, B and 3 more')
  })

  it('uses plain language — no internals', () => {
    const text = toastMessage({ titles: ['Valerie', 'Ramlar', 'Dangerous'], arrivals: 3 })
    for (const jargon of ['revision', 'song map', 'songmap', 'fingerprint', 'merge', 'pull']) {
      expect(text.toLowerCase()).not.toContain(jargon)
    }
  })
})
