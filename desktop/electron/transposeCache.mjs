import path from 'node:path'

export const RUBBERBAND_TRANSPOSE_ALGO_VERSION = 'rubberband-r3-v1'
export const RUBBERBAND_RENDER_TIMEOUT_MS = 10 * 60 * 1000

export function rubberBandPlatformKey(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return `${platform}-${arch}`
  if (platform === 'win32' && arch === 'x64') return 'win32-x64'
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) return `${platform}-${arch}`
  return null
}

export function normalizeTransposeSemitones(semitones, { allowZero = false } = {}) {
  const n = Number(semitones)
  if (!Number.isInteger(n) || n < -12 || n > 12 || (!allowZero && n === 0)) {
    throw new Error(
      allowZero
        ? 'semitones must be an integer between -12 and 12'
        : 'semitones must be a non-zero integer between -12 and 12',
    )
  }
  return n
}

export function signedSemitonePathPart(semitones) {
  const n = normalizeTransposeSemitones(semitones)
  return n > 0 ? `p${String(n).padStart(2, '0')}` : `m${String(Math.abs(n)).padStart(2, '0')}`
}

export function sourceCacheId(identity) {
  const sha = typeof identity?.sha256 === 'string' ? identity.sha256 : ''
  const size = Number(identity?.fileSize ?? identity?.size)
  if (!/^[a-f0-9]{64}$/i.test(sha)) throw new Error('source identity is missing sha256')
  if (!Number.isFinite(size) || size < 0) throw new Error('source identity is missing file size')
  return `${sha.slice(0, 20)}-${Math.trunc(size)}`
}

export function transposeCacheSubpath(identity, semitones) {
  return path.posix.join(
    'cache',
    'transpose',
    RUBBERBAND_TRANSPOSE_ALGO_VERSION,
    sourceCacheId(identity),
    `${signedSemitonePathPart(semitones)}.wav`,
  )
}

export function buildRubberBandArgs(inputPath, outputPath, semitones) {
  return [
    '--fine',
    '--formant',
    '--time',
    '1',
    '--pitch',
    String(normalizeTransposeSemitones(semitones)),
    inputPath,
    outputPath,
  ]
}

export function durationDriftSec(sourceInfo, outputInfo) {
  const sourceDuration = Number(sourceInfo?.durationSec)
  const outputDuration = Number(outputInfo?.durationSec)
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    throw new Error('source duration is missing')
  }
  if (!Number.isFinite(outputDuration) || outputDuration <= 0) {
    throw new Error('output duration is missing')
  }
  return outputDuration - sourceDuration
}

export function classifyDurationAlignment(sourceInfo, outputInfo) {
  const driftSec = durationDriftSec(sourceInfo, outputInfo)
  const absDriftSec = Math.abs(driftSec)
  const sampleRate = Number(outputInfo?.sampleRate ?? sourceInfo?.sampleRate ?? 44100)
  const driftFrames = Number.isFinite(sampleRate) && sampleRate > 0
    ? Math.round(absDriftSec * sampleRate)
    : null
  const tinyLimitSec = Math.max(0.05, 4 / Math.max(sampleRate || 44100, 1))
  const largeLimitSec = Math.max(0.25, Number(sourceInfo.durationSec) * 0.002)
  return {
    ok: absDriftSec <= tinyLimitSec,
    needsPadTrim: absDriftSec > 4 / Math.max(sampleRate || 44100, 1) && absDriftSec <= tinyLimitSec,
    largeDrift: absDriftSec > largeLimitSec,
    driftSec,
    absDriftSec,
    driftFrames,
  }
}
