import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import type { Bar, Beat, HarmonyEvent, Section, SongMap } from './types'
import {
  applyConflictDecisions,
  mergeForConflict,
  type Conflict,
} from './collabMerge'
import { mergeLocalIntoCollab } from './collab'

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
  return {
    id,
    kind: 'verse',
    label,
    barRange: { startBarIndex: start, endBarIndex: end },
  }
}

function audio(
  fileName: string,
  opts: Partial<NonNullable<SongMap['audio']>> = {},
): NonNullable<SongMap['audio']> {
  return {
    fileName,
    source: 'upload',
    trim: { startSec: 0, endSec: 10 },
    durationSec: 10,
    sampleRate: 44100,
    channels: 2,
    fileSize: 12345,
    ...opts,
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

  it('keeps non-overlapping list items from both sides — no conflict (co-editing)', () => {
    const base = createEmptySongMap()
    // A shared chord marks this as co-editing (same track, additions on both
    // sides). Zero-overlap non-empty harmony is a wholesale replacement and
    // is covered by the dedicated describe block below.
    const shared = chord('h-0', 'Am')
    const local: SongMap = { ...base, harmony: [shared, chord('h-1', 'C'), chord('h-2', 'F')] }
    const cloud: SongMap = { ...base, harmony: [shared, chord('h-3', 'G'), chord('h-4', 'Am')] }

    const { merged, conflicts } = mergeForConflict(local, cloud)
    expect(conflicts).toEqual([])
    expect(merged.harmony.map((h) => h.id).sort()).toEqual(['h-0', 'h-1', 'h-2', 'h-3', 'h-4'])
  })

  it('does NOT flag a phantom conflict when a chord differs only by float round-trip noise', () => {
    // The server (JSONB) re-serializes floats, so a chord that came back from
    // the cloud can have startSec 1.2000000000000002 vs the local 1.2. These
    // are the same chord — must not surface a conflict row.
    const base = createEmptySongMap()
    const mine = { ...chord('h-1', 'C'), startSec: 1.2, endSec: 2.4 }
    const theirs = { ...chord('h-1', 'C'), startSec: 1.2000000000000002, endSec: 2.3999999999999995 }
    const local: SongMap = { ...base, harmony: [mine] }
    const cloud: SongMap = { ...base, harmony: [theirs] }

    const { conflicts } = mergeForConflict(local, cloud)
    expect(conflicts).toEqual([])
  })

  it('does NOT flag a phantom conflict for an undefined-vs-missing optional field', () => {
    const base = createEmptySongMap()
    const mine = { ...chord('h-1', 'C'), beatId: undefined } as HarmonyEvent
    const theirs = chord('h-1', 'C') // no beatId key at all
    const local: SongMap = { ...base, harmony: [mine] }
    const cloud: SongMap = { ...base, harmony: [theirs] }

    const { conflicts } = mergeForConflict(local, cloud)
    expect(conflicts).toEqual([])
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

  it('does not flag audio conflict for same identity with different local paths and duration noise', () => {
    const base = createEmptySongMap()
    const local: SongMap = {
      ...base,
      audio: audio('song.wav', {
        sha256: 'same-sha',
        durationSec: 10.1234561,
        originalPath: 'audio/local-song.wav',
      }),
    }
    const cloud: SongMap = {
      ...base,
      audio: audio('song.wav', {
        sha256: 'same-sha',
        durationSec: 10.1234569,
        originalPath: 'audio/other-machine.wav',
      }),
    }

    const { conflicts } = mergeForConflict(local, cloud)
    expect(conflicts.some((c) => c.path === 'audio')).toBe(false)
  })

  it('flags different audio sha as dangerous and can keep mine', () => {
    const base = createEmptySongMap()
    const localAudio = audio('song.wav', { sha256: 'local-sha', originalPath: 'audio/song.wav' })
    const cloudAudio = audio('song.mp3', { sha256: 'cloud-sha', fileSize: 22222 })
    const local: SongMap = { ...base, audio: localAudio }
    const cloud: SongMap = { ...base, audio: cloudAudio }

    const report = mergeForConflict(local, cloud)
    const audioConflicts = report.conflicts.filter((c) => c.path === 'audio')
    expect(audioConflicts).toHaveLength(1)
    expect(audioConflicts[0]).toMatchObject({
      label: 'Audio file',
      severity: 'dangerous',
    })
    expect(report.merged.audio?.sha256).toBe('cloud-sha')

    const result = applyConflictDecisions(report, new Map([['audio', 'mine']]))
    expect(result.audio?.sha256).toBe('local-sha')
    expect(result.audio?.fileName).toBe('song.wav')
    expect(result.audio?.originalPath).toBeUndefined()
  })

  it('flags audio conflict when local has audio and cloud has none', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, audio: audio('song.wav', { sha256: 'local-sha' }) }
    const cloud: SongMap = { ...base, audio: undefined }

    const { conflicts } = mergeForConflict(local, cloud)
    expect(conflicts).toContainEqual(
      expect.objectContaining({ path: 'audio', severity: 'dangerous' }),
    )
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

  it('labels and resolves transpose conflicts', () => {
    const base = createEmptySongMap()
    const local: SongMap = { ...base, transpose: { baseSemitones: -2 } }
    const cloud: SongMap = { ...base, transpose: { baseSemitones: 2 } }
    const report = mergeForConflict(local, cloud)
    expect(report.conflicts).toContainEqual(
      expect.objectContaining({ path: 'transpose', label: 'Transposition' }),
    )
    expect(applyConflictDecisions(report, new Map()).transpose?.baseSemitones).toBe(2)
    expect(applyConflictDecisions(report, new Map([['transpose', 'mine']])).transpose?.baseSemitones).toBe(-2)
  })

  it('labels and resolves lyrics conflicts (whole-field LWW)', () => {
    const base = createEmptySongMap()
    const mine = {
      words: [{ text: 'Hey', startSec: 1, endSec: 1.4, line: 0 }],
      sourceText: 'Hey',
    }
    const theirs = {
      words: [{ text: 'Yo', startSec: 2, endSec: 2.3, line: 0 }],
      sourceText: 'Yo',
    }
    const local: SongMap = { ...base, lyrics: mine }
    const cloud: SongMap = { ...base, lyrics: theirs }
    const report = mergeForConflict(local, cloud)
    expect(report.conflicts).toContainEqual(
      expect.objectContaining({ path: 'lyrics', label: 'Lyrics' }),
    )
    expect(applyConflictDecisions(report, new Map()).lyrics?.sourceText).toBe('Yo')
    expect(applyConflictDecisions(report, new Map([['lyrics', 'mine']])).lyrics?.sourceText).toBe('Hey')
  })

  it('identical lyrics on both sides produce no conflict', () => {
    const base = createEmptySongMap()
    const same = { words: [], sourceText: 'La la' }
    const report = mergeForConflict({ ...base, lyrics: same }, { ...base, lyrics: { ...same } })
    expect(report.conflicts.some((c) => c.path === 'lyrics')).toBe(false)
  })

  it('preserves non-conflicted local-only items regardless of decisions', () => {
    const base = createEmptySongMap()
    const shared = chord('h-0', 'Am')
    const local: SongMap = { ...base, harmony: [shared, chord('h-1', 'C'), chord('h-2', 'F')] }
    const cloud: SongMap = { ...base, harmony: [shared, chord('h-3', 'G')] }
    const report = mergeForConflict(local, cloud)
    const result = applyConflictDecisions(report, new Map())
    expect(result.harmony.map((h) => h.id).sort()).toEqual(['h-0', 'h-1', 'h-2', 'h-3'])
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
      transpose: { baseSemitones: -1 },
    }
    const cloud: SongMap = {
      ...base,
      metadata: { ...base.metadata, bpm: 130, artist: 'Cloud' },
      harmony: [chord('h-1', 'G'), chord('h-3', 'Am')],
      sections: [section('s-1', 'Verse (cloud)', 0, 3)],
      countInBeats: 2,
      transpose: { baseSemitones: 1 },
    }
    const { conflicts } = mergeForConflict(local, cloud)
    const paths = pathSet(conflicts)
    expect(paths.has('metadata/bpm')).toBe(true)
    expect(paths.has('metadata/artist')).toBe(true)
    expect(paths.has('harmony/h-1')).toBe(true)
    expect(paths.has('sections/s-1')).toBe(true)
    expect(paths.has('countInBeats')).toBe(true)
    expect(paths.has('transpose')).toBe(true)
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

  it('rehydrates local-only fields after adopting a collab merge result', () => {
    const base = createEmptySongMap()
    const local: SongMap = {
      ...base,
      audio: audio('song.wav', {
        sha256: 'same-sha',
        originalPath: 'audio/song.wav',
      }),
      stemRefs: { Vocals: 'stems/best/vocals.wav' },
      mixState: { master: 0.8, tracks: [{ key: 'original', volume: 0.7, muted: true }] },
    }
    const cloud: SongMap = {
      ...base,
      audio: audio('song.wav', { sha256: 'same-sha' }),
    }

    const report = mergeForConflict(local, cloud)
    const hydrated = mergeLocalIntoCollab(local, report.merged)
    expect(hydrated.audio?.originalPath).toBe('audio/song.wav')
    expect(hydrated.stemRefs).toEqual(local.stemRefs)
    expect(hydrated.mixState).toEqual(local.mixState)
  })
})

describe('wholesale harmony replacement (sheet import vs stale cloud)', () => {
  function withHarmony(harmony: HarmonyEvent[]): SongMap {
    const m = createEmptySongMap()
    return { ...m, harmony }
  }
  it('near-zero id overlap surfaces ONE dangerous harmony conflict instead of a union', () => {
    const local = withHarmony([chord('n1', 'A'), chord('n2', 'C')])
    const cloud = withHarmony([chord('o1', 'G'), chord('o2', 'D'), chord('o3', 'E')])
    const report = mergeForConflict(local, cloud)
    const row = report.conflicts.find((c) => c.path === 'harmony')
    expect(row).toBeTruthy()
    expect(row!.severity).toBe('dangerous')
    // Default = cloud; no 5-chord union soup.
    expect(report.merged.harmony.map((x) => x.id)).toEqual(['o1', 'o2', 'o3'])
    // "Keep mine" installs the local track wholesale.
    const resolved = applyConflictDecisions(report, new Map([['harmony', 'mine']]))
    expect(resolved.harmony.map((x) => x.id)).toEqual(['n1', 'n2'])
  })
  it('normal co-editing (shared ids) keeps the per-chord merge', () => {
    const shared = chord('s1', 'A')
    const local = withHarmony([shared, chord('n2', 'C')])
    const cloud = withHarmony([shared, chord('o2', 'D')])
    const report = mergeForConflict(local, cloud)
    expect(report.conflicts.find((c) => c.path === 'harmony')).toBeUndefined()
    expect(report.merged.harmony.map((x) => x.id).sort()).toEqual(['n2', 'o2', 's1'])
  })
})

describe('collabMerge · timeline.original is preserved through a merge', () => {
  // Regression: the merged SongMap rebuilt `timeline` as just `{ bars, beats }`,
  // silently dropping `timeline.original` — the analyzed baseline the editor
  // uses for "Reset grid". After any collab/cloud conflict resolve the reset
  // affordance vanished. `original` is captured once at analysis and never
  // hand-edited, so it must ride through the merge untouched.
  function withOriginal(): SongMap {
    const base = createEmptySongMap()
    return {
      ...base,
      timeline: {
        bars: [bar('b-0', 0)],
        beats: [beat('bt-0', 'b-0', 0, 0)],
        original: {
          bars: [bar('b-0', 0)],
          beats: [beat('bt-0', 'b-0', 0, 0)],
        },
      },
    }
  }

  it('keeps original when both sides have it', () => {
    const sm = withOriginal()
    const { merged } = mergeForConflict(sm, sm)
    expect(merged.timeline.original).toBeTruthy()
    expect(merged.timeline.original!.bars.map((b) => b.id)).toEqual(['b-0'])
    expect(merged.timeline.original!.beats.map((b) => b.id)).toEqual(['bt-0'])
  })

  it('keeps original even if only the LOCAL side carries it', () => {
    const local = withOriginal()
    const cloud: SongMap = {
      ...local,
      timeline: { bars: local.timeline.bars, beats: local.timeline.beats },
    }
    expect(cloud.timeline.original).toBeUndefined()
    const { merged } = mergeForConflict(local, cloud)
    expect(merged.timeline.original).toBeTruthy()
    expect(merged.timeline.original!.bars.map((b) => b.id)).toEqual(['b-0'])
  })
})
