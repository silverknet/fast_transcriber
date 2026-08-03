/**
 * Which mixer lanes already carry their own preamble silence.
 *
 * BarBro aligns tracks by PREPENDING SILENCE inside the buffer, so every
 * source shares one t=0 (see `mixerEngine.ts`). Lanes BarBro renders itself
 * — cue, click, the generated band, the drum machine — bake
 * `titleCuePreludeSec + countIn.prependSec` into the WAV at render time.
 * Prepending again would shift them by that amount a second time, which
 * sounds like the track playing at a random offset against the song.
 *
 * Recorded audio (the original mix, stems) carries no preamble, so it DOES
 * get silence prepended.
 *
 * Two kinds of lane position themselves, and both belong here:
 *   - lanes whose loader calls a `render*WavBlob` helper (the offset is baked
 *     into the WAV's samples), and
 *   - MIDI lanes, whose instrument adds the same offset when it schedules
 *     (see `drumTrackLayout`).
 *
 * `laneAlignment.test.ts` scrapes MixerView for both shapes and fails if a
 * generated lane stops being covered.
 */
export const PREBAKED_PREAMBLE_LANE_KEYS: ReadonlySet<string> = new Set([
  'cue',
  'click',
  'drums-gen',
  'bass-gen',
  'drum-machine',
  'bass-machine',
  'chord-machine',
  'arp-machine',
])

/** True when the lane's buffer already starts at the shared musical t=0. */
export function laneHasPrebakedPreamble(key: string): boolean {
  return PREBAKED_PREAMBLE_LANE_KEYS.has(key)
}
