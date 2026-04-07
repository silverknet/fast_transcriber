import type { CueSettings, Meter, SongMetadata } from './types'

export const DEFAULT_METER: Meter = { numerator: 4, denominator: 4 }

export function defaultCueSettings(): CueSettings {
  return {
    mode: 'off',
    countInBeats: 4,
    useSectionLabels: true,
  }
}

export function emptySongMetadata(nowIso: string): SongMetadata {
  return {
    title: 'Untitled',
    createdAt: nowIso,
    updatedAt: nowIso,
  }
}
