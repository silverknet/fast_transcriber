import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RUBBERBAND_TRANSPOSE_ALGO_VERSION,
  buildRubberBandArgs,
  classifyDurationAlignment,
  normalizeTransposeSemitones,
  rubberBandPlatformKey,
  signedSemitonePathPart,
  transposeCacheSubpath,
} from './transposeCache.mjs'

const SOURCE_IDENTITY = {
  sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  fileSize: 12345678,
}

test('Rubber Band command uses high-quality tempo-preserving flags', () => {
  assert.deepEqual(buildRubberBandArgs('/in.wav', '/out.wav', 3), [
    '--fine',
    '--formant',
    '--time',
    '1',
    '--pitch',
    '3',
    '/in.wav',
    '/out.wav',
  ])
})

test('transpose semitone validation accepts shared range only', () => {
  assert.equal(normalizeTransposeSemitones(-12), -12)
  assert.equal(normalizeTransposeSemitones(12), 12)
  assert.equal(normalizeTransposeSemitones(0, { allowZero: true }), 0)
  assert.throws(() => normalizeTransposeSemitones(0), /non-zero/)
  assert.throws(() => normalizeTransposeSemitones(13), /between -12 and 12/)
  assert.throws(() => normalizeTransposeSemitones(1.5), /integer/)
})

test('cache subpath includes Rubber Band algorithm, source identity, and signed semitones', () => {
  assert.equal(signedSemitonePathPart(1), 'p01')
  assert.equal(signedSemitonePathPart(-12), 'm12')
  assert.equal(
    transposeCacheSubpath(SOURCE_IDENTITY, -3),
    `cache/transpose/${RUBBERBAND_TRANSPOSE_ALGO_VERSION}/0123456789abcdef0123-12345678/m03.wav`,
  )
})

test('duration alignment classifies tiny repairable drift and large drift', () => {
  const source = { durationSec: 120, sampleRate: 44100 }
  const tiny = classifyDurationAlignment(source, { durationSec: 120.012, sampleRate: 44100 })
  assert.equal(tiny.ok, true)
  assert.equal(tiny.needsPadTrim, true)

  const large = classifyDurationAlignment(source, { durationSec: 121, sampleRate: 44100 })
  assert.equal(large.ok, false)
  assert.equal(large.largeDrift, true)
})

test('platform key names match bundled binary layout', () => {
  assert.equal(rubberBandPlatformKey('darwin', 'arm64'), 'darwin-arm64')
  assert.equal(rubberBandPlatformKey('darwin', 'x64'), 'darwin-x64')
  assert.equal(rubberBandPlatformKey('win32', 'x64'), 'win32-x64')
  assert.equal(rubberBandPlatformKey('linux', 'arm64'), 'linux-arm64')
  assert.equal(rubberBandPlatformKey('freebsd', 'x64'), null)
})
