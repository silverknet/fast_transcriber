import type { Snippet } from 'svelte'

/**
 * Tiny snippet portal for the Song Edit DAW shell.
 *
 * Lets a mode's editor component (e.g. `TimelineWorkspace`) keep DEEP controls
 * defined in its own markup — so they retain their closures over that
 * component's `$state` + handlers — while RENDERING them inside the shell-owned
 * right inspector `<aside>` (`EditInspector`). The snippet stays reactive to its
 * defining component's state even though it paints in another subtree; this is a
 * supported Svelte 5 pattern.
 *
 * The editor sets `extra` while its tab is active and clears it (via an
 * `$effect` cleanup) on unmount / tab change. `EditInspector` renders it.
 */
class InspectorPortal {
  /** Extra inspector content contributed by the active mode's editor, or null. */
  extra = $state<Snippet | null>(null)
}

export const inspectorPortal = new InspectorPortal()
