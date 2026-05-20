import { writable } from 'svelte/store'

export type DesktopCompanionStatus = {
  reachable: boolean
  version: string | null
  lastCheckedAt: string | null
  lastError: string | null
}

export const desktopCompanionStatus = writable<DesktopCompanionStatus>({
  reachable: false,
  version: null,
  lastCheckedAt: null,
  lastError: null,
})
