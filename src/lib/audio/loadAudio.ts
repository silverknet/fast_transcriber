/**
 * THE audio-source boundary — the single place that answers "where does this
 * audio come from?".
 *
 * Everything downstream (decode → `AudioBuffer` → `PlaybackController`, and the
 * mixer) is completely source-agnostic: it receives BYTES and a label, nothing
 * more. Everything upstream (disk via the sidecar, or the compressed cloud copy)
 * is hidden behind the injected loaders. This keeps the two very different
 * app modes — desktop-with-local-HD and browser-with-cloud — orthogonal: the
 * boundary is this one function, and it reports the source EXPLICITLY.
 *
 * The fidelity failsafe (`resolveAudioSource`) lives inside `planAudioLoad`, so
 * cloud audio is unreachable whenever the desktop client is connected.
 */
import { planAudioLoad, planStemLoad } from '$lib/client/planAudioLoad'
import { fetchCloudAudioBlob, type CloudAudioManifest } from '$lib/client/cloudAudio'
import type { AudioSource } from './resolveAudioSource'

export type LoadedAudio =
  | { source: 'local' | 'cloud'; blob: Blob; reason: string }
  | { source: 'missing'; blob: null; reason: string }

/** What the boundary needs to know — no hidden globals; the caller supplies it. */
export interface AudioSourceInputs {
  sidecarReachable: boolean
  songId: string | null
  /** A local HD master resolves right now (desktop + file present). */
  localAudioAvailable: boolean
  /** The cloud manifest from `cloud_songs.cloud_audio`, or null. */
  cloudAudio: CloudAudioManifest | null
}

/** Byte loaders. `loadLocal*` is only ever invoked when the source is local. */
export interface AudioLoaders {
  loadLocal: () => Promise<Blob>
  /** Overridable for tests; defaults to the real guarded cloud fetch. */
  fetchCloud?: typeof fetchCloudAudioBlob
}

async function finish(
  plan: { resolution: { source: AudioSource; reason: string }; cloud?: { path: string; cacheKey: string } },
  sidecarReachable: boolean,
  loaders: AudioLoaders,
): Promise<LoadedAudio> {
  const { source, reason } = plan.resolution
  if (source === 'local') return { source, blob: await loaders.loadLocal(), reason }
  if (source === 'cloud' && plan.cloud) {
    const fetchCloud = loaders.fetchCloud ?? fetchCloudAudioBlob
    const blob = await fetchCloud({ sidecarReachable, path: plan.cloud.path, cacheKey: plan.cloud.cacheKey })
    return { source, blob, reason }
  }
  return { source: 'missing', blob: null, reason }
}

/** Load a song's MIX audio from wherever it should come from. */
export async function loadMixAudio(inputs: AudioSourceInputs, loaders: AudioLoaders): Promise<LoadedAudio> {
  return finish(planAudioLoad(inputs), inputs.sidecarReachable, loaders)
}

/** Load one STEM's audio (mixer), same boundary + failsafe as the mix. */
export async function loadStemAudio(
  inputs: Omit<AudioSourceInputs, 'localAudioAvailable'> & { localStemAvailable: boolean },
  stemName: string,
  loaders: AudioLoaders,
): Promise<LoadedAudio> {
  const plan = planStemLoad({
    sidecarReachable: inputs.sidecarReachable,
    localStemAvailable: inputs.localStemAvailable,
    songId: inputs.songId,
    stemName,
    cloudAudio: inputs.cloudAudio,
  })
  return finish(plan, inputs.sidecarReachable, loaders)
}
