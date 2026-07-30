/**
 * Which sources are audible given the per-stem on/off toggles, for the edit-song
 * stems dock. The rule the user asked for (mirrors live mode):
 *
 *   - ALL stems on  → play the ORIGINAL full mix (stems muted). Summing every
 *     stem just reproduces the mix with more artifacts, so play the real thing.
 *   - SOME stems on → play exactly those stems; the original mix is muted.
 *   - NO stems on   → silence (you turned everything off).
 *   - No stems exist at all → the original always plays.
 *
 * Pure + framework-free so the transport and its tests share one source of truth.
 */
export type StemAudibility = {
  /** Play the original full-mix track. */
  playOriginal: boolean
  /** Stem keys that should be audible (empty when the original plays). */
  audibleStemKeys: string[]
}

/** A stem is "on" unless explicitly set to false — new stems default to audible. */
function isOn(enabled: Record<string, boolean>, key: string): boolean {
  return enabled[key] !== false
}

export function resolveStemAudibility(
  stemKeys: readonly string[],
  enabled: Record<string, boolean>,
): StemAudibility {
  if (stemKeys.length === 0) return { playOriginal: true, audibleStemKeys: [] }
  if (stemKeys.every((k) => isOn(enabled, k))) {
    return { playOriginal: true, audibleStemKeys: [] }
  }
  return { playOriginal: false, audibleStemKeys: stemKeys.filter((k) => isOn(enabled, k)) }
}
