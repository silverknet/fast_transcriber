import { sha256HexOfBlob } from '$lib/songmap/persist'
import type { AudioReference, SongMap } from '$lib/songmap/types'
import { computeAudioFingerprint, type AudioFingerprint } from './audioFingerprint'

export type ImportedAudioSource = AudioReference['source']

export type ImportedAudioArtifact = {
  file?: File
  fileName: string
  mimeType?: string
  durationSec: number
  sampleRate?: number
  channels?: number
  fileSize?: number
  sha256?: string
  originalSha256?: string
  /** Recording identity, computed during decode — see `audioFingerprint.ts`. */
  fingerprint?: AudioFingerprint
  source: ImportedAudioSource
  alreadyWrittenSubpath?: string
  titleHint?: string
}

export type PrepareImportedAudioOptions = {
  source?: ImportedAudioSource
  fileName?: string
  mimeType?: string
  titleHint?: string
  alreadyWrittenSubpath?: string
  durationSec?: number
  sampleRate?: number
  channels?: number
  fileSize?: number
  sha256?: string
  originalSha256?: string
  fingerprint?: AudioFingerprint
}

export async function decodeAudioBlobInfo(
  blob: Blob,
): Promise<{
  durationSec: number
  sampleRate: number
  channels: number
  fingerprint?: AudioFingerprint
}> {
  // OFFLINE: this context only decodes, so it must not take one of the
  // browser's ~6 hardware AudioContext slots. See `audioDevice.ts`.
  const ctx = new OfflineAudioContext(1, 1, 44100)
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    // The file is already decoded here, so the recording fingerprint is
    // essentially free — this is the one place guaranteed to have PCM.
    const channels: Float32Array[] = []
    for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c))
    return {
      durationSec: buf.duration,
      sampleRate: buf.sampleRate,
      channels: buf.numberOfChannels,
      fingerprint: computeAudioFingerprint(channels, buf.sampleRate) ?? undefined,
    }
  } finally {
    // Nothing to close: an OfflineAudioContext holds no hardware slot.
  }
}

export async function prepareImportedAudio(
  input: File | Blob,
  opts: PrepareImportedAudioOptions = {},
): Promise<ImportedAudioArtifact> {
  const inferredName =
    opts.fileName ??
    (input instanceof File && input.name ? input.name : 'audio.wav')
  const mimeType = opts.mimeType ?? input.type ?? 'application/octet-stream'
  const file =
    input instanceof File && input.name === inferredName && (!opts.mimeType || input.type === opts.mimeType)
      ? input
      : new File([input], inferredName, { type: mimeType })

  // Importers that already know the metadata (the sidecar download path)
  // must NOT be forced into a decode just to build a fingerprint — that would
  // turn a cheap import into a full decode of a large file. The fingerprint is
  // opportunistic: computed for free when we decode anyway, and otherwise
  // backfilled by `ensureAudioFingerprint()` the first time the editor decodes
  // this audio for the waveform.
  const decoded =
    opts.durationSec !== undefined && opts.sampleRate !== undefined && opts.channels !== undefined
      ? {
          durationSec: opts.durationSec,
          sampleRate: opts.sampleRate,
          channels: opts.channels,
          fingerprint: opts.fingerprint,
        }
      : await decodeAudioBlobInfo(file)

  if (!(decoded.durationSec > 0)) throw new Error('Audio file has zero duration.')

  const sha = opts.sha256 ?? (await sha256HexOfBlob(file).catch(() => undefined))

  return {
    file,
    fileName: inferredName,
    mimeType,
    durationSec: decoded.durationSec,
    sampleRate: decoded.sampleRate,
    channels: decoded.channels,
    fileSize: opts.fileSize ?? file.size,
    sha256: sha,
    originalSha256: opts.originalSha256 ?? sha,
    fingerprint: decoded.fingerprint ?? opts.fingerprint,
    source: opts.source ?? 'upload',
    alreadyWrittenSubpath: opts.alreadyWrittenSubpath,
    titleHint: opts.titleHint,
  }
}

export function audioReferenceFromImportedArtifact(
  artifact: ImportedAudioArtifact,
  trim?: { startSec: number; endSec: number },
): AudioReference {
  const endSec = trim?.endSec ?? artifact.durationSec
  return {
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    durationSec: artifact.durationSec,
    sampleRate: artifact.sampleRate,
    channels: artifact.channels,
    fileSize: artifact.fileSize,
    trim: trim ?? { startSec: 0, endSec },
    sha256: artifact.sha256,
    originalSha256: artifact.originalSha256 ?? artifact.sha256,
    fingerprint: artifact.fingerprint,
    originalPath: artifact.alreadyWrittenSubpath,
    source: artifact.source,
  }
}

/**
 * Backfill the recording fingerprint onto a `SongMap`'s audio reference once
 * PCM is available, without disturbing anything else.
 *
 * Returns the SAME object when nothing should change — no fingerprint could be
 * computed, or one is already stored. Callers rely on that identity check to
 * avoid an autosave → push loop: this must only ever fire once per song.
 */
export function ensureAudioFingerprint(map: SongMap, buffer: DecodedLike): SongMap {
  if (!map.audio || map.audio.fingerprint) return map
  const channels: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
  const fingerprint = computeAudioFingerprint(channels, buffer.sampleRate)
  if (!fingerprint) return map
  return { ...map, audio: { ...map.audio, fingerprint } }
}

/** Structural subset of `AudioBuffer`, so this stays unit-testable in Node. */
export type DecodedLike = {
  numberOfChannels: number
  sampleRate: number
  getChannelData(channel: number): Float32Array
}
