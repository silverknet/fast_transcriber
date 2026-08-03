import { defaultSectionLabel } from './sectionEdit'
import { sortBeatsByTime } from './normalize'
import type { Bar, CueEvent, CueTrack, Section, SongMap } from './types'

export const DEFAULT_CUE_TRACK_ID = 'main'

export const NUMBER_WORDS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
]

type IdFactory = () => string

function stableIdFromKey(prefix: string, key: string): string {
  return `${prefix}_${key.replace(/[^a-zA-Z0-9_-]+/g, '_')}`
}

function cleanText(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

function sectionDisplayName(section: Section): string {
  const label = cleanText(section.label || defaultSectionLabel(section.kind))
  return label || defaultSectionLabel(section.kind)
}

function barByIndex(songMap: SongMap): Map<number, Bar> {
  return new Map(songMap.timeline.bars.map((bar) => [bar.index, bar]))
}

function orderedSectionStarts(songMap: SongMap): Section[] {
  return [...songMap.sections].sort((a, b) => a.barRange.startBarIndex - b.barRange.startBarIndex)
}

/**
 * True iff this cue track will actually SAY something in live mode — an enabled
 * event with spoken text, or the spoken count-in. A cue *track* can exist (and a
 * cue WAV can linger on disk) with nothing to say; this is the honest "there are
 * cues present" signal used for the project-card cue dot.
 */
export function cueTrackHasSpokenContent(track: CueTrack | undefined): boolean {
  if (!track) return false
  return track.events.some((e) => e.enabled && !!e.text?.trim()) || !!track.spokenCountIn
}

export function songMapHasCueContent(songMap: SongMap): boolean {
  return cueTrackHasSpokenContent(getPrimaryCueTrack(songMap))
}

export function createDefaultCueTrack(opts: { id?: string; name?: string } = {}): CueTrack {
  return {
    id: opts.id ?? DEFAULT_CUE_TRACK_ID,
    name: opts.name ?? 'Main cues',
    enabled: true,
    events: [],
    suppressedGeneratedKeys: [],
  }
}

export function getPrimaryCueTrack(songMap: SongMap): CueTrack | undefined {
  return songMap.cueTracks.find((track) => track.enabled) ?? songMap.cueTracks[0]
}

export function generatedSectionKey(section: Section): string {
  return `section:${section.id}:${section.kind}:${section.barRange.startBarIndex}`
}

export function generatedCountKey(section: Section, beatIndex: number): string {
  return `${generatedSectionKey(section)}:count:${beatIndex}`
}

function firstBeatIdForBar(songMap: SongMap, bar: Bar): string | undefined {
  const beatId = bar.beatIds[0]
  if (beatId && songMap.timeline.beats.some((beat) => beat.id === beatId)) return beatId
  return songMap.timeline.beats
    .filter((beat) => beat.barId === bar.id)
    .sort((a, b) => a.indexInBar - b.indexInBar)[0]?.id
}

function sectionAnchor(songMap: SongMap, section: Section, sectionBar: Bar): CueEvent['anchor'] {
  const leadBars = 1
  const beatId = firstBeatIdForBar(songMap, sectionBar)
  if (beatId) return { kind: 'beat', beatId, leadBars }
  return { kind: 'bar', barId: sectionBar.id, leadBars }
}

function generatedSource(section: Section, leadBars = 1): CueEvent['generatedSource'] {
  return { kind: 'section', sectionId: section.id, leadBars }
}

function generatedSectionEvent(songMap: SongMap, section: Section, sectionBar: Bar): CueEvent {
  const generatedKey = generatedSectionKey(section)
  return {
    id: stableIdFromKey('cue', generatedKey),
    kind: 'section',
    enabled: true,
    anchor: { ...sectionAnchor(songMap, section, sectionBar), offsetSec: -0.52 },
    text: sectionDisplayName(section),
    generatedKey,
    generatedSource: generatedSource(section),
    source: 'generated',
  }
}

function generatedCountEvents(songMap: SongMap, section: Section, sectionBar: Bar): CueEvent[] {
  const beats = sortBeatsByTime(songMap.timeline.beats)
    .filter((beat) => beat.barId === sectionBar.id)
    .sort((a, b) => a.indexInBar - b.indexInBar)
  if (beats.length > 0) {
    return beats.map((beat, index) => {
      const generatedKey = generatedCountKey(section, index)
      return {
        id: stableIdFromKey('cue', generatedKey),
        kind: 'count',
        enabled: true,
        anchor: { kind: 'beat', beatId: beat.id, leadBars: 1, offsetSec: -0.048 },
        text: NUMBER_WORDS[index] ?? String(index + 1),
        generatedKey,
        generatedSource: generatedSource(section),
        source: 'generated',
      }
    })
  }

  const beatCount = Math.max(1, sectionBar.beatCount || sectionBar.meter?.numerator || 4)
  const beatDur = (sectionBar.endSec - sectionBar.startSec) / beatCount
  return Array.from({ length: beatCount }, (_, index) => {
    const generatedKey = generatedCountKey(section, index)
    return {
      id: stableIdFromKey('cue', generatedKey),
      kind: 'count',
      enabled: true,
      anchor: {
        kind: 'time',
        timeSec: sectionBar.startSec + index * beatDur,
        leadBars: 1,
        offsetSec: -0.048,
      },
      text: NUMBER_WORDS[index] ?? String(index + 1),
      generatedKey,
      generatedSource: generatedSource(section),
      source: 'generated',
    }
  })
}

/**
 * The generated speech + count cue events for ONE section — for per-section
 * toggles in the cue editor. `speech` reads the section name just before it
 * starts; `count` is the beat count-in (one event per beat).
 */
export function buildSectionCueEvents(
  songMap: SongMap,
  section: Section,
): { speech: CueEvent | null; count: CueEvent[] } {
  const bar = barByIndex(songMap).get(section.barRange.startBarIndex)
  if (!bar) return { speech: null, count: [] }
  return { speech: generatedSectionEvent(songMap, section, bar), count: generatedCountEvents(songMap, section, bar) }
}

function generatedEventsFromSections(songMap: SongMap): CueEvent[] {
  const bars = barByIndex(songMap)
  const events: CueEvent[] = []
  for (const section of orderedSectionStarts(songMap)) {
    const sectionBar = bars.get(section.barRange.startBarIndex)
    if (!sectionBar) continue
    events.push(generatedSectionEvent(songMap, section, sectionBar))
    events.push(...generatedCountEvents(songMap, section, sectionBar))
  }
  return events
}

function generatedEventMap(events: CueEvent[]): Map<string, CueEvent> {
  const out = new Map<string, CueEvent>()
  for (const event of events) {
    if (event.generatedKey) out.set(event.generatedKey, event)
  }
  return out
}

function isEditedGenerated(event: CueEvent): boolean {
  return event.source === 'generated' && Boolean(event.generatedKey) && Boolean(event.edited)
}

function isDisabledGenerated(event: CueEvent): boolean {
  return event.source === 'generated' && Boolean(event.generatedKey) && event.enabled === false
}

export function generateCueTrackFromSections(
  songMap: SongMap,
  track: CueTrack = createDefaultCueTrack(),
  opts: { idFactory?: IdFactory } = {},
): CueTrack {
  const suppressed = new Set(track.suppressedGeneratedKeys)
  const nextGenerated = generatedEventsFromSections(songMap).filter(
    (event) => !event.generatedKey || !suppressed.has(event.generatedKey),
  )
  const nextByKey = generatedEventMap(nextGenerated)
  const retained: CueEvent[] = []
  const retainedKeys = new Set<string>()

  for (const event of track.events) {
    if (!event.generatedKey || event.source !== 'generated') {
      retained.push(event)
      continue
    }
    if (suppressed.has(event.generatedKey)) continue
    if (isEditedGenerated(event) || isDisabledGenerated(event)) {
      retained.push(event)
      retainedKeys.add(event.generatedKey)
    }
  }

  for (const event of nextGenerated) {
    if (event.generatedKey && retainedKeys.has(event.generatedKey)) continue
    retained.push({
      ...event,
      id: event.id || opts.idFactory?.() || stableIdFromKey('cue', event.generatedKey ?? crypto.randomUUID()),
    })
  }

  return {
    ...track,
    events: retained,
    suppressedGeneratedKeys: [...suppressed],
    renderExport: undefined,
  }
}

/**
 * Is this cue event still meaningful for the song's CURRENT sections?
 *
 * Cue tracks are shared by every draft, but a cue GENERATED from a section
 * carries that section's id. Switch to a draft whose sections differ and the
 * cue is left announcing a section that is not there — the speech renderer
 * happily spoke "Chorus A" over a draft with no Chorus A, and the stale name
 * went into the rendered cue WAV.
 *
 * Filtered at READ time rather than deleted on switch, deliberately:
 *  - nothing the user edited is ever destroyed;
 *  - switching back makes the cue live again by itself, no bookkeeping;
 *  - it follows the "derive, don't bridge state" rule in CLAUDE.md.
 *
 * Manual cues (no `generatedSource`) always survive — they were placed by hand
 * against bars, not sections, and are not ours to second-guess.
 */
export function isCueEventLiveForSections(songMap: SongMap, event: CueEvent): boolean {
  const src = event.generatedSource
  if (!src || src.kind !== 'section') return true
  return songMap.sections.some((section) => section.id === src.sectionId)
}

export function cueTrackHasSharedData(track: CueTrack): boolean {
  return Boolean(
    track.name.trim() ||
      track.voiceId ||
      track.events.length > 0 ||
      track.suppressedGeneratedKeys.length > 0 ||
      track.spokenCountIn,
  )
}

// ── Project-wide cue setup ───────────────────────────────────────────────────
//
// One cue track per performer, in every song, with the spoken song
// introduction on each of them. Everything below is PURE `(SongMap) -> SongMap`
// so the same code runs for the song open in the editor and for a bulk pass
// over a whole project — a bulk operation that behaved differently from the
// interactive one would be a trap, not a feature.

/**
 * The generated key the OLD announcement model used.
 *
 * The spoken introduction used to be materialized as a generated `intro` event
 * per song, switched on and off by a bulk pass. That made "all songs announce"
 * a fact about button presses, not about the setting: a song added after the
 * press silently did not announce, and a renamed song kept announcing its old
 * title frozen in the event text.
 *
 * The announcement is now DERIVED at render/playback time from the project
 * setting (`defaults.preCountInCue.mode`), with an intro EVENT meaning only
 * "override the words". This key survives solely so the migration below can
 * recognise and strip the old generated events; a user-EDITED one is kept —
 * it is a real override.
 */
export const SPOKEN_INTRO_KEY = 'intro:song'

/** Strip un-edited generated intro events (old-model debris). Edited = kept. */
function stripGeneratedIntro(track: CueTrack): CueTrack {
  const stale = track.events.some(
    (e) => e.kind === 'intro' && e.generatedKey === SPOKEN_INTRO_KEY && !e.edited,
  )
  if (!stale) return track
  return {
    ...track,
    events: track.events.filter(
      (e) => !(e.kind === 'intro' && e.generatedKey === SPOKEN_INTRO_KEY && !e.edited),
    ),
    renderExport: undefined,
  }
}

export type CuePerformer = { id: string; name: string }

/**
 * One cue track per performer, keyed by `performerId`.
 *
 * Existing linked tracks are kept as they are. The FIRST unlinked track is
 * adopted by the first unclaimed performer rather than left orphaned beside a
 * new one — that track is almost always the legacy `main`, and duplicating it
 * would leave every song with an unowned track full of the user's real work.
 */
export function ensurePerformerCueTracks(
  songMap: SongMap,
  performers: readonly CuePerformer[],
  opts: { idFactory?: IdFactory } = {},
): SongMap {
  if (performers.length === 0) return songMap
  const newId = opts.idFactory ?? (() => crypto.randomUUID())
  const tracks = [...songMap.cueTracks]
  const claimed = new Set(tracks.map((t) => t.performerId).filter(Boolean) as string[])
  let changed = false

  for (const performer of performers) {
    if (claimed.has(performer.id)) continue
    const orphan = tracks.findIndex((t) => !t.performerId)
    if (orphan >= 0) {
      tracks[orphan] = { ...tracks[orphan]!, performerId: performer.id, name: performer.name }
    } else {
      tracks.push({
        ...createDefaultCueTrack({ id: newId(), name: performer.name }),
        performerId: performer.id,
      })
    }
    claimed.add(performer.id)
    changed = true
  }
  return changed ? { ...songMap, cueTracks: tracks } : songMap
}

/**
 * The whole project-wide cue setup for ONE song: a cue track per performer,
 * section cues generated on each.
 *
 * Deliberately NOT here: the spoken song introduction. It is derived from the
 * project setting wherever cues are rendered or played, so it cannot drift —
 * a song added tomorrow announces because the setting says so, not because a
 * button was pressed after it arrived. This pass only cleans up events the
 * old materialized model left behind.
 */
export function applyProjectCueDefaults(
  songMap: SongMap,
  opts: {
    performers: readonly CuePerformer[]
    idFactory?: IdFactory
  },
): SongMap {
  const withTracks = ensurePerformerCueTracks(songMap, opts.performers, {
    idFactory: opts.idFactory,
  })
  const cueTracks = withTracks.cueTracks.map((track) =>
    stripGeneratedIntro(generateCueTrackFromSections(withTracks, track, { idFactory: opts.idFactory })),
  )
  return { ...withTracks, cueTracks }
}

// ── The one cue-playback switch ─────────────────────────────────────────────

/**
 * Are spoken cues muted for this song?
 *
 * ONE flag, `mixState.tracks['cue'].muted`, read by every surface that can
 * sound a cue (the overview mixer, live mode) and written by every toggle (the
 * editor's transport bar, the live cue pill). It lives in `mixState` because it
 * is a per-song playback preference, not shared musical content.
 *
 * These helpers exist so no component re-implements the find-and-patch — the
 * mixer and the transport bar each had their own copy growing in place.
 */
export function cuePlaybackMuted(songMap: SongMap): boolean {
  return songMap.mixState?.tracks.find((t) => t.key === 'cue')?.muted ?? false
}

/** The same song with cue playback muted or not. Pure; safe for `patchSongMap`. */
export function withCuePlaybackMuted(songMap: SongMap, muted: boolean): SongMap {
  const tracks = (songMap.mixState?.tracks ?? []).filter((t) => t.key !== 'cue')
  return {
    ...songMap,
    mixState: { ...songMap.mixState, tracks: [...tracks, { key: 'cue', volume: 1, muted }] },
  }
}

// ── Authoring the spoken parts of a track ───────────────────────────────────

/** The current announcement override text, if any ("Winehouse"). */
export function announcementOverrideText(track: CueTrack): string | undefined {
  return track.events.find((e) => e.enabled && e.kind === 'intro')?.text?.trim() || undefined
}

/**
 * Set, replace or clear this track's announcement override.
 *
 * The override is an `intro` EVENT carrying only the WORDS — the project
 * setting stays the only switch. Marked `edited: true` so the migration in
 * `applyProjectCueDefaults` treats it as a person's decision and never strips
 * it. Empty text removes the override entirely: the announcement then derives
 * from the song title again, and KEEPS deriving — clearing must restore
 * inheritance, not freeze today's title.
 */
export function withAnnouncementOverride(track: CueTrack, text: string): CueTrack {
  const spoken = cleanText(text)
  const others = track.events.filter((e) => e.kind !== 'intro')
  if (!spoken) {
    if (others.length === track.events.length) return track
    return { ...track, events: others, renderExport: undefined }
  }
  const existing = announcementOverrideText(track)
  if (existing === spoken) return track
  return {
    ...track,
    events: [
      {
        id: stableIdFromKey('cue', `intro_override_${track.id}`),
        kind: 'intro',
        enabled: true,
        anchor: { kind: 'time', timeSec: 0 },
        text: spoken,
        edited: true,
        source: 'custom',
      },
      ...others,
    ],
    renderExport: undefined,
  }
}

/**
 * Switch the spoken count-in ("{title} … {N} … one, two, …") on or off.
 * Clears the render — the spoken content changed.
 */
export function withSpokenCountIn(track: CueTrack, on: boolean): CueTrack {
  if (!!track.spokenCountIn === on) return track
  const next: CueTrack = { ...track, renderExport: undefined }
  if (on) next.spokenCountIn = true
  else delete next.spokenCountIn
  return next
}
