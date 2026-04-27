import type { Accidental, Bar, Beat, ChordSymbol, HarmonyEvent, SongMap } from '$lib/songmap'
import { chordQualityToMusicXmlKind, songKeyToFifths } from './chordMapping'

const DIVISIONS_PER_QUARTER = 24

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function noteAlter(accidental?: Accidental): number {
  if (accidental === 'sharp') return 1
  if (accidental === 'flat') return -1
  return 0
}

function chordToHarmonyXml(chord: ChordSymbol): string {
  const kind = chordQualityToMusicXmlKind(chord.quality)
  const kindText = kind.text ? ` text="${xmlEscape(kind.text)}"` : ''
  const pieces = [
    '<harmony placement="above">',
    '<root>',
    `<root-step>${chord.root}</root-step>`,
    ...(chord.accidental ? [`<root-alter>${noteAlter(chord.accidental)}</root-alter>`] : []),
    '</root>',
    `<kind${kindText}>${kind.value}</kind>`,
    ...(chord.bass
      ? [
          '<bass>',
          `<bass-step>${chord.bass}</bass-step>`,
          ...(chord.bassAccidental ? [`<bass-alter>${noteAlter(chord.bassAccidental)}</bass-alter>`] : []),
          '</bass>',
        ]
      : []),
    '</harmony>',
  ]
  return pieces.join('')
}

function measureDuration(bar: Bar): number {
  return Math.round((bar.meter.numerator * 4 * DIVISIONS_PER_QUARTER) / bar.meter.denominator)
}

function buildBeatLookup(beats: Beat[]): Map<string, Beat> {
  return new Map(beats.map((beat) => [beat.id, beat]))
}

function resolveHarmonyOffsetDivisions(
  harmony: HarmonyEvent,
  bar: Bar,
  beatsById: Map<string, Beat>,
  beatsInBar: Beat[],
): number {
  const quarterDivisions = (4 * DIVISIONS_PER_QUARTER) / bar.meter.denominator
  if (harmony.beatAnchor) {
    return Math.max(0, Math.round(harmony.beatAnchor.indexInBar * quarterDivisions))
  }
  if (harmony.beatId) {
    const beat = beatsById.get(harmony.beatId)
    if (beat) return Math.max(0, Math.round(beat.indexInBar * quarterDivisions))
  }
  if (!beatsInBar.length) return 0
  let closestIndex = 0
  let closestDistance = Number.POSITIVE_INFINITY
  for (const beat of beatsInBar) {
    const distance = Math.abs(beat.timeSec - harmony.startSec)
    if (distance < closestDistance) {
      closestDistance = distance
      closestIndex = beat.indexInBar
    }
  }
  return Math.max(0, Math.round(closestIndex * quarterDivisions))
}

export function songMapToMusicXml(songMap: SongMap): string {
  const bars = [...songMap.timeline.bars].sort((a, b) => a.index - b.index)
  const beatsById = buildBeatLookup(songMap.timeline.beats)
  const beatsByBarId = new Map<string, Beat[]>()
  for (const beat of songMap.timeline.beats) {
    const list = beatsByBarId.get(beat.barId) ?? []
    list.push(beat)
    beatsByBarId.set(beat.barId, list)
  }
  for (const list of beatsByBarId.values()) {
    list.sort((a, b) => a.indexInBar - b.indexInBar)
  }

  const harmonyByBarId = new Map<string, HarmonyEvent[]>()
  for (const h of songMap.harmony) {
    const list = harmonyByBarId.get(h.barId) ?? []
    list.push(h)
    harmonyByBarId.set(h.barId, list)
  }

  const sectionStartsByBarIndex = new Map<number, string[]>()
  for (const section of songMap.sections) {
    const list = sectionStartsByBarIndex.get(section.barRange.startBarIndex) ?? []
    list.push(section.label || section.kind)
    sectionStartsByBarIndex.set(section.barRange.startBarIndex, list)
  }

  const title = xmlEscape(songMap.metadata.title || 'Untitled')
  const composer = songMap.metadata.composer ? xmlEscape(songMap.metadata.composer) : ''
  const hasKey = Boolean(songMap.metadata.keyDetail)
  const keyFifths = hasKey && songMap.metadata.keyDetail ? songKeyToFifths(songMap.metadata.keyDetail) : 0
  const bpm = songMap.metadata.bpm

  const measureXml = bars
    .map((bar, measureIndex) => {
      const isFirstMeasure = measureIndex === 0
      const beatsInBar = beatsByBarId.get(bar.id) ?? []
      const harmonies = [...(harmonyByBarId.get(bar.id) ?? [])]
      harmonies.sort((a, b) => resolveHarmonyOffsetDivisions(a, bar, beatsById, beatsInBar) - resolveHarmonyOffsetDivisions(b, bar, beatsById, beatsInBar))

      const measureParts: string[] = [`<measure number="${bar.index + 1}">`]

      if (isFirstMeasure) {
        measureParts.push('<attributes>')
        measureParts.push(`<divisions>${DIVISIONS_PER_QUARTER}</divisions>`)
        if (hasKey) {
          measureParts.push('<key>')
          measureParts.push(`<fifths>${keyFifths}</fifths>`)
          measureParts.push(`<mode>${songMap.metadata.keyDetail?.mode ?? 'major'}</mode>`)
          measureParts.push('</key>')
        }
        measureParts.push('<time>')
        measureParts.push(`<beats>${bar.meter.numerator}</beats>`)
        measureParts.push(`<beat-type>${bar.meter.denominator}</beat-type>`)
        measureParts.push('</time>')
        measureParts.push('<clef><sign>G</sign><line>2</line></clef>')
        measureParts.push('<measure-style><slash type="start"/></measure-style>')
        measureParts.push('</attributes>')
        if (typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0) {
          measureParts.push(
            `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(
              bpm,
            )}</per-minute></metronome></direction-type><sound tempo="${Math.round(bpm)}"/></direction>`,
          )
        }
      }

      const sectionLabels = sectionStartsByBarIndex.get(bar.index) ?? []
      for (const sectionLabel of sectionLabels) {
        measureParts.push(
          `<direction placement="above"><direction-type><rehearsal>${xmlEscape(
            sectionLabel,
          )}</rehearsal></direction-type></direction>`,
        )
      }

      let cursor = 0
      const totalDuration = measureDuration(bar)
      for (const harmony of harmonies) {
        const offset = Math.max(0, Math.min(totalDuration, resolveHarmonyOffsetDivisions(harmony, bar, beatsById, beatsInBar)))
        if (offset > cursor) {
          measureParts.push(`<forward><duration>${offset - cursor}</duration></forward>`)
        }
        measureParts.push(chordToHarmonyXml(harmony.chord))
        cursor = offset
      }
      if (cursor < totalDuration) {
        measureParts.push(`<forward><duration>${totalDuration - cursor}</duration></forward>`)
      }

      measureParts.push('</measure>')
      return measureParts.join('')
    })
    .join('')

  const credits = [
    `<work><work-title>${title}</work-title></work>`,
    '<identification>',
    ...(composer ? [`<creator type="composer">${composer}</creator>`] : []),
    '<encoding><software>BarBro</software></encoding>',
    '</identification>',
  ].join('')

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    credits,
    '<part-list><score-part id="P1"><part-name>Lead Sheet</part-name></score-part></part-list>',
    `<part id="P1">${measureXml}</part>`,
    '</score-partwise>',
  ].join('')
}
