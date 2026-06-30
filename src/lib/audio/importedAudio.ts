import { sha256HexOfBlob } from '$lib/songmap/persist'
import type { AudioReference } from '$lib/songmap/types'

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
}

export async function decodeAudioBlobInfo(
  blob: Blob,
): Promise<{ durationSec: number; sampleRate: number; channels: number }> {
  const ctx = new AudioContext()
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    return {
      durationSec: buf.duration,
      sampleRate: buf.sampleRate,
      channels: buf.numberOfChannels,
    }
  } finally {
    await ctx.close().catch(() => {})
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

  const decoded =
    opts.durationSec !== undefined && opts.sampleRate !== undefined && opts.channels !== undefined
      ? {
          durationSec: opts.durationSec,
          sampleRate: opts.sampleRate,
          channels: opts.channels,
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
    originalPath: artifact.alreadyWrittenSubpath,
    source: artifact.source,
  }
}
