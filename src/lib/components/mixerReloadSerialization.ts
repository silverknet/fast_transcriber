/**
 * Serializing mixer rebuilds.
 *
 * Rebuilding wipes every track before it re-adds them, so it is NOT re-entrant:
 * two overlapping runs wipe each other's freshly-added tracks and can leave the
 * mixer empty. Callers are spread out (song change, machine edits, the add-track
 * menu, settings watchers), and several can fire from one user action — so the
 * safety has to live here rather than in each caller's head.
 *
 * A call arriving mid-flight rides along and asks for exactly ONE more pass, so
 * work that arrived during a rebuild is never dropped and a burst never queues
 * a rebuild per call.
 */
export function createReloadSerializer(run: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null
  let requestedAgain = false

  return function reload(): Promise<void> {
    if (inFlight) {
      requestedAgain = true
      return inFlight
    }
    inFlight = (async () => {
      try {
        do {
          requestedAgain = false
          await run()
        } while (requestedAgain)
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }
}
