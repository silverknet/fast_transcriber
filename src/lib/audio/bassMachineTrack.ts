/**
 * Composing the bass machine's live track: settings → part → instrument.
 *
 * Mirrors `drumMachineTrack.ts`, and for the same reason: the LIVE path and the
 * WAV export path both derive from `generateBassGroove` + the shared track
 * layout, so they cannot drift.
 */
import { generateBassGroove } from '$lib/songmap/generateBassGroove'
import { bassTrackLayout, buildBassPart, type BassPart } from './bassPart'
import { createBassMidiInstrument, type BassMidiInstrument } from './bassMidiInstrument'
import { measureBassNormalizeGain } from './bassNormalizeGain'
import { normalizeBassTone } from './bassTone'
import type { SongMap } from '$lib/songmap/types'

/** The part the bass machine should play, or null when there's nothing to play. */
export function bassMachinePart(sm: SongMap, transposeSemitones = 0): BassPart | null {
  const machine = sm.bassMachine
  if (!machine?.enabled) return null
  const layout = bassTrackLayout(sm)
  if (!layout) return null
  return buildBassPart(generateBassGroove(sm, machine), layout, transposeSemitones)
}

export async function createBassMachineInstrument(
  ctx: BaseAudioContext,
  sm: SongMap,
  transposeSemitones = 0,
): Promise<BassMidiInstrument | null> {
  const machine = sm.bassMachine
  const part = bassMachinePart(sm, transposeSemitones)
  if (!machine || !part || part.notes.length === 0) return null
  const tone = normalizeBassTone(machine.tone)
  return createBassMidiInstrument(ctx, {
    part,
    tone,
    soundId: machine.sound,
    normalizeGain: await measureBassNormalizeGain(part, tone, machine.sound),
  })
}

/**
 * Push new settings into a live instrument. Returns false when the track should
 * disappear instead, so the caller can drop the lane.
 */
export async function updateBassMachineInstrument(
  inst: BassMidiInstrument,
  sm: SongMap,
  transposeSemitones = 0,
): Promise<boolean> {
  const machine = sm.bassMachine
  const part = bassMachinePart(sm, transposeSemitones)
  if (!machine || !part || part.notes.length === 0) return false
  const tone = normalizeBassTone(machine.tone)
  await inst.setSound(tone, machine.sound)
  inst.setPart(part)
  inst.setNormalizeGain(await measureBassNormalizeGain(part, tone, machine.sound))
  return true
}
