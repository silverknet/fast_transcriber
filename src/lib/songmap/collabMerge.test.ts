import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import type { Bar, Beat, HarmonyEvent, Section, SongMap } from './types'
import {
  applyConflictDecisions,
  mergeForConflict,
  type Conflict,
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
  }
}

function beat(id: string, barId: string, indexInBar: number, timeSec: number): Beat {
  return { id, barId, indexInBar, timeSec, source: 'detected' }
}

function section(id: string, label: string, start: number, end: number): Section {
  return {
    id,
    kind: 'verse',
    label,
    barRange: { startBarIndex: start, endBarIndex: end },
  }
}

function pathSet(conflicts: Conflict[]): Set<string> {
  return new Set(conflicts.map((c) => c.path))
}

describe('collabMerge · mergeForConflict', () => {
  it('reports no conflicts when local and cloud are identical', () => {
    const sm = createEmptySongMap()
    const { conflicts, merged } = mergeForConflict(sm, sm)
    expect(conflicts).toEqual([])
    expect(merged.metadata.title).toBe(sm.metadata.title)
  })

  it('keeps non-overlapping list items from both sides — no conflict', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, harmony: [chord('h-1', 'C'), chord('h-2', 'F')] }
    const cloud: SongMap = { ...base, harmony: [chord('h-3', 'G'), chord('h-4', 'Am')] }

    const { merged, conflicts } = mergeForConflict(local, cloud)
    expect(conflicts).toEqual([])
    expect(merged.harmony.map((h) => h.id).sort()).toEqual(['h-1', 'h-2', 'h-3', 'h-4'])
  })

  it('flags a safe conflict for same-id chord with different content; defaults to theirs', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, harmony: [chord('h-1', 'C')] }
    const cloud: SongMap = { ...base, harmony: [chord('h-1', 'G')] }

    const { merged, conflicts } = mergeForConflict(local, cloud)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.path).toBe('harmony/h-1')
    expect(conflicts[0]?.severity).toBe('safe')
    // Default = theirs (cloud).
    expect(merged.harmony).toHaveLength(1)
    expect(merged.harmony[0]?.chord.displayRaw).toBe('G')
  })

  it('same id + identical content → no conflict, no duplicate', () => {
    const base = createEmptySongMap()
    const same = chord('h-1', 'C')
    const local: SongMap = { ...base, harmony: [same] }
    const cloud: SongMap = { ...base, harmony: [same] }

    const { merged, conflicts } = mergeForConflict(local, cloud)
    expect(conflicts).toEqual([])
    expect(merged.harmony).toHaveLength(1)
  })

  it('flags scalar metadata disagreements (bpm)', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, metadata: { ...base.metadata, bpm: 120 } }
    const cloud: SongMap = { ...base, metadata: { ...base.metadata, bpm: 140 } }

    const { merged, conflicts } = mergeForConflict(local, cloud)
    const bpmC = conflicts.find((c) => c.path === 'metadata/bpm')
    expect(bpmC).toBeDefined()
    expect(bpmC?.severity).toBe('safe')
    expect(merged.metadata.bpm).toBe(140) // theirs wins by default
  })

  it('flags timeline bar-count change as dangerous', () => {
    const base = createEmptySongMap()
    const local: SongMap = {
      ...base,
      timeline: { bars: [bar('b-1', 0)], beats: [] },
    }
    const cloud: SongMap = {
      ...base,
      timeline: { bars: [bar('b-1', 0), bar('b-2', 1)], beats: [] },
    }
    const { conflicts } = mergeForConflict(local, cloud)
    const tlC = conflicts.find((c) => c.path === 'timeline/bars-count')
    expect(tlC).toBeDefined()
    expect(tlC?.severity).toBe('dangerous')
  })

  it('flags metadata.analyzed flip as dangerous', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, metadata: { ...base.metadata, analyzed: true } }
    const cloud: SongMap = { ...base, metadata: { ...base.metadata, analyzed: false } }
    const { conflicts } = mergeForConflict(local, cloud)
    const c = conflicts.find((c) => c.path === 'metadata/analyzed')
    expect(c).toBeDefined()
    expect(c?.severity).toBe('dangerous')
  })

  it('flags expectedAudio sha swap as dangerous', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, expectedAudio: { fileName: 'a.wav', sha256: 'aaa' } }
    const cloud: SongMap = { ...base, expectedAudio: { fileName: 'a.wav', sha256: 'bbb' } }
    const { conflicts } = mergeForConflict(local, cloud)
    const c = conflicts.find((c) => c.path === 'expectedAudio')
    expect(c).toBeDefined()
    expect(c?.severity).toBe('dangerous')
  })

  it('does not flag expectedAudio when only the local side has a sha', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, expectedAudio: { fileName: 'a.wav', sha256: 'aaa' } }
    const cloud: SongMap = { ...base, expectedAudio: { fileName: 'a.wav' } }
    const { conflicts } = mergeForConflict(local, cloud)
    expect(conflicts.some((c) => c.path === 'expectedAudio')).toBe(false)
  })

  it('merges sections by id — non-overlapping kept, overlapping flagged', () => {
    const base = createEmptySongMap()
    const local: SongMap = {
      ...base,
      sections: [section('s-1', 'Verse 1', 0, 3), section('s-2', 'Chorus', 4, 7)],
    }
    const cloud: SongMap = {
      ...base,
      sections: [section('s-1', 'Verse 1 (renamed)', 0, 3), section('s-3', 'Bridge', 8, 11)],
    }
    const { merged, conflicts } = mergeForConflict(local, cloud)
    expect(conflicts.some((c) => c.path === 'sections/s-1')).toBe(true)
    expect(merged.sections.map((s) => s.id).sort()).toEqual(['s-1', 's-2', 's-3'])
    // s-1 defaults to theirs.
    expect(merged.sections.find((s) => s.id === 's-1')?.label).toBe('Verse 1 (renamed)')
  })

  it('merges timeline beats by id', () => {
    const base = createEmptySongMap()
    const local: SongMap = {
      ...base,
      timeline: { bars: [], beats: [beat('bt-1', 'b-1', 0, 0), beat('bt-2', 'b-1', 1, 0.5)] },
    }
    const cloud: SongMap = {
      ...base,
      timeline: { bars: [], beats: [beat('bt-1', 'b-1', 0, 0.05), beat('bt-3', 'b-1', 2, 1)] },
    }
    const { merged, conflicts } = mergeForConflict(local, cloud)
    expect(pathSet(conflicts).has('timeline/beats/bt-1')).toBe(true)
    expect(merged.timeline.beats.map((b) => b.id).sort()).toEqual(['bt-1', 'bt-2', 'bt-3'])
  })
})

describe('collabMerge · applyConflictDecisions', () => {
  it('returns the cloud-default merge when no decisions are passed', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, metadata: { ...base.metadata, bpm: 100 } }
    const cloud: SongMap = { ...base, metadata: { ...base.metadata, bpm: 130 } }
    const report = mergeForConflict(local, cloud)
    const result = applyConflictDecisions(report, new Map())
    expect(result.metadata.bpm).toBe(130)
  })

  it('flips a metadata scalar back to "mine" when decided', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, metadata: { ...base.metadata, bpm: 100 } }
    const cloud: SongMap = { ...base, metadata: { ...base.metadata, bpm: 130 } }
    const report = mergeForConflict(local, cloud)
    const result = applyConflictDecisions(report, new Map([['metadata/bpm', 'mine']]))
    expect(result.metadata.bpm).toBe(100)
  })

  it('flips a same-id harmony item back to "mine" without duplicating', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, harmony: [chord('h-1', 'C')] }
    const cloud: SongMap = { ...base, harmony: [chord('h-1', 'G')] }
    const report = mergeForConflict(local, cloud)
    const result = applyConflictDecisions(report, new Map([['harmony/h-1', 'mine']]))
    expect(result.harmony).toHaveLength(1)
    expect(result.harmony[0]?.chord.displayRaw).toBe('C')
  })

  it('flips expectedAudio back to "mine"', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, expectedAudio: { fileName: 'a.wav', sha256: 'aaa' } }
    const cloud: SongMap = { ...base, expectedAudio: { fileName: 'b.wav', sha256: 'bbb' } }
    const report = mergeForConflict(local, cloud)
    const result = applyConflictDecisions(report, new Map([['expectedAudio', 'mine']]))
    expect(result.expectedAudio?.sha256).toBe('aaa')
  })

  it('preserves non-conflicted local-only items regardless of decisions', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, harmony: [chord('h-1', 'C'), chord('h-2', 'F')] }
    const cloud: SongMap = { ...base, harmony: [chord('h-3', 'G')] }
    const report = mergeForConflict(local, cloud)
    const result = applyConflictDecisions(report, new Map())
    expect(result.harmony.map((h) => h.id).sort()).toEqual(['h-1', 'h-2', 'h-3'])
  })
})

describe('collabMerge · invariant: no silent data loss', () => {
  it('every conflicting field appears in the conflicts list', () => {
    const base = createEmptySongMap()
    const local: SongMap = {
      ...base,
      metadata: { ...base.metadata, bpm: 100, artist: 'Local' },
      harmony: [chord('h-1', 'C'), chord('h-2', 'F')],
      sections: [section('s-1', 'Verse', 0, 3)],
      countInBeats: 4,
    }
    const cloud: SongMap = {
      ...base,
      metadata: { ...base.metadata, bpm: 130, artist: 'Cloud' },
      harmony: [chord('h-1', 'G'), chord('h-3', 'Am')],
      sections: [section('s-1', 'Verse (cloud)', 0, 3)],
      countInBeats: 2,
    }
    const { conflicts } = mergeForConflict(local, cloud)
    const paths = pathSet(conflicts)
    expect(paths.has('metadata/bpm')).toBe(true)
    expect(paths.has('metadata/artist')).toBe(true)
    expect(paths.has('harmony/h-1')).toBe(true)
    expect(paths.has('sections/s-1')).toBe(true)
    expect(paths.has('countInBeats')).toBe(true)
    // Non-conflicting (h-2, h-3) must NOT appear.
    expect(paths.has('harmony/h-2')).toBe(false)
    expect(paths.has('harmony/h-3')).toBe(false)
  })

  it('"Keep mine" for every conflict reproduces the local SongMap fields', () => {
    const base = createEmptySongMap()
    const local: SongMap = {
      ...base,
      metadata: { ...base.metadata, bpm: 100 },
      harmony: [chord('h-1', 'C')],
      countInBeats: 4,
    }
    const cloud: SongMap = {
      ...base,
      metadata: { ...base.metadata, bpm: 130 },
      harmony: [chord('h-1', 'G')],
      countInBeats: 2,
    }
    const report = mergeForConflict(local, cloud)
    const decisions = new Map(report.conflicts.map((c) => [c.path, 'mine' as const]))
    const result = applyConflictDecisions(report, decisions)
    expect(result.metadata.bpm).toBe(100)
    expect(result.harmony[0]?.chord.displayRaw).toBe('C')
    expect(result.countInBeats).toBe(4)
  })
})
