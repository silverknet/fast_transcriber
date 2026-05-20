/**
 * Deterministic write for `barbro.project.json`.
 * Mirrors the key-sorting approach in smapFile.ts so the same logical
 * project produces the same bytes — easier to reason about diffs and
 * survives across versioned builds.
 */

import type { ProjectFile } from './types'

function sortKeysDeep(x: unknown): unknown {
  if (x === undefined) return undefined
  if (x === null || typeof x !== 'object') return x
  if (Array.isArray(x)) return x.map(sortKeysDeep)
  const o = x as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(o).sort()) {
    const v = o[k]
    if (v === undefined) continue
    const inner = sortKeysDeep(v)
    if (inner !== undefined) out[k] = inner
  }
  return out
}

export function serializeProject(project: ProjectFile, pretty: boolean = true): string {
  const sorted = sortKeysDeep(project)
  return JSON.stringify(sorted, null, pretty ? 2 : 0)
}

export function projectToBlob(project: ProjectFile): Blob {
  return new Blob([serializeProject(project)], { type: 'application/json' })
}
