/**
 * Phase 2 of the collaborative sync plan: a shadow `Y.Doc` representation of a
 * `SongMap`, plus the derive step back to a plain `SongMap`.
 *
 * See [`docs/domains/collab-sync-architecture.md`](../../../docs/domains/collab-sync-architecture.md)
 * §5 (document shape) and §8 (seed determinism). NOTHING in the running app
 * reads or writes this yet — Phase 2 exists to build and prove the
 * representation. Writers migrate in Phase 3, transport in Phase 4.
 *
 * ## What is in the document
 *
 * Collaborative state ONLY. The local-only fields (`projectFolder`,
 * `stemRefs`, `liveStemRefs`, `sectionBorderHints`, `chordHints`, `mixState`,
 * `audio.originalPath`, every `renderExport.relativePath`) are stripped by
 * `toCollabSongMap()` before seeding — that function stays the single
 * authority on the local/shared boundary, so the knowledge is not duplicated
 * here. This replaces today's strip-on-push list with a structural boundary:
 * a local field cannot leak because it is not in the document at all.
 *
 * ```
 * ydoc
 * ├─ meta      Y.Map    formatVersion, app, metadata (nested Y.Map), transpose,
 * │                     countInBeats, startBeatId, expectedAudio, clickExport,
 * │                     drumMidi, bassMidi
 * ├─ audio     Y.Map    AudioReference incl. recording fingerprint
 * ├─ timeline  Y.Map
 * │   ├─ bars     Y.Map<barId,  Y.Map>
 * │   ├─ beats    Y.Map<beatId, Y.Map>
 * │   └─ original plain value — the "Reset grid" snapshot (see below)
 * ├─ active    Y.Map    activeDraftId, activeDraftName,
 * │                     sections Y.Map<sectionId, Y.Map>,
 * │                     harmony  Y.Map<harmonyId, Y.Map>,
 * │                     lyrics   plain value
 * ├─ drafts    Y.Map<draftId, Y.Map>   (sections / harmony id-keyed inside)
 * └─ cueTracks Y.Map<trackId, Y.Map>   (events id-keyed inside)
 * ```
 *
 * **Id-keyed `Y.Map`, never `Y.Array`.** Bars, beats, harmony, sections,
 * drafts and cue events all carry stable ids and have *derived* order, so an
 * id-keyed map makes concurrent adds and deletes conflict-free by
 * construction while a positional array would let concurrent inserts
 * interleave for no benefit. `yDocToSongMap` sorts — see
 * `canonicalSongMapOrder`.
 *
 * **The active draft still lives at the root** (`active.sections` /
 * `active.harmony` / `active.lyrics`), mirroring today's `SongMap`. §5 notes
 * that the document could store all drafts uniformly and let the derive step
 * project the active one to the root; that is a Phase 3 change, deliberately
 * NOT made here, so Phase 2 is a pure representation change.
 *
 * ## Value granularity
 *
 * Entities are `Y.Map`s so two people editing different fields of the same
 * bar/chord/section both keep their edit. Leaf objects that are meaningful
 * only as a unit — `Bar.meter`, `HarmonyEvent.chord`, `Section.barRange`,
 * `CueEvent.anchor`, `lyrics`, `drumMidi`, `bassMidi`, `clickExport`,
 * `timeline.original` — are stored as whole plain values (last-write-wins on
 * the field), which is the same granularity `collabMerge.ts` already applies
 * to them.
 *
 * Unknown fields are carried through verbatim rather than dropped, so a
 * document written by a newer client survives a round trip through an older
 * one instead of silently losing the new field.
 */
import * as Y from 'yjs'
import { toCollabSongMap } from './collab'
import type {
  Bar,
  Beat,
  CueEvent,
  CueTrack,
  HarmonyEvent,
  Section,
  SongDraft,
  SongMap,
} from './types'
import { SONGMAP_FORMAT_VERSION } from './version'

/**
 * The `clientID` every seed is built under — see §8 of the architecture doc.
 *
 * Yjs assigns a RANDOM `clientID` to a fresh `Y.Doc`. Two devices seeding
 * independently from the same `.smap` would therefore mint two different
 * documents, and merging them would duplicate every bar, chord and section
 * rather than converge on one song. Pinning the seed's `clientID` (together
 * with the canonical op order below) makes `songMapSeedUpdate()` a PURE
 * FUNCTION of the SongMap: same input, byte-identical output, on every device
 * and in every process.
 *
 * This is the same determinism requirement recorded in `draftsMigrate.ts`
 * (fixed derived ids, no invented timestamps) and fixed for legacy cue tracks
 * in commit `174610c` — but with a worse failure mode: LWW produced a phantom
 * conflict loop, this would produce silent duplication.
 *
 * IMPORTANT — this id is for SEEDING ONLY. A doc that will accept local edits
 * must run under its own random `clientID`, or two devices would mint
 * colliding `(clientID, clock)` pairs and corrupt the document. Use
 * `hydrateSongDoc()` to get an editable doc; never edit the doc returned by
 * `songMapToYDoc()`.
 */
export const SEED_CLIENT_ID = 0

/** Root type names. Exported so Phase 3 writers and Phase 5 undo scopes agree. */
export const ROOT_META = 'meta'
export const ROOT_AUDIO = 'audio'
export const ROOT_TIMELINE = 'timeline'
export const ROOT_ACTIVE = 'active'
export const ROOT_DRAFTS = 'drafts'
export const ROOT_CUE_TRACKS = 'cueTracks'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

type AnyRecord = Record<string, unknown>

/**
 * Deep-copy a value into a canonical JSON shape: object keys sorted, `undefined`
 * properties dropped, arrays left in order.
 *
 * Key sorting is load-bearing for §8, not cosmetic. lib0 encodes a plain object
 * in `Object.keys()` order, so two devices holding the same song with different
 * key insertion order would seed to different bytes. That is not hypothetical:
 * a map parsed from a `.smap` file carries the file's key order, while the same
 * map pulled from Postgres carries JSONB's internal key order. Sorting collapses
 * both onto one encoding.
 *
 * Dropping `undefined` mirrors JSON's own rule and keeps "absent" and
 * "explicitly undefined" from seeding to different documents.
 *
 * The copy also protects the caller: derived values are never aliases of
 * document-internal objects, so a reader cannot mutate the document by
 * accident.
 */
function canonicalValue(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (Array.isArray(value)) {
    // JSON turns a hole / undefined element into null; match that.
    return value.map((entry) => canonicalValue(entry) ?? null)
  }
  if (typeof value === 'object') {
    const source = value as AnyRecord
    const out: Record<string, JsonValue> = {}
    for (const key of Object.keys(source).sort()) {
      const next = canonicalValue(source[key])
      if (next !== undefined) out[key] = next
    }
    return out
  }
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  return value as JsonValue
}

/** Set `key` only when the value survives canonicalization (i.e. is not `undefined`). */
function setValue(map: Y.Map<unknown>, key: string, value: unknown): void {
  const next = canonicalValue(value)
  if (next !== undefined) map.set(key, next)
}

/**
 * Copy every own field of `source` into `map` in sorted key order, skipping
 * `skip` (fields the caller stores as nested Y types) and `undefined` values.
 *
 * Sorted order is what makes the op sequence canonical: Yjs assigns clocks in
 * insertion order, so iterating an object's natural key order would encode two
 * equal songs differently.
 */
function fillFields(map: Y.Map<unknown>, source: AnyRecord, skip?: ReadonlySet<string>): void {
  for (const key of Object.keys(source).sort()) {
    if (skip?.has(key)) continue
    setValue(map, key, source[key])
  }
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Seed an id-keyed `Y.Map` of entity `Y.Map`s under `parent[key]`.
 *
 * Entities are inserted in id order so the op sequence — and therefore the
 * encoded update — does not depend on the order the caller's array happened to
 * be in. Ids are unique by construction in a map; a source array carrying the
 * same id twice collapses to the last occurrence.
 */
function seedIdKeyed<T extends { id: string }>(
  parent: Y.Map<unknown>,
  key: string,
  items: readonly T[] | undefined,
  seedEntity?: (entity: Y.Map<unknown>, item: T) => void,
): void {
  const collection = new Y.Map<unknown>()
  parent.set(key, collection)
  const sorted = [...(items ?? [])].sort((a, b) => compareId(a.id, b.id))
  for (const item of sorted) {
    const entity = new Y.Map<unknown>()
    collection.set(item.id, entity)
    if (seedEntity) seedEntity(entity, item)
    else fillFields(entity, item as unknown as AnyRecord)
  }
}

function seedCueTrack(entity: Y.Map<unknown>, track: CueTrack): void {
  fillFields(entity, track as unknown as AnyRecord, new Set(['events']))
  seedIdKeyed(entity, 'events', track.events)
}

function seedDraft(entity: Y.Map<unknown>, draft: SongDraft): void {
  fillFields(entity, draft as unknown as AnyRecord, new Set(['sections', 'harmony']))
  seedIdKeyed(entity, 'harmony', draft.harmony)
  seedIdKeyed(entity, 'sections', draft.sections)
}

/**
 * Sort the "Reset grid" snapshot the same way the live timeline is sorted.
 *
 * The snapshot is stored as one atomic value (it is written once by an
 * analysis merge and never edited field-by-field), so its array order is part
 * of its encoding — canonicalizing it keeps two devices from seeding different
 * bytes for the same snapshot.
 */
function canonicalTimelineOriginal(original: SongMap['timeline']['original']): unknown {
  if (!original) return undefined
  return {
    bars: sortBars(original.bars ?? []),
    beats: sortBeats(original.beats ?? []),
  }
}

// ── Canonical order ─────────────────────────────────────────────────────────
//
// The document stores collections id-keyed, so array order is NOT stored — it
// is derived, exactly as §5 requires. These comparators are the single
// definition of that derived order. Every one is a TOTAL order (id breaks
// every tie) so the derive step is deterministic even when the natural key
// collides, which it routinely does: two chords can start at the same second,
// two sections can start on the same bar.

function sortBars(bars: readonly Bar[]): Bar[] {
  return [...bars].sort((a, b) => a.index - b.index || compareId(a.id, b.id))
}

function sortBeats(beats: readonly Beat[]): Beat[] {
  return [...beats].sort((a, b) => a.timeSec - b.timeSec || compareId(a.id, b.id))
}

function sortHarmony(harmony: readonly HarmonyEvent[]): HarmonyEvent[] {
  return [...harmony].sort((a, b) => a.startSec - b.startSec || compareId(a.id, b.id))
}

function sortSections(sections: readonly Section[]): Section[] {
  return [...sections].sort(
    (a, b) => a.barRange.startBarIndex - b.barRange.startBarIndex || compareId(a.id, b.id),
  )
}

function sortDrafts(drafts: readonly SongDraft[]): SongDraft[] {
  return [...drafts].sort((a, b) => a.name.localeCompare(b.name) || compareId(a.id, b.id))
}

/**
 * Cue tracks and cue events have no natural order key, so they sort by id.
 *
 * NOTE for Phase 3: `getPrimaryCueTrack()` falls back to `cueTracks[0]` when no
 * track is enabled, and `cueTrackSpeechSchedule` takes the FIRST enabled
 * `intro` event — both read positional meaning out of an array whose order §5
 * declares derived. With one cue track per song (today's shape:
 * `DEFAULT_CUE_TRACK_ID`) this is inert, but a multi-track song with no enabled
 * track could pick a different primary after the derive step. Give those two
 * lookups an explicit tiebreak before Phase 3 makes the document authoritative.
 */
function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareId(a.id, b.id))
}

/**
 * Put every collection of a SongMap into the order `yDocToSongMap` derives.
 *
 * Exported because it is the honest statement of what the document preserves:
 * the document is order-free, so a round trip returns the canonical ordering
 * rather than whatever order the input arrays happened to be in. For a SongMap
 * that is already canonically ordered — which is what the editor produces —
 * this is the identity.
 */
export function canonicalSongMapOrder(sm: SongMap): SongMap {
  const out: SongMap = {
    ...sm,
    timeline: {
      ...sm.timeline,
      bars: sortBars(sm.timeline?.bars ?? []),
      beats: sortBeats(sm.timeline?.beats ?? []),
    },
    sections: sortSections(sm.sections ?? []),
    harmony: sortHarmony(sm.harmony ?? []),
    cueTracks: sortById(sm.cueTracks ?? []).map((track) => ({
      ...track,
      events: sortById(track.events ?? []),
    })),
  }
  if (sm.timeline?.original) {
    out.timeline.original = {
      bars: sortBars(sm.timeline.original.bars ?? []),
      beats: sortBeats(sm.timeline.original.beats ?? []),
    }
  }
  // An id-keyed map cannot tell `drafts: []` from no `drafts` field, so the
  // document treats them as one state. That is not an invention: `deleteDraft`
  // already collapses the last remaining draft to `undefined`, and `listDrafts`
  // reads `map.drafts ?? []`. The only observable difference is the
  // `collabContentFingerprint` string, so normalize here too and keep the two
  // sides agreeing.
  if (sm.drafts && sm.drafts.length > 0) {
    out.drafts = sortDrafts(sm.drafts).map((draft) => ({
      ...draft,
      sections: sortSections(draft.sections ?? []),
      harmony: sortHarmony(draft.harmony ?? []),
    }))
  } else {
    delete out.drafts
  }
  return out
}

// ── Seed ────────────────────────────────────────────────────────────────────

/**
 * Fields of the collaborative SongMap that the document places somewhere other
 * than `meta`. Everything else — including fields a newer client added and this
 * build has never heard of — lands in `meta` verbatim, so a round trip through
 * an older client is lossless.
 */
const NON_META_FIELDS: ReadonlySet<string> = new Set([
  'audio',
  'timeline',
  'sections',
  'harmony',
  'lyrics',
  'drafts',
  'activeDraftId',
  'activeDraftName',
  'cueTracks',
  'metadata',
])

export type SeedOptions = {
  /**
   * Override the seed `clientID`. Exists so the determinism tests can build the
   * NON-deterministic seed they are guarding against. Production code must use
   * the default — see `SEED_CLIENT_ID`.
   */
  clientID?: number
}

/**
 * Seed a `Y.Doc` from a plain SongMap. Deterministic: the returned document's
 * `Y.encodeStateAsUpdate` is a pure function of the collaborative content of
 * `sm` (see `SEED_CLIENT_ID`).
 *
 * The result is a SEED, not a session. Do not edit it — see `hydrateSongDoc`.
 */
export function songMapToYDoc(sm: SongMap, options: SeedOptions = {}): Y.Doc {
  const collab = toCollabSongMap(sm)
  const doc = new Y.Doc()
  // Y.Doc has no clientID constructor option; assigning before any content is
  // created is the supported way to pin it.
  doc.clientID = options.clientID ?? SEED_CLIENT_ID

  const meta = doc.getMap<unknown>(ROOT_META)
  const audio = doc.getMap<unknown>(ROOT_AUDIO)
  const timeline = doc.getMap<unknown>(ROOT_TIMELINE)
  const active = doc.getMap<unknown>(ROOT_ACTIVE)
  const drafts = doc.getMap<unknown>(ROOT_DRAFTS)
  const cueTracks = doc.getMap<unknown>(ROOT_CUE_TRACKS)

  // One transaction, so the seed is a single atomic update and the op order is
  // exactly the order written below.
  doc.transact(() => {
    // meta — scalars first (sorted), then the nested metadata map.
    fillFields(meta, collab as unknown as AnyRecord, NON_META_FIELDS)
    if (collab.metadata) {
      const metadata = new Y.Map<unknown>()
      meta.set('metadata', metadata)
      fillFields(metadata, collab.metadata as unknown as AnyRecord)
    }

    if (collab.audio) fillFields(audio, collab.audio as unknown as AnyRecord)

    // timeline
    fillFields(timeline, (collab.timeline ?? {}) as unknown as AnyRecord, new Set(['bars', 'beats', 'original']))
    seedIdKeyed(timeline, 'bars', collab.timeline?.bars)
    seedIdKeyed(timeline, 'beats', collab.timeline?.beats)
    setValue(timeline, 'original', canonicalTimelineOriginal(collab.timeline?.original))

    // active draft (root sections/harmony/lyrics — Phase 3 folds this into drafts)
    setValue(active, 'activeDraftId', collab.activeDraftId)
    setValue(active, 'activeDraftName', collab.activeDraftName)
    setValue(active, 'lyrics', collab.lyrics)
    seedIdKeyed(active, 'harmony', collab.harmony)
    seedIdKeyed(active, 'sections', collab.sections)

    for (const draft of sortById(collab.drafts ?? [])) {
      const entity = new Y.Map<unknown>()
      drafts.set(draft.id, entity)
      seedDraft(entity, draft)
    }

    for (const track of sortById(collab.cueTracks ?? [])) {
      const entity = new Y.Map<unknown>()
      cueTracks.set(track.id, entity)
      seedCueTrack(entity, track)
    }
  })

  return doc
}

/**
 * The canonical seed bytes for a SongMap. Byte-identical across devices and
 * processes for equal collaborative content — that is the §8 guarantee, and
 * `ydoc.test.ts` holds it down in-process and across a real child process.
 */
export function songMapSeedUpdate(sm: SongMap): Uint8Array {
  return Y.encodeStateAsUpdate(songMapToYDoc(sm))
}

/**
 * Build an EDITABLE document from seed bytes.
 *
 * The returned doc keeps Yjs's own random `clientID`, so this device's future
 * edits can never collide with another device's. The seeded content stays
 * attributed to `SEED_CLIENT_ID`, which is exactly what makes two devices that
 * seeded the same song converge instead of duplicating it.
 *
 * This is the Phase 3 entry point; nothing calls it yet.
 */
export function hydrateSongDoc(update: Uint8Array): Y.Doc {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, update)
  return doc
}

// ── Derive ──────────────────────────────────────────────────────────────────

/**
 * Convert a stored value to a plain, fully-detached one.
 *
 * `Y.Map.toJSON()` converts nested Y types but returns any plain object it is
 * holding BY REFERENCE — so a reader handed `bar.meter` or `chord` straight
 * from `toJSON()` could mutate the document by assigning to it, with no
 * transaction and no observer firing. Every read goes through
 * `canonicalValue`, which deep-copies, so the derived SongMap is inert.
 */
function plainCopy(value: unknown): unknown {
  return canonicalValue(value instanceof Y.Map ? value.toJSON() : value)
}

function readEntity(value: unknown): AnyRecord {
  return (plainCopy(value) as AnyRecord) ?? {}
}

/** Read an id-keyed collection back out as an array of plain objects. */
function readIdKeyed(parent: Y.Map<unknown> | undefined, key: string): AnyRecord[] {
  const collection = parent?.get(key)
  if (!(collection instanceof Y.Map)) return []
  const out: AnyRecord[] = []
  collection.forEach((value) => {
    out.push(readEntity(value))
  })
  return out
}

function readValue(map: Y.Map<unknown> | undefined, key: string): unknown {
  const value = map?.get(key)
  if (value === undefined) return undefined
  return plainCopy(value)
}

/** Own fields of a Y.Map as a plain object, excluding nested collections. */
function readFields(map: Y.Map<unknown>, skip?: ReadonlySet<string>): AnyRecord {
  const out: AnyRecord = {}
  map.forEach((value, key) => {
    if (skip?.has(key)) return
    out[key] = plainCopy(value)
  })
  return out
}

function isEmpty(record: AnyRecord): boolean {
  return Object.keys(record).length === 0
}

/**
 * Derive a plain `SongMap` from the document. Readers never see a Yjs type —
 * that containment rule (§4, §11) is what keeps `yjs` out of the thirty-odd
 * modules that only read songs.
 *
 * The result carries the COLLABORATIVE subset only. Local-only fields are
 * per-device and are merged back in from local storage by the caller; see
 * `mergeLocalIntoCollab` in `collab.ts`.
 *
 * Collections come back in `canonicalSongMapOrder`, because the document does
 * not store array order.
 */
export function yDocToSongMap(doc: Y.Doc): SongMap {
  const meta = doc.getMap<unknown>(ROOT_META)
  const audio = doc.getMap<unknown>(ROOT_AUDIO)
  const timeline = doc.getMap<unknown>(ROOT_TIMELINE)
  const active = doc.getMap<unknown>(ROOT_ACTIVE)
  const draftsMap = doc.getMap<unknown>(ROOT_DRAFTS)
  const cueTracksMap = doc.getMap<unknown>(ROOT_CUE_TRACKS)

  const metaFields = readFields(meta, new Set(['metadata']))
  const metadata = (readValue(meta, 'metadata') ?? {}) as SongMap['metadata']

  const bars = sortBars(readIdKeyed(timeline, 'bars') as unknown as Bar[])
  const beats = sortBeats(readIdKeyed(timeline, 'beats') as unknown as Beat[])

  const sm = {
    ...metaFields,
    formatVersion: (metaFields.formatVersion ?? SONGMAP_FORMAT_VERSION) as typeof SONGMAP_FORMAT_VERSION,
    metadata,
    timeline: { ...readFields(timeline, new Set(['bars', 'beats', 'original'])), bars, beats },
    sections: sortSections(readIdKeyed(active, 'sections') as unknown as Section[]),
    harmony: sortHarmony(readIdKeyed(active, 'harmony') as unknown as HarmonyEvent[]),
    // Filled in below, once each track's id-keyed events are read back.
    cueTracks: [],
  } as SongMap

  // timeline.original is stored atomically; preserve absence.
  const original = readValue(timeline, 'original')
  if (original !== undefined) {
    sm.timeline.original = original as NonNullable<SongMap['timeline']['original']>
  }

  const audioFields = readFields(audio)
  if (!isEmpty(audioFields)) sm.audio = audioFields as unknown as SongMap['audio']

  const activeDraftId = readValue(active, 'activeDraftId')
  if (activeDraftId !== undefined) sm.activeDraftId = activeDraftId as string
  const activeDraftName = readValue(active, 'activeDraftName')
  if (activeDraftName !== undefined) sm.activeDraftName = activeDraftName as string
  const lyrics = readValue(active, 'lyrics')
  if (lyrics !== undefined) sm.lyrics = lyrics as SongMap['lyrics']

  // Cue tracks: entity fields + id-keyed events.
  const cueTracks: CueTrack[] = []
  cueTracksMap.forEach((value) => {
    if (!(value instanceof Y.Map)) return
    const track = readFields(value, new Set(['events'])) as unknown as CueTrack
    track.events = sortById(readIdKeyed(value, 'events') as unknown as CueEvent[])
    cueTracks.push(track)
  })
  sm.cueTracks = sortById(cueTracks)

  // Drafts: absent stays absent (an empty `drafts: []` is not the same as no
  // drafts field to `collabContentFingerprint`).
  if (draftsMap.size > 0) {
    const drafts: SongDraft[] = []
    draftsMap.forEach((value) => {
      if (!(value instanceof Y.Map)) return
      const draft = readFields(value, new Set(['sections', 'harmony'])) as unknown as SongDraft
      draft.sections = sortSections(readIdKeyed(value, 'sections') as unknown as Section[])
      draft.harmony = sortHarmony(readIdKeyed(value, 'harmony') as unknown as HarmonyEvent[])
      drafts.push(draft)
    })
    sm.drafts = sortDrafts(drafts)
  }

  return sm
}

/**
 * Convenience for the Phase 2 assertion "the document says the same thing the
 * parser did": seed and derive in one step.
 */
export function roundTripThroughYDoc(sm: SongMap): SongMap {
  return yDocToSongMap(songMapToYDoc(sm))
}
