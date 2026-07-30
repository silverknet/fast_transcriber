import { describe, it, expect } from 'vitest'
import { parseProjectJson } from './parse'
import { serializeProject } from './serialize'
import type { ProjectFile } from './types'

function manifest(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    formatVersion: 1,
    id: 'proj-1',
    name: 'My Set',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    songs: [],
    ...extra,
  })
}

describe('parseProjectJson — autoStems', () => {
  it('is undefined when absent', () => {
    expect(parseProjectJson(manifest()).autoStems).toBeUndefined()
  })

  it('round-trips a well-formed config', () => {
    const p = parseProjectJson(
      manifest({ autoStems: { enabled: true, stems: ['drums', 'bass'], quality: 'best' } }),
    )
    expect(p.autoStems).toEqual({ enabled: true, stems: ['drums', 'bass'], quality: 'best' })
  })

  it('filters unknown stem names and de-duplicates', () => {
    const p = parseProjectJson(
      manifest({
        autoStems: { enabled: true, stems: ['drums', 'drums', 'kazoo', 'bass'], quality: 'balanced' },
      }),
    )
    expect(p.autoStems?.stems).toEqual(['drums', 'bass'])
  })

  it('falls back to balanced for an unknown quality', () => {
    const p = parseProjectJson(
      manifest({ autoStems: { enabled: true, stems: ['vocals'], quality: 'ultra' } }),
    )
    expect(p.autoStems?.quality).toBe('balanced')
  })

  it('coerces enabled to a strict boolean', () => {
    const p = parseProjectJson(
      manifest({ autoStems: { enabled: 'yes', stems: ['drums'], quality: 'preview' } }),
    )
    expect(p.autoStems?.enabled).toBe(false)
  })

  it('does not throw on a malformed block — treats it as not configured', () => {
    expect(parseProjectJson(manifest({ autoStems: 'nope' })).autoStems).toBeUndefined()
    expect(parseProjectJson(manifest({ autoStems: { stems: 'no' } })).autoStems).toEqual({
      enabled: false,
      stems: [],
      quality: 'balanced',
    })
  })

  it('survives a serialize → parse round-trip (persistence is lossless)', () => {
    const project: ProjectFile = {
      formatVersion: 1,
      id: 'proj-1',
      name: 'My Set',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      songs: [],
      autoStems: { enabled: true, stems: ['drums', 'bass', 'other'], quality: 'best' },
    }
    const reparsed = parseProjectJson(serializeProject(project))
    expect(reparsed.autoStems).toEqual(project.autoStems)
  })
})

describe('parseProjectJson — mastering kickPunch', () => {
  const withMastering = (extra: Record<string, unknown>) =>
    parseProjectJson(manifest({ mastering: { enabled: true, ...extra } })).mastering

  it('is undefined when absent (existing projects are untouched)', () => {
    expect(withMastering({})?.kickPunch).toBeUndefined()
  })

  it('keeps a valid amount', () => {
    expect(withMastering({ kickPunch: 0.4 })?.kickPunch).toBe(0.4)
  })

  it('clamps out-of-range amounts to 0…1', () => {
    expect(withMastering({ kickPunch: 7 })?.kickPunch).toBe(1)
    expect(withMastering({ kickPunch: -3 })?.kickPunch).toBe(0)
  })

  it('ignores junk rather than corrupting the config', () => {
    expect(withMastering({ kickPunch: 'loud' })?.kickPunch).toBeUndefined()
    expect(withMastering({ kickPunch: NaN })?.kickPunch).toBeUndefined()
  })

  it('survives a serialize → parse round-trip', () => {
    const project: ProjectFile = {
      formatVersion: 1,
      id: 'proj-1',
      name: 'My Set',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      songs: [],
      mastering: { enabled: true, kickPunch: 0.45, stems: { drums: { intensity: 'light' } } },
    }
    const reparsed = parseProjectJson(serializeProject(project))
    expect(reparsed.mastering?.kickPunch).toBe(0.45)
  })
})
