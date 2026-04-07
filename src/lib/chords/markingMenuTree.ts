import {
  chordWithoutBass,
  dominantSeventhOfChordRoot,
  tritoneSubOfDominantSeventh,
} from '$lib/chords'
import { diatonicTriadsInKey, songKeyPreferFlats } from '$lib/chords/diatonic'
import { formatChordSymbol } from '$lib/chords/formatChordSymbol'
import type { ChordSymbol, SongKey } from '$lib/songmap/types'

export type RadialMenuNodeAction = 'commit' | 'branch' | 'search' | 'clear'

export type RadialMenuNode = {
  id: string
  label: string
  shortLabel?: string
  action: RadialMenuNodeAction
  chord?: ChordSymbol
  children?: RadialMenuNode[]
  weight?: number
}

function dedupeByLabel(nodes: RadialMenuNode[], preferFlats: boolean): RadialMenuNode[] {
  const seen = new Set<string>()
  const result: RadialMenuNode[] = []

  for (const node of nodes) {
    const key =
      node.chord != null
        ? formatChordSymbol(node.chord, { preferFlats })
        : `${node.action}:${node.label}`

    if (seen.has(key)) continue
    seen.add(key)
    result.push(node)
  }

  return result
}

function chordNode(
  id: string,
  chord: ChordSymbol,
  preferFlats: boolean,
  weight = 0,
  shortLabel?: string,
): RadialMenuNode {
  return {
    id,
    label: formatChordSymbol(chord, { preferFlats }),
    shortLabel,
    action: 'commit',
    chord,
    weight,
  }
}

function branchNode(
  id: string,
  label: string,
  children: RadialMenuNode[],
  weight = 0,
  shortLabel?: string,
): RadialMenuNode {
  return {
    id,
    label,
    shortLabel,
    action: 'branch',
    children,
    weight,
  }
}

export function buildChordMarkingTree(songKey: SongKey): RadialMenuNode {
  const preferFlats = songKeyPreferFlats(songKey)
  const triads = diatonicTriadsInKey(songKey, preferFlats)

  const tonic = chordWithoutBass(triads[0]!, preferFlats)
  const supertonic = chordWithoutBass(triads[1]!, preferFlats)
  const mediant = chordWithoutBass(triads[2]!, preferFlats)
  const subdominant = chordWithoutBass(triads[3]!, preferFlats)
  const dominant = chordWithoutBass(triads[4]!, preferFlats)
  const submediant = chordWithoutBass(triads[5]!, preferFlats)
  const leading = chordWithoutBass(triads[6]!, preferFlats)

  const V7 = dominantSeventhOfChordRoot(dominant, preferFlats)
  const V7ofii = dominantSeventhOfChordRoot(supertonic, preferFlats)
  const V7ofiii = dominantSeventhOfChordRoot(mediant, preferFlats)
  const V7ofIV = dominantSeventhOfChordRoot(subdominant, preferFlats)
  const V7ofV = dominantSeventhOfChordRoot(dominant, preferFlats)
  const V7ofvi = dominantSeventhOfChordRoot(submediant, preferFlats)

  const tritoneV = tritoneSubOfDominantSeventh(V7, preferFlats)
  const tritoneVofV = tritoneSubOfDominantSeventh(V7ofV, preferFlats)

  const ivMinor: ChordSymbol = {
    ...subdominant,
    quality: 'minor',
    displayRaw: '',
  }
  ivMinor.displayRaw = formatChordSymbol(ivMinor, { preferFlats })

  const ivMinor6: ChordSymbol = {
    ...subdominant,
    quality: 'minor6',
    displayRaw: '',
  }
  ivMinor6.displayRaw = formatChordSymbol(ivMinor6, { preferFlats })

  const tonicFamily = dedupeByLabel(
    [
      chordNode('tonic-I', tonic, preferFlats, 100, 'I'),
      chordNode('tonic-vi', submediant, preferFlats, 90, 'vi'),
      chordNode('tonic-iii', mediant, preferFlats, 70, 'iii'),
    ],
    preferFlats,
  ).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))

  const dominantFamily = dedupeByLabel(
    [
      chordNode('dom-V', dominant, preferFlats, 100, 'V'),
      chordNode('dom-V7', V7, preferFlats, 95, 'V7'),
      chordNode('dom-vii', leading, preferFlats, 70, 'vii°'),
      chordNode('dom-sub', tritoneV, preferFlats, 50, 'sub'),
    ],
    preferFlats,
  ).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))

  const subdominantFamily = dedupeByLabel(
    [
      chordNode('sub-IV', subdominant, preferFlats, 100, 'IV'),
      chordNode('sub-ii', supertonic, preferFlats, 90, 'ii'),
    ],
    preferFlats,
  ).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))

  const secDomFamily = dedupeByLabel(
    [
      chordNode('sec-Vii', V7ofii, preferFlats, 90, 'V/ii'),
      chordNode('sec-Viii', V7ofiii, preferFlats, 60, 'V/iii'),
      chordNode('sec-VIV', V7ofIV, preferFlats, 75, 'V/IV'),
      chordNode('sec-VV', V7ofV, preferFlats, 95, 'V/V'),
      chordNode('sec-Vvi', V7ofvi, preferFlats, 85, 'V/vi'),
      chordNode('sec-subVofV', tritoneVofV, preferFlats, 40, 'sub V/V'),
    ],
    preferFlats,
  ).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))

  const borrowedFamily = dedupeByLabel(
    [
      chordNode('borrow-iv', ivMinor, preferFlats, 95, 'iv'),
      chordNode('borrow-iv6', ivMinor6, preferFlats, 80, 'iv6'),
    ],
    preferFlats,
  ).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))

  const rootChildren: RadialMenuNode[] = [
    branchNode('root-tonic', 'Tonic', tonicFamily, 100, 'T'),
    branchNode('root-dominant', 'Dominant', dominantFamily, 95, 'D'),
    branchNode('root-subdominant', 'Subdominant', subdominantFamily, 90, 'S'),
    branchNode('root-secdom', 'Secondary', secDomFamily, 75, 'Sec'),
    branchNode('root-borrowed', 'Borrowed', borrowedFamily, 65, 'Bor'),
    {
      id: 'root-search',
      label: 'Search',
      shortLabel: '...',
      action: 'search' as const,
      weight: 40,
    },
    {
      id: 'root-clear',
      label: 'No chord',
      shortLabel: 'N.C.',
      action: 'clear' as const,
      weight: 35,
    },
  ].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))

  return {
    id: 'root',
    label: 'Chord menu',
    action: 'branch',
    children: rootChildren,
  }
}

/** Ms to hover a category before drilling in (muscle memory / avoids accidental drills). */
export const RADIAL_HOVER_DRILL_MS = 240

/** Max one-tap chords on the home ring (most common by weight). */
export const RADIAL_QUICK_PICK_COUNT = 7

export type RadialHomeRingParts = {
  /** Top commit nodes from all harmonic families, deduped, sorted by weight. */
  quickPicks: RadialMenuNode[]
  /** Tonic, Dominant, … — hover or click to show their children. */
  categories: RadialMenuNode[]
  search: RadialMenuNode | undefined
  clear: RadialMenuNode | undefined
}

/**
 * Split the tree root into quick chords vs category branches vs Search/Clear.
 * Home ring = quickPicks + categories + utilities.
 */
export function buildRadialHomeRingParts(root: RadialMenuNode, preferFlats: boolean): RadialHomeRingParts {
  const children = root.children ?? []
  const commits: RadialMenuNode[] = []
  const categories: RadialMenuNode[] = []
  let search: RadialMenuNode | undefined
  let clear: RadialMenuNode | undefined

  for (const c of children) {
    if (c.action === 'search') {
      search = c
      continue
    }
    if (c.action === 'clear') {
      clear = c
      continue
    }
    if (c.action === 'branch' && c.children?.length) {
      categories.push(c)
      for (const leaf of c.children) {
        if (leaf.action === 'commit' && leaf.chord) {
          commits.push(leaf)
        }
      }
    }
  }

  const deduped = dedupeByLabel(commits, preferFlats)
  deduped.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
  const quickPicks = deduped.slice(0, RADIAL_QUICK_PICK_COUNT)

  categories.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))

  return { quickPicks, categories, search, clear }
}

/** Nodes drawn on the ring: home (quick + categories + search/clear) or a drilled category’s children. */
export function radialRingNodes(
  root: RadialMenuNode,
  preferFlats: boolean,
  drilledCategory: RadialMenuNode | null,
): RadialMenuNode[] {
  if (drilledCategory?.children?.length) {
    return drilledCategory.children
  }

  const { quickPicks, categories, search, clear } = buildRadialHomeRingParts(root, preferFlats)
  const tail: RadialMenuNode[] = []
  if (search) tail.push(search)
  if (clear) tail.push(clear)
  return [...quickPicks, ...categories, ...tail]
}
