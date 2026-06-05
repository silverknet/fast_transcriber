/**
 * Phase 8 — three-way-ish merge for cloud song conflicts.
 *
 * `mergeLocalIntoCollab` in `collab.ts` is the trust-the-server path:
 * use it during a normal pull when there's nothing local to preserve
 * beyond stripped fields. This file owns the harder case: the autosave
 * tried to push and got a 409 because the cloud song's revision moved
 * since the client's `clientBaseRevision`. Now we have:
 *
 *   local   — what the user just edited (their pending push body)
 *   cloud   — what came back in the 409 response (the new server state)
 *
 * The output is a merged SongMap that:
 *  - keeps every item that exists only on one side (different `id`s);
 *  - for items with the same `id` whose contents differ, prefers cloud
 *    by default and records the disagreement so the UI can prompt;
 *  - for scalar fields (metadata.bpm, cues, countInBeats…), same rule —
 *    cloud wins by default, prompt on disagreement;
 *  - for dangerous fields (whole timeline replacement, expectedAudio
 *    swap), always lists the conflict regardless of the user picking
 *    cloud — these require explicit confirmation.
 *
 * The default "cloud wins" choice keeps every other collaborator's
 * editor consistent with the server until the user explicitly says
 * otherwise. The dialog can flip individual rows back to "keep mine"
 * before pushing the merged result with the new clientBaseRevision.
 *
 * The merge is pure. `applyConflictDecisions` builds the final
 * SongMap from the conflict report + user choices.
 */
import type { SongMap, HarmonyEvent, Section, Bar, Beat } from './types'

/**
 * One disputed change. `path` identifies the field so the UI can label
 * it; `mine` / `theirs` carry the two values for side-by-side display.
 * `severity` is `'safe'` for normal LWW choices and `'dangerous'` for
 * field changes the user really should look at (timeline regen, audio
 * identity swap) before clicking through.
 */
export interface Conflict {
  path: string
  label: string
  severity: 'safe' | 'dangerous'
  mine: unknown
  theirs: unknown
}

export interface MergeReport {
  /** The merge result with all conflicts resolved by the default — `theirs` (cloud). */
  merged: SongMap
  /** Every disagreement the user can override. Empty array = auto-merged cleanly. */
  conflicts: Conflict[]
}

/**
 * "Keep mine" for a given conflict path. The dialog flips entries here
 * before calling `applyConflictDecisions(report, decisions)`.
 */
export type ConflictDecisions = Map<string, 'mine' | 'theirs'>

// ── Helpers ──────────────────────────────────────────────────────────────

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    if (a.length !== (b as unknown[]).length) return false
    for (let i = 0; i < a.length; i++) if (!shallowEqual(a[i], (b as unknown[])[i])) return false
    return true
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!shallowEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

/**
 * Merge two `id`-keyed lists. Items unique to one side survive as-is.
 * Items with the same `id` whose contents differ produce a Conflict
 * with `theirs` (cloud) as the default in the merged output.
 */
function mergeByIdList<T extends { id: string }>(
  mine: T[] | undefined,
  theirs: T[] | undefined,
  pathPrefix: string,
  label: string,
): { merged: T[]; conflicts: Conflict[] } {
  const mineMap = new Map<string, T>()
  for (const item of mine ?? []) mineMap.set(item.id, item)
  const theirsMap = new Map<string, T>()
  for (const item of theirs ?? []) theirsMap.set(item.id, item)

  const conflicts: Conflict[] = []
  /** Preserve cloud order, then append local-only items. */
  const merged: T[] = []
  const seen = new Set<string>()

  for (const item of theirs ?? []) {
    const local = mineMap.get(item.id)
    if (local && !shallowEqual(local, item)) {
      conflicts.push({
        path: `${pathPrefix}/${item.id}`,
        label: `${label} ${item.id.slice(0, 8)}`,
        severity: 'safe',
        mine: local,
        theirs: item,
      })
    }
    merged.push(item) // cloud wins by default
    seen.add(item.id)
  }
  for (const item of mine ?? []) {
    if (!seen.has(item.id)) {
      merged.push(item) // local-only item, no conflict
    }
  }
  return { merged, conflicts }
}

function classifyScalar(
  mine: unknown,
  theirs: unknown,
  path: string,
  label: string,
): Conflict | null {
  if (shallowEqual(mine, theirs)) return null
  return { path, label, severity: 'safe', mine, theirs }
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Build the merged SongMap + conflict report. Defaults every disputed
 * field to the cloud value; the UI can flip individual entries back
 * via `applyConflictDecisions`.
 */
export function mergeForConflict(local: SongMap, cloud: SongMap): MergeReport {
  const conflicts: Conflict[] = []

  // ── Lists keyed by id ──
  const harmony = mergeByIdList<HarmonyEvent>(local.harmony, cloud.harmony, 'harmony', 'Chord at beat')
  conflicts.push(...harmony.conflicts)
  const sections = mergeByIdList<Section>(local.sections, cloud.sections, 'sections', 'Section')
  conflicts.push(...sections.conflicts)
  const bars = mergeByIdList<Bar>(local.timeline?.bars, cloud.timeline?.bars, 'timeline/bars', 'Bar')
  conflicts.push(...bars.conflicts)
  const beats = mergeByIdList<Beat>(local.timeline?.beats, cloud.timeline?.beats, 'timeline/beats', 'Beat')
  conflicts.push(...beats.conflicts)

  // ── Wholesale timeline change (bar count differs) is dangerous ──
  if ((local.timeline?.bars?.length ?? 0) !== (cloud.timeline?.bars?.length ?? 0)) {
    conflicts.push({
      path: 'timeline/bars-count',
      label: 'Timeline length',
      severity: 'dangerous',
      mine: local.timeline?.bars?.length ?? 0,
      theirs: cloud.timeline?.bars?.length ?? 0,
    })
  }

  // ── Metadata scalars ──
  const metaFields: Array<keyof SongMap['metadata']> = [
    'title', 'artist', 'composer', 'arranger', 'bpm', 'notes', 'keyDetail',
  ]
  for (const f of metaFields) {
    const c = classifyScalar(
      local.metadata?.[f],
      cloud.metadata?.[f],
      `metadata/${String(f)}`,
      `Metadata · ${String(f)}`,
    )
    if (c) conflicts.push(c)
  }
  // `metadata.analyzed` flipping is dangerous — it changes the whole editor mode.
  if ((local.metadata?.analyzed ?? false) !== (cloud.metadata?.analyzed ?? false)) {
    conflicts.push({
      path: 'metadata/analyzed',
      label: 'Analyzed flag',
      severity: 'dangerous',
      mine: !!local.metadata?.analyzed,
      theirs: !!cloud.metadata?.analyzed,
    })
  }

  // ── Cues / count-in / start-beat ──
  const cuesC = classifyScalar(local.cues, cloud.cues, 'cues', 'Cue settings')
  if (cuesC) conflicts.push(cuesC)
  const cibC = classifyScalar(local.countInBeats, cloud.countInBeats, 'countInBeats', 'Count-in beats')
  if (cibC) conflicts.push(cibC)
  const sbC = classifyScalar(local.startBeatId, cloud.startBeatId, 'startBeatId', 'Start beat')
  if (sbC) conflicts.push(sbC)

  // ── expectedAudio swap is dangerous (different master) ──
  if (
    local.expectedAudio?.sha256 &&
    cloud.expectedAudio?.sha256 &&
    local.expectedAudio.sha256 !== cloud.expectedAudio.sha256
  ) {
    conflicts.push({
      path: 'expectedAudio',
      label: 'Expected audio identity',
      severity: 'dangerous',
      mine: local.expectedAudio,
      theirs: cloud.expectedAudio,
    })
  }

  // ── Assemble merged result, cloud wins by default ──
  const merged: SongMap = {
    ...cloud,
    harmony: harmony.merged,
    sections: sections.merged,
    timeline: {
      bars: bars.merged,
      beats: beats.merged,
    },
  }

  return { merged, conflicts }
}

/**
 * Apply user choices over a merge report. For every conflict the user
 * picked "mine", swap that path's value in the merged SongMap.
 *
 * Handles list-keyed paths (`harmony/<id>`, `sections/<id>`,
 * `timeline/bars/<id>`, `timeline/beats/<id>`) and scalar paths
 * (`metadata/<field>`, `cues`, `countInBeats`, `startBeatId`,
 * `expectedAudio`, `timeline/bars-count`, `metadata/analyzed`).
 */
export function applyConflictDecisions(
  report: MergeReport,
  decisions: ConflictDecisions,
): SongMap {
  let result: SongMap = report.merged

  for (const c of report.conflicts) {
    const choice = decisions.get(c.path) ?? 'theirs'
    if (choice === 'theirs') continue

    // id-keyed list paths: replace the cloud item with the local one.
    if (c.path.startsWith('harmony/')) {
      const id = c.path.slice('harmony/'.length)
      result = {
        ...result,
        harmony: result.harmony.map((h) => (h.id === id ? (c.mine as HarmonyEvent) : h)),
      }
      continue
    }
    if (c.path.startsWith('sections/')) {
      const id = c.path.slice('sections/'.length)
      result = {
        ...result,
        sections: result.sections.map((s) => (s.id === id ? (c.mine as Section) : s)),
      }
      continue
    }
    if (c.path.startsWith('timeline/bars/')) {
      const id = c.path.slice('timeline/bars/'.length)
      result = {
        ...result,
        timeline: {
          ...result.timeline,
          bars: result.timeline.bars.map((b) => (b.id === id ? (c.mine as Bar) : b)),
        },
      }
      continue
    }
    if (c.path.startsWith('timeline/beats/')) {
      const id = c.path.slice('timeline/beats/'.length)
      result = {
        ...result,
        timeline: {
          ...result.timeline,
          beats: result.timeline.beats.map((b) => (b.id === id ? (c.mine as Beat) : b)),
        },
      }
      continue
    }
    // Scalar / object paths.
    if (c.path.startsWith('metadata/')) {
      const f = c.path.slice('metadata/'.length)
      if (f === 'analyzed') {
        result = { ...result, metadata: { ...result.metadata, analyzed: c.mine as boolean } }
      } else {
        result = { ...result, metadata: { ...result.metadata, [f]: c.mine } }
      }
      continue
    }
    if (c.path === 'cues') result = { ...result, cues: c.mine as SongMap['cues'] }
    else if (c.path === 'countInBeats') result = { ...result, countInBeats: c.mine as number | undefined }
    else if (c.path === 'startBeatId') result = { ...result, startBeatId: c.mine as string | undefined }
    else if (c.path === 'expectedAudio') result = { ...result, expectedAudio: c.mine as SongMap['expectedAudio'] }
    // `timeline/bars-count` is informational — the per-id merges above
    // already determine which bars survive; no extra apply step.
  }

  return result
}
