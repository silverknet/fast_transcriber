import type {
  ProjectFile,
  ProjectTransitionAnchor,
  ProjectTransitionEffect,
  ProjectHoldTransition,
  ProjectTransitionEndWarning,
  ProjectTransitionRecipe,
  TransitionAnchorMode,
  TransitionDelayDivision,
} from './types'

const ANCHOR_MODES = new Set<TransitionAnchorMode>(['bar', 'beat', 'tonic', 'free'])
const DELAY_DIVISIONS = new Set<TransitionDelayDivision>(['quarter', 'dotted-eighth', 'eighth'])

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finiteIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function optionalPositiveInteger(value: unknown): number | null | undefined {
  if (value === null) return null
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined
}

function parseAnchor(value: unknown): ProjectTransitionAnchor | null {
  const anchor = objectValue(value)
  if (!anchor) return null
  if (typeof anchor.mode !== 'string' || !ANCHOR_MODES.has(anchor.mode as TransitionAnchorMode)) {
    return null
  }
  if (!finiteIn(anchor.timeSec, 0, 24 * 60 * 60) || typeof anchor.label !== 'string') return null
  const barNumber = optionalPositiveInteger(anchor.barNumber)
  const beatNumber = optionalPositiveInteger(anchor.beatNumber)
  if (barNumber === undefined || beatNumber === undefined) return null
  return {
    mode: anchor.mode as TransitionAnchorMode,
    timeSec: anchor.timeSec,
    barNumber,
    beatNumber,
    label: anchor.label,
  }
}

/** Parse one persisted transition without coercing unsafe timing or routing values. */
export function parseProjectTransition(value: unknown): ProjectTransitionRecipe | null {
  const recipe = objectValue(value)
  if (!recipe || recipe.schema !== 'barbro.transition-recipe' || recipe.version !== 1) return null
  const outgoing = objectValue(recipe.outgoing)
  const incoming = objectValue(recipe.incoming)
  const transition = objectValue(recipe.transition)
  // `incoming` is OPTIONAL — an ending-only recipe has no destination.
  if (!outgoing || !transition) return null
  const endingType = transition.type
  const KNOWN = ['echo', 'cut', 'hit', 'fade', 'hold']
  if (typeof endingType !== 'string' || !KNOWN.includes(endingType)) return null
  if (typeof outgoing.songId !== 'string' || !outgoing.songId) return null
  if (typeof outgoing.title !== 'string') return null
  const endAnchor = parseAnchor(outgoing.endAnchor)
  // ENDING-ONLY: no incoming side at all. That is what a `hold` always is, and
  // it is the only way the LAST song of a set can be given an ending.
  let incomingSide: ProjectTransitionRecipe['incoming']
  if (incoming) {
    if (typeof incoming.songId !== 'string' || !incoming.songId) return null
    if (outgoing.songId === incoming.songId) return null
    if (typeof incoming.title !== 'string') return null
    const startAnchor = parseAnchor(incoming.startAnchor)
    if (!startAnchor) return null
    incomingSide = { songId: incoming.songId, title: incoming.title, startAnchor }
  }
  const nextSongDelay = objectValue(transition.nextSongDelay)
  if (!endAnchor || !nextSongDelay) return null

  // The ending effect, one arm at a time. Each arm validates only its own
  // block; a recipe naming a type whose block is missing or junk is rejected
  // outright rather than half-applied — a half-valid ending is a silent
  // surprise on a stage.
  let effect: ProjectTransitionEffect | null = null
  if (endingType === 'cut') {
    const cut = objectValue(transition.cut)
    if (!cut || !finiteIn(cut.softnessMs, 1, 500)) return null
    effect = { type: 'cut', cut: { softnessMs: cut.softnessMs } }
  } else if (endingType === 'hit') {
    const hit = objectValue(transition.hit)
    if (!hit) return null
    if (!finiteIn(hit.kickLevel, 0, 1.25) || !finiteIn(hit.crashLevel, 0, 1.25)) return null
    if (!finiteIn(hit.softnessMs, 1, 500)) return null
    effect = {
      type: 'hit',
      hit: { kickLevel: hit.kickLevel, crashLevel: hit.crashLevel, softnessMs: hit.softnessMs },
    }
  } else if (endingType === 'fade') {
    const fade = objectValue(transition.fade)
    if (!fade || !finiteIn(fade.bars, 0.25, 32)) return null
    effect = { type: 'fade', fade: { bars: fade.bars } }
  } else if (endingType === 'hold') {
    const hold = objectValue(transition.hold)
    const BEDS = ['kick', 'kick-bass', 'kick-hat', 'pad']
    if (!hold || typeof hold.bed !== 'string' || !BEDS.includes(hold.bed)) return null
    if (!finiteIn(hold.level, 0, 1)) return null
    effect = {
      type: 'hold',
      hold: { bed: hold.bed as ProjectHoldTransition['bed'], level: hold.level },
    }
  }

  const echo = endingType === 'echo' ? objectValue(transition.echo) : null
  if (endingType === 'echo' && !echo) return null
  if (echo && echo.throwRule !== 'beat-3-or-7') return null
  if (echo && (!finiteIn(echo.throwTimeSec, 0, 24 * 60 * 60))) return null
  if (echo && (typeof echo.delayDivision !== 'string' || !DELAY_DIVISIONS.has(echo.delayDivision as TransitionDelayDivision))) return null
  if (echo && (!finiteIn(echo.captureLengthBeats, 0.05, 8))) return null
  if (echo && (!finiteIn(echo.drySongHoldBeats, 0, 16))) return null
  if (echo && (!finiteIn(echo.sendLevel, 0, 1) || !finiteIn(echo.wetLevel, 0, 1))) return null
  if (echo && (!finiteIn(echo.feedback, 0, 0.995) || !finiteIn(echo.repeatBuild, -1, 1))) return null
  if (echo && (!finiteIn(echo.toneHz, 200, 18_000))) return null
  if (echo && (!finiteIn(echo.tailLengthSec, 0.1, 30))) return null
  if (echo && (!finiteIn(echo.effectiveTailLengthSec, 0.1, 30))) return null
  if (echo && (!finiteIn(echo.blendReverbLevel, 0, 1))) return null
  if (echo && (!finiteIn(echo.blendReverbLengthSec, 0.1, 30))) return null
  // The spoken warning before the ending. Optional and independent of the
  // ending type — junk is dropped rather than rejecting the whole recipe, so a
  // bad cue can never cost you a programmed ending.
  let endWarning: ProjectTransitionEndWarning | undefined
  const warnRaw = objectValue(transition.endWarning)
  if (warnRaw && typeof warnRaw.text === 'string' && finiteIn(warnRaw.leadBars, 0.25, 16)) {
    endWarning = { text: warnRaw.text.slice(0, 120), leadBars: warnRaw.leadBars }
  }

  if (nextSongDelay.measuredFrom !== 'echo-stop' && nextSongDelay.measuredFrom !== 'outgoing-end') {
    return null
  }
  if (!finiteIn(nextSongDelay.beats, 0, 32)) return null
  if (!finiteIn(nextSongDelay.secondsAtOutgoingTempo, 0, 120)) return null
  if (!finiteIn(nextSongDelay.startOffsetAfterOutgoingEndSec, 0, 120)) return null

  return {
    schema: 'barbro.transition-recipe',
    version: 1,
    outgoing: {
      songId: outgoing.songId,
      title: outgoing.title,
      endAnchor,
    },
    ...(incomingSide ? { incoming: incomingSide } : {}),
    transition: {
      ...(echo
        ? {
            type: 'echo' as const,
            echo: {
              throwRule: 'beat-3-or-7' as const,
              throwTimeSec: echo.throwTimeSec as number,
              delayDivision: echo.delayDivision as TransitionDelayDivision,
              captureLengthBeats: echo.captureLengthBeats as number,
              drySongHoldBeats: echo.drySongHoldBeats as number,
              sendLevel: echo.sendLevel as number,
              wetLevel: echo.wetLevel as number,
              feedback: echo.feedback as number,
              repeatBuild: echo.repeatBuild as number,
              toneHz: echo.toneHz as number,
              tailLengthSec: echo.tailLengthSec as number,
              effectiveTailLengthSec: echo.effectiveTailLengthSec as number,
              blendReverbLevel: echo.blendReverbLevel as number,
              blendReverbLengthSec: echo.blendReverbLengthSec as number,
            },
          }
        : effect!),
      nextSongDelay: {
        measuredFrom: nextSongDelay.measuredFrom as 'echo-stop' | 'outgoing-end',
        beats: nextSongDelay.beats,
        secondsAtOutgoingTempo: nextSongDelay.secondsAtOutgoingTempo,
        startOffsetAfterOutgoingEndSec: nextSongDelay.startOffsetAfterOutgoingEndSec,
      },
      ...(endWarning ? { endWarning } : {}),
    },
  }
}

export function parseProjectTransitions(
  value: unknown,
  songs: ProjectFile['songs'],
): ProjectTransitionRecipe[] | undefined {
  if (!Array.isArray(value)) return undefined
  const songIds = new Set(songs.map((song) => song.id))
  const byOutgoing = new Map<string, ProjectTransitionRecipe>()
  for (const item of value) {
    const recipe = parseProjectTransition(item)
    if (!recipe) continue
    if (!songIds.has(recipe.outgoing.songId)) continue
    // An ending-only recipe has no destination to validate.
    if (recipe.incoming && !songIds.has(recipe.incoming.songId)) continue
    byOutgoing.set(recipe.outgoing.songId, recipe)
  }
  return byOutgoing.size > 0 ? [...byOutgoing.values()] : undefined
}

/**
 * The recipe that applies when this song is playing.
 *
 * An ENDING-ONLY recipe (no `incoming`) matches whatever comes next, including
 * nothing — it describes how this song finishes and says nothing about the
 * destination. A paired recipe still only applies to its own pair, so
 * reordering the setlist cannot make one fire into the wrong song.
 */
export function transitionForSongs(
  project: ProjectFile | null | undefined,
  outgoingSongId: string,
  incomingSongId: string | null,
): ProjectTransitionRecipe | null {
  return (
    project?.transitions?.find(
      (recipe) =>
        recipe.outgoing.songId === outgoingSongId &&
        (!recipe.incoming || recipe.incoming.songId === incomingSongId),
    ) ?? null
  )
}
