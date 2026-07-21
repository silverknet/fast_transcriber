/**
 * Song drafts (v6) — sections + chords + lyrics as ONE switchable unit.
 *
 * The ACTIVE draft's content is always at the SongMap root (`sections`,
 * `harmony`, `lyrics`), identified by `activeDraftId` / `activeDraftName`.
 * Every consumer — grid, lead sheet, mixer chord rail, live mode, PDF and
 * Ableton exports — keeps reading those three root fields and never needs to
 * know drafts exist. Stored INACTIVE drafts live in `drafts[]`; the active one
 * is never duplicated in there, so there is exactly one source of truth for
 * what the song currently plays.
 *
 * Switching swaps all three fields at once: the outgoing content is stored
 * under its own draft entry as the incoming draft is lifted to the root.
 * Nothing is ever silently discarded, and switching is reversible.
 *
 * Replaces v5's `chordLayers.ts` + `sectionLayers.ts`, which kept two
 * independent stacks paired only by a matching `name` string. That pairing
 * broke as soon as the two sides disambiguated duplicate names differently
 * (real example from a live project: five chord layers named `Sheet import`,
 * `Sheet import 2`, `Sheet import 3`, `Sheet import 3 2`, `My chords` against
 * three section layouts named `My sections`, `Sheet import`, `Sheet import 2`).
 */
import type { IdFactory } from './harmonyEdit'
import type { DraftSource, Section, SongDraft, SongMap } from './types'

export const DEFAULT_DRAFT_NAME = 'My draft'

/**
 * The ONLY way to build a `SongDraft`. Every producer — the parser, the v5
 * migration, and the runtime switch/duplicate/import paths — goes through here
 * so stored drafts always serialize with the same key order.
 *
 * That matters because `.smap` is written with plain `JSON.stringify`, and the
 * repo holds save → load → save byte-identical (`smapFile.test.ts`). Two
 * constructors that emit the same fields in a different order produce different
 * bytes for identical content, which shows up as a phantom "modified" file and,
 * on the cloud path, as a needless revision bump.
 */
export function makeDraft(
  fields: Pick<SongDraft, 'id' | 'name' | 'sections' | 'harmony'> &
    Partial<Pick<SongDraft, 'source' | 'createdAt' | 'lyrics'>>,
): SongDraft {
  const draft: SongDraft = {
    id: fields.id,
    name: fields.name,
    sections: fields.sections,
    harmony: fields.harmony,
  }
  if (fields.source) draft.source = fields.source
  if (fields.createdAt) draft.createdAt = fields.createdAt
  if (fields.lyrics) draft.lyrics = fields.lyrics
  return draft
}

/** Display name of the draft currently loaded at the root. */
export function activeDraftName(map: SongMap): string {
  return map.activeDraftName ?? DEFAULT_DRAFT_NAME
}

/** Deep-copy sections so a stored draft never aliases live editor state. */
function cloneSections(sections: Section[]): Section[] {
  return sections.map((s) => ({ ...s, barRange: { ...s.barRange } }))
}

/** Snapshot the active root content as a draft body (no identity fields). */
function activeContent(map: SongMap): Pick<SongDraft, 'sections' | 'harmony' | 'lyrics'> {
  return {
    sections: cloneSections(map.sections),
    harmony: map.harmony.map((h) => ({ ...h })),
    lyrics: map.lyrics ? { ...map.lyrics, words: map.lyrics.words.map((w) => ({ ...w })) } : undefined,
  }
}

/** True when a draft holds nothing worth preserving. */
function isEmptyContent(c: Pick<SongDraft, 'sections' | 'harmony' | 'lyrics'>): boolean {
  return (
    c.sections.length === 0 &&
    c.harmony.length === 0 &&
    (c.lyrics?.words.length ?? 0) === 0 &&
    (c.lyrics?.sourceText ?? '') === ''
  )
}

/** Avoid two drafts sharing a display name ("Sheet import 2"). */
export function uniqueDraftName(map: SongMap, base: string, opts?: { ignoreActive?: boolean }): string {
  const taken = new Set((map.drafts ?? []).map((d) => d.name))
  if (!opts?.ignoreActive) taken.add(activeDraftName(map))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Every draft, sorted by name. This is what the draft switcher renders — it
 * must never show the active draft twice, which is why `drafts[]` excludes it
 * by construction.
 *
 * The order is deliberately INDEPENDENT of which draft is active: the switcher
 * is a radio list, and putting the selected row first would make the list
 * reorder under the user's cursor the moment they picked something.
 */
export function listDrafts(
  map: SongMap,
): Array<{ id: string; name: string; source?: DraftSource; createdAt?: string; active: boolean }> {
  const active = {
    id: map.activeDraftId ?? '',
    name: activeDraftName(map),
    createdAt: undefined,
    active: true,
  }
  const stored = (map.drafts ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    source: d.source,
    createdAt: d.createdAt,
    active: false,
  }))
  return [active, ...stored].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Ensure the map has a draft identity. A song that has never been touched by
 * the draft UI still has content at the root but no `activeDraftId`; give it
 * one so switching away can store it under a stable id.
 */
export function ensureActiveDraftIdentity(map: SongMap, newId: IdFactory): SongMap {
  if (map.activeDraftId && map.activeDraftName) return map
  return {
    ...map,
    activeDraftId: map.activeDraftId ?? newId(),
    activeDraftName: map.activeDraftName ?? DEFAULT_DRAFT_NAME,
  }
}

/**
 * Make `draftId` the active draft. The outgoing root content takes the
 * incoming draft's place in `drafts[]` under its own name, so the swap is
 * lossless and reversible. An outgoing draft with no sections, chords or
 * lyrics is dropped rather than stored as an empty shell.
 */
export function switchToDraft(
  map: SongMap,
  draftId: string,
  newId: IdFactory,
): { ok: true; map: SongMap } | { ok: false; error: string } {
  if (draftId && draftId === map.activeDraftId) return { ok: true, map }

  const drafts = map.drafts ?? []
  const target = drafts.find((d) => d.id === draftId)
  if (!target) return { ok: false, error: 'Unknown draft' }

  const remaining = drafts.filter((d) => d.id !== draftId)
  const outgoingContent = activeContent(map)
  const outgoing: SongDraft | null = isEmptyContent(outgoingContent)
    ? null
    : makeDraft({
        id: map.activeDraftId ?? newId(),
        name: activeDraftName(map),
        source: 'manual',
        createdAt: new Date().toISOString(),
        ...outgoingContent,
      })
  const nextDrafts = outgoing ? [...remaining, outgoing] : remaining

  return {
    ok: true,
    map: {
      ...map,
      sections: cloneSections(target.sections),
      harmony: target.harmony.map((h) => ({ ...h })),
      lyrics: target.lyrics
        ? { ...target.lyrics, words: target.lyrics.words.map((w) => ({ ...w })) }
        : undefined,
      drafts: nextDrafts.length > 0 ? nextDrafts : undefined,
      activeDraftId: target.id,
      activeDraftName: target.name,
    },
  }
}

/**
 * Store `content` as a NEW draft and make it active. The previously-active
 * content is preserved as a stored draft — this is the path a chord-sheet
 * import takes, so an import can never destroy hand-made work.
 */
/**
 * NOTE ON PROVENANCE: there is deliberately no `source` parameter here.
 * `SongDraft.source` exists only on STORED drafts, and the draft this creates
 * becomes the ACTIVE one — whose identity on `SongMap` is just
 * `activeDraftId` + `activeDraftName`, with nowhere to put it. An earlier
 * version accepted a `source` argument and silently ignored it, so callers
 * passing `'sheet-import'` believed they were recording something they weren't.
 * Giving the active draft a source means adding `activeDraftSource` to the
 * schema and carrying it through switch, parse and the cloud fingerprint; worth
 * doing only if something actually displays it.
 */
export function addDraftAndActivate(
  map: SongMap,
  content: Pick<SongDraft, 'sections' | 'harmony' | 'lyrics'>,
  name: string,
  newId: IdFactory,
): SongMap {
  const withIdentity = ensureActiveDraftIdentity(map, newId)
  const outgoingContent = activeContent(withIdentity)
  const stored = withIdentity.drafts ?? []
  const outgoing: SongDraft | null = isEmptyContent(outgoingContent)
    ? null
    : makeDraft({
        id: withIdentity.activeDraftId!,
        name: activeDraftName(withIdentity),
        source: 'manual',
        createdAt: new Date().toISOString(),
        ...outgoingContent,
      })
  const nextDrafts = outgoing ? [...stored, outgoing] : stored
  // Resolve the new name against the drafts that will actually exist, ignoring
  // the outgoing active name — it has already moved into `nextDrafts`.
  const resolvedName = uniqueDraftName(
    { ...withIdentity, drafts: nextDrafts },
    name,
    { ignoreActive: true },
  )

  return {
    ...withIdentity,
    sections: cloneSections(content.sections),
    harmony: content.harmony.map((h) => ({ ...h })),
    lyrics: content.lyrics
      ? { ...content.lyrics, words: content.lyrics.words.map((w) => ({ ...w })) }
      : undefined,
    drafts: nextDrafts.length > 0 ? nextDrafts : undefined,
    activeDraftId: newId(),
    activeDraftName: resolvedName,
  }
}

/**
 * Copy the active draft into a new active draft. The original is preserved
 * under its own name — this is "try an alternative without losing this one".
 */
export function duplicateActiveDraft(map: SongMap, name: string, newId: IdFactory): SongMap {
  return addDraftAndActivate(map, activeContent(map), name, newId)
}

/** Rename a draft — the active one when `draftId` matches it, else a stored one. */
export function renameDraft(map: SongMap, draftId: string, rawName: string): SongMap {
  const name = rawName.trim()
  if (name === '') return map
  if (draftId === map.activeDraftId) {
    return { ...map, activeDraftName: uniqueDraftName(map, name, { ignoreActive: true }) }
  }
  const drafts = map.drafts ?? []
  if (!drafts.some((d) => d.id === draftId)) return map
  const others = { ...map, drafts: drafts.filter((d) => d.id !== draftId) }
  const resolved = uniqueDraftName(others, name)
  return { ...map, drafts: drafts.map((d) => (d.id === draftId ? { ...d, name: resolved } : d)) }
}

/**
 * Delete a STORED draft. The active draft is untouchable here — deleting what
 * the song currently plays has to go through an explicit switch first, so the
 * root is never left holding content with no draft identity.
 */
export function deleteDraft(map: SongMap, draftId: string): SongMap {
  if (draftId === map.activeDraftId) return map
  const nextDrafts = (map.drafts ?? []).filter((d) => d.id !== draftId)
  return { ...map, drafts: nextDrafts.length > 0 ? nextDrafts : undefined }
}
