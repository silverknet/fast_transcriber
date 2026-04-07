import type { Bar, Beat } from '$lib/songmap/types'

export type TimelineLayer = 'waveform' | 'beats' | 'bars' | 'markers'

/**
 * Result shape for beat/bar detection — same logical types as SongMap timeline.
 * Merge into a `SongMap` with `mergeAnalysisIntoSongMap` (client-side).
 */
export type AnalysisResult = {
  beats: Beat[]
  bars: Bar[]
}
