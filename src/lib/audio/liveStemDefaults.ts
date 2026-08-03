import type { AutoStemName } from '$lib/project/types'

/**
 * Live-mode stem audibility: which mixer lanes start unmuted when a song loads
 * on stage. The project picks a set of "standard" stems (`ProjectDefaults.liveStems`)
 * and EVERY song applies it on load, overriding whatever mute/solo state that
 * song happens to remember — so a whole set opens from one backing-track config.
 *
 * This is the pure decision layer; `MixerView` seeds each lane's initial `muted`
 * from it (see `initialMutedFor`). Lane keys arrive in two schemes: disk
 * `stem:drums.wav` and Collab cloud `stem:Drums`.
 */

/**
 * Legacy default when a project has never configured `liveStems`: every Demucs
 * stem audible EXCEPT vocals. Preserves the behavior that shipped before this
 * setting existed.
 */
export const LEGACY_LIVE_STEMS: readonly AutoStemName[] = ['drums', 'bass', 'other']

/** Is this mixer lane a separated-stem lane? */
export function isStemLaneKey(key: string): boolean {
  return key.startsWith('stem:')
}

/**
 * Map a stem lane key to its Demucs slot, across both naming schemes. Returns
 * `null` for non-stem lanes and for ad-hoc stem files that aren't one of the
 * four Demucs slots (e.g. a hand-added `stem:guitar.wav`).
 */
export function stemNameForKey(key: string): AutoStemName | null {
  if (!isStemLaneKey(key)) return null
  const rest = key.slice('stem:'.length).toLowerCase()
  if (/vocal/.test(rest)) return 'vocals'
  if (/drum/.test(rest)) return 'drums'
  if (/bass/.test(rest)) return 'bass'
  if (/other/.test(rest)) return 'other'
  return null
}

/** The effective audible-stem set: the project config, or the legacy default. */
export function audibleStemSet(liveStems: readonly AutoStemName[] | undefined): readonly AutoStemName[] {
  return liveStems ?? LEGACY_LIVE_STEMS
}

/**
 * Should this stem lane be AUDIBLE (unmuted) on live load, given the project
 * config? Ad-hoc stems outside the four Demucs slots (name `null`) follow the
 * legacy rule — audible unless the filename reads as a vocal — so a custom stem
 * is never silently dropped by a config that can't name it.
 */
export function isStemLaneAudible(key: string, liveStems: readonly AutoStemName[] | undefined): boolean {
  const name = stemNameForKey(key)
  if (name === null) return !/vocal/i.test(key)
  return audibleStemSet(liveStems).includes(name)
}

/**
 * Does the song have at least one stem lane the config marks audible? When
 * false, the caller keeps the full `original` mix audible so a song that lacks
 * the selected stems is never silent on stage.
 */
export function hasAudibleStemLane(
  laneKeys: readonly string[],
  liveStems: readonly AutoStemName[] | undefined,
): boolean {
  return laneKeys.some((k) => isStemLaneKey(k) && isStemLaneAudible(k, liveStems))
}
