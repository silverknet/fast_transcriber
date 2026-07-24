/**
 * Pure guards that keep the editor's local `$state` from fighting a LIVE remote
 * `songMap` change (browser-mode live-receive, or desktop live-receive).
 *
 * The editor is almost entirely `$derived($songMap)` and re-renders remote
 * changes for free. The exceptions are a few bits of local `$state`: the lyrics
 * textarea draft (a `bind:`-ed input) and the beat/bar selection ids. These
 * helpers decide how those should react when the underlying song changes out
 * from under them — extracted here so the decisions are unit-testable without
 * mounting the editor page.
 */
import type { SongMap } from '$lib/songmap/types'

/**
 * Should the lyrics textarea draft be re-seeded from the stored `.smap` lyrics?
 *
 * - Song switch (`keyChanged`) → always reseed.
 * - Same song → reseed ONLY when the stored text changed (a remote edit landed),
 *   the user hasn't typed since the last seed (`draft === seededText`), and the
 *   textarea isn't focused. This lets a collaborator's lyric edit show up live
 *   without ever discarding text the local user is actively writing.
 */
export function shouldReseedLyricsDraft(args: {
  keyChanged: boolean
  storedText: string
  seededText: string
  draft: string
  focused: boolean
}): boolean {
  if (args.keyChanged) return true
  return args.storedText !== args.seededText && args.draft === args.seededText && !args.focused
}

export interface EditorSelections {
  selectedBeatId: string | null
  chordsSelectionBeatIds: string[]
  sectionsSelectionBarIds: string[]
  selectedFraction: { barId: string; fraction: number } | null
}

/**
 * Drop selection ids that no longer exist in the song — e.g. after a live remote
 * change (or a local edit) removed or replaced beats/bars. Returns ONLY the
 * fields that actually changed, so the caller can avoid needless reactive writes
 * (and effect churn) when nothing was stale.
 */
export function pruneSelections(sm: SongMap, sel: EditorSelections): Partial<EditorSelections> {
  const beatIds = new Set(sm.timeline.beats.map((b) => b.id))
  const barIds = new Set(sm.timeline.bars.map((b) => b.id))
  const out: Partial<EditorSelections> = {}

  if (sel.selectedBeatId !== null && !beatIds.has(sel.selectedBeatId)) {
    out.selectedBeatId = null
  }
  const chords = sel.chordsSelectionBeatIds.filter((id) => beatIds.has(id))
  if (chords.length !== sel.chordsSelectionBeatIds.length) {
    out.chordsSelectionBeatIds = chords
  }
  const sections = sel.sectionsSelectionBarIds.filter((id) => barIds.has(id))
  if (sections.length !== sel.sectionsSelectionBarIds.length) {
    out.sectionsSelectionBarIds = sections
  }
  if (sel.selectedFraction !== null && !barIds.has(sel.selectedFraction.barId)) {
    out.selectedFraction = null
  }
  return out
}
