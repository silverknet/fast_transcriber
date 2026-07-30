/**
 * Debounced, coalescing work queue for "this lane changed, re-render it".
 *
 * Dragging a slider fires a change per pixel. Re-rendering on each one makes
 * the editor unusable, and letting renders overlap means an older, slower one
 * can land last and overwrite the newest audio. So:
 *
 *   - schedule() coalesces a burst into ONE run per key after `delayMs`
 *   - only one run happens at a time
 *   - anything scheduled DURING a run is picked up on the next pass rather
 *     than starting a second concurrent render
 *
 * Extracted from the mixer so this behaviour is testable without mounting a
 * 2,700-line component.
 */
export type RefreshQueue = {
  /** Queue `key` for refresh, restarting the debounce window. */
  schedule: (key: string) => void
  /** Run everything pending right now, skipping the debounce. */
  flush: () => Promise<void>
  /** Drop pending work and cancel the timer (teardown). */
  cancel: () => void
  /** Testing/diagnostics: keys waiting to run. */
  pending: () => string[]
  /** Testing/diagnostics: whether a run is in flight. */
  isRunning: () => boolean
}

export function createRefreshQueue(
  run: (key: string) => Promise<void>,
  delayMs: number,
): RefreshQueue {
  let timer: ReturnType<typeof setTimeout> | null = null
  const pending = new Set<string>()
  let running = false

  async function drain(): Promise<void> {
    if (running) return
    running = true
    try {
      while (pending.size > 0) {
        const keys = [...pending]
        pending.clear()
        for (const k of keys) {
          try {
            await run(k)
          } catch {
            // One failing lane must not strand the queue or block its siblings.
          }
        }
      }
    } finally {
      running = false
    }
  }

  return {
    schedule(key) {
      pending.add(key)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void drain()
      }, delayMs)
    },
    async flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      await drain()
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      pending.clear()
    },
    pending: () => [...pending],
    isRunning: () => running,
  }
}
