/**
 * The user's live-mode MIDI button map, persisted to localStorage. Edited via
 * MIDI-learn in the settings dialog; read by the live controller.
 */
import { writable, get } from 'svelte/store'
import { browser } from '$app/environment'
import { DEFAULT_LIVE_MAPPING, type LiveAction, type LiveMapping } from './liveMidiMap'

const KEY = 'barbro::live-midi-map'

function load(): LiveMapping {
  if (!browser) return { ...DEFAULT_LIVE_MAPPING }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULT_LIVE_MAPPING, ...(JSON.parse(raw) as Partial<LiveMapping>) }
  } catch {
    /* corrupt / unavailable — fall back to defaults */
  }
  return { ...DEFAULT_LIVE_MAPPING }
}

export const liveMapping = writable<LiveMapping>(load())

liveMapping.subscribe((m) => {
  if (!browser) return
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* private mode — best-effort */
  }
})

/**
 * Assign `controlId` to `action`. A control drives exactly one action, so it's
 * first cleared from any other action it was on (that action becomes unassigned
 * until re-learned).
 */
export function bindLiveAction(action: LiveAction, controlId: string): void {
  liveMapping.update((m) => {
    const next: LiveMapping = { ...m }
    for (const k of Object.keys(next) as LiveAction[]) {
      if (next[k] === controlId) next[k] = ''
    }
    next[action] = controlId
    return next
  })
}

export function resetLiveMapping(): void {
  liveMapping.set({ ...DEFAULT_LIVE_MAPPING })
}

/** Current snapshot (non-reactive). */
export function currentLiveMapping(): LiveMapping {
  return get(liveMapping)
}
