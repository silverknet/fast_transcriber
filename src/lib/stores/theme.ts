import { readable } from 'svelte/store'

/**
 * Bumps whenever the light/dark theme changes — i.e. the `dark` class on
 * `<html>` is toggled (see AppMenuBar's `toggleDarkMode`). Canvas-drawn views
 * (the waveforms) subscribe to this so they REDRAW with the new theme colours:
 * a `<canvas>` paints concrete pixels and can't react to CSS-variable changes on
 * its own, so without this a theme flip leaves the old colour on screen until
 * something else forces a repaint.
 */
export const themeTick = readable(0, (set) => {
  if (typeof document === 'undefined') return
  let n = 0
  const mo = new MutationObserver(() => set((n += 1)))
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => mo.disconnect()
})
