/**
 * Decide HOW to load a song's audio — the pure brain the editor's load path and
 * the mixer call. Wraps `resolveAudioSource` (the fidelity failsafe) and, when
 * the answer is cloud, hands back the exact object path + IndexedDB cache key.
 *
 * Keeping this pure means the "which audio, from where" decision is unit-tested
 * once, and both the grid loader and the mixer reuse it instead of re-deriving.
 */
import { resolveAudioSource, type AudioResolution } from '$lib/audio/resolveAudioSource'
import { cloudAudioCacheKey, type CloudAudioManifest } from './cloudAudio'

export interface AudioLoadPlan {
  resolution: AudioResolution
  /** Present only when `resolution.source === 'cloud'`. */
  cloud?: { path: string; cacheKey: string }
}

export function planAudioLoad(input: {
  sidecarReachable: boolean
  /** This song belongs to a local disk project (`osPath !== null`). */
  localProjectPresent: boolean
  /** A local HD master resolves (originalPath on disk / reconcile match). */
  localAudioAvailable: boolean
  songId: string | null
  cloudAudio: CloudAudioManifest | null
}): AudioLoadPlan {
  const cloudAudioAvailable = !!input.cloudAudio?.mix?.path && !!input.songId
  const resolution = resolveAudioSource({
    sidecarReachable: input.sidecarReachable,
    localProjectPresent: input.localProjectPresent,
    localAudioAvailable: input.localAudioAvailable,
    cloudAudioAvailable,
  })
  if (resolution.source === 'cloud' && input.cloudAudio && input.songId) {
    return {
      resolution,
      cloud: {
        path: input.cloudAudio.mix.path,
        cacheKey: cloudAudioCacheKey({
          songId: input.songId,
          sourceSha256: input.cloudAudio.sourceSha256,
          kind: 'mix',
        }),
      },
    }
  }
  return { resolution }
}

/** Stem variant of `planAudioLoad` — for the mixer, per stem slot. */
export function planStemLoad(input: {
  sidecarReachable: boolean
  /** This song belongs to a local disk project (`osPath !== null`). */
  localProjectPresent: boolean
  localStemAvailable: boolean
  songId: string | null
  stemName: string
  cloudAudio: CloudAudioManifest | null
}): AudioLoadPlan {
  const stemObj = input.cloudAudio?.stems?.[input.stemName]
  const cloudAudioAvailable = !!stemObj?.path && !!input.songId
  const resolution = resolveAudioSource({
    sidecarReachable: input.sidecarReachable,
    localProjectPresent: input.localProjectPresent,
    localAudioAvailable: input.localStemAvailable,
    cloudAudioAvailable,
  })
  if (resolution.source === 'cloud' && stemObj && input.songId) {
    return {
      resolution,
      cloud: {
        path: stemObj.path,
        cacheKey: cloudAudioCacheKey({
          songId: input.songId,
          sourceSha256: input.cloudAudio!.sourceSha256,
          kind: `stem:${input.stemName}`,
        }),
      },
    }
  }
  return { resolution }
}
