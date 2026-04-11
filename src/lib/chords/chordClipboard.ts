import type { Accidental, ChordSymbol, NoteName } from '$lib/songmap/types'

export const CHORD_CLIPBOARD_KIND = 'fast-transcriber-chords/v1' as const

export type ChordClipboardPayload = {
  kind: typeof CHORD_CLIPBOARD_KIND
  chords: (ChordSymbol | null)[]
}

const NOTES: NoteName[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

function isNoteName(x: unknown): x is NoteName {
  return typeof x === 'string' && (NOTES as string[]).includes(x)
}

function isAccidental(x: unknown): x is Accidental {
  return x === 'sharp' || x === 'flat' || x === 'natural'
}

function parseChordSymbol(raw: unknown): ChordSymbol | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!isNoteName(o.root)) return null
  if (typeof o.displayRaw !== 'string') return null
  const chord: ChordSymbol = {
    root: o.root,
    displayRaw: o.displayRaw,
  }
  if (o.accidental !== undefined) {
    if (!isAccidental(o.accidental)) return null
    chord.accidental = o.accidental
  }
  if (o.quality !== undefined) {
    if (typeof o.quality !== 'string') return null
    chord.quality = o.quality
  }
  if (o.extensions !== undefined) {
    if (!Array.isArray(o.extensions) || !o.extensions.every((x) => typeof x === 'string')) return null
    chord.extensions = o.extensions as string[]
  }
  if (o.bass !== undefined) {
    if (!isNoteName(o.bass)) return null
    chord.bass = o.bass
  }
  if (o.bassAccidental !== undefined) {
    if (!isAccidental(o.bassAccidental)) return null
    chord.bassAccidental = o.bassAccidental
  }
  return chord
}

export function serializeChordClipboard(chords: (ChordSymbol | null)[]): string {
  const payload: ChordClipboardPayload = { kind: CHORD_CLIPBOARD_KIND, chords }
  return JSON.stringify(payload)
}

/** Returns parsed chord row, or null if text is not our clipboard format. */
export function parseChordClipboard(text: string): (ChordSymbol | null)[] | null {
  try {
    const o = JSON.parse(text) as unknown
    if (!o || typeof o !== 'object') return null
    const rec = o as Record<string, unknown>
    if (rec.kind !== CHORD_CLIPBOARD_KIND) return null
    if (!Array.isArray(rec.chords)) return null
    const out: (ChordSymbol | null)[] = []
    for (const cell of rec.chords) {
      if (cell === null) {
        out.push(null)
        continue
      }
      const c = parseChordSymbol(cell)
      if (!c) return null
      out.push(c)
    }
    return out
  } catch {
    return null
  }
}
