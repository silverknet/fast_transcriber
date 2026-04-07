import { createSongMapFromAudioSession } from '$lib/songmap/factory'
import { mergeAnalysisIntoSongMap } from '$lib/songmap/merge'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import { evenBeatTimes } from '$lib/songmap/timelineEdit'
import type { Bar, Beat, SongMap } from '$lib/songmap/types'
import { validateSongMap } from '$lib/songmap/validate'

export type RawBeatRow = {
  time: number
  beatInBar: number
}

export type BeatsToSongMapInput = {
  filename: string
  durationSec: number
  mimeType?: string
  beats: RawBeatRow[]
  idFactory?: () => string
}

function medianSorted(values: number[]): number {
  if (values.length === 0) return 0.5
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** Aligns beat times with equal spacing inside each bar (bar interval is authoritative). */
function applyEvenSpacingToBeats(map: SongMap): SongMap {
  const barById = new Map(map.timeline.bars.map((b) => [b.id, b]))
  const byBar = new Map<string, Beat[]>()
  for (const b of map.timeline.beats) {
    const arr = byBar.get(b.barId) ?? []
    arr.push(b)
    byBar.set(b.barId, arr)
  }
  const next: Beat[] = []
  for (const [barId, list] of byBar) {
    const bar = barById.get(barId)
    if (!bar) continue
    const sorted = [...list].sort((a, b) => a.indexInBar - b.indexInBar || a.id.localeCompare(b.id))
    const n = sorted.length
    const times = evenBeatTimes(bar, n)
    for (let i = 0; i < n; i++) {
      next.push({ ...sorted[i]!, indexInBar: i, timeSec: times[i]! })
    }
  }
  return {
    ...map,
    timeline: {
      ...map.timeline,
      beats: sortBeatsByTime(next),
    },
  }
}

/**
 * Converts madmom-style rows into a valid SongMap v1 (bars from downbeats, flat beats).
 */
export function beatsToSongMap(input: BeatsToSongMapInput): SongMap {
  const id = input.idFactory ?? (() => crypto.randomUUID())
  const now = new Date().toISOString()

  const rows = [...input.beats]
    .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.beatInBar))
    .sort((a, b) => a.time - b.time)

  const firstDown = rows.findIndex((b) => b.beatInBar === 1)
  const trimmed = firstDown >= 0 ? rows.slice(firstDown) : rows

  if (trimmed.length === 0) {
    throw new Error('No beats detected')
  }

  const segments: RawBeatRow[][] = []
  let seg: RawBeatRow[] = []
  for (const b of trimmed) {
    if (b.beatInBar === 1 && seg.length > 0) {
      segments.push(seg)
      seg = [b]
    } else {
      seg.push(b)
    }
  }
  if (seg.length) segments.push(seg)

  const intervals: number[] = []
  for (let i = 1; i < trimmed.length; i++) {
    intervals.push(trimmed[i]!.time - trimmed[i - 1]!.time)
  }
  const medianBeat = medianSorted(intervals.filter((x) => x > 0))
  const bpm =
    medianBeat > 1e-6 ? Math.round((60 / medianBeat) * 100) / 100 : undefined

  const bars: Bar[] = []
  const beats: Beat[] = []

  for (let bi = 0; bi < segments.length; bi++) {
    const segment = segments[bi]!
    const barId = id()
    const beatCount = segment.length
    const beatIds: string[] = []
    const startSec = segment[0]!.time
    const nextStart = bi + 1 < segments.length ? segments[bi + 1]![0]!.time : null
    const lastT = segment[segment.length - 1]!.time

    let endSec: number
    if (nextStart !== null) {
      endSec = nextStart
    } else {
      endSec = Math.min(input.durationSec, lastT + medianBeat)
      if (endSec <= lastT) {
        endSec = lastT + Math.max(medianBeat * 0.25, 1e-3)
      }
      endSec = Math.min(endSec, input.durationSec + 1e6)
      if (endSec <= lastT) {
        endSec = lastT + 1e-3
      }
    }

    /** `mergeAnalysisIntoSongMap` validates beats before we can run `applyEvenSpacingToBeats`. */
    const stubBar: Bar = {
      id: barId,
      index: bi,
      startSec,
      endSec,
      meter: { numerator: beatCount, denominator: 4 },
      beatCount,
      beatIds: [],
    }
    const times = evenBeatTimes(stubBar, beatCount)
    const segByBeatInBar = [...segment].sort((a, b) => a.beatInBar - b.beatInBar)

    for (let k = 0; k < segByBeatInBar.length; k++) {
      const bid = id()
      beatIds.push(bid)
      beats.push({
        id: bid,
        barId,
        indexInBar: k,
        timeSec: times[k]!,
        source: 'detected',
      })
    }

    bars.push({
      id: barId,
      index: bi,
      startSec,
      endSec,
      meter: { numerator: beatCount, denominator: 4 },
      beatCount,
      beatIds,
    })
  }

  const titleStem = input.filename.replace(/\.[^.]+$/, '') || 'Untitled'
  const base = createSongMapFromAudioSession(
    {
      file: null,
      name: input.filename,
      startSec: 0,
      endSec: input.durationSec,
    },
    { title: titleStem },
  )

  if (input.mimeType) {
    base.audio = { ...base.audio!, mimeType: input.mimeType }
  }

  let map = mergeAnalysisIntoSongMap(base, { bars, beats })
  map = applyEvenSpacingToBeats(map)
  map = {
    ...map,
    metadata: {
      ...map.metadata,
      ...(bpm !== undefined ? { bpm } : {}),
      updatedAt: now,
    },
  }

  const v = validateSongMap(map)
  if (!v.ok) {
    throw new Error(`Invalid SongMap: ${v.errors.join('; ')}`)
  }
  return map
}
