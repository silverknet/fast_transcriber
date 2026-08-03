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
import type { SongMap, HarmonyEvent, Section, SongDraft, Bar, Beat, CueEvent, CueTrack } from './types'
import { canonicalEqual } from './collab'
import { DEFAULT_DRAFT_NAME, makeDraft } from './drafts'

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
/** The active draft of one side: its identity AND its content. */
type DraftSide = {
  id: string
  name: string
  sections: Section[]
  harmony: HarmonyEvent[]
  lyrics: SongMap['lyrics']
}

function activeDraftSide(map: SongMap): DraftSide | null {
  if (!map.activeDraftId) return null
  return {
    id: map.activeDraftId,
    name: map.activeDraftName ?? DEFAULT_DRAFT_NAME,
    sections: map.sections ?? [],
    harmony: map.harmony ?? [],
    lyrics: map.lyrics,
  }
}

/**
 * Store a side's active draft into `list`, REPLACING any entry with the same
 * id rather than skipping it.
 *
 * Replacing matters: the other device may already hold a copy of this draft
 * from before it switched away, and that copy is a stale snapshot. The side
 * whose ROOT holds the draft has been editing it since, so its content is the
 * live one. Skipping on id-match let the stale copy shadow those edits and
 * silently dropped them.
 */
function preserveSide(list: SongDraft[], side: DraftSide): SongDraft[] {
  // No `createdAt`: merge output is fingerprinted and pushed, so it must be
  // byte-deterministic — a wall-clock stamp would make two devices merging
  // the same pair disagree.
  const draft = makeDraft({
    id: side.id,
    name: side.name,
    source: 'manual',
    sections: side.sections,
    harmony: side.harmony,
    lyrics: side.lyrics,
  })
  const at = list.findIndex((d) => d.id === side.id)
  if (at === -1) return [...list, draft]
  // Keep position stable so the merge stays deterministic.
  return list.map((d, i) => (i === at ? draft : d))
}

export function mergeForConflict(local: SongMap, cloud: SongMap): MergeReport {
  const conflicts: Conflict[] = []

  // ── Song drafts decide how the root content merges ────────────────────────
  // `harmony` / `sections` / `lyrics` at the root are the ACTIVE DRAFT's
  // content. Per-id merging of those fields is only meaningful when both sides
  // are ON THE SAME DRAFT. When they diverge — one collaborator switched drafts
  // or ran a sheet import — a per-id union blends two different arrangements
  // into one: 15 sections from my draft plus 13 from theirs, an arrangement
  // neither person made. So divergence is resolved at DRAFT level: one side's
  // draft wins wholesale and the other is preserved in `drafts[]`, losing
  // nothing and mixing nothing.
  const localSide = activeDraftSide(local)
  const cloudSide = activeDraftSide(cloud)
  const draftsDiverged = localSide !== null && cloudSide !== null && localSide.id !== cloudSide.id

  // ── Lists keyed by id ──
  // Harmony: per-id merging is right for co-editing, but a sheet import /
  // track switch REPLACES the whole list with fresh ids. Unioning those with
  // the cloud's old chords produced a 244-chord soup — and worse, the silent
  // no-conflict rebase then pushed it. Near-zero id overlap on two non-empty
  // sides = a wholesale replacement: surface ONE dangerous conflict and keep
  // the sides intact (cloud default, user can pick "mine").
  const localHarmonyIds = new Set((local.harmony ?? []).map((h) => h.id))
  const harmonyOverlap = (cloud.harmony ?? []).filter((h) => localHarmonyIds.has(h.id)).length
  const harmonyWholesale =
    (local.harmony?.length ?? 0) > 0 &&
    (cloud.harmony?.length ?? 0) > 0 &&
    harmonyOverlap / Math.max(local.harmony.length, cloud.harmony.length) < 0.1 &&
    !canonicalEqual(local.harmony, cloud.harmony)
  const harmony =
    draftsDiverged || harmonyWholesale
      ? { merged: cloud.harmony, conflicts: [] as Conflict[] }
      : mergeByIdList<HarmonyEvent>(local.harmony, cloud.harmony, 'harmony', 'Chord at beat')
  // A draft divergence already raises ONE draft-level conflict below that
  // carries the chords with it; don't also raise a chord-level one.
  if (harmonyWholesale && !draftsDiverged) {
    // mine/theirs carry the ACTUAL arrays so applyConflictDecisions can
    // install the chosen side; the dialog's describe() truncates for display.
    conflicts.push({
      path: 'harmony',
      label: `Chords (whole track: mine ${local.harmony.length} vs cloud ${cloud.harmony.length})`,
      severity: 'dangerous',
      mine: local.harmony,
      theirs: cloud.harmony,
    })
  }
  conflicts.push(...harmony.conflicts)
  const sections = draftsDiverged
    ? { merged: cloud.sections, conflicts: [] as Conflict[] }
    : mergeByIdList<Section>(local.sections, cloud.sections, 'sections', 'Section')
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
  // Lyrics belong to the ACTIVE DRAFT. When the drafts diverged, the
  // draft-level conflict below already carries them; raising a separate lyrics
  // row would let the user resolve it the opposite way and end up with one
  // draft's lyrics over another draft's chords.
  const lyC = draftsDiverged
    ? null
    : classifyScalar(local.lyrics, cloud.lyrics, 'lyrics', 'Lyrics')
  if (lyC) conflicts.push(lyC)
  // Drum track: whole-field LWW like lyrics. Compare with renderExport
  // stripped so a local re-render (new fingerprint/path) never conflicts.
  const dmLocal = local.drumMidi ? { ...local.drumMidi, renderExport: undefined } : undefined
  const dmCloud = cloud.drumMidi ? { ...cloud.drumMidi, renderExport: undefined } : undefined
  const dmC = classifyScalar(dmLocal, dmCloud, 'drumMidi', 'Drum track')
  if (dmC) conflicts.push(dmC)
  const bmLocal = local.bassMidi ? { ...local.bassMidi, renderExport: undefined } : undefined
  const bmCloud = cloud.bassMidi ? { ...cloud.bassMidi, renderExport: undefined } : undefined
  const bmC = classifyScalar(bmLocal, bmCloud, 'bassMidi', 'Bass track')
  if (bmC) conflicts.push(bmC)
  // Drum machine: settings only (events are derived), so whole-field LWW is
  // right — same renderExport-stripped comparison as the tracks above.
  const machLocal = local.drumMachine
    ? { ...local.drumMachine, renderExport: undefined }
    : undefined
  const machCloud = cloud.drumMachine
    ? { ...cloud.drumMachine, renderExport: undefined }
    : undefined
  const machC = classifyScalar(machLocal, machCloud, 'drumMachine', 'Drum machine')
  if (machC) conflicts.push(machC)
  const bMachLocal = local.bassMachine
    ? { ...local.bassMachine, renderExport: undefined }
    : undefined
  const bMachCloud = cloud.bassMachine
    ? { ...cloud.bassMachine, renderExport: undefined }
    : undefined
  const bMachC = classifyScalar(bMachLocal, bMachCloud, 'bassMachine', 'Bass machine')
  if (bMachC) conflicts.push(bMachC)
  const busC = classifyScalar(local.effectBusses, cloud.effectBusses, 'effectBusses', 'Effect busses')
  if (busC) conflicts.push(busC)
  // Stored drafts merge BY ID, not last-write-wins: two collaborators can each
  // create a draft between syncs, and whole-field LWW would drop one of them.
  const storedDrafts = mergeByIdList<SongDraft>(local.drafts, cloud.drafts, 'drafts', 'Draft')
  conflicts.push(...storedDrafts.conflicts)

  if (draftsDiverged) {
    // Which draft is SELECTED is not a dangerous decision — it is lossless
    // whichever way it goes, because both drafts are preserved in `drafts[]`
    // regardless. It's just "which one am I looking at", and the picker changes
    // that in one click. So it is `safe`: it settles without a dialog and
    // auto-resolves toward MINE (see autoResolveDecisions), so a collaborator
    // switching drafts on their machine never yanks the draft out from under
    // you. Marking it dangerous forced a dialog on an ordinary open — exactly
    // the interruption the whole auto-settle path exists to remove.
    conflicts.push({
      path: 'activeDraft',
      label: `Selected draft (mine “${localSide!.name}” vs cloud “${cloudSide!.name}”)`,
      severity: 'safe',
      mine: localSide,
      theirs: cloudSide,
    })
  } else {
    // Same draft on both sides — only the display name can disagree.
    const dfnC = classifyScalar(
      local.activeDraftName,
      cloud.activeDraftName,
      'activeDraftName',
      'Draft name',
    )
    if (dfnC) conflicts.push(dfnC)
  }

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
  // Cloud's draft sits at the root, so LOCAL's active draft has to be moved
  // into storage or its content would be dropped on the floor. The active
  // draft is never also stored (see `validate.ts`), so filter it out.
  let mergedDrafts = storedDrafts.merged
  if (draftsDiverged) mergedDrafts = preserveSide(mergedDrafts, localSide!)
  const activeId = cloud.activeDraftId ?? local.activeDraftId
  mergedDrafts = mergedDrafts.filter((d) => d.id !== activeId)

  // `timeline.original` is the analyzed baseline snapshot ("Reset grid").
  // It's captured once at analysis and never hand-edited, so it's the same on
  // both sides — but it must survive the merge (rebuilding `timeline` as just
  // `{ bars, beats }` silently dropped it, losing the reset affordance after
  // any collab/cloud conflict resolve).
  const mergedOriginal = cloud.timeline?.original ?? local.timeline?.original

  const merged: SongMap = {
    ...cloud,
    harmony: harmony.merged,
    sections: sections.merged,
    drafts: mergedDrafts.length > 0 ? mergedDrafts : undefined,
    cueTracks: cueTracks.merged,
    timeline: {
      bars: bars.merged,
      beats: beats.merged,
      ...(mergedOriginal ? { original: mergedOriginal } : {}),
    },
  }

  return { merged, conflicts }
}

// ── Resolving without a dialog ──────────────────────────────────────────

/**
 * Is this value "nothing"? Used to tell a real disagreement (two edits) from a
 * one-sided ABSENCE (one copy simply never had the field).
 *
 * Numbers and booleans are always content — `0`, `false` and
 * `{ baseSemitones: 0 }` are deliberate values, not blanks. Containers are
 * empty when everything inside them is, so a never-populated
 * `{ words: [], sourceText: '' }` reads as absent while
 * `{ words: [], sourceText: 'hey' }` does not.
 */
function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (typeof v === 'string') return v.trim().length === 0
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).every(isEmptyValue)
  }
  return false
}

/** Does this report contain anything a human must look at before it lands? */
export function hasDangerousConflict(report: MergeReport): boolean {
  return report.conflicts.some((c) => c.severity === 'dangerous')
}

/**
 * Decisions for settling a report WITHOUT asking the user.
 *
 * "Cloud wins" is the right default for a genuine disagreement: two people
 * edited the same field and the server's copy keeps everyone consistent. It is
 * NOT right when the cloud side is simply EMPTY, because then "cloud wins" is
 * not a choice between two edits — it is a deletion of content only this device
 * has. Cloud sync was push-only-on-open for a long time, so a cloud row can be
 * months behind and missing whole fields (a `formatVersion` 2 row predates both
 * `transpose` and `lyrics`, so it has neither). Letting it win there would wipe
 * work that never reached the server.
 *
 * So one asymmetry is corrected: when the cloud value is empty and the local one
 * is not, keep the local value. That direction is provably lossless — the cloud
 * had nothing to lose. The reverse (cloud has content, local is empty) still
 * takes the cloud value, and two non-empty sides still resolve to cloud.
 *
 * Items keyed by id never qualify: a conflict there means BOTH sides hold the
 * item, so neither is empty and per-id last-write-wins stands. Dangerous rows
 * are skipped outright — they go to the dialog rather than being auto-applied.
 *
 * Pure and order-independent, so two devices settling the same pair agree.
 */
export function autoResolveDecisions(report: MergeReport): ConflictDecisions {
  const decisions: ConflictDecisions = new Map()
  for (const c of report.conflicts) {
    if (c.severity === 'dangerous') continue
    // Which draft is selected keeps MINE: it's a view preference, and having a
    // collaborator's selection replace yours mid-edit is jarring for no gain
    // (both drafts are preserved either way). Everything else keeps local only
    // when the cloud side is empty, so a stale row can't delete local content.
    if (c.path === 'activeDraft') decisions.set(c.path, 'mine')
    else if (isEmptyValue(c.theirs) && !isEmptyValue(c.mine)) decisions.set(c.path, 'mine')
  }
  return decisions
}

/**
 * The SongMap to adopt when a report can be settled without prompting.
 * Only meaningful when `hasDangerousConflict(report)` is false.
 */
export function autoResolvedMerge(report: MergeReport): SongMap {
  return applyConflictDecisions(report, autoResolveDecisions(report))
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
    else if (c.path === 'drumMidi') result = { ...result, drumMidi: c.mine as SongMap['drumMidi'] }
    else if (c.path === 'bassMidi') result = { ...result, bassMidi: c.mine as SongMap['bassMidi'] }
    else if (c.path === 'drumMachine') {
      result = { ...result, drumMachine: c.mine as SongMap['drumMachine'] }
    } else if (c.path === 'bassMachine') {
      result = { ...result, bassMachine: c.mine as SongMap['bassMachine'] }
    } else if (c.path === 'effectBusses') {
      result = { ...result, effectBusses: c.mine as SongMap['effectBusses'] }
    }
    else if (c.path === 'harmony') result = { ...result, harmony: c.mine as SongMap['harmony'] }
    else if (c.path === 'activeDraftName') {
      result = { ...result, activeDraftName: c.mine as string | undefined }
    } else if (c.path.startsWith('drafts/')) {
      const id = c.path.slice('drafts/'.length)
      const next = (result.drafts ?? []).map((d) => (d.id === id ? (c.mine as SongDraft) : d))
      result = { ...result, drafts: next.length > 0 ? next : undefined }
    } else if (c.path === 'activeDraft') {
      // Swap which draft is at the root. The side being displaced must be
      // stored, or choosing "mine" would discard the cloud collaborator's
      // draft entirely — the merge stays lossless whichever way the user picks.
      const mine = c.mine as DraftSide
      const theirs = c.theirs as DraftSide
      const stored = preserveSide(
        (result.drafts ?? []).filter((d) => d.id !== mine.id),
        theirs,
      )
      result = {
        ...result,
        sections: mine.sections,
        harmony: mine.harmony,
        lyrics: mine.lyrics,
        drafts: stored.length > 0 ? stored : undefined,
        activeDraftId: mine.id,
        activeDraftName: mine.name,
      }
    }
    else if (c.path === 'expectedAudio') result = { ...result, expectedAudio: c.mine as SongMap['expectedAudio'] }
    else if (c.path === 'audio') result = { ...result, audio: c.mine as SongMap['audio'] }
    // `timeline/bars-count` is informational — the per-id merges above
    // already determine which bars survive; no extra apply step.
  }

  return result
}
