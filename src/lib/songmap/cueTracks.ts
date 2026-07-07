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

export function cueTrackHasSharedData(track: CueTrack): boolean {
  return Boolean(
    track.name.trim() ||
      track.voiceId ||
      track.events.length > 0 ||
      track.suppressedGeneratedKeys.length > 0 ||
      track.spokenCountIn,
  )
}
