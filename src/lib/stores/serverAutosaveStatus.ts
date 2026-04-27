import { writable } from 'svelte/store'

export type ServerAutosaveStatus = {
  enabled: boolean
  saving: boolean
  lastCheckedAt: string | null
  lastSavedAt: string | null
  lastError: string | null
  sessionId: string | null
}

export const serverAutosaveStatus = writable<ServerAutosaveStatus>({
  enabled: false,
  saving: false,
  lastCheckedAt: null,
  lastSavedAt: null,
  lastError: null,
  sessionId: null,
})
