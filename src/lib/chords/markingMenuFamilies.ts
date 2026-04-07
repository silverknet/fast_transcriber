/**
 * Key-aware harmonic families for ChordMarkingMenu.
 * Family order matches sector indices 0..5 from markingMenuGeometry.familySectorIndex6.
 */

import type { ChordSymbol, SongKey } from '$lib/songmap/types'
import {
  diatonicChordVariationsForDegree,
  diatonicDegreeRomanLabel,
  diatonicTriadsInKey,
  songKeyPreferFlats,
} from './diatonic'
import { formatChordSymbol } from './formatChordSymbol'
import { chordRootToPitchClass, pitchClassToRootAcc, transposePitchClass } from './pitchClass'
import { dominantSeventhOfChordRoot, tritoneSubOfDominantSeventh } from './secondaryDominant'

export type MarkingMenuAction = 'clear' | 'search'

export type MarkingMenuItem = {
  id: string
  label: string
  chord?: ChordSymbol
  action?: MarkingMenuAction
}

export type MarkingMenuFamilyId =
  | 'tonic'
  | 'special'
  | 'subdominant'
  | 'dominant'
  | 'borrowed'
  | 'secondary_dominant'

export type MarkingMenuFamily = {
  id: MarkingMenuFamilyId
  label: string
  items: MarkingMenuItem[]
}

function withQualityClone(base: ChordSymbol, quality: string, preferFlats: boolean): ChordSymbol {
  const c: ChordSymbol = {
    root: base.root,
    accidental: base.accidental,
    quality,
    extensions: undefined,
    bass: undefined,
    bassAccidental: undefined,
    displayRaw: '',
  }
  c.displayRaw = formatChordSymbol(c, { preferFlats })
  return c
}

function majorTriadFromPc(pc: number, preferFlats: boolean): ChordSymbol {
  const { root, accidental } = pitchClassToRootAcc(pc, preferFlats)
  const c: ChordSymbol = { root, accidental, quality: 'major', displayRaw: '' }
  c.displayRaw = formatChordSymbol(c, { preferFlats })
  return c
}

function minorTriadFromPc(pc: number, preferFlats: boolean): ChordSymbol {
  const { root, accidental } = pitchClassToRootAcc(pc, preferFlats)
  const c: ChordSymbol = { root, accidental, quality: 'minor', displayRaw: '' }
  c.displayRaw = formatChordSymbol(c, { preferFlats })
  return c
}

/**
 * Six families in **sector order**: [tonic, special, subdominant, dominant, borrowed, secondary_dominant].
 */
export function buildMarkingMenuFamilies(key: SongKey): MarkingMenuFamily[] {
  const pf = songKeyPreferFlats(key)
  const t = diatonicTriadsInKey(key, pf)
  const I = t[0]!
  const ii = t[1]!
  const iii = t[2]!
  const IV = t[3]!
  const V = t[4]!
  const vi = t[5]!
  const vii = t[6]!

  const V7 = dominantSeventhOfChordRoot(I, pf)
  const tritoneSub = tritoneSubOfDominantSeventh(V7, pf)

  const tonicItems: MarkingMenuItem[] = [
    { id: 'to-0', label: diatonicDegreeRomanLabel(key, 0), chord: I },
    { id: 'to-5', label: diatonicDegreeRomanLabel(key, 5), chord: vi },
    { id: 'to-2', label: diatonicDegreeRomanLabel(key, 2), chord: iii },
  ]

  const specialItems: MarkingMenuItem[] = [
    { id: 'sp-clear', label: 'Clear', action: 'clear' },
    { id: 'sp-more', label: '…', action: 'search' },
  ]

  const iiVars = diatonicChordVariationsForDegree(key, 1, pf)
  const ii7 = iiVars.find((c) => c.quality === 'min7') ?? iiVars[1]

  const subdominantItems: MarkingMenuItem[] = [
    { id: 'sd-iv', label: diatonicDegreeRomanLabel(key, 3), chord: IV },
    { id: 'sd-ii', label: diatonicDegreeRomanLabel(key, 1), chord: ii },
    ...(ii7 && ii7 !== ii
      ? [{ id: 'sd-ii7', label: `${diatonicDegreeRomanLabel(key, 1)}7`, chord: ii7 }]
      : []),
  ]

  const dominantItems: MarkingMenuItem[] = [
    { id: 'dm-v', label: diatonicDegreeRomanLabel(key, 4), chord: V },
    { id: 'dm-v7', label: 'V7', chord: V7 },
    { id: 'dm-vii', label: diatonicDegreeRomanLabel(key, 6), chord: vii },
    { id: 'dm-sub', label: 'subV', chord: tritoneSub },
  ]

  const tonicPc = chordRootToPitchClass(I.root, I.accidental)
  const bVIpc = transposePitchClass(tonicPc, 8)
  const bVIIpc = transposePitchClass(tonicPc, 10)
  const IVpc = chordRootToPitchClass(IV.root, IV.accidental)

  const borrowedItems: MarkingMenuItem[] =
    key.mode === 'major'
      ? [
          { id: 'br-iv', label: 'iv', chord: minorTriadFromPc(IVpc, pf) },
          { id: 'br-b7', label: '♭VII', chord: majorTriadFromPc(bVIIpc, pf) },
          { id: 'br-b6', label: '♭VI', chord: majorTriadFromPc(bVIpc, pf) },
        ]
      : [
          { id: 'br-iv', label: 'iv', chord: IV },
          { id: 'br-IV', label: 'IV', chord: withQualityClone(IV, 'major', pf) },
          { id: 'br-b6', label: '♭VI', chord: majorTriadFromPc(bVIpc, pf) },
        ]

  const secondaryItems: MarkingMenuItem[] = [
    { id: 'sx-vv', label: 'V/V', chord: dominantSeventhOfChordRoot(V, pf) },
    { id: 'sx-vvi', label: 'V/vi', chord: dominantSeventhOfChordRoot(vi, pf) },
    { id: 'sx-vii', label: 'V/ii', chord: dominantSeventhOfChordRoot(ii, pf) },
    { id: 'sx-viv', label: 'V/IV', chord: dominantSeventhOfChordRoot(IV, pf) },
  ]

  return [
    { id: 'tonic', label: 'Tonic', items: tonicItems },
    { id: 'special', label: 'More', items: specialItems },
    { id: 'subdominant', label: 'Pre‑V', items: subdominantItems },
    { id: 'dominant', label: 'Dom', items: dominantItems },
    { id: 'borrowed', label: 'Borrow', items: borrowedItems },
    { id: 'secondary_dominant', label: 'V/x', items: secondaryItems },
  ]
}
