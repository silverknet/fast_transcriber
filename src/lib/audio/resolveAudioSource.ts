/**
 * The SINGLE authority for deciding which audio a song plays from — and the hard
 * failsafe that a lossy CLOUD copy is NEVER used when the desktop client is
 * connected (i.e. when the local HD master is available).
 *
 * Rule (non-negotiable product decision):
 *  - **Desktop connected** → play the LOCAL HD master. If it doesn't resolve,
 *    prompt a relink — NEVER silently fall back to the compressed cloud copy.
 *  - **Browser mode** (no sidecar) → stream the compressed cloud AAC.
 *
 * Every playback/mixer code path obtains audio through `resolveAudioSource`, and
 * the cloud download/decode entry points additionally call
 * `assertCloudAudioAccessAllowed`, so it is impossible to fetch the low-def copy
 * while the desktop client is on.
 */

export type AudioSource = 'local' | 'cloud' | 'missing'

export interface AudioSourceInput {
  /** Sidecar reachable == "desktop mode" == the local HD master is accessible. */
  sidecarReachable: boolean
  /** A local HD master resolves (originalPath on disk, or a sha reconcile match). */
  localAudioAvailable: boolean
  /** A compressed cloud audio object exists for this song. */
  cloudAudioAvailable: boolean
}

export interface AudioResolution {
  source: AudioSource
  mode: 'desktop' | 'browser'
  /** Human-readable why, for logs / the missing-audio banner. */
  reason: string
}

/**
 * Decide the audio source. The ONLY place this decision is made — do not
 * re-implement "which audio" anywhere else.
 */
export function resolveAudioSource(input: AudioSourceInput): AudioResolution {
  if (input.sidecarReachable) {
    // Desktop mode: the local HD master is the ONLY acceptable source. The
    // compressed cloud copy is intentionally unreachable here — a relink is the
    // correct response to a missing local file, not a silent downgrade.
    return input.localAudioAvailable
      ? { source: 'local', mode: 'desktop', reason: 'desktop connected — using local HD master' }
      : {
          source: 'missing',
          mode: 'desktop',
          reason:
            'desktop connected but the local file did not resolve — relink it (the compressed cloud copy is deliberately not used on desktop)',
        }
  }
  // Browser mode: no sidecar, so the compressed cloud copy is the source.
  return input.cloudAudioAvailable
    ? { source: 'cloud', mode: 'browser', reason: 'browser mode — streaming compressed cloud audio' }
    : {
        source: 'missing',
        mode: 'browser',
        reason: 'browser mode and no cloud audio has been uploaded for this song yet',
      }
}

/**
 * Enforcement half of the rule: throw if the desktop client is connected, making
 * it impossible to obtain the lossy cloud copy while the HD master is available.
 * Call at the TOP of every cloud-audio fetch/decode entry point.
 */
export function assertCloudAudioAccessAllowed(sidecarReachable: boolean): void {
  if (sidecarReachable) {
    throw new Error(
      'BarBro refuses to load the compressed cloud audio while the desktop client is connected — ' +
        'the local HD master must be used. (resolveAudioSource failsafe)',
    )
  }
}
