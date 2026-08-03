/**
 * ARE THE AUX BUSES WHAT THE MONITOR MODEL ASSUMES?
 *
 * Every in-ear mix in BarBro assumes six INDEPENDENT MONO buses: one per
 * performer, feeding one pack, heard in both ears. That assumption was never
 * checked against the desk — `/config/buslink` appeared nowhere in the codebase.
 *
 * It matters in two ways, and both are silent failures:
 *
 *  - **Linked pairs halve the count.** Six buses become three stereo pairs, so
 *    the fourth performer's "bus 4" is really the right half of pair 3-4 and
 *    they hear whatever bus 3 is sending, panned.
 *  - **The bus master moves.** On a linked pair the ODD bus owns the master, so
 *    `/bus/4/mix/fader` writes go somewhere that does not control what that
 *    performer hears. The write succeeds. Nothing happens. X-Air says nothing.
 *
 * A person with silent in-ears cannot tell that from a bad cable, which is why
 * this is worth a sentence on screen rather than an assumption in the code.
 */

/** The desk reports link state per PAIR: 1-2, 3-4, 5-6. */
export const BUS_LINK_PATHS = ['/config/buslink/1-2', '/config/buslink/3-4', '/config/buslink/5-6']

export type BusTopology = {
  /** True only when the desk confirmed every pair is unlinked. */
  mono: boolean
  /** Pairs the desk said are linked, as labels: `'1-2'`. */
  linkedPairs: string[]
  /** True when the desk did not answer — which is NOT the same as mono. */
  unknown: boolean
  /** Said plainly, for someone standing at a desk. */
  reason: string
}

type Replies = Record<string, { type: string; value: number | string }[] | undefined>

/**
 * Read the link state. An unanswered query is `unknown`, never `mono`.
 *
 * The whole point of this check is to stop the app claiming something about the
 * desk that the desk never said. Treating silence as "unlinked" would reinstate
 * exactly the assumption being tested.
 */
export function readBusTopology(replies: Replies): BusTopology {
  const linkedPairs: string[] = []
  let answered = 0
  for (const path of BUS_LINK_PATHS) {
    const v = replies[path]?.[0]?.value
    if (typeof v !== 'number') continue
    answered++
    if (v !== 0) linkedPairs.push(path.slice('/config/buslink/'.length))
  }

  if (answered < BUS_LINK_PATHS.length) {
    return {
      mono: false,
      linkedPairs,
      unknown: true,
      reason:
        'The desk did not say whether its aux buses are linked, so the monitor mixes cannot be trusted yet. Read the desk again.',
    }
  }
  if (linkedPairs.length === 0) {
    return { mono: true, linkedPairs: [], unknown: false, reason: '' }
  }
  const pairs = linkedPairs.join(' and ')
  return {
    mono: false,
    linkedPairs,
    unknown: false,
    reason: `Aux ${pairs} ${linkedPairs.length === 1 ? 'is' : 'are'} linked as a stereo pair on the desk, but each performer needs their own mono mix. Unlink ${linkedPairs.length === 1 ? 'it' : 'them'} on the mixer, or two people will share one mix.`,
  }
}

/** How many independent monitor mixes this desk can actually give out. */
export function availableMonitorBuses(topology: BusTopology): number {
  if (topology.unknown) return 0
  return 6 - topology.linkedPairs.length
}
