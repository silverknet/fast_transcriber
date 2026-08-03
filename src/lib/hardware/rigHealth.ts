/**
 * IS THE RIG ACTUALLY READY? — one honest answer, from evidence only.
 *
 * This drives a single indicator in the navbar, and the whole value of that
 * indicator is that it is never optimistic. A green light that means "probably"
 * is worse than no light: it gets trusted at load-in, and the first proof that
 * it was wrong is silence in front of an audience — or a click track in the
 * house, which is the one mistake everyone hears.
 *
 * ## The rule
 *
 * Every check is a claim about the DESK, and every claim must be backed by
 * something the desk actually said. Nothing is inferred from "we sent the
 * command". X-AIR ignores addresses it does not have — silently, no reply, no
 * error — so a write is not evidence that anything happened. That failure mode
 * cost an entire afternoon and produced total silence with every setting
 * apparently correct.
 *
 * So an unknown is NEVER treated as a pass. Missing read-back is amber, not
 * green, and the reason is always stated in the words of the thing that is
 * wrong rather than as a status code.
 */

/**
 * How strong the proof behind a passing check is. The vocabulary comes from
 * the live-audio architecture (docs/architecture/audio-system-overview.md):
 * readiness must NAME its evidence, because "configured" and "proven" look
 * like the same green dot and are nothing like the same fact.
 *
 *  - `configured` — someone filled a field in. Nothing external agreed.
 *  - `observed`   — the desk itself reported it, by read-back or handshake.
 *  - `confirmed`  — a person physically verified it (heard it, saw the meter).
 */
export type RigEvidence = 'configured' | 'observed' | 'confirmed'

/** One thing that has to be true, and whether the desk has confirmed it. */
export type RigCheck = {
  key: 'connected' | 'usb-input' | 'foh-safe' | 'monitors'
  /** Shown to a person standing at a desk. No jargon, no addresses. */
  label: string
  state: 'pass' | 'fail' | 'unknown'
  /** Why, when it is not a pass. Empty on pass. */
  detail: string
  /** What a PASS here would actually rest on. Present on every check so the
   *  UI can say "set up" vs "proven" instead of one undifferentiated green. */
  evidence: RigEvidence
}

export type RigHealth = {
  /** Green ONLY when every check passed on evidence. */
  ready: boolean
  /** True when something is actively wrong, as opposed to merely unproven. */
  broken: boolean
  checks: RigCheck[]
  /** One sentence for a tooltip. */
  summary: string
}

export type RigHealthInput = {
  /** The desk answered `/xinfo` — a real handshake, not an open socket. */
  deskIdentified: boolean
  /** Model/firmware the desk reported, for the tooltip. */
  deskLabel?: string | null
  /**
   * BarBro's channels are fed from USB AND from the right USB channels.
   * `null` when it has not been checked — which is not the same as false.
   */
  usbInputOk: boolean | null
  /**
   * Click and cue are proven OFF the main bus BY READ-BACK.
   * `null` when unverified. Never assume: this is the check that matters most.
   */
  fohSafe: boolean | null
  /** Channels that are still on the house when they must not be. */
  unsafeChannels?: readonly number[]
  /** How many performers have a monitor bus assigned. */
  monitorsConfigured: number
}

/**
 * Fold the evidence into one verdict.
 *
 * Deliberately total: every branch returns a stated reason, so the indicator can
 * always say WHY rather than just going amber.
 */
export function rigHealth(input: RigHealthInput): RigHealth {
  const checks: RigCheck[] = []

  checks.push(
    input.deskIdentified
      ? {
          key: 'connected',
          label: input.deskLabel ? `Desk connected (${input.deskLabel})` : 'Desk connected',
          state: 'pass',
          detail: '',
          evidence: 'observed',
        }
      : {
          key: 'connected',
          label: 'Desk connected',
          state: 'fail',
          detail: 'No mixer has answered. Press Find my desk on the rig page.',
          evidence: 'observed',
        },
  )

  checks.push(
    input.usbInputOk === true
      ? { key: 'usb-input', label: 'Desk is hearing this computer', state: 'pass', detail: '', evidence: 'observed' }
      : input.usbInputOk === false
        ? {
            key: 'usb-input',
            label: 'Desk is hearing this computer',
            state: 'fail',
            detail: 'The channels carrying BarBro are listening to their sockets, not to USB.',
            evidence: 'observed',
          }
        : {
            key: 'usb-input',
            label: 'Desk is hearing this computer',
            state: 'unknown',
            detail: 'Not checked yet.',
            evidence: 'observed',
          },
  )

  // The one that ends a show. An UNVERIFIED state is reported as a failure of
  // proof, never quietly rolled into "probably fine".
  checks.push(
    input.fohSafe === true
      ? { key: 'foh-safe', label: 'Click and cues kept out of the house', state: 'pass', detail: '', evidence: 'observed' }
      : input.fohSafe === false
        ? {
            key: 'foh-safe',
            label: 'Click and cues kept out of the house',
            state: 'fail',
            detail: `Still going to the house: channel ${(input.unsafeChannels ?? []).join(', ') || 'unknown'}. Fix before you go live.`,
            evidence: 'observed',
          }
        : {
            key: 'foh-safe',
            label: 'Click and cues kept out of the house',
            state: 'unknown',
            detail: 'Not proven yet — the desk has not been read back.',
            evidence: 'observed',
          },
  )

  checks.push(
    input.monitorsConfigured > 0
      ? {
          key: 'monitors',
          label: `${input.monitorsConfigured} in-ear mix${input.monitorsConfigured === 1 ? '' : 'es'} set up`,
          state: 'pass',
          detail: '',
          // Assignment is a form someone filled in — the desk has said nothing
          // about signal actually leaving those buses. Named as such so the
          // chip can say "set up, not yet proven" instead of a flat green.
          evidence: 'configured',
        }
      : {
          key: 'monitors',
          label: 'In-ear mixes set up',
          state: 'unknown',
          detail: 'No performer has a monitor assigned yet.',
          evidence: 'configured',
        },
  )

  const ready = checks.every((c) => c.state === 'pass')
  const broken = checks.some((c) => c.state === 'fail')

  let summary: string
  if (ready) {
    const weakest = checks.some((c) => c.state === 'pass' && c.evidence === 'configured')
    summary = weakest
      ? 'Rig ready — desk proven; monitor mixes are set up but not yet proven with signal.'
      : 'Rig ready — desk connected, hearing this computer, click and cues off the house.'
  } else {
    const worst = checks.find((c) => c.state === 'fail') ?? checks.find((c) => c.state === 'unknown')
    summary = worst ? `${worst.label}: ${worst.detail}` : 'Rig not ready.'
  }

  return { ready, broken, checks, summary }
}

/**
 * The one thing that must never be true, stated as a function.
 *
 * A lane carrying click or spoken cues must never be assigned to the main bus,
 * whatever a stored config says. Kept separate from the desk-verification path
 * so it can be enforced BEFORE anything is written, not merely detected after.
 */
export function isMonitorOnlyLaneKey(laneKey: string): boolean {
  return laneKey === 'click' || laneKey === 'cue'
}

/**
 * Strip any main-bus assignment that would put click or cues into the house.
 *
 * Belt and braces over `xairFohSafetyPlan`: that builds the correct plan, this
 * guarantees no *other* code path can hand the desk an assignment that would
 * undo it. The house is the one place a mistake is heard by everyone.
 */
export function withoutHouseAssignmentForMonitorLanes<
  T extends { laneKey: string; channels: readonly number[] },
>(routes: readonly T[]): { monitorOnlyChannels: number[]; musicalChannels: number[] } {
  const monitorOnly = new Set<number>()
  const musical = new Set<number>()
  for (const r of routes) {
    const target = isMonitorOnlyLaneKey(r.laneKey) ? monitorOnly : musical
    for (const c of r.channels) if (Number.isInteger(c) && c >= 1 && c <= 16) target.add(c)
  }
  // A channel shared between a musical lane and a monitor-only lane is treated
  // as MONITOR-ONLY. Safety wins over convenience: the cost of being wrong in
  // this direction is a quiet monitor, and in the other it is click in the PA.
  for (const c of monitorOnly) musical.delete(c)
  return {
    monitorOnlyChannels: [...monitorOnly].sort((a, b) => a - b),
    musicalChannels: [...musical].sort((a, b) => a - b),
  }
}
