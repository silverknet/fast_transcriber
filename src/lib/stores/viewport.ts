import { readable } from 'svelte/store'

/**
 * The app's first viewport signal: `true` on phone-width screens. Drives the
 * read-only mobile "Live" layout (a corner song-menu + a non-scrolling stage)
 * without a separate route — the same live page adapts.
 *
 * SSR-safe: defaults to `false` (desktop) and only subscribes to `matchMedia`
 * in the browser, so it never touches `window` during server render.
 */
const NARROW_QUERY = '(max-width: 640px)'

export const isNarrow = readable(false, (set) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  const mq = window.matchMedia(NARROW_QUERY)
  set(mq.matches)
  const onChange = (e: MediaQueryListEvent) => set(e.matches)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
})
