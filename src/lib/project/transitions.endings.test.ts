/**
 * THE ENDING TYPES, both parsers' worth of paranoia.
 *
 * `transition.type` was the single literal `'echo'`, and five other endings
 * existed only inside the Transition Lab where they could be auditioned but
 * never saved. Widening the union is the easy half; the half that bites is the
 * whitelist parsers — this repo has silently eaten project settings four times
 * that way, and I lost `liveStems` to it the same week.
 */
import { describe, expect, it } from 'vitest'
import { parseProjectTransition } from './transitions'
import type { ProjectTransitionRecipe } from './types'

const anchor = (timeSec: number) => ({
  mode: 'bar' as const,
  timeSec,
  barNumber: 1,
  beatNumber: 1,
  label: 'Start of bar 1',
})

const recipe = (transition: unknown): unknown => ({
  schema: 'barbro.transition-recipe',
  version: 1,
  outgoing: { songId: 'a', title: 'Out', endAnchor: anchor(200) },
  incoming: { songId: 'b', title: 'In', startAnchor: anchor(4) },
  transition,
})

const delay = {
  measuredFrom: 'outgoing-end',
  beats: 0,
  secondsAtOutgoingTempo: 0,
  startOffsetAfterOutgoingEndSec: 1.5,
}

describe('the new ending types survive a round trip', () => {
  it('cut', () => {
    const out = parseProjectTransition(
      recipe({ type: 'cut', cut: { softnessMs: 24 }, nextSongDelay: delay }),
    ) as ProjectTransitionRecipe
    expect(out).not.toBeNull()
    expect(out.transition.type).toBe('cut')
    expect(out.transition.type === 'cut' && out.transition.cut.softnessMs).toBe(24)
  })

  it('hit — the kick + crash ending', () => {
    const out = parseProjectTransition(
      recipe({
        type: 'hit',
        hit: { kickLevel: 0.9, crashLevel: 0.7, softnessMs: 24 },
        nextSongDelay: delay,
      }),
    ) as ProjectTransitionRecipe
    expect(out.transition.type).toBe('hit')
    if (out.transition.type !== 'hit') throw new Error('narrowing')
    expect(out.transition.hit).toEqual({ kickLevel: 0.9, crashLevel: 0.7, softnessMs: 24 })
  })

  it('fade', () => {
    const out = parseProjectTransition(
      recipe({ type: 'fade', fade: { bars: 2 }, nextSongDelay: delay }),
    ) as ProjectTransitionRecipe
    expect(out.transition.type === 'fade' && out.transition.fade.bars).toBe(2)
  })

  it('echo still parses exactly as before', () => {
    const echo = {
      throwRule: 'beat-3-or-7',
      throwTimeSec: 207.85,
      delayDivision: 'dotted-eighth',
      captureLengthBeats: 0.75,
      drySongHoldBeats: 1.75,
      sendLevel: 0.62,
      wetLevel: 0.72,
      feedback: 0.96,
      repeatBuild: 0.53,
      toneHz: 5200,
      tailLengthSec: 7.2,
      effectiveTailLengthSec: 7.2,
      blendReverbLevel: 0.72,
      blendReverbLengthSec: 7.6,
    }
    const out = parseProjectTransition(
      recipe({ type: 'echo', echo, nextSongDelay: { ...delay, measuredFrom: 'echo-stop' } }),
    ) as ProjectTransitionRecipe
    expect(out.transition.type).toBe('echo')
    if (out.transition.type !== 'echo') throw new Error('narrowing')
    expect(out.transition.echo).toEqual(echo)
  })
})

describe('a half-valid ending is rejected, not half-applied', () => {
  it('rejects a type whose parameter block is missing', () => {
    expect(parseProjectTransition(recipe({ type: 'cut', nextSongDelay: delay }))).toBeNull()
    expect(parseProjectTransition(recipe({ type: 'hit', nextSongDelay: delay }))).toBeNull()
    expect(parseProjectTransition(recipe({ type: 'fade', nextSongDelay: delay }))).toBeNull()
  })

  it('rejects out-of-range parameters rather than clamping them', () => {
    // Clamping would silently give a different ending than the one authored.
    expect(
      parseProjectTransition(recipe({ type: 'cut', cut: { softnessMs: 9000 }, nextSongDelay: delay })),
    ).toBeNull()
    expect(
      parseProjectTransition(
        recipe({ type: 'hit', hit: { kickLevel: 5, crashLevel: 0.5, softnessMs: 24 }, nextSongDelay: delay }),
      ),
    ).toBeNull()
    expect(
      parseProjectTransition(recipe({ type: 'fade', fade: { bars: 0 }, nextSongDelay: delay })),
    ).toBeNull()
  })

  it('still rejects an unknown ending type', () => {
    expect(
      parseProjectTransition(recipe({ type: 'teleport', nextSongDelay: delay })),
    ).toBeNull()
  })
})

describe('the spoken end warning', () => {
  const withWarn = (endWarning: unknown) =>
    parseProjectTransition(
      recipe({ type: 'cut', cut: { softnessMs: 24 }, nextSongDelay: delay, endWarning }),
    ) as ProjectTransitionRecipe | null

  it('survives, with its lead in bars', () => {
    const out = withWarn({ text: 'ending', leadBars: 2 })
    expect(out?.transition.endWarning).toEqual({ text: 'ending', leadBars: 2 })
  })

  it('is optional', () => {
    const out = parseProjectTransition(
      recipe({ type: 'cut', cut: { softnessMs: 24 }, nextSongDelay: delay }),
    ) as ProjectTransitionRecipe
    expect(out.transition.endWarning).toBeUndefined()
  })

  it('a bad warning is DROPPED, never costing you the ending', () => {
    // Losing a programmed ending because a cue string was malformed would be a
    // catastrophic trade. The ending is the load-bearing part.
    expect(withWarn({ text: 'x', leadBars: 999 })?.transition.type).toBe('cut')
    expect(withWarn({ text: 'x', leadBars: 999 })?.transition.endWarning).toBeUndefined()
    expect(withWarn({ leadBars: 2 })?.transition.endWarning).toBeUndefined()
  })

  it('caps runaway text rather than rejecting it', () => {
    const out = withWarn({ text: 'x'.repeat(400), leadBars: 1 })
    expect(out?.transition.endWarning?.text.length).toBe(120)
  })
})
