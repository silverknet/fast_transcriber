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
  provenanceSatisfiesPreset,
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

test('provenanceSatisfiesPreset: proof required for defined presets', () => {
  const bestProv = { engine: 'demucs', model: 'htdemucs_ft', shifts: 10, overlap: 0.5 }
  assert.equal(provenanceSatisfiesPreset('best', bestProv), true)
  // Better-than-required settings still satisfy.
  assert.equal(provenanceSatisfiesPreset('balanced', bestProv), true)
  assert.equal(provenanceSatisfiesPreset('preview', bestProv), true) // _ft outranks plain
  // Weaker settings in a "best" folder do NOT satisfy.
  assert.equal(
    provenanceSatisfiesPreset('best', { engine: 'demucs', model: 'htdemucs_ft', shifts: 5, overlap: 0.25 }),
    false,
  )
  assert.equal(
    provenanceSatisfiesPreset('best', { engine: 'demucs', model: 'htdemucs', shifts: 10, overlap: 0.5 }),
    false,
  )
  // No stamp at all → unproven.
  assert.equal(provenanceSatisfiesPreset('best', null), false)
  assert.equal(provenanceSatisfiesPreset('best', undefined), false)
  // Legacy/unknown slugs carry no promise — always pass.
  assert.equal(provenanceSatisfiesPreset('legacy', null), true)
  assert.equal(provenanceSatisfiesPreset('whatever', undefined), true)
})

test('bestStemOnDisk: unproven preset stems demote to unknown rank', () => {
  const stems = { best: ['vocals.wav'], preview: ['vocals.wav'] }
  const prov = {
    best: null, // pre-provenance split — unproven
    preview: { engine: 'demucs', model: 'htdemucs', shifts: 1, overlap: 0.25 },
  }
  const m = bestStemOnDisk(stems, prov)
  // Proven preview beats unproven "best".
  assert.deepEqual(m.get('vocals'), { rank: 2, slug: 'preview', filename: 'vocals.wav' })
  // Without provenance info the folder name is trusted (back-compat).
  assert.equal(bestStemOnDisk(stems).get('vocals').slug, 'best')
})

test('computeNeededStems: unproven stems get re-queued at target quality', () => {
  const stems = { best: ['vocals.wav', 'drums.wav'] }
  const config = { stems: ['vocals', 'drums'], quality: 'best' }
  // No provenance map → trust folder names (old behavior).
  assert.deepEqual(computeNeededStems(stems, config), [])
  // Provenance map present but no stamp → re-split both.
  assert.deepEqual(computeNeededStems(stems, config, { best: null }), ['vocals', 'drums'])
  // Valid stamp → satisfied.
  const prov = { best: { engine: 'demucs', model: 'htdemucs_ft', shifts: 10, overlap: 0.5 } }
  assert.deepEqual(computeNeededStems(stems, config, prov), [])
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
