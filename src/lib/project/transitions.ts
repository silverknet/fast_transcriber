import type {
  ProjectFile,
  ProjectTransitionAnchor,
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
  if (!outgoing || !incoming || !transition || transition.type !== 'echo') return null
  if (typeof outgoing.songId !== 'string' || !outgoing.songId) return null
  if (typeof incoming.songId !== 'string' || !incoming.songId) return null
  if (outgoing.songId === incoming.songId) return null
  if (typeof outgoing.title !== 'string' || typeof incoming.title !== 'string') return null
  const endAnchor = parseAnchor(outgoing.endAnchor)
  const startAnchor = parseAnchor(incoming.startAnchor)
  const echo = objectValue(transition.echo)
  const nextSongDelay = objectValue(transition.nextSongDelay)
  if (!endAnchor || !startAnchor || !echo || !nextSongDelay) return null
  if (echo.throwRule !== 'beat-3-or-7') return null
  if (!finiteIn(echo.throwTimeSec, 0, 24 * 60 * 60)) return null
  if (typeof echo.delayDivision !== 'string' || !DELAY_DIVISIONS.has(echo.delayDivision as TransitionDelayDivision)) return null
  if (!finiteIn(echo.captureLengthBeats, 0.05, 8)) return null
  if (!finiteIn(echo.drySongHoldBeats, 0, 16)) return null
  if (!finiteIn(echo.sendLevel, 0, 1) || !finiteIn(echo.wetLevel, 0, 1)) return null
  if (!finiteIn(echo.feedback, 0, 0.995) || !finiteIn(echo.repeatBuild, -1, 1)) return null
  if (!finiteIn(echo.toneHz, 200, 18_000)) return null
  if (!finiteIn(echo.tailLengthSec, 0.1, 30)) return null
  if (!finiteIn(echo.effectiveTailLengthSec, 0.1, 30)) return null
  if (!finiteIn(echo.blendReverbLevel, 0, 1)) return null
  if (!finiteIn(echo.blendReverbLengthSec, 0.1, 30)) return null
  if (nextSongDelay.measuredFrom !== 'echo-stop') return null
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
    incoming: {
      songId: incoming.songId,
      title: incoming.title,
      startAnchor,
    },
    transition: {
      type: 'echo',
      echo: {
        throwRule: 'beat-3-or-7',
        throwTimeSec: echo.throwTimeSec,
        delayDivision: echo.delayDivision as TransitionDelayDivision,
        captureLengthBeats: echo.captureLengthBeats,
        drySongHoldBeats: echo.drySongHoldBeats,
        sendLevel: echo.sendLevel,
        wetLevel: echo.wetLevel,
        feedback: echo.feedback,
        repeatBuild: echo.repeatBuild,
        toneHz: echo.toneHz,
        tailLengthSec: echo.tailLengthSec,
        effectiveTailLengthSec: echo.effectiveTailLengthSec,
        blendReverbLevel: echo.blendReverbLevel,
        blendReverbLengthSec: echo.blendReverbLengthSec,
      },
      nextSongDelay: {
        measuredFrom: 'echo-stop',
        beats: nextSongDelay.beats,
        secondsAtOutgoingTempo: nextSongDelay.secondsAtOutgoingTempo,
        startOffsetAfterOutgoingEndSec: nextSongDelay.startOffsetAfterOutgoingEndSec,
      },
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
    if (!songIds.has(recipe.outgoing.songId) || !songIds.has(recipe.incoming.songId)) continue
    byOutgoing.set(recipe.outgoing.songId, recipe)
  }
  return byOutgoing.size > 0 ? [...byOutgoing.values()] : undefined
}

export function transitionForSongs(
  project: ProjectFile | null | undefined,
  outgoingSongId: string,
  incomingSongId: string,
): ProjectTransitionRecipe | null {
  return project?.transitions?.find(
    (recipe) =>
      recipe.outgoing.songId === outgoingSongId && recipe.incoming.songId === incomingSongId,
  ) ?? null
}
