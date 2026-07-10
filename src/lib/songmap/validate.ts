import { SONGMAP_FORMAT_VERSION } from './version'
import type {
  Bar,
  Beat,
  CueAnchor,
  CueEvent,
  CueTrack,
  HarmonyEvent,
  Lyrics,
  Section,
  SongKey,
  SongMap,
  SongMetadata,
  SongTranspose,
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

function validateTranspose(t: SongTranspose | undefined, path: string, errors: string[]) {
  if (t === undefined) return
  if (!Number.isInteger(t.baseSemitones)) {
    errors.push(`${path}.baseSemitones must be an integer`)
  } else if (t.baseSemitones < -12 || t.baseSemitones > 12) {
    errors.push(`${path}.baseSemitones must be between -12 and 12`)
  }
}

function validateLyrics(l: Lyrics | undefined, path: string, errors: string[]) {
  if (l === undefined) return
  if (typeof l.sourceText !== 'string') errors.push(`${path}.sourceText must be a string`)
  if (!Array.isArray(l.words)) {
    errors.push(`${path}.words must be an array`)
    return
  }
  for (let i = 0; i < l.words.length; i++) {
    const w = l.words[i]!
    const p = `${path}.words[${i}]`
    if (typeof w.text !== 'string' || !w.text) errors.push(`${p}.text required`)
    if (!isFiniteNumber(w.startSec) || w.startSec < 0) errors.push(`${p}.startSec invalid`)
    if (!isFiniteNumber(w.endSec)) errors.push(`${p}.endSec invalid`)
    else if (w.endSec <= w.startSec) errors.push(`${p}.endSec must be > startSec`)
    if (!Number.isInteger(w.line) || w.line < 0) errors.push(`${p}.line invalid`)
  }
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
  'riff',
  'break',
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

const CUE_EVENT_KINDS = new Set([
  'section',
  'count',
  'intro',
  'custom-text',
  'recorded-audio-placeholder',
])

const CUE_EVENT_SOURCES = new Set(['generated', 'custom', 'imported', 'recorded'])

function validateCueAnchor(anchor: CueAnchor, path: string, errors: string[]) {
  if (!anchor || typeof anchor !== 'object') {
    errors.push(`${path} invalid`)
    return
  }
  if (anchor.kind === 'bar') {
    if (typeof anchor.barId !== 'string' || !anchor.barId) errors.push(`${path}.barId required`)
  } else if (anchor.kind === 'beat') {
    if (typeof anchor.beatId !== 'string' || !anchor.beatId) errors.push(`${path}.beatId required`)
  } else if (anchor.kind === 'time') {
    if (!isFiniteNumber(anchor.timeSec)) errors.push(`${path}.timeSec invalid`)
  } else {
    errors.push(`${path}.kind invalid`)
  }
  if (anchor.offsetSec !== undefined && !isFiniteNumber(anchor.offsetSec)) {
    errors.push(`${path}.offsetSec invalid`)
  }
  if (anchor.leadBars !== undefined && !isFiniteNumber(anchor.leadBars)) {
    errors.push(`${path}.leadBars invalid`)
  }
  if (anchor.leadBeats !== undefined && !isFiniteNumber(anchor.leadBeats)) {
    errors.push(`${path}.leadBeats invalid`)
  }
}

function validateCueEvent(event: CueEvent, path: string, errors: string[]) {
  if (typeof event.id !== 'string' || !event.id) errors.push(`${path}.id required`)
  if (!CUE_EVENT_KINDS.has(event.kind)) errors.push(`${path}.kind invalid`)
  if (typeof event.enabled !== 'boolean') errors.push(`${path}.enabled must be boolean`)
  validateCueAnchor(event.anchor, `${path}.anchor`, errors)
  if (event.text !== undefined && typeof event.text !== 'string') errors.push(`${path}.text invalid`)
  if (event.generatedKey !== undefined && typeof event.generatedKey !== 'string') {
    errors.push(`${path}.generatedKey invalid`)
  }
  if (event.generatedSource !== undefined) {
    if (!event.generatedSource || event.generatedSource.kind !== 'section') {
      errors.push(`${path}.generatedSource invalid`)
    } else {
      if (typeof event.generatedSource.sectionId !== 'string' || !event.generatedSource.sectionId) {
        errors.push(`${path}.generatedSource.sectionId invalid`)
      }
      if (
        event.generatedSource.leadBars !== undefined &&
        !isFiniteNumber(event.generatedSource.leadBars)
      ) {
        errors.push(`${path}.generatedSource.leadBars invalid`)
      }
      if (
        event.generatedSource.leadBeats !== undefined &&
        !isFiniteNumber(event.generatedSource.leadBeats)
      ) {
        errors.push(`${path}.generatedSource.leadBeats invalid`)
      }
    }
  }
  if (event.source !== undefined && !CUE_EVENT_SOURCES.has(event.source)) {
    errors.push(`${path}.source invalid`)
  }
  if (event.edited !== undefined && typeof event.edited !== 'boolean') errors.push(`${path}.edited invalid`)
  if (event.stale !== undefined && typeof event.stale !== 'boolean') errors.push(`${path}.stale invalid`)
}

function validateCueTrack(track: CueTrack, path: string, errors: string[]) {
  if (typeof track.id !== 'string' || !track.id) errors.push(`${path}.id required`)
  if (typeof track.name !== 'string' || !track.name.trim()) errors.push(`${path}.name required`)
  if (typeof track.enabled !== 'boolean') errors.push(`${path}.enabled must be boolean`)
  if (track.voiceId !== undefined && typeof track.voiceId !== 'string') errors.push(`${path}.voiceId invalid`)
  if (!Array.isArray(track.events)) errors.push(`${path}.events must be array`)
  else track.events.forEach((event, i) => validateCueEvent(event, `${path}.events[${i}]`, errors))
  if (!Array.isArray(track.suppressedGeneratedKeys)) {
    errors.push(`${path}.suppressedGeneratedKeys must be array`)
  } else {
    track.suppressedGeneratedKeys.forEach((key, i) => {
      if (typeof key !== 'string') errors.push(`${path}.suppressedGeneratedKeys[${i}] invalid`)
    })
  }
}

export function validateSongMap(map: SongMap): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (map.formatVersion !== SONGMAP_FORMAT_VERSION) {
    errors.push(`formatVersion must be ${SONGMAP_FORMAT_VERSION}`)
  }

  validateMetadata(map.metadata, 'metadata', errors)
  validateTranspose(map.transpose, 'transpose', errors)
  validateLyrics(map.lyrics, 'lyrics', errors)

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

  if (map.timeline?.original !== undefined) {
    const orig = map.timeline.original
    if (!orig || !Array.isArray(orig.bars) || !Array.isArray(orig.beats)) {
      errors.push('timeline.original must have bars[] and beats[]')
    } else {
      orig.bars.forEach((bar, i) => validateBar(bar, `timeline.original.bars[${i}]`, errors))
      orig.beats.forEach((b, i) => validateBeat(b, `timeline.original.beats[${i}]`, errors))
    }
  }

  if (!Array.isArray(map.cueTracks)) errors.push('cueTracks must be array')
  else map.cueTracks.forEach((track, i) => validateCueTrack(track, `cueTracks[${i}]`, errors))

  if (map.countInBeats !== undefined) {
    if (!Number.isInteger(map.countInBeats) || map.countInBeats < 0) {
      errors.push('countInBeats must be a non-negative integer')
    }
  }
  if (map.startBeatId !== undefined) {
    if (typeof map.startBeatId !== 'string' || map.startBeatId.length === 0) {
      errors.push('startBeatId must be a non-empty string')
    } else if (Array.isArray(beats) && !beats.some((b) => b.id === map.startBeatId)) {
      // Soft fail: the override beat is missing. Plan says to drop the field
      // with a warning; here we surface a warning so the parser can decide to
      // drop it. The validator itself doesn't mutate.
      warnings.push(`startBeatId references missing beat "${map.startBeatId}"`)
    }
  }

  const validateRenderedExport = (c: unknown, label: string) => {
    if (!c || typeof c !== 'object') {
      errors.push(`${label} invalid`)
      return
    }
    const r = c as Record<string, unknown>
    if (typeof r.fingerprint !== 'string' || !r.fingerprint) errors.push(`${label}.fingerprint invalid`)
    if (!Number.isFinite(r.durationSec as number) || (r.durationSec as number) <= 0) {
      errors.push(`${label}.durationSec invalid`)
    }
    if (!Number.isFinite(r.sampleRate as number) || (r.sampleRate as number) <= 0) {
      errors.push(`${label}.sampleRate invalid`)
    }
    if (typeof r.generatedAt !== 'string' || !r.generatedAt) errors.push(`${label}.generatedAt invalid`)
    if (!Number.isFinite(r.preludeOffsetSec as number) || (r.preludeOffsetSec as number) < 0) {
      errors.push(`${label}.preludeOffsetSec invalid`)
    }
    if (r.relativePath !== undefined && typeof r.relativePath !== 'string') {
      errors.push(`${label}.relativePath invalid`)
    }
  }
  if (Array.isArray(map.cueTracks)) {
    map.cueTracks.forEach((track, i) => {
      if (track.renderExport !== undefined) validateRenderedExport(track.renderExport, `cueTracks[${i}].renderExport`)
    })
  }
  if (map.clickExport !== undefined) validateRenderedExport(map.clickExport, 'clickExport')

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

  if (map.projectFolder !== undefined && typeof map.projectFolder !== 'string') {
    errors.push('projectFolder must be a string')
  }
  if (map.stemRefs !== undefined) {
    if (typeof map.stemRefs !== 'object' || Array.isArray(map.stemRefs)) {
      errors.push('stemRefs must be an object')
    } else {
      for (const [k, v] of Object.entries(map.stemRefs)) {
        if (typeof v !== 'string') errors.push(`stemRefs.${k} must be a string`)
      }
    }
  }
  if (map.mixState !== undefined) {
    if (!map.mixState || typeof map.mixState !== 'object') {
      errors.push('mixState invalid')
    } else {
      if (!Array.isArray(map.mixState.tracks)) errors.push('mixState.tracks must be an array')
      else {
        for (let i = 0; i < map.mixState.tracks.length; i++) {
          const t = map.mixState.tracks[i]
          if (!t || typeof t !== 'object') errors.push(`mixState.tracks[${i}] invalid`)
          else {
            if (typeof t.key !== 'string' || !t.key) errors.push(`mixState.tracks[${i}].key invalid`)
            if (!Number.isFinite(t.volume) || t.volume < 0) errors.push(`mixState.tracks[${i}].volume invalid`)
          }
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  }
}
