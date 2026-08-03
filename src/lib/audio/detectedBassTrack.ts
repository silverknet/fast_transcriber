/**
 * The DETECTED bass as a live MIDI instrument — the machine's twin.
 *
 * BarBro Bass rendered a WAV while the bass machine played MIDI, so changing
 * its sound meant waiting for a full re-render instead of hearing the change
 * immediately. Same notes, same voice code, same part builder as the machine;
 * only the source of the notes differs (detected from the stem, rather than
 * generated from the chords).
 */
import { bassTrackLayout, buildBassPart, type BassPart } from './bassPart'
import { createBassMidiInstrument, type BassMidiInstrument } from './bassMidiInstrument'
import { measureBassNormalizeGain } from './bassNormalizeGain'
import { normalizeBassTone } from './bassTone'
import { detectedBassEvents } from './renderBassTrack'
import type { SongMap } from '$lib/songmap/types'

/** What BarBro Bass should play, or null when there is nothing detected. */
export function detectedBassPart(sm: SongMap, transposeSemitones = 0): BassPart | null {
  const bm = sm.bassMidi
  if (!bm || bm.events.length === 0) return null
  const layout = bassTrackLayout(sm)
  if (!layout) return null
  // NOTE: transpose is applied inside `detectedBassEvents`, so it is NOT
  // passed on to `buildBassPart` as well — doing both would shift twice.
  const events = detectedBassEvents(sm, { transposeSemitones })
  if (events.length === 0) return null
  return buildBassPart(events, layout, 0)
}

/** A live instrument for the detected bass, or null when there is nothing to play. */
export async function createDetectedBassInstrument(
  ctx: BaseAudioContext,
  sm: SongMap,
  transposeSemitones = 0,
): Promise<BassMidiInstrument | null> {
  const part = detectedBassPart(sm, transposeSemitones)
  if (!part || part.notes.length === 0) return null
  const bm = sm.bassMidi
  const tone = normalizeBassTone(bm?.tone)
  return createBassMidiInstrument(ctx, {
    part,
    tone,
    soundId: bm?.sound,
    normalizeGain: await measureBassNormalizeGain(part, tone, bm?.sound),
  })
}

/**
 * Push new settings into the live instrument. False means the lane should go
 * away (nothing detected any more), matching the machine's contract.
 */
export async function updateDetectedBassInstrument(
  inst: BassMidiInstrument,
  sm: SongMap,
  transposeSemitones = 0,
): Promise<boolean> {
  const part = detectedBassPart(sm, transposeSemitones)
  if (!part || part.notes.length === 0) return false
  const bm = sm.bassMidi
  const tone = normalizeBassTone(bm?.tone)
  await inst.setSound(tone, bm?.sound)
  inst.setPart(part)
  inst.setNormalizeGain(await measureBassNormalizeGain(part, tone, bm?.sound))
  return true
}
