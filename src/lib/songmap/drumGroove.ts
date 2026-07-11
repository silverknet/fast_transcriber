/**
 * Groove inference — turn jittery detected drum hits into a drum part that
 * MAKES SENSE, taking deliberate liberties with the recording:
 *
 *   1. Snap every detected hit to a 16th-note slot inside its bar.
 *   2. Per section × class, build a histogram: in what fraction of the
 *      section's bars does a hit land on each slot?
 *   3. Slots above a frequency threshold form THE PATTERN; play that pattern
 *      in every active bar of the section — detection misses get filled,
 *      one-off flukes disappear.
 *   4. Hi-hats get special treatment: pick a steady pulse layer (16ths /
 *      8ths / quarters) from the observed density, with downbeat accents.
 *   5. Bars where the detector heard NOTHING at all stay silent — breaks,
 *      intros and stops survive.
 *   6. A crash lands on a section's first downbeat when one was detected
 *      near the boundary.
 *
 * Pure and unit-testable: events + timeline + sections in, events out.
 */
import { sortBeatsByTime } from './normalize'
import type { Bar, Beat, DrumClass, DrumMidiEvent, Section, SongMap } from './types'

const SLOTS_PER_BEAT = 4 // 16ths

/** A slot is part of the pattern when hit in ≥ this fraction of active bars. */
const PATTERN_MIN_FREQ: Record<DrumClass, number> = {
  kick: 0.4,
  snare: 0.4,
  tom: 0.75, // toms are the least reliable class — demand near-unanimity
  hihat: 0.5, // only used when the pulse-layer heuristic doesn't kick in
  cymbal: 2, // cymbals never form a per-bar pattern; handled at boundaries
}

/** Hat pulse selection by median detected hats per active bar. */
const HAT_16THS_MIN_PER_BAR = 10
const HAT_8THS_MIN_PER_BAR = 5
const HAT_QUARTERS_MIN_PER_BAR = 2.5

const CRASH_NEAR_BOUNDARY_BARS = 1

type BarSlots = {
  bar: Bar
  beats: Beat[]
  /** slot index → time */
  slotTimes: number[]
}

function buildBarSlots(sm: SongMap): BarSlots[] {
  const beatsSorted = sortBeatsByTime(sm.timeline.beats)
  const beatsByBar = new Map<string, Beat[]>()
  for (const b of beatsSorted) {
    const arr = beatsByBar.get(b.barId)
    if (arr) arr.push(b)
    else beatsByBar.set(b.barId, [b])
  }
  const bars = [...sm.timeline.bars].sort((a, b) => a.index - b.index)
  return bars.map((bar) => {
    const beats = beatsByBar.get(bar.id) ?? []
    const slotTimes: number[] = []
    for (let bi = 0; bi < beats.length; bi++) {
      const start = beats[bi]!.timeSec
      const end = bi + 1 < beats.length ? beats[bi + 1]!.timeSec : bar.endSec
      const span = Math.max(0, end - start)
      for (let s = 0; s < SLOTS_PER_BEAT; s++) {
        slotTimes.push(start + (span * s) / SLOTS_PER_BEAT)
      }
    }
    return { bar, beats, slotTimes }
  })
}

/** Sections covering every bar; uncovered bars form implicit blocks. */
function sectionBlocks(sm: SongMap, barCount: number): { start: number; end: number }[] {
  const blocks: { start: number; end: number }[] = []
  const sections = [...sm.sections].sort(
    (a: Section, b: Section) => a.barRange.startBarIndex - b.barRange.startBarIndex,
  )
  let cursor = 0
  for (const s of sections) {
    const start = Math.max(0, s.barRange.startBarIndex)
    const end = Math.min(barCount - 1, s.barRange.endBarIndex)
    if (start > cursor) blocks.push({ start: cursor, end: start - 1 })
    if (end >= start) blocks.push({ start, end })
    cursor = Math.max(cursor, end + 1)
  }
  if (cursor <= barCount - 1) blocks.push({ start: cursor, end: barCount - 1 })
  return blocks.length > 0 ? blocks : [{ start: 0, end: barCount - 1 }]
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/**
 * Infer the steady groove. Returns grid-locked events covering the song.
 */
export function inferDrumGroove(sm: SongMap, events: DrumMidiEvent[]): DrumMidiEvent[] {
  const barSlots = buildBarSlots(sm)
  if (barSlots.length === 0 || events.length === 0) return events

  // Assign each detected event to (barIdx, slotIdx).
  type Placed = { barIdx: number; slot: number; e: DrumMidiEvent }
  const placed: Placed[] = []
  const barStarts = barSlots.map((b) => b.bar.startSec)
  for (const e of events) {
    // Binary search for the owning bar.
    let lo = 0
    let hi = barSlots.length - 1
    if (e.timeSec < barStarts[0]!) continue
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (barStarts[mid]! <= e.timeSec) lo = mid
      else hi = mid - 1
    }
    const bs = barSlots[lo]!
    if (bs.slotTimes.length === 0) continue
    let best = 0
    let bestD = Infinity
    for (let s = 0; s < bs.slotTimes.length; s++) {
      const d = Math.abs(bs.slotTimes[s]! - e.timeSec)
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    placed.push({ barIdx: lo, slot: best, e })
  }

  // Bars with ANY detected activity — the groove only plays where the
  // drummer played.
  const activeBars = new Set(placed.map((p) => p.barIdx))

  const out: DrumMidiEvent[] = []
  const blocks = sectionBlocks(sm, barSlots.length)

  for (const block of blocks) {
    const blockBars: number[] = []
    for (let b = block.start; b <= block.end; b++) {
      if (activeBars.has(b)) blockBars.push(b)
    }
    if (blockBars.length === 0) continue
    const blockPlaced = placed.filter((p) => p.barIdx >= block.start && p.barIdx <= block.end)

    // ── Kick / snare / tom: slot-histogram patterns ──
    for (const cls of ['kick', 'snare', 'tom'] as DrumClass[]) {
      const ofCls = blockPlaced.filter((p) => p.e.cls === cls)
      if (ofCls.length === 0) continue
      const bySlot = new Map<number, { bars: Set<number>; vels: number[] }>()
      for (const p of ofCls) {
        const cur = bySlot.get(p.slot) ?? { bars: new Set<number>(), vels: [] }
        cur.bars.add(p.barIdx)
        cur.vels.push(p.e.velocity)
        bySlot.set(p.slot, cur)
      }
      const patternSlots: { slot: number; velocity: number }[] = []
      for (const [slot, info] of bySlot) {
        const freq = info.bars.size / blockBars.length
        if (freq >= PATTERN_MIN_FREQ[cls]) {
          patternSlots.push({ slot, velocity: Math.min(1, median(info.vels)) })
        }
      }
      if (patternSlots.length === 0) continue
      for (const barIdx of blockBars) {
        const bs = barSlots[barIdx]!
        for (const ps of patternSlots) {
          const t = bs.slotTimes[ps.slot]
          if (t === undefined) continue
          out.push({ timeSec: t, cls, velocity: ps.velocity })
        }
      }
    }

    // ── Hi-hats: steady pulse from observed density ──
    const hats = blockPlaced.filter((p) => p.e.cls === 'hihat')
    if (hats.length > 0) {
      const perBar = blockBars.map((b) => hats.filter((p) => p.barIdx === b).length)
      const density = median(perBar)
      const hatVel = Math.min(1, median(hats.map((p) => p.e.velocity)))
      let stride: number | null = null
      if (density >= HAT_16THS_MIN_PER_BAR) stride = 1
      else if (density >= HAT_8THS_MIN_PER_BAR) stride = 2
      else if (density >= HAT_QUARTERS_MIN_PER_BAR) stride = SLOTS_PER_BEAT
      if (stride !== null) {
        for (const barIdx of blockBars) {
          const bs = barSlots[barIdx]!
          for (let s = 0; s < bs.slotTimes.length; s += stride) {
            const onBeat = s % SLOTS_PER_BEAT === 0
            out.push({
              timeSec: bs.slotTimes[s]!,
              cls: 'hihat',
              velocity: Math.min(1, hatVel * (onBeat ? 1 : 0.8)),
            })
          }
        }
      } else {
        // Sparse hats — fall back to the histogram pattern like kick/snare.
        const bySlot = new Map<number, { bars: Set<number>; vels: number[] }>()
        for (const p of hats) {
          const cur = bySlot.get(p.slot) ?? { bars: new Set<number>(), vels: [] }
          cur.bars.add(p.barIdx)
          cur.vels.push(p.e.velocity)
          bySlot.set(p.slot, cur)
        }
        for (const [slot, info] of bySlot) {
          if (info.bars.size / blockBars.length < PATTERN_MIN_FREQ.hihat) continue
          for (const barIdx of blockBars) {
            const t = barSlots[barIdx]!.slotTimes[slot]
            if (t !== undefined) {
              out.push({ timeSec: t, cls: 'hihat', velocity: Math.min(1, median(info.vels)) })
            }
          }
        }
      }
    }

    // ── Crash on the block's first active downbeat when detected nearby ──
    const firstActive = blockBars[0]!
    const boundaryLo = barSlots[Math.max(0, firstActive - CRASH_NEAR_BOUNDARY_BARS)]!.bar.startSec
    const boundaryHi = barSlots[Math.min(barSlots.length - 1, firstActive + CRASH_NEAR_BOUNDARY_BARS)]!.bar.endSec
    const crashNearby = blockPlaced.some(
      (p) => p.e.cls === 'cymbal' && p.e.timeSec >= boundaryLo && p.e.timeSec <= boundaryHi,
    )
    if (crashNearby) {
      const t = barSlots[firstActive]!.slotTimes[0]
      if (t !== undefined) out.push({ timeSec: t, cls: 'cymbal', velocity: 0.9 })
    }
  }

  out.sort((a, b) => a.timeSec - b.timeSec || a.cls.localeCompare(b.cls))
  return out
}
