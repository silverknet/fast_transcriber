/**
 * `assetPresent` against the sidecar's REAL responses.
 *
 * The three cases below were observed from a live sidecar, not invented:
 *
 *   present file  -> 206, 1 byte      (Range honoured)
 *   EMPTY file    -> 416, 0 bytes     (range unsatisfiable)
 *   absent file   -> 404, 37 bytes    (a JSON error body — note it has LENGTH)
 *
 * The last one is why this cannot simply ask "did I get bytes back": a missing
 * file answers with a body. And the empty-file case is the one that matters
 * most in practice — a stem truncated by an interrupted sync reads as present
 * everywhere else and plays as silence on stage.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assetPresent } from './offlineSetCheck'

function mockFetch(status: number, byteLength: number) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => new ArrayBuffer(byteLength),
  })) as unknown as typeof fetch
}

afterEach(() => vi.unstubAllGlobals())

describe('is this file really on disk', () => {
  it('a present file (206, 1 byte) counts as present', async () => {
    vi.stubGlobal('fetch', mockFetch(206, 1))
    expect(await assetPresent('/proj', 'songs/a', 'original.wav')).toBe(true)
  })

  it('an EMPTY file (416) counts as MISSING', async () => {
    // A truncated stem from an interrupted sync. It exists, and it is silence.
    vi.stubGlobal('fetch', mockFetch(416, 0))
    expect(await assetPresent('/proj', 'songs/a', 'empty.wav')).toBe(false)
  })

  it('an absent file counts as missing despite its error body having bytes', async () => {
    // 404 comes back with 37 bytes of JSON. Counting bytes alone would call
    // this present.
    vi.stubGlobal('fetch', mockFetch(404, 37))
    expect(await assetPresent('/proj', 'songs/a', 'nope.wav')).toBe(false)
  })

  it('a 200 with content is present (a server that ignores Range)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, 4096))
    expect(await assetPresent('/proj', 'songs/a', 'original.wav')).toBe(true)
  })

  it('a 200 with NO content is missing', async () => {
    vi.stubGlobal('fetch', mockFetch(200, 0))
    expect(await assetPresent('/proj', 'songs/a', 'zero.wav')).toBe(false)
  })

  it('an unreachable sidecar reads as NOT ready, never as fine', async () => {
    // Defaulting to "present" here would report a set as gig-ready when nothing
    // had actually been checked.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    expect(await assetPresent('/proj', 'songs/a', 'original.wav')).toBe(false)
  })

  it('asks for one byte, not the whole file', async () => {
    // A set's worth of stems would be minutes and a lot of memory.
    const spy = mockFetch(206, 1)
    vi.stubGlobal('fetch', spy)
    await assetPresent('/proj', 'songs/a', 'original.wav')
    const init = (spy as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1]
    expect((init.headers as Record<string, string>).Range).toBe('bytes=0-0')
  })

  it('passes the project path, song folder and subpath through', async () => {
    const spy = mockFetch(206, 1)
    vi.stubGlobal('fetch', spy)
    await assetPresent('/my/proj', 'songs/opener-1234', 'stems/drums.wav')
    const url = (spy as unknown as { mock: { calls: [string][] } }).mock.calls[0]![0]
    expect(url).toContain('projectPath=%2Fmy%2Fproj')
    expect(url).toContain('songFolder=songs%2Fopener-1234')
    expect(url).toContain('subpath=stems%2Fdrums.wav')
  })
})
