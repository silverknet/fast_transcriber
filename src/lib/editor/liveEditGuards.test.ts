import { describe, it, expect } from 'vitest'
import { shouldReseedLyricsDraft, pruneSelections, type EditorSelections } from './liveEditGuards'
import type { SongMap } from '$lib/songmap/types'

describe('shouldReseedLyricsDraft', () => {
  it('reseeds on song switch regardless of anything else', () => {
    expect(
      shouldReseedLyricsDraft({
        keyChanged: true,
        storedText: 'a',
        seededText: 'a',
        draft: 'user was typing here',
        focused: true,
      }),
    ).toBe(true)
  })

  it('reseeds same-song when a remote change landed and the user has not typed', () => {
    expect(
      shouldReseedLyricsDraft({
        keyChanged: false,
        storedText: 'REMOTE edit',
        seededText: 'old',
        draft: 'old', // draft still equals what we seeded → user untouched
        focused: false,
      }),
    ).toBe(true)
  })

  it('does NOT clobber the user mid-type (draft diverged from seed)', () => {
    expect(
      shouldReseedLyricsDraft({
        keyChanged: false,
        storedText: 'REMOTE edit',
        seededText: 'old',
        draft: 'old plus my new line', // user has typed
        focused: false,
      }),
    ).toBe(false)
  })

  it('does NOT reseed while the textarea is focused', () => {
    expect(
      shouldReseedLyricsDraft({
        keyChanged: false,
        storedText: 'REMOTE edit',
        seededText: 'old',
        draft: 'old',
        focused: true,
      }),
    ).toBe(false)
  })

  it('no-op when nothing changed (stored === seeded)', () => {
    expect(
      shouldReseedLyricsDraft({
        keyChanged: false,
        storedText: 'same',
        seededText: 'same',
        draft: 'same',
        focused: false,
      }),
    ).toBe(false)
  })
})

function smWith(beatIds: string[], barIds: string[]): SongMap {
  return {
    timeline: {
      beats: beatIds.map((id) => ({ id })),
      bars: barIds.map((id) => ({ id })),
    },
  } as unknown as SongMap
}

describe('pruneSelections', () => {
  const full: EditorSelections = {
    selectedBeatId: 'b2',
    chordsSelectionBeatIds: ['b1', 'b2', 'b3'],
    sectionsSelectionBarIds: ['bar1', 'bar2'],
    selectedFraction: { barId: 'bar2', fraction: 0.5 },
  }

  it('returns no changes when every selected id still exists', () => {
    const sm = smWith(['b1', 'b2', 'b3'], ['bar1', 'bar2'])
    expect(pruneSelections(sm, full)).toEqual({})
  })

  it('drops a selectedBeatId that vanished', () => {
    const sm = smWith(['b1', 'b3'], ['bar1', 'bar2'])
    const out = pruneSelections(sm, full)
    expect(out.selectedBeatId).toBeNull()
    expect(out.chordsSelectionBeatIds).toEqual(['b1', 'b3'])
  })

  it('filters chord/section selections to surviving ids and nulls a stale fraction', () => {
    const sm = smWith(['b1'], ['bar1'])
    const out = pruneSelections(sm, full)
    expect(out.selectedBeatId).toBeNull()
    expect(out.chordsSelectionBeatIds).toEqual(['b1'])
    expect(out.sectionsSelectionBarIds).toEqual(['bar1'])
    expect(out.selectedFraction).toBeNull()
  })

  it('leaves untouched fields absent from the result (no needless writes)', () => {
    // Only a section bar vanished; beat selections + fraction survive.
    const sm = smWith(['b1', 'b2', 'b3'], ['bar2'])
    const out = pruneSelections(sm, full)
    expect(out).toEqual({ sectionsSelectionBarIds: ['bar2'] })
    expect('selectedBeatId' in out).toBe(false)
    expect('selectedFraction' in out).toBe(false)
  })
})
