import { writable } from 'svelte/store'

/**
 * The user chose to keep using BarBro WITHOUT the desktop app — browser/collab
 * mode — even though the sidecar is present but outdated/needs attention.
 *
 * Set from the `/download` gate's "Continue without BarBro Desktop" escape and
 * read by the layout's redirect so it stops yanking them back to `/download`.
 * An outdated sidecar shouldn't lock you out any harder than NO sidecar does
 * (which already falls through to Collab mode).
 *
 * Session-scoped: a fresh launch re-surfaces the update nudge, but it never
 * traps — one click always gets you into the app.
 */
const KEY = 'barbro-continue-without-desktop'

function readInitial(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export const continueWithoutDesktop = writable<boolean>(readInitial())

continueWithoutDesktop.subscribe((v) => {
  try {
    if (typeof sessionStorage === 'undefined') return
    if (v) sessionStorage.setItem(KEY, '1')
    else sessionStorage.removeItem(KEY)
  } catch {
    /* storage blocked (private mode) — in-memory only, still works this session */
  }
})
