/**
 * THE SIDECAR MUST NOT EAT PROJECT SETTINGS.
 *
 * `parseManifestObject` rebuilds `barbro.project.json` from a WHITELIST before
 * writing it. Anything not on that list is silently deleted — no error, no
 * warning, and the save button appears to work.
 *
 * This has now bitten four times: `autoStems`, `cloud`, `defaults` and
 * `mastering` each had to be added after the fact, and each has a comment
 * saying so. Then `performers` was added to the web app and NOT here, so a band
 * roster could be created, saved, and was gone the instant anything wrote the
 * manifest — which on desktop is every save. It looked like the button did
 * nothing, ten times in a row.
 *
 * A comment did not stop it happening again. A test might.
 *
 * Run: node --test desktop/electron/manifestRoundTrip.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** A manifest using every top-level field the web app can write. */
const FULL_MANIFEST = {
  formatVersion: 1,
  id: 'proj-1',
  name: 'Bröllopsgig',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  songs: [{ id: 's1', folder: 'songs/one' }],
  autoStems: { enabled: true, stems: ['drums'], quality: 'fast' },
  cloud: { projectId: 'c1', lastSyncedRevision: 3 },
  defaults: { countInBeats: 8, preCountInCue: { mode: 'title' } },
  mastering: { enabled: true, matchLoudness: true },
  performers: [
    {
      id: 'p1',
      name: 'Martin',
      role: 'Keys',
      monitorBus: 1,
      inputs: [{ id: 'i1', label: 'Piano', channels: [1, 2] }],
    },
    {
      id: 'p2',
      name: 'Anna',
      role: 'Vocals',
      monitorBus: 2,
      inputs: [{ id: 'i2', label: 'Sång', channels: [3] }],
    },
  ],
  performerMixes: {
    p1: { stems: { drums: 0.6, vocals: 0.2 }, click: 0.9, cue: 1 },
    p2: { stems: { vocals: 1 }, original: 0.7 },
  },
  liveRig: {
    routes: [{ laneKey: 'click', channels: [11], followVolume: false, followMute: false }],
    monitorSends: { 1: { click: 1, original: 0.8 } },
    busMaster: { 1: 0.75 },
  },
}

/**
 * The sidecar is one large Electron module that cannot be imported outside
 * Electron, so the parser is extracted from source and evaluated on its own.
 * Crude, but it tests the REAL function rather than a copy that could drift.
 */
async function loadParser() {
  const src = readFileSync(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8')
  const names = [
    'parseManifestObject',
    'parseManifestAutoStems',
    'parseManifestCloud',
    'parseManifestDefaults',
    'parseManifestMastering',
    'parseManifestPerformers',
    'parseManifestPerformerMixes',
    'parseManifestLiveRig',
  ]
  const fns = names
    .map((n) => {
      const at = src.indexOf(`function ${n}(`)
      assert.notEqual(at, -1, `${n} not found in main.mjs`)
      // Function bodies in this file end at a closing brace in column 0.
      const end = src.indexOf('\n}\n', at)
      assert.notEqual(end, -1, `could not delimit ${n}`)
      return src.slice(at, end + 3)
    })
    .join('\n')

  const prelude = `
    const PROJECT_FILE_VERSION = 1
    const AUTO_STEM_NAMES = ['drums', 'bass', 'vocals', 'other']
    const AUTO_STEM_QUALITIES = ['fast', 'balanced', 'best']
    function validateRelSongFolder(f) {
      if (typeof f !== 'string' || !f.startsWith('songs/')) throw new Error('bad folder')
      return f
    }
  `
  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(`${prelude}\n${fns}\nexport { parseManifestObject }`).toString('base64')}`
  )
  return mod.parseManifestObject
}

test('a full manifest survives the round trip with NOTHING dropped', async () => {
  const parse = await loadParser()
  const out = parse(FULL_MANIFEST)
  const lost = Object.keys(FULL_MANIFEST).filter((k) => out[k] === undefined)
  assert.deepEqual(
    lost,
    [],
    `the sidecar DELETED these on write: ${lost.join(', ')}. Add a parser for each in parseManifestObject — a field missing here is a setting that silently never saves.`,
  )
})

test('performers survive, with their monitor bus', async () => {
  // The exact regression: a roster that could be created and saved but was gone
  // the moment the manifest was written.
  const parse = await loadParser()
  const out = parse(FULL_MANIFEST)
  assert.equal(out.performers.length, 2)
  assert.equal(out.performers[0].name, 'Martin')
  assert.equal(out.performers[0].monitorBus, 1)
  assert.equal(out.performers[1].monitorBus, 2)
})

test('performer INPUTS survive — the band’s patch plan is not lost on write', async () => {
  const parse = await loadParser()
  const out = parse(FULL_MANIFEST)
  assert.deepEqual(out.performers[0].inputs, [{ id: 'i1', label: 'Piano', channels: [1, 2] }])
  assert.deepEqual(out.performers[1].inputs, [{ id: 'i2', label: 'Sång', channels: [3] }])
})

test('junk performer inputs are dropped, not written back broken', async () => {
  const parse = await loadParser()
  const out = parse({
    ...FULL_MANIFEST,
    performers: [
      {
        id: 'p1',
        name: 'Martin',
        inputs: [
          { id: 'ok', label: 'Piano', channels: [1, 2] },
          { id: 'bad1', label: 'No channels', channels: [] },
          { id: 'bad2', label: 'Off desk', channels: [17] },
          { label: 'No id', channels: [5] },
          { id: 'bad3', label: 'Dup', channels: [6, 6] },
        ],
      },
    ],
  })
  assert.deepEqual(out.performers[0].inputs, [{ id: 'ok', label: 'Piano', channels: [1, 2] }])
})

test('the live rig survives — routes, sends and bus masters', async () => {
  const parse = await loadParser()
  const out = parse(FULL_MANIFEST)
  assert.deepEqual(out.liveRig.routes[0].channels, [11])
  assert.equal(out.liveRig.monitorSends[1].click, 1)
  assert.equal(out.liveRig.busMaster[1], 0.75)
})

test('junk is dropped rather than written to the desk', async () => {
  const parse = await loadParser()
  const out = parse({
    ...FULL_MANIFEST,
    performers: [
      { id: 'ok', name: 'Fine', monitorBus: 99 }, // out of range
      { name: 'No id' },
      { id: 'x', name: 'Also fine', monitorBus: 3 },
    ],
    liveRig: { routes: [{ laneKey: 'click', channels: [17, 18, 0, 11] }] }, // 17/18 do not exist
  })
  assert.equal(out.performers.length, 2)
  assert.equal(out.performers[0].monitorBus, undefined, 'bus 99 must not reach the desk')
  assert.equal(out.performers[1].monitorBus, 3)
  assert.deepEqual(out.liveRig.routes[0].channels, [11], 'the XR18 has no channels 17/18')
})

test('an absent optional block stays absent rather than becoming empty', async () => {
  const parse = await loadParser()
  const { performers, liveRig, ...bare } = FULL_MANIFEST
  const out = parse(bare)
  assert.equal(out.performers, undefined)
  assert.equal(out.liveRig, undefined)
  assert.equal(out.name, 'Bröllopsgig')
})

test('performer mixes survive, level for level', async () => {
  // The trap this file exists for, third occurrence: a manifest field the web
  // writes and the sidecar whitelist silently deletes. A performer who dialed
  // in their monitor mix would lose it on the next sidecar write.
  const parse = await loadParser()
  const out = parse(FULL_MANIFEST)
  assert.deepEqual(out.performerMixes.p1, { stems: { drums: 0.6, vocals: 0.2 }, click: 0.9, cue: 1 })
  assert.deepEqual(out.performerMixes.p2, { stems: { vocals: 1 }, original: 0.7 })
})

test('a junk mix level is dropped, never coerced to silence', async () => {
  const parse = await loadParser()
  const out = parse({
    ...FULL_MANIFEST,
    performerMixes: { p1: { stems: { drums: 'loud' }, click: Number.NaN, cue: 0.5 } },
  })
  assert.deepEqual(out.performerMixes.p1, { stems: {}, cue: 0.5 })
})
