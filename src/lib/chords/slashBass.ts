import type { Accidental, ChordSymbol, NoteName } from '$lib/songmap/types'
import { formatChordSymbol } from './formatChordSymbol'

/** Strip slash bass and refresh `displayRaw`. */
export function chordWithoutBass(chord: ChordSymbol, preferFlats: boolean): ChordSymbol {
  const c: ChordSymbol = {
    ...chord,
    bass: undefined,
    bassAccidental: undefined,
    displayRaw: '',
  }
  c.displayRaw = formatChordSymbol(c, { preferFlats })
  return c
}

/** Set slash bass (e.g. C + G → C/G) and refresh `displayRaw`. */
export function withSlashBass(
  chord: ChordSymbol,
  bass: NoteName,
  bassAccidental: Accidental | undefined,
  preferFlats: boolean,
): ChordSymbol {
  const c: ChordSymbol = {
    ...chord,
    bass,
    bassAccidental,
    displayRaw: '',
  }
  c.displayRaw = formatChordSymbol(c, { preferFlats })
  return c
}
