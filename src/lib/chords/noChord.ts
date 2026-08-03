import type { ChordSymbol } from '$lib/songmap/types'

/**
 * The canonical **N.C.** ("no chord") symbol — a real, PLACED harmony event
 * that acts like a chord: it renders as `N.C.`, it stretches to the next
 * chord, and by being a real event it stops the previous chord's stretch.
 *
 * This is intentionally NOT the same as deleting/clearing a chord: clearing
 * removes the event so the previous chord stretches OVER the spot, which is
 * musically different from explicitly declaring "no chord here".
 *
 * `root: 'C'` is a placeholder that satisfies `validateChordSymbol` (a valid
 * `NoteName`) but is never used — every consumer checks `noChord` first
 * (`formatChordSymbol` prints `N.C.`, `transposeChord` returns it unchanged).
 *
 * Treat it as immutable; callers that store it should spread a fresh copy.
 */
export const NO_CHORD_SYMBOL: ChordSymbol = {
  root: 'C',
  noChord: true,
  displayRaw: 'N.C.',
}

/** True when a chord symbol is the N.C. ("no chord") marker. */
export function isNoChord(chord: ChordSymbol | null | undefined): boolean {
  return !!chord?.noChord
}
