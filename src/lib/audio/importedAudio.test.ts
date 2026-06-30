import { describe, expect, it } from 'vitest'
import {
  audioReferenceFromImportedArtifact,
  prepareImportedAudio,
  type ImportedAudioArtifact,
} from './importedAudio'

describe('prepareImportedAudio', () => {
  it('stamps identity metadata without decoding when provided by the importer', async () => {
    const artifact = await prepareImportedAudio(new Blob(['abc'], { type: 'audio/wav' }), {
      fileName: 'yt-demo.wav',
      mimeType: 'audio/wav',
      durationSec: 12.5,
      sampleRate: 48000,
      channels: 2,
      fileSize: 3,
      source: 'import',
      alreadyWrittenSubpath: 'audio/yt-demo.wav',
      titleHint: 'Demo',
    })

    expect(artifact.file).toBeInstanceOf(File)
    expect(artifact.fileName).toBe('yt-demo.wav')
    expect(artifact.mimeType).toBe('audio/wav')
    expect(artifact.durationSec).toBe(12.5)
    expect(artifact.sampleRate).toBe(48000)
    expect(artifact.channels).toBe(2)
    expect(artifact.fileSize).toBe(3)
    expect(artifact.source).toBe('import')
    expect(artifact.alreadyWrittenSubpath).toBe('audio/yt-demo.wav')
    expect(artifact.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(artifact.originalSha256).toBe(artifact.sha256)
  })
})

describe('audioReferenceFromImportedArtifact', () => {
  it('preserves project subpath and import identity fields', () => {
    const artifact: ImportedAudioArtifact = {
      fileName: 'yt-demo.wav',
      mimeType: 'audio/wav',
      durationSec: 12.5,
      sampleRate: 48000,
      channels: 2,
      fileSize: 1234,
      sha256: 'sha',
      originalSha256: 'original-sha',
      source: 'import',
      alreadyWrittenSubpath: 'audio/yt-demo.wav',
    }

    expect(audioReferenceFromImportedArtifact(artifact)).toEqual({
      fileName: 'yt-demo.wav',
      mimeType: 'audio/wav',
      durationSec: 12.5,
      sampleRate: 48000,
      channels: 2,
      fileSize: 1234,
      trim: { startSec: 0, endSec: 12.5 },
      sha256: 'sha',
      originalSha256: 'original-sha',
      originalPath: 'audio/yt-demo.wav',
      source: 'import',
    })
  })
})
