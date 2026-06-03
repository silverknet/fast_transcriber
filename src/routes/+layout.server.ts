/**
 * No server-side session restoration. The desktop sidecar is the only
 * persistence layer for projects + songs; the browser-side restore happens
 * in `+layout.svelte` via `tryRestoreLastProject`. This file exists only
 * to opt out of any inherited parent loads.
 */
export async function load(): Promise<Record<string, never>> {
  return {}
}
