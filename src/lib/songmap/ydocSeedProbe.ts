/**
 * Seed-determinism probe, run as a SEPARATE node process by `ydoc.test.ts`.
 *
 * The §8 hazard is that a fresh `Y.Doc` picks a random `clientID`, so two
 * DEVICES seeding the same `.smap` mint two different documents that merge into
 * a duplicated song. An in-process double-seed catches that (each `new Y.Doc()`
 * re-randomises), but only a second process also rules out anything seeded from
 * process-level entropy or module-load order. This prints the seed digest so
 * the test can compare it against its own.
 *
 * Not imported by the app.
 */
import { createHash } from 'node:crypto'
import { songMapSeedUpdate } from './ydoc'
import { minimalSongMap, richSongMap } from './ydocFixtures'

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const out = {
  rich: digest(songMapSeedUpdate(richSongMap())),
  minimal: digest(songMapSeedUpdate(minimalSongMap())),
}

process.stdout.write(JSON.stringify(out))
