import { describe, expect, it } from 'vitest'
import { diagnoseFit } from './fitConfidence'

// Cases mirror the real-library measurement (AGENT_NOTES 2026-07-25): a good
// fit, a partial one, a buried-vocal near-zero, and a weak recognition.
describe('diagnoseFit', () => {
  it('high row coverage → good', () => {
    const d = diagnoseFit({ matchedRows: 47, totalRows: 62 }) // ~76%
    expect(d.quality).toBe('good')
    expect(d.rowCoverage).toBeGreaterThan(0.75)
  })

  it('mid coverage → partial', () => {
    const d = diagnoseFit({ matchedRows: 34, totalRows: 62 }) // ~55%
    expect(d.quality).toBe('partial')
  })

  it('near-zero coverage WITH a quiet vocal stem → quiet-vocals (not blamed on recognition)', () => {
    // Leva-livet: 3/238-ish rows, vocal stem measured -26.9 dB mean.
    const d = diagnoseFit({ matchedRows: 1, totalRows: 60 }, { vocalDbfsMean: -26.9 })
    expect(d.quality).toBe('quiet-vocals')
    expect(d.detail.toLowerCase()).toContain('vocals')
  })

  it('near-zero coverage with a healthy stem → no-fit', () => {
    const d = diagnoseFit({ matchedRows: 1, totalRows: 60 }, { vocalDbfsMean: -18 })
    expect(d.quality).toBe('no-fit')
  })

  it('low-but-not-zero coverage, no loudness info → weak-recognition', () => {
    const d = diagnoseFit({ matchedRows: 12, totalRows: 60 }) // 20%
    expect(d.quality).toBe('weak-recognition')
  })

  it('handles zero rows without dividing by zero', () => {
    const d = diagnoseFit({ matchedRows: 0, totalRows: 0 })
    expect(d.rowCoverage).toBe(0)
    expect(d.quality).toBe('no-fit')
  })

  it('user-facing copy carries no engine internals', () => {
    for (const c of [
      diagnoseFit({ matchedRows: 50, totalRows: 60 }),
      diagnoseFit({ matchedRows: 1, totalRows: 60 }, { vocalDbfsMean: -27 }),
      diagnoseFit({ matchedRows: 10, totalRows: 60 }),
    ]) {
      const text = `${c.headline} ${c.detail}`.toLowerCase()
      for (const banned of ['whisper', 'python', 'model', 'asr', 'transcri', 'anchor', 'dbfs']) {
        expect(text).not.toContain(banned)
      }
    }
  })
})
