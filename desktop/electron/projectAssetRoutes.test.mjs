/**
 * HTTP-level e2e for the project asset endpoints. Run with:
 *   node --test desktop/electron/projectAssetRoutes.test.mjs
 *
 * Boots the REAL handlers (from projectAssetRoutes.mjs) behind a real
 * http.createServer — the same dispatch shape main.mjs uses — and drives the
 * full "Replace audio" round-trip over the loopback with fetch: write a master,
 * read it back (full + Range), overwrite it, remove it, and confirm traversal +
 * malformed requests are rejected. This is the endpoint whose failure started
 * the whole investigation.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createProjectAssetRoutes } from './projectAssetRoutes.mjs'

// Faithful stand-ins for main.mjs's injected plumbing.
function sendJson(res, status, payload, cors) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    ...cors,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}
async function readRequestJson(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (chunks.length === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

/** Boot the asset routes behind a real server, mirroring main.mjs's dispatch. */
async function startAssetServer() {
  const routes = createProjectAssetRoutes({ sendJson, readRequestJson })
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'POST' && u.pathname === '/native/project/song/asset/write') return void routes.write(req, res, {})
    if (req.method === 'POST' && u.pathname === '/native/project/song/asset/remove') return void routes.remove(req, res, {})
    if (req.method === 'GET' && u.pathname === '/native/project/song/asset/read') return void routes.read(req, res, {}, u)
    res.writeHead(404)
    res.end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`
  return { base, close: () => new Promise((r) => server.close(r)) }
}

function tempProject() {
  const root = mkdtempSync(path.join(tmpdir(), 'barbro-assets-'))
  const projectPath = path.join(root, 'MyProject')
  mkdirSync(projectPath, { recursive: true })
  return { root, projectPath, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

const post = (base, route, body) =>
  fetch(`${base}/native/project/song/asset/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

function readUrl(base, projectPath, songFolder, subpath) {
  const u = new URL(`${base}/native/project/song/asset/read`)
  u.searchParams.set('projectPath', projectPath)
  u.searchParams.set('songFolder', songFolder)
  u.searchParams.set('subpath', subpath)
  return u.toString()
}

test('replace-audio round-trip over HTTP: write → read → range → overwrite → remove → 404', async () => {
  const srv = await startAssetServer()
  const fx = tempProject()
  const songFolder = 'songs/tune-abc'
  const subpath = 'audio/master.wav'
  try {
    // WRITE a master (base64), then READ it back byte-identical.
    const first = Buffer.alloc(4096, 0xab)
    let r = await post(srv.base, 'write', {
      projectPath: fx.projectPath,
      songFolder,
      subpath,
      contentBase64: first.toString('base64'),
    })
    assert.equal(r.status, 200)
    assert.equal((await r.json()).ok, true)

    r = await fetch(readUrl(srv.base, fx.projectPath, songFolder, subpath))
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('content-type'), 'audio/wav')
    assert.equal(r.headers.get('accept-ranges'), 'bytes')
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(first))

    // RANGE read (proves the serving fix is wired through the endpoint).
    r = await fetch(readUrl(srv.base, fx.projectPath, songFolder, subpath), {
      headers: { Range: 'bytes=0-99' },
    })
    assert.equal(r.status, 206)
    assert.equal(Buffer.from(await r.arrayBuffer()).length, 100)

    // OVERWRITE (replace audio) with different content + size → read reflects it.
    const second = Buffer.alloc(8000, 0xcd)
    r = await post(srv.base, 'write', {
      projectPath: fx.projectPath,
      songFolder,
      subpath,
      contentBase64: second.toString('base64'),
    })
    assert.equal(r.status, 200)
    r = await fetch(readUrl(srv.base, fx.projectPath, songFolder, subpath))
    const got = Buffer.from(await r.arrayBuffer())
    assert.equal(got.length, 8000)
    assert.equal(got[0], 0xcd)

    // REMOVE → subsequent read is a clean 404 (not a truncated stream).
    r = await post(srv.base, 'remove', { projectPath: fx.projectPath, songFolder, subpath })
    assert.equal(r.status, 200)
    r = await fetch(readUrl(srv.base, fx.projectPath, songFolder, subpath))
    assert.equal(r.status, 404)
  } finally {
    fx.cleanup()
    await srv.close()
  }
})

test('path traversal is rejected on write/read/remove (400), never escaping the project', async () => {
  const srv = await startAssetServer()
  const fx = tempProject()
  try {
    const evil = '../../../tmp/pwned.wav'
    let r = await post(srv.base, 'write', {
      projectPath: fx.projectPath,
      songFolder: 'songs/s',
      subpath: evil,
      contentBase64: Buffer.from('x').toString('base64'),
    })
    assert.equal(r.status, 400)

    r = await post(srv.base, 'remove', { projectPath: fx.projectPath, songFolder: 'songs/../..', subpath: 'audio/x.wav' })
    assert.equal(r.status, 400)

    r = await fetch(readUrl(srv.base, fx.projectPath, 'songs/s', evil))
    assert.equal(r.status, 400)
  } finally {
    fx.cleanup()
    await srv.close()
  }
})

test('malformed / missing inputs → correct status codes', async () => {
  const srv = await startAssetServer()
  const fx = tempProject()
  try {
    // non-JSON body
    let r = await fetch(`${srv.base}/native/project/song/asset/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json{',
    })
    assert.equal(r.status, 400)

    // projectPath that doesn't exist → 404
    r = await post(srv.base, 'write', {
      projectPath: path.join(fx.root, 'does-not-exist'),
      songFolder: 'songs/s',
      subpath: 'audio/x.wav',
      contentBase64: Buffer.from('x').toString('base64'),
    })
    assert.equal(r.status, 404)

    // missing contentBase64 → 400
    r = await post(srv.base, 'write', { projectPath: fx.projectPath, songFolder: 'songs/s', subpath: 'audio/x.wav' })
    assert.equal(r.status, 400)

    // read of a never-written file → 404
    r = await fetch(readUrl(srv.base, fx.projectPath, 'songs/s', 'audio/nope.wav'))
    assert.equal(r.status, 404)
  } finally {
    fx.cleanup()
    await srv.close()
  }
})
