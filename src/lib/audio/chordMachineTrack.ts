/**
 * Composing the chords and arp lanes: Chords-tab settings → part → instrument.
 *
 * Mirrors `drumMachineTrack.ts` / `bassMachineTrack.ts`, with one deliberate
 * difference: these voices have NO `.smap` settings of their own. They read
 * `chordJam` — the same knobs the Chords tab uses — so a player sets the sound
 * once and both surfaces agree. That is what "the ones we have in the chord
 * tab" means; a second copy of the settings would just be another thing to
 * drift.
 */
import { chordJam } from './chordJam.svelte'
import { buildArpPart, buildKeysPart, chordTrackLayout, type ChordPart } from './chordMachinePart'
import { createKeysMidiInstrument, type KeysMidiInstrument } from './keysMidiInstrument'
import type { SongMap } from '$lib/songmap/types'

export type ChordMachineVoice = 'keys' | 'arp'

/** The part a voice should play, or null when there is nothing to play. */
export function chordMachinePart(
  sm: SongMap,
  voice: ChordMachineVoice,
  transposeSemitones = 0,
): ChordPart | null {
  const layout = chordTrackLayout(sm)
  if (!layout) return null
  return voice === 'keys'
    ? buildKeysPart(sm, chordJam.keysOctave, layout, transposeSemitones)
    : buildArpPart(
        sm,
        {
          octave: chordJam.arpOctave,
          rate: chordJam.arpRate,
          direction: chordJam.arpDirection,
          octaves: chordJam.arpOctaves,
          swing: chordJam.arpSwing,
        },
        layout,
        transposeSemitones,
      )
}

const patchFor = (voice: ChordMachineVoice) =>
  voice === 'keys' ? chordJam.keysPatch : chordJam.arpPatch
const volumeFor = (voice: ChordMachineVoice) =>
  voice === 'keys' ? chordJam.keysVolume : chordJam.arpVolume

export function createChordMachineInstrument(
  ctx: BaseAudioContext,
  sm: SongMap,
  voice: ChordMachineVoice,
  transposeSemitones = 0,
): KeysMidiInstrument | null {
  const part = chordMachinePart(sm, voice, transposeSemitones)
  if (!part || part.notes.length === 0) return null
  return createKeysMidiInstrument(ctx, {
    part,
    patch: patchFor(voice),
    volume: volumeFor(voice),
  })
}

/**
 * Push new settings into a live instrument. Returns false when the lane should
 * disappear instead, so the caller can drop it.
 */
export function updateChordMachineInstrument(
  inst: KeysMidiInstrument,
  sm: SongMap,
  voice: ChordMachineVoice,
  transposeSemitones = 0,
): boolean {
  const part = chordMachinePart(sm, voice, transposeSemitones)
  if (!part || part.notes.length === 0) return false
  inst.setPart(part)
  inst.setPatch(patchFor(voice))
  inst.setVolume(volumeFor(voice))
  return true
}
