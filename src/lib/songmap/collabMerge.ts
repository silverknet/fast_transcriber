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
 *  - for scalar fields (metadata.bpm, countInBeats...), same rule -
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
import type { SongMap, HarmonyEvent, Section, Bar, Beat, CueEvent, CueTrack } from './types'
import { canonicalEqual } from './collab'

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

/**
 * Content equality for merge decisions. Delegates to `canonicalEqual`, which
 * normalizes the same way the sync fingerprint does — so two items that differ
 * only by server JSON round-trip noise (float re-serialization, `undefined` vs
 * missing keys, key order) are treated as identical and never surface a phantom
 * conflict row.
 */
function shallowEqual(a: unknown, b: unknown): boolean {
  return canonicalEqual(a, b)
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

function audioIdentityDiffers(a: SongMap['audio'], b: SongMap['audio']): boolean {
  if (!a && !b) return false
  if (!a || !b) return true
  if (a.sha256 && b.sha256) return a.sha256 !== b.sha256
  return a.fileName !== b.fileName || a.fileSize !== b.fileSize
}

function stripAudioOriginalPath(audio: SongMap['audio']): SongMap['audio'] {
  if (!audio) return undefined
  const { originalPath: _originalPath, ...rest } = audio
  return rest
}

function cueEventLabel(mine: CueEvent, theirs: CueEvent): string {
  if (mine.text !== theirs.text) return 'Cue text'
  if (!shallowEqual(mine.anchor, theirs.anchor)) return 'Cue timing'
  if (mine.enabled !== theirs.enabled) return 'Cue enabled'
  return 'Cue event'
}

function mergeCueEvents(
  mine: CueEvent[] | undefined,
  theirs: CueEvent[] | undefined,
  trackId: string,
): { merged: CueEvent[]; conflicts: Conflict[] } {
  const mineMap = new Map<string, CueEvent>()
  for (const event of mine ?? []) mineMap.set(event.id, event)
  const conflicts: Conflict[] = []
  const merged: CueEvent[] = []
  const seen = new Set<string>()

  for (const event of theirs ?? []) {
    const local = mineMap.get(event.id)
    if (local && !shallowEqual(local, event)) {
      conflicts.push({
        path: `cueTracks/${trackId}/events/${event.id}`,
        label: cueEventLabel(local, event),
        severity: 'safe',
        mine: local,
        theirs: event,
      })
    }
    merged.push(event)
    seen.add(event.id)
  }
  for (const event of mine ?? []) {
    if (!seen.has(event.id)) merged.push(event)
  }
  return { merged, conflicts }
}

function mergeCueTracks(
  mine: CueTrack[] | undefined,
  theirs: CueTrack[] | undefined,
): { merged: CueTrack[]; conflicts: Conflict[] } {
  const mineMap = new Map<string, CueTrack>()
  for (const track of mine ?? []) mineMap.set(track.id, track)
  const conflicts: Conflict[] = []
  const merged: CueTrack[] = []
  const seen = new Set<string>()

  for (const track of theirs ?? []) {
    const local = mineMap.get(track.id)
    if (!local) {
      merged.push(track)
      seen.add(track.id)
      continue
    }

    const events = mergeCueEvents(local.events, track.events, track.id)
    conflicts.push(...events.conflicts)
    for (const field of ['name', 'enabled', 'voiceId', 'suppressedGeneratedKeys'] as const) {
      const c = classifyScalar(
        local[field],
        track[field],
        `cueTracks/${track.id}/${field}`,
        field === 'name'
          ? 'Cue track name'
          : field === 'enabled'
            ? 'Cue track enabled'
            : field === 'voiceId'
              ? 'Cue voice'
              : 'Deleted generated cues',
      )
      if (c) conflicts.push(c)
    }

    merged.push({
      ...track,
      events: events.merged,
    })
    seen.add(track.id)
  }

  for (const track of mine ?? []) {
    if (!seen.has(track.id)) merged.push(track)
  }
  return { merged, conflicts }
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
  const cueTracks = mergeCueTracks(local.cueTracks, cloud.cueTracks)
  conflicts.push(...cueTracks.conflicts)

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

  // ── Count-in / start-beat ──
  const cibC = classifyScalar(local.countInBeats, cloud.countInBeats, 'countInBeats', 'Count-in beats')
  if (cibC) conflicts.push(cibC)
  const sbC = classifyScalar(local.startBeatId, cloud.startBeatId, 'startBeatId', 'Start beat')
  if (sbC) conflicts.push(sbC)
  const trC = classifyScalar(
    local.transpose,
    cloud.transpose,
    'transpose',
    'Transposition',
  )
  if (trC) conflicts.push(trC)
  // Whole-field LWW for lyrics (like transpose) — lyric edits are wholesale
  // (paste / re-align), so per-word merging isn't worth the complexity.
  const lyC = classifyScalar(local.lyrics, cloud.lyrics, 'lyrics', 'Lyrics')
  if (lyC) conflicts.push(lyC)
  // Whole-field LWW for stored chord tracks (v5) — layers are snapshots
  // created/consumed wholesale (stash on import, switch), like lyrics.
  const clC = classifyScalar(local.chordLayers, cloud.chordLayers, 'chordLayers', 'Chord tracks')
  if (clC) conflicts.push(clC)
  const clnC = classifyScalar(
    local.activeChordLayerName,
    cloud.activeChordLayerName,
    'activeChordLayerName',
    'Active chord track name',
  )
  if (clnC) conflicts.push(clnC)
  const slC = classifyScalar(local.sectionLayers, cloud.sectionLayers, 'sectionLayers', 'Section layouts')
  if (slC) conflicts.push(slC)
  const slnC = classifyScalar(
    local.activeSectionLayerName,
    cloud.activeSectionLayerName,
    'activeSectionLayerName',
    'Active section layout name',
  )
  if (slnC) conflicts.push(slnC)

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

  // ── Audio identity swap is dangerous (different master) ──
  // `audio.originalPath` is per-machine and must never participate in the
  // conflict value. Identity is intentionally narrow: sha when both sides
  // have it, otherwise fileName/fileSize. Durations/rates pick up float
  // noise through JSONB and are handled by reconciliation elsewhere.
  if (audioIdentityDiffers(local.audio, cloud.audio)) {
    conflicts.push({
      path: 'audio',
      label: 'Audio file',
      severity: 'dangerous',
      mine: stripAudioOriginalPath(local.audio),
      theirs: stripAudioOriginalPath(cloud.audio),
    })
  }

  // ── Assemble merged result, cloud wins by default ──
  const merged: SongMap = {
    ...cloud,
    harmony: harmony.merged,
    sections: sections.merged,
    cueTracks: cueTracks.merged,
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
 * `timeline/bars/<id>`, `timeline/beats/<id>`,
 * `cueTracks/<trackId>/events/<eventId>`) and scalar paths
 * (`metadata/<field>`, `cueTracks/<trackId>/<field>`,
 * `countInBeats`, `startBeatId`, `expectedAudio`,
 * `timeline/bars-count`, `metadata/analyzed`).
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
    if (c.path.startsWith('cueTracks/')) {
      const parts = c.path.split('/')
      const trackId = parts[1]
      const field = parts[2]
      if (trackId && field === 'events' && parts[3]) {
        const eventId = parts[3]
        result = {
          ...result,
          cueTracks: result.cueTracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  events: track.events.map((event) => (event.id === eventId ? (c.mine as CueEvent) : event)),
                }
              : track,
          ),
        }
        continue
      }
      if (trackId && field) {
        result = {
          ...result,
          cueTracks: result.cueTracks.map((track) =>
            track.id === trackId ? { ...track, [field]: c.mine } : track,
          ),
        }
        continue
      }
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
    if (c.path === 'countInBeats') result = { ...result, countInBeats: c.mine as number | undefined }
    else if (c.path === 'startBeatId') result = { ...result, startBeatId: c.mine as string | undefined }
    else if (c.path === 'transpose') result = { ...result, transpose: c.mine as SongMap['transpose'] }
    else if (c.path === 'lyrics') result = { ...result, lyrics: c.mine as SongMap['lyrics'] }
    else if (c.path === 'chordLayers') result = { ...result, chordLayers: c.mine as SongMap['chordLayers'] }
    else if (c.path === 'activeChordLayerName') result = { ...result, activeChordLayerName: c.mine as string | undefined }
    else if (c.path === 'sectionLayers') result = { ...result, sectionLayers: c.mine as SongMap['sectionLayers'] }
    else if (c.path === 'activeSectionLayerName') result = { ...result, activeSectionLayerName: c.mine as string | undefined }
    else if (c.path === 'expectedAudio') result = { ...result, expectedAudio: c.mine as SongMap['expectedAudio'] }
    else if (c.path === 'audio') result = { ...result, audio: c.mine as SongMap['audio'] }
    // `timeline/bars-count` is informational — the per-id merges above
    // already determine which bars survive; no extra apply step.
  }

  return result
}
