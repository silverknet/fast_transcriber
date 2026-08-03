/**
 * Guards against half-wiring a machine editor.
 *
 * Opening an editor from the mixer takes THREE things that live apart:
 *   1. the lane key in `EDITABLE_LANE_KEYS`, or the lane gets no `onSelect` and
 *      clicking it does literally nothing,
 *   2. a branch in the `openEditor` derived, or selecting it opens no panel,
 *   3. a panel to render in the dock.
 *
 * The chords and arp lanes shipped with (2) and (3) but not (1), so they were
 * silently unclickable. Nothing failed — there was just no reaction. This test
 * scrapes MixerView so the three lists cannot drift apart again.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const MIXER_VIEW = new URL('./MixerView.svelte', import.meta.url)
const src = () => readFileSync(MIXER_VIEW, 'utf8')

/** The lane keys listed in `EDITABLE_LANE_KEYS`. */
function editableLaneKeys(): string[] {
  const m = /const EDITABLE_LANE_KEYS = new Set\(\[([\s\S]*?)\]\)/.exec(src())
  if (!m) throw new Error('EDITABLE_LANE_KEYS not found — did it get renamed?')
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!)
}

/** The lane keys `openEditor` recognises. */
function openEditorLaneKeys(): string[] {
  const m = /const openEditor = \$derived<[^>]*>\(([\s\S]*?)\n  \)/.exec(src())
  if (!m) throw new Error('openEditor derived not found — did it get renamed?')
  return [...m[1]!.matchAll(/selectedLaneKey === '([^']+)'/g)].map((x) => x[1]!)
}

describe('mixer editable lanes', () => {
  it('every lane with an editor is also clickable', () => {
    const editable = new Set(editableLaneKeys())
    for (const key of openEditorLaneKeys()) {
      expect(
        editable.has(key),
        `'${key}' opens an editor but is missing from EDITABLE_LANE_KEYS, so clicking it does nothing`,
      ).toBe(true)
    }
  })

  it('every clickable lane actually opens something', () => {
    // The reverse drift: a lane you can select that shows no panel just looks
    // broken — it highlights and nothing happens.
    const opens = new Set(openEditorLaneKeys())
    for (const key of editableLaneKeys()) {
      expect(
        opens.has(key),
        `'${key}' is selectable but has no branch in openEditor, so nothing opens`,
      ).toBe(true)
    }
  })

  it('covers the four machines', () => {
    expect(editableLaneKeys().sort()).toEqual(
      ['arp-machine', 'bass-machine', 'chord-machine', 'drum-machine'].sort(),
    )
  })

  it('the scrapes find something — a rename must fail loudly, not vacuously pass', () => {
    expect(editableLaneKeys().length).toBeGreaterThan(0)
    expect(openEditorLaneKeys().length).toBeGreaterThan(0)
  })
})
