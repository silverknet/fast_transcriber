/**
 * Composing the drum machine's live track: settings → part → instrument.
 *
 * Kept out of `MixerView` so the mixer only has to say "make me an instrument",
 * and kept in one place so the LIVE path and the WAV export path derive their
 * events from the same two calls — `generateDrumGroove` + `drumTrackLayout`.
 * That shared derivation is what stops the two drifting apart.
 */
import { generateDrumGroove } from '$lib/songmap/generateDrumGroove'
import { buildDrumPart, drumTrackLayout, type DrumPart } from './drumPart'
import { createDrumMidiInstrument, type DrumMidiInstrument } from './drumMidiInstrument'
import { measureDrumNormalizeGain } from './drumNormalizeGain'
import type { DrumKit } from './drumKits'
import type { SongMap } from '$lib/songmap/types'

/**
 * The part the drum machine should play, or null when the song can't carry one
 * (no track, disabled, or no usable trim/grid yet).
 */
export function drumMachinePart(sm: SongMap): DrumPart | null {
  const machine = sm.drumMachine
  if (!machine?.enabled) return null
  const layout = drumTrackLayout(sm)
  if (!layout) return null
  return buildDrumPart(generateDrumGroove(sm, machine), layout)
}

/**
 * Build the live instrument. Null when there's nothing to play — the caller
 * simply doesn't add a lane, exactly as the render path returned no blob.
 */
export async function createDrumMachineInstrument(
  ctx: BaseAudioContext,
  sm: SongMap,
  kit: DrumKit,
): Promise<DrumMidiInstrument | null> {
  const part = drumMachinePart(sm)
  if (!part || part.hits.length === 0) return null
  return createDrumMidiInstrument(ctx, {
    part,
    kit,
    normalizeGain: measureDrumNormalizeGain(part, kit),
  })
}

/**
 * Push new settings into a live instrument — the instant-change path. Returns
 * false when the track should disappear instead (disabled or now unplayable),
 * so the caller can drop the lane.
 */
export function updateDrumMachineInstrument(
  inst: DrumMidiInstrument,
  sm: SongMap,
  kit: DrumKit,
): boolean {
  const part = drumMachinePart(sm)
  if (!part || part.hits.length === 0) return false
  inst.setKit(kit)
  inst.setPart(part)
  // The level target depends on the part AND the kit, so it moves with either.
  inst.setNormalizeGain(measureDrumNormalizeGain(part, kit))
  return true
}
