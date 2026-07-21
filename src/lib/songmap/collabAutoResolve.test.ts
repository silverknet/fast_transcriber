/**
 * Settling a 409 WITHOUT a dialog.
 *
 * Two claims are locked here, and they pull against each other:
 *
 *  1. Ordinary divergence must not interrupt anyone. Only `dangerous`
 *     conflicts — the ones that change what the song IS — get a dialog.
 *  2. Auto-settling must never delete work that only exists on this device.
 *
 * (2) is the load-bearing one. Cloud sync was push-only-on-open for a long
 * time, so a cloud row can be months stale AND at an older `formatVersion`
 * than the local `.smap`. Migrating both to v6 from different starting points
 * diverges honestly, and plain "cloud wins" would then wipe every field the
 * older row predates. The version-skew block at the bottom is that exact
 * production case.
 */
import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import { parseSongMap } from './parse'
import type { Bar, Beat, HarmonyEvent, Lyrics, Section, SongMap } from './types'
import {
  autoResolveDecisions,
  autoResolvedMerge,
  hasDangerousConflict,
  mergeForConflict,
} from './collabMerge'

function chord(id: string, root: string): HarmonyEvent {
  return {
    id,
    barId: `bar-${id}`,
    startSec: 0,
    endSec: 1,
    chord: { root: root as HarmonyEvent['chord']['root'], displayRaw: root },
  }
}

function bar(id: string, index: number): Bar {
  return {
    id,
    index,
    startSec: index,
    endSec: index + 1,
    meter: { numerator: 4, denominator: 4 },
    beatCount: 4,
    beatIds: [],
  }
}

function beat(id: string, barId: string, indexInBar: number, timeSec: number): Beat {
  return { id, barId, indexInBar, timeSec, source: 'detected' }
}

function section(id: string, label: string, start: number, end: number): Section {
  return { id, kind: 'verse', label, barRange: { startBarIndex: start, endBarIndex: end } }
}

function lyrics(text: string): Lyrics {
  return { sourceText: text, words: [{ text, startSec: 0, endSec: 1, line: 0 }] }
}

function paths(map: Map<string, 'mine' | 'theirs'>): string[] {
  return [...map.keys()].sort()
}

// ── The dialog gate ───────────────────────────────────────────────────────

describe('hasDangerousConflict — what still deserves an interruption', () => {
  it('is false for ordinary last-write-wins divergence', () => {
    const base = createEmptySongMap()
    const local: SongMap = {
      ...base,
      metadata: { ...base.metadata, bpm: 120, notes: 'mine' },
      countInBeats: 4,
    }
    const cloud: SongMap = {
      ...base,
      metadata: { ...base.metadata, bpm: 140, notes: 'theirs' },
      countInBeats: 8,
    }
    const report = mergeForConflict(local, cloud)
    expect(report.conflicts.length).toBeGreaterThan(0)
    expect(hasDangerousConflict(report)).toBe(false)
  })

  it('is true when the timeline length changed', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, timeline: { bars: [bar('b1', 0), bar('b2', 1)], beats: [] } }
    const cloud: SongMap = { ...base, timeline: { bars: [bar('b1', 0)], beats: [] } }
    expect(hasDangerousConflict(mergeForConflict(local, cloud))).toBe(true)
  })

  it('is true when the audio master differs', () => {
    const base = createEmptySongMap()
    const withAudio = (sha: string): SongMap => ({
      ...base,
      audio: {
        fileName: 'a.wav',
        source: 'upload',
        trim: { startSec: 0, endSec: 10 },
        sha256: sha,
      },
    })
    expect(hasDangerousConflict(mergeForConflict(withAudio('aaa'), withAudio('bbb')))).toBe(true)
  })

  it('is true when the whole chord track was replaced', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, harmony: [chord('new-1', 'C'), chord('new-2', 'G')] }
    const cloud: SongMap = { ...base, harmony: [chord('old-1', 'Am'), chord('old-2', 'F')] }
    expect(hasDangerousConflict(mergeForConflict(local, cloud))).toBe(true)
  })

  it('is true when the two sides sit on different drafts', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, activeDraftId: 'draft-live', activeDraftName: 'Live' }
    const cloud: SongMap = { ...base, activeDraftId: 'draft-orig', activeDraftName: 'Original' }
    const report = mergeForConflict(local, cloud)
    expect(hasDangerousConflict(report)).toBe(true)
    expect(report.conflicts.some((c) => c.path === 'activeDraft')).toBe(true)
  })

  it('is true when the analyzed flag flipped', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, metadata: { ...base.metadata, analyzed: true } }
    const cloud: SongMap = { ...base, metadata: { ...base.metadata, analyzed: false } }
    expect(hasDangerousConflict(mergeForConflict(local, cloud))).toBe(true)
  })
})

// ── The no-silent-deletion rule ───────────────────────────────────────────

describe('autoResolveDecisions — an empty cloud value never wins', () => {
  it('keeps local lyrics when the cloud copy has none', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, lyrics: lyrics('never pushed') }
    const report = mergeForConflict(local, base)

    expect(report.conflicts.map((c) => c.path)).toEqual(['lyrics'])
    // The unguarded default would have deleted them.
    expect(report.merged.lyrics).toBeUndefined()
    expect(paths(autoResolveDecisions(report))).toEqual(['lyrics'])
    expect(autoResolvedMerge(report).lyrics).toEqual(lyrics('never pushed'))
  })

  it.each([
    ['transpose', { transpose: { baseSemitones: 3 } }],
    ['drumMidi', {
      drumMidi: {
        events: [{ timeSec: 0, cls: 'kick' as const, velocity: 1 }],
        analyzedAt: '2024-01-01T00:00:00.000Z',
        analyzerVersion: 1,
        sourceStem: 'drums',
        audioFingerprint: 'fp',
      },
    }],
    ['bassMidi', {
      bassMidi: {
        events: [{ timeSec: 0, durationSec: 1, midi: 40, velocity: 1 }],
        analyzedAt: '2024-01-01T00:00:00.000Z',
        analyzerVersion: 1,
        sourceStem: 'bass',
        audioFingerprint: 'fp',
      },
    }],
    ['countInBeats', { countInBeats: 4 }],
    ['startBeatId', { startBeatId: 'beat-7' }],
  ])('keeps local %s when the cloud copy has none', (path, patch) => {
    const base = createEmptySongMap()
    const local = { ...base, ...patch } as SongMap
    const report = mergeForConflict(local, base)

    expect(paths(autoResolveDecisions(report))).toContain(path)
    const settled = autoResolvedMerge(report) as unknown as Record<string, unknown>
    expect(settled[path]).toEqual((patch as Record<string, unknown>)[path])
  })

  it('keeps local metadata text the cloud copy never had', () => {
    const base = createEmptySongMap()
    const local: SongMap = {
      ...base,
      metadata: { ...base.metadata, notes: 'capo 2', artist: 'Wilco' },
    }
    const settled = autoResolvedMerge(mergeForConflict(local, base))
    expect(settled.metadata.notes).toBe('capo 2')
    expect(settled.metadata.artist).toBe('Wilco')
  })

  it('treats a blank string and an empty list as absent, not as content', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, metadata: { ...base.metadata, notes: 'real' } }
    const cloud: SongMap = { ...base, metadata: { ...base.metadata, notes: '   ' } }
    expect(autoResolvedMerge(mergeForConflict(local, cloud)).metadata.notes).toBe('real')
  })

  it('does NOT treat 0 or false as absent — they are deliberate values', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, countInBeats: 4 }
    const cloud: SongMap = { ...base, countInBeats: 0 }
    // Cloud genuinely says "no count-in". That is a value, so cloud still wins.
    expect(autoResolveDecisions(mergeForConflict(local, cloud)).size).toBe(0)
    expect(autoResolvedMerge(mergeForConflict(local, cloud)).countInBeats).toBe(0)

    const localZero: SongMap = { ...base, transpose: { baseSemitones: 0 } }
    expect(autoResolveDecisions(mergeForConflict(localZero, base)).size).toBe(1)
    expect(autoResolvedMerge(mergeForConflict(localZero, base)).transpose).toEqual({
      baseSemitones: 0,
    })
  })
})

describe('autoResolveDecisions — cloud still wins where it has something to say', () => {
  it('adopts cloud content when the local side is the empty one', () => {
    const base = createEmptySongMap()
    const cloud: SongMap = { ...base, lyrics: lyrics('theirs'), transpose: { baseSemitones: 5 } }
    const settled = autoResolvedMerge(mergeForConflict(base, cloud))
    expect(settled.lyrics).toEqual(lyrics('theirs'))
    expect(settled.transpose).toEqual({ baseSemitones: 5 })
  })

  it('keeps plain last-write-wins when both sides have content', () => {
    const base = createEmptySongMap()
    const local: SongMap = {
      ...base,
      lyrics: lyrics('mine'),
      metadata: { ...base.metadata, bpm: 120 },
    }
    const cloud: SongMap = {
      ...base,
      lyrics: lyrics('theirs'),
      metadata: { ...base.metadata, bpm: 140 },
    }
    const report = mergeForConflict(local, cloud)
    expect(autoResolveDecisions(report).size).toBe(0)
    const settled = autoResolvedMerge(report)
    expect(settled.lyrics).toEqual(lyrics('theirs'))
    expect(settled.metadata.bpm).toBe(140)
  })

  it('never flips an id-keyed item — co-editing stays last-write-wins', () => {
    const base = createEmptySongMap()
    const shared = chord('h-0', 'Am')
    const local: SongMap = {
      ...base,
      harmony: [shared, { ...chord('h-1', 'C'), endSec: 9 }],
      sections: [section('s-1', 'Mine', 0, 3)],
      timeline: { bars: [bar('b-1', 0)], beats: [beat('bt-1', 'b-1', 0, 0)] },
    }
    const cloud: SongMap = {
      ...base,
      harmony: [shared, chord('h-1', 'C')],
      sections: [section('s-1', 'Theirs', 0, 3)],
      timeline: { bars: [bar('b-1', 0)], beats: [{ ...beat('bt-1', 'b-1', 0, 0), strength: 0.9 }] },
    }
    const report = mergeForConflict(local, cloud)
    expect(report.conflicts.length).toBeGreaterThan(0)
    expect(autoResolveDecisions(report).size).toBe(0)
    const settled = autoResolvedMerge(report)
    expect(settled.sections[0].label).toBe('Theirs')
    expect(settled.harmony.find((h) => h.id === 'h-1')?.endSec).toBe(1)
  })
})

describe('autoResolvedMerge — structural guarantees', () => {
  it('keeps every list item that exists on only one side', () => {
    const base = createEmptySongMap()
    const shared = chord('h-0', 'Am')
    const local: SongMap = {
      ...base,
      harmony: [shared, chord('mine-only', 'C')],
      sections: [section('s-mine', 'Mine', 0, 1)],
    }
    const cloud: SongMap = {
      ...base,
      harmony: [shared, chord('theirs-only', 'G')],
      sections: [section('s-theirs', 'Theirs', 2, 3)],
    }
    const settled = autoResolvedMerge(mergeForConflict(local, cloud))
    expect(settled.harmony.map((h) => h.id).sort()).toEqual(['h-0', 'mine-only', 'theirs-only'])
    expect(settled.sections.map((s) => s.id).sort()).toEqual(['s-mine', 's-theirs'])
  })

  it('is deterministic — two devices settling the same pair agree byte for byte', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, lyrics: lyrics('mine'), countInBeats: 4 }
    const cloud: SongMap = { ...base, metadata: { ...base.metadata, bpm: 99 } }
    const a = autoResolvedMerge(mergeForConflict(local, cloud))
    const b = autoResolvedMerge(mergeForConflict(local, cloud))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('INVARIANT: no auto-settled field turns non-empty local content into nothing', () => {
    const base = createEmptySongMap()
    // A local copy carrying a bit of everything, against a cloud copy that has
    // none of it — the shape of a months-stale row.
    const local: SongMap = {
      ...base,
      metadata: { ...base.metadata, notes: 'capo 2', artist: 'Wilco', bpm: 120 },
      lyrics: lyrics('mine'),
      transpose: { baseSemitones: 2 },
      countInBeats: 4,
      startBeatId: 'beat-3',
    }
    const report = mergeForConflict(local, base)
    expect(hasDangerousConflict(report)).toBe(false)

    const settled = autoResolvedMerge(report) as unknown as Record<string, unknown>
    const localRec = local as unknown as Record<string, unknown>
    for (const c of report.conflicts) {
      // Only top-level scalar/whole-field paths participate in this check.
      if (c.path.includes('/') && !c.path.startsWith('metadata/')) continue
      const key = c.path.startsWith('metadata/') ? c.path.slice('metadata/'.length) : c.path
      const settledValue = c.path.startsWith('metadata/')
        ? (settled.metadata as Record<string, unknown>)[key]
        : settled[key]
      const localValue = c.path.startsWith('metadata/')
        ? (localRec.metadata as Record<string, unknown>)[key]
        : localRec[key]
      expect(settledValue, `${c.path} was silently emptied`).toEqual(localValue)
    }
  })
})

// ── The production case ───────────────────────────────────────────────────

/**
 * Regression for the reported first-open dialog. A song whose local `.smap` is
 * `formatVersion` 4 and whose cloud row is still `formatVersion` 2: the cloud
 * row predates `transpose` (v3) and `lyrics` (v4), so after both migrate to v6
 * the merge honestly reports two disagreements. Neither is dangerous, so it
 * must settle silently — and it must not take the older row's word for fields
 * that row could not have carried.
 */
describe('version skew: a v2 cloud row against a v4 local copy', () => {
  function legacy(formatVersion: number, extra: Record<string, unknown> = {}): SongMap {
    return parseSongMap(
      JSON.stringify({
        formatVersion,
        metadata: {
          title: 'Ramlar',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          analyzed: true,
          bpm: 120,
        },
        timeline: {
          bars: [
            {
              id: 'bar-1',
              index: 0,
              startSec: 0,
              endSec: 2,
              meter: { numerator: 4, denominator: 4 },
              beatCount: 1,
              beatIds: ['beat-1'],
            },
          ],
          beats: [{ id: 'beat-1', barId: 'bar-1', indexInBar: 0, timeSec: 0, source: 'detected' }],
        },
        sections: [
          {
            id: 'sec-1',
            kind: 'verse',
            label: 'Verse',
            barRange: { startBarIndex: 0, endBarIndex: 0 },
          },
        ],
        harmony: [
          {
            id: 'h-1',
            barId: 'bar-1',
            startSec: 0,
            endSec: 2,
            chord: { root: 'A', quality: 'min', displayRaw: 'Am' },
          },
        ],
        cueTracks: [
          { id: 'cue-1', name: 'Cues', enabled: true, events: [], suppressedGeneratedKeys: [] },
        ],
        countInBeats: 4,
        ...extra,
      }),
    )
  }

  const cloudV2 = () => legacy(2)
  const localV4 = () =>
    legacy(4, {
      transpose: { baseSemitones: 2 },
      lyrics: { sourceText: 'hello world', words: [] },
    })

  it('every legacy version lands on the same active draft, so drafts do not diverge', () => {
    // This is why `activeDraft` staying dangerous costs nothing here: the
    // migration derives a fixed id, so version skew alone never trips it.
    const ids = [1, 2, 3, 4, 5].map((v) => legacy(v).activeDraftId)
    expect(new Set(ids).size).toBe(1)
  })

  it('does not report a wholesale chord replacement — migration preserves chord ids', () => {
    const report = mergeForConflict(localV4(), cloudV2())
    expect(report.conflicts.some((c) => c.path === 'harmony')).toBe(false)
  })

  it('reports only safe conflicts, so it settles without a dialog', () => {
    const report = mergeForConflict(localV4(), cloudV2())
    expect(report.conflicts.map((c) => c.path).sort()).toEqual(['lyrics', 'transpose'])
    expect(hasDangerousConflict(report)).toBe(false)
  })

  it('REGRESSION: settling it keeps the lyrics and transposition the old row never had', () => {
    const local = localV4()
    const report = mergeForConflict(local, cloudV2())

    // What the unguarded cloud-wins default would have done:
    expect(report.merged.lyrics).toBeUndefined()
    expect(report.merged.transpose).toBeUndefined()

    // What actually ships:
    const settled = autoResolvedMerge(report)
    expect(settled.lyrics).toEqual(local.lyrics)
    expect(settled.transpose).toEqual({ baseSemitones: 2 })
    // ...without losing anything the cloud row did carry.
    expect(settled.harmony).toEqual(local.harmony)
    expect(settled.sections).toEqual(local.sections)
    expect(settled.timeline.bars).toHaveLength(1)
  })

  it('converges: once pushed, the reverse direction is a no-op', () => {
    const settled = autoResolvedMerge(mergeForConflict(localV4(), cloudV2()))
    // The other device now pulls that result against its own v2-derived copy.
    const second = mergeForConflict(cloudV2(), settled)
    expect(hasDangerousConflict(second)).toBe(false)
    const converged = autoResolvedMerge(second)
    expect(converged.lyrics).toEqual(settled.lyrics)
    expect(converged.transpose).toEqual(settled.transpose)
    // And a third pass changes nothing more.
    expect(JSON.stringify(autoResolvedMerge(mergeForConflict(settled, converged)))).toBe(
      JSON.stringify(converged),
    )
  })
})
