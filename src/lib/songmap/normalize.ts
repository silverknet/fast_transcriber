import type { Bar, Beat } from './types'

/** Sort bars by `index` ascending (stable for already-sorted lists). */
export function sortBarsByIndex(bars: Bar[]): Bar[] {
  return [...bars].sort((a, b) => a.index - b.index)
}

/** Sort beats by `timeSec`, then `id`. */
export function sortBeatsByTime(beats: Beat[]): Beat[] {
  return [...beats].sort((a, b) => a.timeSec - b.timeSec || a.id.localeCompare(b.id))
}
