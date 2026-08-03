/**
 * The rig setup checks, as data.
 *
 * Wiring a desk fails in a small number of specific ways, and each has a
 * different fix. Naming them and ordering them by dependency is most of the
 * value: if audio never reaches the desk, no amount of fader-wiggling helps,
 * so that check comes first and the rest stay locked behind it.
 *
 * Pure — no audio, no network — so the ordering and the pass/fail rules are
 * testable without a desk plugged in.
 */

export type CheckId =
  | 'output-device'
  | 'usb-arrives'
  | 'channel-identity'
  | 'desk-connect'
  | 'desk-readback'
  | 'main-lr'
  | 'aux-sends'
  | 'foh-safety'

export type CheckState = 'blocked' | 'ready' | 'running' | 'passed' | 'failed' | 'skipped'

export type RigCheck = {
  id: CheckId
  title: string
  /** What the user is being asked to confirm, in their words. */
  question: string
  /** What to do when it fails — the single most useful sentence. */
  remedy: string
  /** Checks that must pass first; a failure here makes this one unanswerable. */
  requires: CheckId[]
  /** True when the answer comes from the user's ears/eyes, not from code. */
  manual: boolean
  /** True when it writes to the desk, so it needs an armed connection. */
  writesToDesk: boolean
}

/**
 * Ordered by dependency, not by importance.
 *
 * The USB routing step is the one that catches almost everyone: an X Air
 * channel sources from either its Local analog input or USB, and the default is
 * Local. Until that block is switched, faders do nothing and the desk looks
 * broken.
 */
export const RIG_CHECKS: readonly RigCheck[] = [
  {
    id: 'output-device',
    title: 'Computer is playing into the desk',
    question: 'Is the system audio output set to the XR18?',
    remedy:
      'System Settings → Sound → Output → XR18. Anything else and the desk never sees audio.',
    requires: [],
    manual: true,
    writesToDesk: false,
  },
  {
    id: 'usb-arrives',
    title: 'USB audio reaches a channel',
    question: 'With the tone playing, do the desk meters move?',
    remedy:
      'In X AIR Edit → Routing → Inputs, set the input block to USB. Channels default to their Local analog inputs, so USB audio never appears until you switch this.',
    requires: ['output-device'],
    manual: true,
    writesToDesk: false,
  },
  {
    id: 'channel-identity',
    title: 'Left and right are where you think',
    question: 'Left-only tone lights the channel you expect, and right-only the other?',
    remedy:
      'Note the two channels that actually light up and set them as the pair below — the rest of this page uses them.',
    requires: ['usb-arrives'],
    manual: true,
    writesToDesk: false,
  },
  {
    id: 'desk-connect',
    title: 'BarBro can reach the desk',
    question: 'Connected over the network?',
    remedy:
      'Same network as the XR18, correct IP, port 10024. The desk shows its IP under Setup → Network.',
    requires: [],
    manual: false,
    writesToDesk: false,
  },
  {
    id: 'desk-readback',
    title: 'The desk answers back',
    question: 'Does reading the desk return real channel state?',
    remedy:
      'Two-way OSC is blocked. Check for a firewall, a guest/AP-isolated network, or another app holding the desk.',
    requires: ['desk-connect'],
    manual: false,
    writesToDesk: false,
  },
  {
    id: 'main-lr',
    title: 'House output',
    question: 'Does the tone reach the main speakers?',
    remedy:
      'Check the channel is assigned to Main LR, the main fader is up, and the amp/speakers are on.',
    requires: ['channel-identity', 'desk-connect'],
    manual: true,
    writesToDesk: true,
  },
  {
    id: 'aux-sends',
    title: 'Each monitor output',
    question: 'Does each in-ear pack get the tone, one at a time?',
    remedy:
      "Raise that aux send on the test channel, and check the pack's own volume. Aux sends are mono on the XR18 — one aux per player.",
    requires: ['channel-identity', 'desk-connect'],
    manual: true,
    writesToDesk: true,
  },
  {
    id: 'foh-safety',
    title: 'Click and cues stay out of the house',
    question: 'Are the monitor-only channels off the main bus, confirmed by read-back?',
    remedy:
      'Take those channels off Main LR. This is checked by reading the desk back, not by assuming the message landed.',
    requires: ['desk-readback'],
    manual: false,
    writesToDesk: true,
  },
]

export function rigCheck(id: CheckId): RigCheck {
  const found = RIG_CHECKS.find((c) => c.id === id)
  if (!found) throw new Error(`unknown rig check: ${id}`)
  return found
}

/**
 * Whether a check can be attempted yet.
 *
 * A check whose prerequisite has not passed is `blocked` — deliberately not
 * `failed`. "You cannot answer this yet" and "this is broken" are different
 * things, and conflating them sends people fixing the wrong end of the chain.
 */
export function checkState(
  id: CheckId,
  results: Partial<Record<CheckId, CheckState>>,
): CheckState {
  const own = results[id]
  if (own === 'passed' || own === 'failed' || own === 'running' || own === 'skipped') return own
  const blocked = rigCheck(id).requires.some((dep) => results[dep] !== 'passed')
  return blocked ? 'blocked' : 'ready'
}

/** The first thing still worth doing — what the page should point at. */
export function nextActionable(
  results: Partial<Record<CheckId, CheckState>>,
): CheckId | null {
  for (const check of RIG_CHECKS) {
    const state = checkState(check.id, results)
    if (state === 'ready' || state === 'failed') return check.id
  }
  return null
}

/** True when everything that matters for a show has passed. */
export function rigReady(results: Partial<Record<CheckId, CheckState>>): boolean {
  return RIG_CHECKS.every((c) => {
    const state = checkState(c.id, results)
    return state === 'passed' || state === 'skipped'
  })
}
