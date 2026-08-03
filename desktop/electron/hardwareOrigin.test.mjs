/**
 * Who may move the desk's faders.
 *
 * Two failures to prevent, pulling in opposite directions:
 *
 *  - Too open: any web page you have in a tab could drive the console during a
 *    show. That is why the gate exists.
 *  - Too closed: the GIG BUILD serves the app from `http://127.0.0.1:47842`,
 *    which is a DIFFERENT origin from both the dev server and the deployed
 *    site. Tightening this without knowing that would leave the XR18 controls
 *    dead in exactly the offline build made for playing live — and the symptom
 *    would be a silent 403 at load-in.
 *
 * Run: node --test desktop/electron/hardwareOrigin.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * `isHardwareOriginAllowed` lives inside main.mjs, which imports Electron and
 * cannot be loaded here. Lift the function out and evaluate it — crude, but it
 * tests the REAL implementation rather than a copy that could drift.
 */
function loadOriginGate(env = {}) {
  const src = readFileSync(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8')
  const start = src.indexOf('function isHardwareOriginAllowed(')
  assert.ok(start > 0, 'isHardwareOriginAllowed not found — was it renamed?')
  const end = src.indexOf('\n}\n', start)
  assert.ok(end > start, 'could not delimit the function body')
  const body = src.slice(start, end + 2)
  const factory = new Function('process', `${body}; return isHardwareOriginAllowed`)
  return factory({ env })
}

test('the gig build origin is allowed — the offline app must reach the desk', () => {
  const allowed = loadOriginGate()
  // The desktop app serves the UI here in gig mode.
  assert.equal(allowed('http://127.0.0.1:47842'), true)
})

test('development and production origins keep working', () => {
  const allowed = loadOriginGate()
  assert.equal(allowed('http://localhost:5173'), true)
  assert.equal(allowed('http://127.0.0.1:5173'), true)
  assert.equal(allowed('https://barbro.netlify.app'), true)
})

test('a same-origin or non-browser request is allowed', () => {
  const allowed = loadOriginGate()
  // Browsers omit Origin for same-origin GETs; Electron and curl send none.
  assert.equal(allowed(undefined), true)
  assert.equal(allowed(''), true)
})

test('a random site CANNOT move the faders', () => {
  const allowed = loadOriginGate()
  for (const o of [
    'https://evil.example.com',
    'http://evil.example.com',
    'https://barbro.netlify.app.evil.com',
    'https://notlocalhost',
  ]) {
    assert.equal(allowed(o), false, o)
  }
})

test('plain http on a public host is refused even if it looks like prod', () => {
  const allowed = loadOriginGate()
  assert.equal(allowed('http://barbro.netlify.app'), false)
})

test('malformed origins are refused rather than throwing', () => {
  const allowed = loadOriginGate()
  assert.equal(allowed('not a url'), false)
})

test('an operator can add an origin explicitly', () => {
  const allowed = loadOriginGate({ BARBRO_HARDWARE_ORIGINS: 'https://studio.example.com' })
  assert.equal(allowed('https://studio.example.com'), true)
  assert.equal(allowed('https://other.example.com'), false)
})
