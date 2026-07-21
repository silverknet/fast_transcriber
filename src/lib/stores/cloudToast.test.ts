/**
 * The anti-spam rule. Collaborators save often, so arrivals must fold into one
 * notice rather than stacking popups — and repeated saves of the SAME song must
 * read as one song, not five.
 */
import { describe, expect, it } from 'vitest'
import { mergeToast, toastMessage, type CloudToast } from './cloudToast'

describe('mergeToast — arrivals coalesce', () => {
  it('opens a notice for the first arrival', () => {
    expect(mergeToast(null, ['Valerie'])).toEqual({
      titles: ['Valerie'],
      arrivals: 1,
      kind: 'arrival',
    })
  })

  it('folds a second arrival into the notice already showing', () => {
    const first = mergeToast(null, ['Valerie'])
    expect(mergeToast(first, ['Ramlar'])).toEqual({
      titles: ['Valerie', 'Ramlar'],
      arrivals: 2,
      kind: 'arrival',
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
    const existing: CloudToast = { titles: ['Valerie'], arrivals: 1, kind: 'arrival' }
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
    expect(toastMessage({ titles: ['Valerie'], arrivals: 1, kind: 'arrival' })).toBe(
      'Valerie was updated by someone else',
    )
  })

  it('names two songs', () => {
    expect(toastMessage({ titles: ['Valerie', 'Ramlar'], arrivals: 2, kind: 'arrival' })).toBe(
      'Updated by someone else: Valerie, Ramlar',
    )
  })

  it('collapses a long list rather than growing without bound', () => {
    expect(
      toastMessage({ titles: ['A', 'B', 'C', 'D', 'E'], arrivals: 5, kind: 'arrival' }),
    ).toBe('Updated by someone else: A, B and 3 more')
  })

  it('uses plain language — no internals', () => {
    const text = toastMessage({ titles: ['Valerie', 'Ramlar', 'Dangerous'], arrivals: 3, kind: 'arrival' })
    for (const jargon of ['revision', 'song map', 'songmap', 'fingerprint', 'merge', 'pull']) {
      expect(text.toLowerCase()).not.toContain(jargon)
    }
  })
})

/**
 * Auto-settling a 409 replaced a dialog with a notice, so the notice has to
 * carry the reassurance the dialog used to: your edits are still here.
 */
describe('reconciled notices — when your own unsent edits were folded in', () => {
  it('says the edits survived, for one song and for several', () => {
    expect(toastMessage({ titles: ['Ramlar'], arrivals: 1, kind: 'reconciled' })).toBe(
      'Ramlar was updated by someone else — your edits were kept',
    )
    expect(
      toastMessage({ titles: ['Ramlar', 'Valerie'], arrivals: 2, kind: 'reconciled' }),
    ).toBe('Updated by someone else, your edits kept: Ramlar, Valerie')
  })

  it('collapses a long list the same way an arrival notice does', () => {
    expect(
      toastMessage({ titles: ['A', 'B', 'C', 'D'], arrivals: 4, kind: 'reconciled' }),
    ).toBe('Updated by someone else, your edits kept: A, B and 2 more')
  })

  it('still avoids internals — including the word for what just happened', () => {
    const text = toastMessage({ titles: ['Ramlar'], arrivals: 1, kind: 'reconciled' })
    for (const jargon of ['revision', 'song map', 'songmap', 'fingerprint', 'merge', 'pull']) {
      expect(text.toLowerCase()).not.toContain(jargon)
    }
  })

  it('coalesces exactly like an arrival — one notice, not a stack', () => {
    let t = mergeToast(null, ['Ramlar'], 'reconciled')
    t = mergeToast(t, ['Valerie'], 'reconciled')
    t = mergeToast(t, ['Ramlar'], 'reconciled')
    expect(t?.titles).toEqual(['Ramlar', 'Valerie'])
    expect(t?.arrivals).toBe(3)
  })

  it('outranks a plain arrival folded into the same notice, whichever came first', () => {
    // Being told "your edits were kept" is the stronger statement; downgrading
    // it to "something changed" would drop the part that reassures.
    const arrivalFirst = mergeToast(mergeToast(null, ['A']), ['B'], 'reconciled')
    expect(arrivalFirst?.kind).toBe('reconciled')

    const reconciledFirst = mergeToast(mergeToast(null, ['A'], 'reconciled'), ['B'])
    expect(reconciledFirst?.kind).toBe('reconciled')
  })

  it('defaults to an arrival when no kind is given, so existing callers are unchanged', () => {
    expect(mergeToast(null, ['A'])?.kind).toBe('arrival')
  })
})
