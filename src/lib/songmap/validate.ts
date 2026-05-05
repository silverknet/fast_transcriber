import { SONGMAP_FORMAT_VERSION } from './version'
import type {
  Bar,
  Beat,
  HarmonyEvent,
  Section,
  SongKey,
  SongMap,
  SongMetadata,
} from './types'

export type ValidationResult = {
  ok: boolean
  errors: string[]
  warnings: string[]
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

const NOTE_NAMES = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B'])

const KEY_MODES = new Set(['major', 'minor'])

function validateSongKey(k: SongKey, path: string, errors: string[]) {
  if (!NOTE_NAMES.has(k.root as string)) errors.push(`${path}.root invalid`)
  if (!KEY_MODES.has(k.mode)) errors.push(`${path}.mode invalid`)
}

function validateMetadata(m: SongMetadata, path: string, errors: string[]) {
  if (typeof m.title !== 'string' || !m.title.trim()) errors.push(`${path}.title required`)
  if (typeof m.createdAt !== 'string') errors.push(`${path}.createdAt must be ISO string`)
  if (typeof m.updatedAt !== 'string') errors.push(`${path}.updatedAt must be ISO string`)
  if (m.keyDetail != null) validateSongKey(m.keyDetail, `${path}.keyDetail`, errors)
}

function validateBar(bar: Bar, path: string, errors: string[]) {
  if (typeof bar.id !== 'string' || !bar.id) errors.push(`${path}.id required`)
  if (!Number.isInteger(bar.index) || bar.index < 0) errors.push(`${path}.index invalid`)
  if (!isFiniteNumber(bar.startSec)) errors.push(`${path}.startSec invalid`)
  if (!isFiniteNumber(bar.endSec)) errors.push(`${path}.endSec invalid`)
  if (bar.endSec <= bar.startSec) errors.push(`${path}.endSec must be > startSec (half-open [start,end))`)
  if (!bar.meter || typeof bar.meter.numerator !== 'number' || bar.meter.numerator < 1) {
    errors.push(`${path}.meter.numerator invalid`)
  }
  if (!bar.meter || typeof bar.meter.denominator !== 'number' || bar.meter.denominator < 1) {
    errors.push(`${path}.meter.denominator invalid`)
  }
  if (!Number.isInteger(bar.beatCount) || bar.beatCount < 0) errors.push(`${path}.beatCount invalid`)
  if (!Array.isArray(bar.beatIds)) errors.push(`${path}.beatIds must be array`)
  else if (bar.beatIds.length !== bar.beatCount) {
    errors.push(`${path}.beatIds length must equal beatCount`)
  }
}

function validateBeat(b: Beat, path: string, errors: string[]) {
  if (typeof b.id !== 'string' || !b.id) errors.push(`${path}.id required`)
  if (typeof b.barId !== 'string' || !b.barId) errors.push(`${path}.barId required`)
  if (!Number.isInteger(b.indexInBar) || b.indexInBar < 0) errors.push(`${path}.indexInBar invalid`)
  if (!isFiniteNumber(b.timeSec)) errors.push(`${path}.timeSec invalid`)
}

const SECTION_KINDS = new Set([
  'intro',
  'verse',
  'preChorus',
  'chorus',
  'bridge',
  'solo',
  'outro',
  'custom',
])

function validateSection(s: Section, path: string, errors: string[]) {
  if (typeof s.id !== 'string' || !s.id) errors.push(`${path}.id required`)
  if (typeof s.kind !== 'string' || !SECTION_KINDS.has(s.kind)) errors.push(`${path}.kind invalid`)
  if (typeof s.label !== 'string') errors.push(`${path}.label required`)
  if (!s.barRange || !Number.isInteger(s.barRange.startBarIndex) || !Number.isInteger(s.barRange.endBarIndex)) {
    errors.push(`${path}.barRange invalid`)
  } else if (s.barRange.endBarIndex < s.barRange.startBarIndex) {
    errors.push(`${path}.barRange end must be >= start`)
  }
}

function validateChordSymbol(c: HarmonyEvent['chord'], path: string, errors: string[]) {
  if (!NOTE_NAMES.has(c.root as string)) errors.push(`${path}.root invalid`)
  if (c.bass != null && !NOTE_NAMES.has(c.bass as string)) errors.push(`${path}.bass invalid`)
  if (typeof c.displayRaw !== 'string') errors.push(`${path}.displayRaw required`)
}

function validateHarmony(h: HarmonyEvent, path: string, errors: string[]) {
  if (typeof h.id !== 'string' || !h.id) errors.push(`${path}.id required`)
  if (typeof h.barId !== 'string' || !h.barId) errors.push(`${path}.barId required`)
  if (!isFiniteNumber(h.startSec)) errors.push(`${path}.startSec invalid`)
  if (!isFiniteNumber(h.endSec)) errors.push(`${path}.endSec invalid`)
  if (h.endSec <= h.startSec) errors.push(`${path}.endSec must be > startSec`)
  validateChordSymbol(h.chord, `${path}.chord`, errors)
}

export function validateSongMap(map: SongMap): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (map.formatVersion !== SONGMAP_FORMAT_VERSION) {
    errors.push(`formatVersion must be ${SONGMAP_FORMAT_VERSION}`)
  }

  validateMetadata(map.metadata, 'metadata', errors)

  const bars = map.timeline?.bars
  const beats = map.timeline?.beats
  if (!Array.isArray(bars)) errors.push('timeline.bars must be array')
  if (!Array.isArray(beats)) errors.push('timeline.beats must be array')

  if (Array.isArray(bars)) {
    bars.forEach((bar, i) => validateBar(bar, `timeline.bars[${i}]`, errors))
    for (let i = 1; i < bars.length; i++) {
      if (bars[i]!.index <= bars[i - 1]!.index) {
        warnings.push(`timeline.bars: bar index not strictly increasing at ${i}`)
      }
    }
    const barIds = new Set(bars.map((b) => b.id))
    if (barIds.size !== bars.length) errors.push('timeline.bars: duplicate bar id')
    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1]!
      const cur = bars[i]!
      if (prev.endSec > cur.startSec + 1e-9) {
        warnings.push(
          `timeline.bars[${i}]: may overlap previous bar end (${prev.endSec}) vs current start (${cur.startSec})`,
        )
      }
    }
  }

  if (Array.isArray(beats)) {
    const beatIds = new Set<string>()
    beats.forEach((b, i) => {
      validateBeat(b, `timeline.beats[${i}]`, errors)
      if (beatIds.has(b.id)) errors.push(`timeline.beats[${i}]: duplicate beat id`)
      beatIds.add(b.id)
    })
    if (Array.isArray(bars)) {
      const barById = new Map(bars.map((b) => [b.id, b]))
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i]!
        const bar = barById.get(b.barId)
        if (!bar) {
          errors.push(`timeline.beats[${i}]: unknown barId ${b.barId}`)
          continue
        }
        if (b.indexInBar >= bar.beatCount) {
          errors.push(`timeline.beats[${i}]: indexInBar out of range for bar`)
        }
        if (b.timeSec < bar.startSec || b.timeSec >= bar.endSec) {
          errors.push(`timeline.beats[${i}]: timeSec must fall within bar [startSec,endSec)`)
        }
      }
      for (const bar of bars) {
        const inBar = beats.filter((b) => b.barId === bar.id)
        if (inBar.length !== bar.beatCount) {
          errors.push(`bar ${bar.id}: beat count mismatch (beatIds vs beats list)`)
        }
        for (const bid of bar.beatIds) {
          const beat = beats.find((b) => b.id === bid)
          if (!beat || beat.barId !== bar.id) {
            errors.push(`bar ${bar.id}: beatId ${bid} missing or wrong bar`)
          }
        }
      }
    }
  }

  if (!map.cues || typeof map.cues.mode !== 'string') errors.push('cues invalid')
  else {
    if (!Number.isInteger(map.cues.countInBeats) || map.cues.countInBeats < 0) {
      errors.push('cues.countInBeats invalid')
    }
    if (typeof map.cues.useSectionLabels !== 'boolean') errors.push('cues.useSectionLabels invalid')
    if (map.cues.prependSec !== undefined && (!Number.isFinite(map.cues.prependSec) || map.cues.prependSec < 0)) {
      errors.push('cues.prependSec invalid')
    }
  }

  if (!Array.isArray(map.sections)) errors.push('sections must be array')
  else map.sections.forEach((s, i) => validateSection(s, `sections[${i}]`, errors))

  if (!Array.isArray(map.harmony)) errors.push('harmony must be array')
  else {
    map.harmony.forEach((h, i) => validateHarmony(h, `harmony[${i}]`, errors))
    if (Array.isArray(beats) && Array.isArray(bars)) {
      const beatById = new Map(beats.map((b) => [b.id, b]))
      const seenBeat = new Set<string>()
      const SPAN_EPS = 0.09
      for (let i = 0; i < map.harmony.length; i++) {
        const h = map.harmony[i]!
        if (h.beatId) {
          if (seenBeat.has(h.beatId)) errors.push(`harmony[${i}]: duplicate beatId ${h.beatId}`)
          seenBeat.add(h.beatId)
          const beat = beatById.get(h.beatId)
          if (!beat) {
            errors.push(`harmony[${i}]: unknown beatId`)
          } else {
            if (beat.barId !== h.barId) errors.push(`harmony[${i}]: barId does not match beat's bar`)
            if (h.beatAnchor != null && h.beatAnchor.indexInBar !== beat.indexInBar) {
              warnings.push(`harmony[${i}]: beatAnchor.indexInBar does not match beat`)
            }
            if (Math.abs(h.startSec - beat.timeSec) > SPAN_EPS) {
              warnings.push(`harmony[${i}]: startSec differs from beat.timeSec`)
            }
          }
        }
      }
    }
  }

  if (Array.isArray(map.sections) && Array.isArray(bars)) {
    const maxBarIndex = bars.length ? Math.max(...bars.map((b) => b.index)) : -1
    map.sections.forEach((s, i) => {
      if (s.barRange.endBarIndex > maxBarIndex) {
        warnings.push(`sections[${i}]: barRange extends past last bar index (${maxBarIndex})`)
      }
    })
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  }
}
