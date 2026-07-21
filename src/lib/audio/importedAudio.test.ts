import { describe, expect, it } from 'vitest'
import {
  audioReferenceFromImportedArtifact,
  prepareImportedAudio,
  ensureAudioFingerprint,
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

describe('ensureAudioFingerprint', () => {
  const buffer = (seconds: number, level: number[]) => ({
    numberOfChannels: 1,
    sampleRate: 8000,
    getChannelData: () => {
      const n = seconds * 8000
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        out[i] = level[Math.min(level.length - 1, Math.floor((i / n) * level.length))]! * (i % 2 ? 1 : -1)
      }
      return out
    },
  })

  const withAudio = (fingerprint?: unknown) =>
    ({
      audio: { fileName: 'a.wav', trim: { startSec: 0, endSec: 10 }, source: 'upload', fingerprint },
    }) as never

  it('stamps a fingerprint when the song has none', () => {
    const out = ensureAudioFingerprint(withAudio(undefined), buffer(4, [0.1, 0.9, 0.4, 1]))
    expect(out.audio?.fingerprint?.envelope).toHaveLength(64)
    expect(out.audio?.fingerprint?.durationSec).toBeCloseTo(4, 2)
  })

  it('returns the SAME object when one is already stored', () => {
    // Identity, not just equality: the caller uses `===` to decide whether to
    // patch the store, and re-patching would loop autosave → push forever.
    const map = withAudio({ version: 1, durationSec: 4, envelope: Array(64).fill(3) })
    expect(ensureAudioFingerprint(map, buffer(4, [0.1, 0.9]))).toBe(map)
  })

  it('returns the SAME object when there is no audio at all', () => {
    const map = {} as never
    expect(ensureAudioFingerprint(map, buffer(4, [0.1, 0.9]))).toBe(map)
  })

  it('returns the SAME object when the audio is silent (nothing to fingerprint)', () => {
    const silent = {
      numberOfChannels: 1,
      sampleRate: 8000,
      getChannelData: () => new Float32Array(0),
    }
    const map = withAudio(undefined)
    expect(ensureAudioFingerprint(map, silent)).toBe(map)
  })
})
