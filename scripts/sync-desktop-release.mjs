#!/usr/bin/env node
/**
 * Copies the latest Apple Silicon DMG from desktop/release into static/releases/
 * so SvelteKit serves it at /releases/barbro-desktop-<version>-arm64.dmg (same origin).
 *
 * Run after: cd desktop && npm run dist:mac-arm64
 * Then from repo root: npm run sync-desktop-release
 */

import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const desktopPkgPath = join(root, 'desktop', 'package.json')
const releaseDir = join(root, 'desktop', 'release')
const outDir = join(root, 'static', 'releases')

const pkg = JSON.parse(readFileSync(desktopPkgPath, 'utf8'))
const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0'

if (!existsSync(releaseDir)) {
  console.error('desktop/release not found. Run: cd desktop && npm run dist:mac-arm64')
  process.exit(1)
}

const dmgName = `barbro-desktop-${version}-arm64.dmg`
const candidates = readdirSync(releaseDir).filter(
  (f) => f.endsWith('-arm64.dmg') && !f.endsWith('.blockmap'),
)

if (candidates.length === 0) {
  console.error('No *-arm64.dmg found in desktop/release/. Build the desktop app first.')
  process.exit(1)
}

/** Prefer exact version match in filename, else newest sort */
const preferred = candidates.find((f) => f.includes(version)) ?? candidates.sort().pop()
const src = join(releaseDir, preferred)

mkdirSync(outDir, { recursive: true })
const dest = join(outDir, dmgName)
copyFileSync(src, dest)
console.log(`Synced ${preferred} -> static/releases/${dmgName}`)
console.log(`Public URL: /releases/${dmgName}`)

const manifestPath = join(root, 'static', 'desktop-downloads.json')
try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest && typeof manifest === 'object') {
    manifest.version = version
    if (!manifest.artifacts) manifest.artifacts = {}
    const arm = manifest.artifacts['darwin-arm64']
    if (arm && typeof arm === 'object') {
      arm.url = `/releases/${dmgName}`
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`Updated static/desktop-downloads.json (darwin-arm64 → /releases/${dmgName})`)
  }
} catch (e) {
  console.warn('Could not update desktop-downloads.json:', e instanceof Error ? e.message : e)
}
