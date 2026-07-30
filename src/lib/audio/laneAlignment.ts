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
 * If you add a lane whose loader calls one of the `render*WavBlob` helpers,
 * its key belongs here. `laneAlignment.test.ts` is the reminder.
 */
export const PREBAKED_PREAMBLE_LANE_KEYS: ReadonlySet<string> = new Set([
  'cue',
  'click',
  'drums-gen',
  'bass-gen',
  'drum-machine',
  'bass-machine',
])

/** True when the lane's buffer already starts at the shared musical t=0. */
export function laneHasPrebakedPreamble(key: string): boolean {
  return PREBAKED_PREAMBLE_LANE_KEYS.has(key)
}
