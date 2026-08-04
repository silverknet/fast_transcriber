/**
 * WHAT A MIXER SESSION IS ALLOWED TO ERASE FROM A SONG.
 *
 * `mixState.tracks` is rewritten from the lanes the engine currently holds. A
 * lane that is not in the engine this session therefore vanished from the song
 * — its fader, its EQ and, worst of all, its live-button link.
 *
 * That is not hypothetical, because whether a GENERATED lane exists is a
 * per-browser localStorage flag (`barbro::mixer::chordLane`,
 * `barbro::mixer::arpLane`) rather than a property of the song. Link the Chords
 * lane to Custom 1 on one laptop; open the song anywhere the lane was not
 * built; touch any fader. The debounced save rewrites `mixState` from the
 * lanes that exist, the chord entry is not among them, and the link is gone.
 * The Custom 1 button goes dead again with nothing on screen to say why.
 *
 * The rule: a lane this session did not BUILD is not a lane this session may
 * ERASE. Present lanes are written from live engine state; absent ones are
 * carried through untouched.
 */

/** The stored shape, structurally — this module only needs the key. */
type TrackEntry = { key: string }

/**
 * Merge the tracks this session actually has with the ones it never saw.
 *
 * `present` wins for any key in both: it is the live engine state, which is by
 * definition newer than what was on disk.
 */
export function mergePersistedTracks<T extends TrackEntry>(
  present: readonly T[],
  stored: readonly T[] | undefined,
): T[] {
  const have = new Set(present.map((t) => t.key))
  return [...present, ...(stored ?? []).filter((t) => !have.has(t.key))]
}
