/**
 * Save / load user-made synth patches in localStorage. Built-in presets live in
 * `keysSynth.ts` (`BUILTIN_PRESETS`); these are the ones the user creates.
 */
import type { SynthPatch } from './keysSynth'

const KEY = 'barbro.synth.userPresets.v1'

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/** All user presets, newest-saved last. Never throws. */
export function loadUserPresets(): SynthPatch[] {
  const ls = safeLocalStorage()
  if (!ls) return []
  try {
    const raw = ls.getItem(KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? (arr as SynthPatch[]) : []
  } catch {
    return []
  }
}

/** Save a patch under its name (replacing any existing one with that name). */
export function saveUserPreset(patch: SynthPatch): SynthPatch[] {
  const ls = safeLocalStorage()
  const name = patch.name.trim() || 'My patch'
  const next = [...loadUserPresets().filter((p) => p.name !== name), { ...patch, name }]
  if (ls) {
    try {
      ls.setItem(KEY, JSON.stringify(next))
    } catch {
      /* quota / disabled — best effort */
    }
  }
  return next
}

/** Delete a user preset by name. */
export function deleteUserPreset(name: string): SynthPatch[] {
  const ls = safeLocalStorage()
  const next = loadUserPresets().filter((p) => p.name !== name)
  if (ls) {
    try {
      ls.setItem(KEY, JSON.stringify(next))
    } catch {
      /* best effort */
    }
  }
  return next
}
