/**
 * Correct, range-aware static file serving for the sidecar's loopback HTTP API.
 *
 * Replaces the ad-hoc `createReadStream(...).pipe(res)` blocks that several
 * asset endpoints copy-pasted, which had two real defects:
 *
 *  1. TRUNCATION ON ERROR. A mid-stream read error ran `res.end()`, flushing
 *     FEWER bytes than the already-sent `Content-Length` promised. The browser
 *     surfaces that as a bare `net::ERR_FAILED` / "Failed to fetch" — a
 *     confusing, hard-to-diagnose symptom (exactly the class of bug that sent us
 *     chasing a phantom serving problem). We now DESTROY the socket so the
 *     client gets an unambiguous aborted-transfer error instead of a silent
 *     short read.
 *
 *  2. NO RANGE SUPPORT. `<audio>`/media loaders and any seeking client send
 *     `Range: bytes=…`; the old code ignored it and always returned the whole
 *     file as `200`. We now honor a single byte range with `206 Partial
 *     Content` + `Accept-Ranges` + `Content-Range`, and reject unsatisfiable
 *     ranges with `416`.
 *
 * The caller validates/authorizes the path; this owns the response.
 * `createStream` is injectable purely so tests can exercise the error path.
 */
import { createReadStream, statSync } from 'node:fs'

/**
 * Parse a single-range HTTP `Range` header against a known resource `size`.
 *
 * @returns
 *   - `null`   — no range / unparseable / multi-range → serve the full body
 *   - `'invalid'` — a well-formed but UNSATISFIABLE range → caller sends 416
 *   - `{ start, end }` — inclusive byte bounds for a 206
 */
export function parseRange(header, size) {
  if (!header || typeof header !== 'string') return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null // absent or multipart → fall back to a full 200
  const [, s, e] = m
  if (s === '' && e === '') return null
  let start
  let end
  if (s === '') {
    // suffix range: the final N bytes
    const n = Number(e)
    if (!Number.isFinite(n) || n <= 0) return 'invalid'
    if (size === 0) return 'invalid'
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(s)
    end = e === '' ? size - 1 : Number(e)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid'
    if (end > size - 1) end = size - 1
  }
  if (start < 0 || start > end || start >= size) return 'invalid'
  return { start, end }
}

/**
 * Stream `filePath` to `res`, honoring `Range` and failing cleanly.
 *
 * @param req  incoming request (reads `method` + `headers.range`)
 * @param res  server response (fully owned by this call)
 * @param filePath  absolute path, already validated + confirmed by the caller
 * @param opts.contentType  MIME type (default application/octet-stream)
 * @param opts.cors  CORS/base headers to merge into every response
 * @param opts.createStream  seam for tests (default fs.createReadStream)
 */
export function serveFileFromDisk(req, res, filePath, opts = {}) {
  const {
    contentType = 'application/octet-stream',
    cors = {},
    createStream = createReadStream,
  } = opts

  let size
  try {
    const st = statSync(filePath)
    if (!st.isFile()) throw new Error('not a regular file')
    size = st.size
  } catch {
    res.writeHead(404, { ...cors, 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, error: 'File not found' }))
    return
  }

  const range = parseRange(req.headers?.range, size)
  if (range === 'invalid') {
    res.writeHead(416, { ...cors, 'Content-Range': `bytes */${size}` })
    res.end()
    return
  }

  let start = 0
  let end = size > 0 ? size - 1 : 0
  let status = 200
  const headers = {
    ...cors,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
  }
  if (range) {
    start = range.start
    end = range.end
    status = 206
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  }
  const length = size === 0 ? 0 : end - start + 1
  headers['Content-Length'] = String(length)

  res.writeHead(status, headers)

  const isHead = (req.method || 'GET').toUpperCase() === 'HEAD'
  if (isHead || length === 0) {
    res.end()
    return
  }

  const stream = createStream(filePath, { start, end })
  const onClientGone = () => stream.destroy()
  res.on('close', onClientGone)
  const cleanup = () => res.removeListener('close', onClientGone)
  stream.on('error', () => {
    cleanup()
    // Headers (and possibly some bytes) are already on the wire, so we cannot
    // change the status. Resetting the socket is the ONLY honest signal: the
    // client sees an aborted transfer instead of a body silently shorter than
    // the promised Content-Length.
    res.destroy()
  })
  stream.on('end', cleanup)
  stream.pipe(res)
}
