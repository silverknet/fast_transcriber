/**
 * Pins down the client-side unwrap of `/native/analyze-downbeats` so a
 * future change to the sidecar response shape can't silently leave the
 * analyzer returning empty beats.
 *
 * The sidecar wraps the python script's stdout JSON like:
 *   { ok: true, data: { beats: [{ time, beatInBar }, ...] } }
 * If that contract changes anywhere (sidecar or wrapper), these tests
 * break and a developer sees the regression before users do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeDownbeatsViaDesktop } from './desktopBridge'

const fakeWav = new Blob([new Uint8Array(1024)], { type: 'audio/wav' })

function mockFetchOnce(response: unknown, opts: { status?: number } = {}) {
  const status = opts.status ?? 200
  globalThis.fetch = vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify(response), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function mockFetchRejects(err: Error) {
  globalThis.fetch = vi.fn().mockRejectedValueOnce(err)
}

beforeEach(() => {
  // Reset between tests so we don't accidentally inherit a previous mock.
  globalThis.fetch = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('analyzeDownbeatsViaDesktop · happy path', () => {
  it('unwraps { ok, data: { beats } } into top-level beats array', async () => {
    mockFetchOnce({
      ok: true,
      data: {
        beats: [
          { time: 0.84, beatInBar: 1 },
          { time: 1.26, beatInBar: 2 },
        ],
      },
    })
    const r = await analyzeDownbeatsViaDesktop(fakeWav)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.beats).toHaveLength(2)
      expect(r.beats[0]).toEqual({ time: 0.84, beatInBar: 1 })
    }
  })

  it('returns ok: true with empty beats array when the analyzer found none', async () => {
    // This is the silence / not-enough-rhythm case — sidecar succeeded
    // but found nothing. The CALLER must decide whether to throw.
    mockFetchOnce({ ok: true, data: { beats: [] } })
    const r = await analyzeDownbeatsViaDesktop(fakeWav)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.beats).toEqual([])
  })

  it('coerces numeric strings into numbers', async () => {
    mockFetchOnce({
      ok: true,
      data: { beats: [{ time: '0.84', beatInBar: '1' }] },
    })
    const r = await analyzeDownbeatsViaDesktop(fakeWav)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.beats[0]).toEqual({ time: 0.84, beatInBar: 1 })
  })

  it('drops beats with non-numeric fields', async () => {
    mockFetchOnce({
      ok: true,
      data: {
        beats: [
          { time: 1, beatInBar: 1 },
          { time: 'oops', beatInBar: 2 },
          { time: 2, beatInBar: 3 },
        ],
      },
    })
    const r = await analyzeDownbeatsViaDesktop(fakeWav)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.beats).toHaveLength(2)
  })
})

describe('analyzeDownbeatsViaDesktop · error paths', () => {
  it('returns ok: false when the sidecar reports its own error', async () => {
    mockFetchOnce(
      { ok: false, error: 'madmom blew up' },
      { status: 503 },
    )
    const r = await analyzeDownbeatsViaDesktop(fakeWav)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('madmom')
  })

  it('returns ok: false when ok is true but data.beats is missing', async () => {
    // Catches a contract regression: if the sidecar one day drops the
    // `data` wrapper (or renames `beats`), surface it loudly.
    mockFetchOnce({ ok: true, data: {} })
    const r = await analyzeDownbeatsViaDesktop(fakeWav)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no beats array/i)
  })

  it('returns ok: false when the response is malformed JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response('not-json', { status: 200 }),
    )
    const r = await analyzeDownbeatsViaDesktop(fakeWav)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/non-JSON/i)
  })

  it('returns ok: false when fetch throws (sidecar offline)', async () => {
    mockFetchRejects(new Error('connect ECONNREFUSED'))
    const r = await analyzeDownbeatsViaDesktop(fakeWav)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/sidecar unreachable/i)
  })

  it('returns ok: false when HTTP status is non-2xx without an error field', async () => {
    mockFetchOnce({ ok: false }, { status: 500 })
    const r = await analyzeDownbeatsViaDesktop(fakeWav)
    expect(r.ok).toBe(false)
  })
})
