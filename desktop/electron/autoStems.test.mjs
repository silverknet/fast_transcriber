/**
 * Pure-logic tests for the sidecar auto-stems daemon. Run with:
 *   node --test desktop/electron/autoStems.test.mjs
 *
 * Only the dependency-free decision helpers are covered here; the daemon
 * shell needs the live sidecar (filesystem + demucs queue) to exercise.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bestStemOnDisk,
  computeNeededStems,
  isStemWavHealthy,
  isSongAnalyzed,
  normalizeAutoStems,
  stemSubpath,
} from './autoStems.mjs'

test('bestStemOnDisk picks highest quality per stem', () => {
  const m = bestStemOnDisk({ preview: ['drums.wav', 'bass.wav'], best: ['drums.wav'] })
  assert.deepEqual(m.get('drums'), { rank: 0, slug: 'best', filename: 'drums.wav' })
  assert.deepEqual(m.get('bass'), { rank: 2, slug: 'preview', filename: 'bass.wav' })
  assert.equal(m.has('vocals'), false)
})

test('computeNeededStems: missing + below-target + satisfied', () => {
  assert.deepEqual(computeNeededStems({}, { stems: ['drums', 'bass'], quality: 'balanced' }), [
    'drums',
    'bass',
  ])
  assert.deepEqual(
    computeNeededStems({ preview: ['drums.wav'] }, { stems: ['drums'], quality: 'best' }),
    ['drums'],
  )
  assert.deepEqual(
    computeNeededStems({ best: ['drums.wav'] }, { stems: ['drums'], quality: 'balanced' }),
    [],
  )
})

test('isStemWavHealthy flags truncated / empty files', () => {
  const ok = { durationSec: 180, sampleRate: 44100, channels: 2, fileSize: 180 * 44100 * 2 * 2 }
  assert.equal(isStemWavHealthy(ok), true)
  assert.equal(isStemWavHealthy(null), false)
  assert.equal(isStemWavHealthy({ ...ok, durationSec: 0 }), false)
  assert.equal(isStemWavHealthy({ ...ok, fileSize: Math.floor(ok.fileSize * 0.1) }), false)
  assert.equal(isStemWavHealthy({ ...ok, fileSize: ok.fileSize * 2 }), true) // higher bit depth
})

test('isSongAnalyzed: flag or bars', () => {
  assert.equal(isSongAnalyzed(true, 0), true)
  assert.equal(isSongAnalyzed(undefined, 16), true)
  assert.equal(isSongAnalyzed(false, 0), false)
})

test('normalizeAutoStems: defensive parsing', () => {
  assert.equal(normalizeAutoStems(undefined), null)
  assert.equal(normalizeAutoStems({ enabled: false, stems: ['drums'], quality: 'best' }), null)
  assert.equal(normalizeAutoStems({ enabled: true, stems: [], quality: 'best' }), null)
  assert.deepEqual(
    normalizeAutoStems({ enabled: true, stems: ['drums', 'drums', 'kazoo', 'bass'], quality: 'huh' }),
    { enabled: true, stems: ['drums', 'bass'], quality: 'balanced' },
  )
})

test('stemSubpath maps slug to folder', () => {
  assert.equal(stemSubpath({ slug: 'best', filename: 'drums.wav' }), 'stems/best/drums.wav')
  assert.equal(stemSubpath({ slug: 'legacy', filename: 'drums.wav' }), 'stems/drums.wav')
})
