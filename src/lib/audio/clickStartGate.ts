/**
 * MAY A SONG START RIGHT NOW? — the live click gate, as a pure rule.
 *
 * Born from a measured failure: on a cold song open, play began while lanes
 * were still loading and the click lane joined TEN SECONDS late — ten seconds
 * of clickless song at a rehearsal. In live, a song with a grid must not
 * start without its click track registered.
 *
 * The rule, not the plumbing: `MixerView` parks the refused start and fires
 * it the moment the click registers. Two deliberate releases:
 *  - no grid → nothing to click, start freely (editor too)
 *  - click build FAILED → start allowed, red line showing why. A broken click
 *    must never lock a song out of a show.
 */
export function mayStartSong(s: {
  liveMode: boolean
  songHasGrid: boolean
  clickLaneReady: boolean
  /** Non-null when the click render failed loudly. */
  clickBuildError: string | null
}): boolean {
  if (!s.liveMode) return true
  if (!s.songHasGrid) return true
  return s.clickLaneReady || s.clickBuildError !== null
}
