/**
 * Bridge from a SongMap's cue track to the per-section lead-in specs the live
 * dynamic-cue engine renders. Mirrors the edit page's `cueSectionRegions`
 * resolution (a section has a spoken-name cue and/or a count-in when the track
 * carries enabled generated events for it) so what you toggle in the Cue tab is
 * exactly what fires when you launch that section live.
 */
import type { SectionCueSpec } from '$lib/audio/sectionCueClips'
import { getPrimaryCueTrack } from '$lib/songmap/cueTracks'
import type { CueTrack, SongMap } from '$lib/songmap/types'

export function sectionCueSpecsFromSongMap(
  sm: SongMap,
  track: CueTrack | undefined = getPrimaryCueTrack(sm),
): SectionCueSpec[] {
  if (!sm.sections?.length || !sm.timeline.bars.length) return []
  const barByIndex = new Map(sm.timeline.bars.map((b) => [b.index, b]))
  const events = track?.events ?? []
  const specs: SectionCueSpec[] = []

  for (const s of sm.sections) {
    const startBar = barByIndex.get(s.barRange.startBarIndex)
    if (!startBar) continue

    const speechEvent = events.find(
      (e) => e.kind === 'section' && e.generatedSource?.sectionId === s.id && e.enabled,
    )
    const countEvents = events.filter(
      (e) => e.kind === 'count' && e.generatedSource?.sectionId === s.id && e.enabled,
    )
    const speechOn = !!speechEvent
    const countOn = countEvents.length > 0
    if (!speechOn && !countOn) continue

    // Count-in numbers land on the beats of the bar BEFORE the section, so take
    // that bar's tempo when it exists (falls back to the section's own bar).
    const leadBar = barByIndex.get(s.barRange.startBarIndex - 1) ?? startBar
    const beatDurationSec =
      leadBar.beatCount > 0 ? (leadBar.endSec - leadBar.startSec) / leadBar.beatCount : 0.5

    specs.push({
      sectionId: s.id,
      speechText: speechOn ? speechEvent!.text || s.label : undefined,
      countInBeats: countOn ? countEvents.length : undefined,
      beatDurationSec,
    })
  }

  return specs
}
