/**
 * Integration tests for the sidecar's static file serving. Run with:
 *   node --test desktop/electron/serveFile.test.mjs
 *
 * These boot a REAL http server around `serveFileFromDisk` and drive it over the
 * loopback with `fetch` — i.e. they exercise the exact path that serves project
 * audio/smap assets to the app, including Range requests and the mid-stream
 * failure mode that used to surface as a bare "Failed to fetch".
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { parseRange, serveFileFromDisk } from './serveFile.mjs'

// ── parseRange (pure) ────────────────────────────────────────────────────────
test('parseRange: absent / unparseable / multipart → full body (null)', () => {
  assert.equal(parseRange(undefined, 100), null)
  assert.equal(parseRange('', 100), null)
  assert.equal(parseRange('bytes=', 100), null)
  assert.equal(parseRange('bytes=0-10,20-30', 100), null) // multipart → serve full
  assert.equal(parseRange('kilobytes=0-10', 100), null)
})

test('parseRange: satisfiable ranges', () => {
  assert.deepEqual(parseRange('bytes=0-99', 100), { start: 0, end: 99 })
  assert.deepEqual(parseRange('bytes=0-49', 100), { start: 0, end: 49 })
  assert.deepEqual(parseRange('bytes=50-', 100), { start: 50, end: 99 }) // open-ended
  assert.deepEqual(parseRange('bytes=-20', 100), { start: 80, end: 99 }) // suffix
  assert.deepEqual(parseRange('bytes=90-999', 100), { start: 90, end: 99 }) // clamp end
})

test('parseRange: unsatisfiable → "invalid" (→ 416)', () => {
  assert.equal(parseRange('bytes=100-200', 100), 'invalid') // start past end
  assert.equal(parseRange('bytes=200-', 100), 'invalid')
  assert.equal(parseRange('bytes=-0', 100), 'invalid') // zero-length suffix
  assert.equal(parseRange('bytes=0-0', 0), 'invalid') // empty file
})

// ── serving over a real HTTP server ──────────────────────────────────────────
function makeFixture(bytes) {
  const dir = mkdtempSync(path.join(tmpdir(), 'servefile-'))
  const file = path.join(dir, 'asset.wav')
  writeFileSync(file, bytes)
  return { dir, file, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Start a one-shot server that serves `file` (with optional opts) and return its base URL. */
async function startServer(file, opts = {}) {
  const server = createServer((req, res) =>
    serveFileFromDisk(req, res, file, { contentType: 'audio/wav', ...opts }),
  )
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) }
}

test('full GET → 200, Accept-Ranges, complete body', async () => {
  const body = Buffer.alloc(200_000, 7)
  const fx = makeFixture(body)
  const srv = await startServer(fx.file)
  try {
    const res = await fetch(srv.url)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('accept-ranges'), 'bytes')
    assert.equal(res.headers.get('content-type'), 'audio/wav')
    assert.equal(res.headers.get('content-length'), String(body.length))
    const got = Buffer.from(await res.arrayBuffer())
    assert.equal(got.length, body.length)
    assert.ok(got.equals(body))
  } finally {
    await srv.close()
    fx.cleanup()
  }
})

test('Range request → 206 Partial Content with correct slice + Content-Range', async () => {
  const body = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256))
  const fx = makeFixture(body)
  const srv = await startServer(fx.file)
  try {
    const res = await fetch(srv.url, { headers: { Range: 'bytes=100-199' } })
    assert.equal(res.status, 206)
    assert.equal(res.headers.get('content-range'), `bytes 100-199/${body.length}`)
    assert.equal(res.headers.get('content-length'), '100')
    const got = Buffer.from(await res.arrayBuffer())
    assert.equal(got.length, 100)
    assert.ok(got.equals(body.subarray(100, 200)))
  } finally {
    await srv.close()
    fx.cleanup()
  }
})

test('suffix Range (bytes=-N) → last N bytes', async () => {
  const body = Buffer.from(Array.from({ length: 500 }, (_, i) => (i * 3) % 256))
  const fx = makeFixture(body)
  const srv = await startServer(fx.file)
  try {
    const res = await fetch(srv.url, { headers: { Range: 'bytes=-50' } })
    assert.equal(res.status, 206)
    const got = Buffer.from(await res.arrayBuffer())
    assert.ok(got.equals(body.subarray(450)))
  } finally {
    await srv.close()
    fx.cleanup()
  }
})

test('unsatisfiable Range → 416 with Content-Range: bytes */size', async () => {
  const body = Buffer.alloc(100, 1)
  const fx = makeFixture(body)
  const srv = await startServer(fx.file)
  try {
    const res = await fetch(srv.url, { headers: { Range: 'bytes=500-600' } })
    assert.equal(res.status, 416)
    assert.equal(res.headers.get('content-range'), 'bytes */100')
  } finally {
    await srv.close()
    fx.cleanup()
  }
})

test('HEAD → headers only, no body', async () => {
  const body = Buffer.alloc(1234, 9)
  const fx = makeFixture(body)
  const srv = await startServer(fx.file)
  try {
    const res = await fetch(srv.url, { method: 'HEAD' })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-length'), '1234')
    assert.equal(res.headers.get('accept-ranges'), 'bytes')
    const got = Buffer.from(await res.arrayBuffer())
    assert.equal(got.length, 0)
  } finally {
    await srv.close()
    fx.cleanup()
  }
})

test('missing file → 404 JSON (never a truncated 200)', async () => {
  const srv = await startServer('/no/such/file/anywhere.wav')
  try {
    const res = await fetch(srv.url)
    assert.equal(res.status, 404)
    const j = await res.json()
    assert.equal(j.ok, false)
  } finally {
    await srv.close()
  }
})

test('mid-stream read error → connection reset, NOT a silently truncated 200', async () => {
  // Real file so Content-Length is set to the true (large) size, but the read
  // stream fails after a few KB. The fix must reset the socket so the client
  // sees an aborted transfer instead of a "successful" short body.
  const body = Buffer.alloc(500_000, 3)
  const fx = makeFixture(body)
  const failingCreateStream = () => {
    let sent = false
    return new Readable({
      read() {
        if (!sent) {
          sent = true
          this.push(Buffer.alloc(2048, 3))
        } else {
          this.destroy(new Error('simulated mid-stream read failure'))
        }
      },
    })
  }
  const srv = await startServer(fx.file, { createStream: failingCreateStream })
  try {
    // The whole fetch-and-read must FAIL as a network error (the reset can land
    // before OR during the body). It must never resolve to a complete body from
    // a broken read — that's the silent-truncation bug we're guarding against.
    await assert.rejects(async () => {
      const res = await fetch(srv.url)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === body.length) return 'MASQUERADED-AS-COMPLETE'
      throw new Error('resolved-short') // still a failure, just a nicer message
    })
  } finally {
    await srv.close()
    fx.cleanup()
  }
})
