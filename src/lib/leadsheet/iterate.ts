import type { Bar, Beat, HarmonyEvent, SongMap } from '$lib/songmap'

export function harmonyByBarId(songMap: SongMap): Map<string, HarmonyEvent[]> {
  const map = new Map<string, HarmonyEvent[]>()
  for (const h of songMap.harmony) {
    const list = map.get(h.barId) ?? []
    list.push(h)
    map.set(h.barId, list)
  }
  return map
}

export function beatById(songMap: SongMap): Map<string, Beat> {
  return new Map(songMap.timeline.beats.map((b) => [b.id, b]))
}

export function harmonyBeatOffset(h: HarmonyEvent, beats: Map<string, Beat>): number {
  if (h.beatAnchor) return Math.max(0, h.beatAnchor.indexInBar)
  if (h.beatId) return Math.max(0, beats.get(h.beatId)?.indexInBar ?? 0)
  return 0
}

export function sectionAtBar(songMap: SongMap, barIndex: number): string | null {
  const s = songMap.sections.find((sec) => sec.barRange.startBarIndex === barIndex)
  return s ? s.label || s.kind : null
}

/**
 * Group sorted bars into systems (rows on a lead sheet). Returns `[]` for an
 * empty song. Last system may contain fewer than `barsPerSystem` bars.
 */
export function barsBySystem(songMap: SongMap, barsPerSystem = 4): Bar[][] {
  const sorted = [...songMap.timeline.bars].sort((a, b) => a.index - b.index)
  const rows: Bar[][] = []
  for (let i = 0; i < sorted.length; i += barsPerSystem) {
    rows.push(sorted.slice(i, i + barsPerSystem))
  }
  return rows
}
