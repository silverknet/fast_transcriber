/**
 * DESK WRITES FOR THE SPLIT — strips that carry BarBro's click and cues.
 *
 * Pure planning: turn a `RigLayout` into the exact OSC writes that make the
 * desk's strips listen to the right USB returns, stay OFF the house, and feed
 * the monitor buses — plus the read-back list that PROVES it took. No I/O
 * here; `XAirSettingsPanel` performs the writes and shows the proof.
 *
 * Two safety properties, enforced by tests:
 *  - CONFIGURATION ONLY: nothing in the strip plan can raise a level — no
 *    fader writes, no bus-master writes. Taking a strip off the house makes
 *    the room QUIETER; switching its input changes what it carries, not how
 *    loud anything is (monitor sends are separate, and deliberately modest).
 *  - CLAIM-ONCE GATE: switching a strip to USB (`rtnsw=1`) silences whatever
 *    sits on its analog jack. Only a person at the desk knows the jack is
 *    empty, so these writes run only after the strips are claimed for BarBro —
 *    one confirmation, persisted per machine, automatic ever after.
 */
import type { RigLayout } from './liveRigPlan'

export type DeskWrite = {
  address: string
  value: number
  /** One line of intent, shown in the applied-writes report. */
  why: string
}

const pad = (n: number) => String(n).padStart(2, '0')

export type SplitStrip = { channel: number; usbSource: number; role: string }

/** The strips the split needs: every non-house click/cue/monitor slot. */
export function splitStrips(layout: RigLayout): SplitStrip[] {
  return layout.slots
    .filter((s) => !s.house && (s.role === 'click' || s.role === 'cue' || s.role === 'monitor'))
    .map((s) => ({ channel: s.deskChannel, usbSource: s.usbSource, role: s.role }))
}

/**
 * Configure the strips, silently: USB input, correct return, off the house,
 * strip on (sends are pre-fader, so the strip fader itself is left alone).
 */
export function buildSplitStripWrites(layout: RigLayout): DeskWrite[] {
  return splitStrips(layout).flatMap((s) => [
    {
      address: `/ch/${pad(s.channel)}/preamp/rtnsw`,
      value: 1,
      why: `${s.role}: strip ${s.channel} listens to USB instead of its analog jack`,
    },
    {
      address: `/ch/${pad(s.channel)}/config/rtnsrc`,
      value: s.usbSource, // ZERO-based on the desk; USB channel s.usbSource + 1 in human terms
      why: `${s.role}: takes USB return ${s.usbSource + 1}`,
    },
    {
      address: `/ch/${pad(s.channel)}/mix/lr`,
      value: 0,
      why: `${s.role}: OFF the house mix — the room never hears it`,
    },
    {
      address: `/ch/${pad(s.channel)}/mix/on`,
      value: 1,
      why: `${s.role}: strip unmuted so its pre-fader sends can feed the monitor buses`,
    },
  ])
}

/**
 * The starting send from each split strip into each performer's bus.
 * 0.65 — measured on the real rig: the song's own sends run ~0.67, and a click
 * at 0.4 sat ~10 dB under the mix, present but inaudible ("I just hear the
 * regular mix"). Matching the song's send level is the audible starting point;
 * still below unity (0.75), and raised or trimmed per performer by ear.
 */
export const SPLIT_SEND_START = 0.65

export type BusSendWrite = { channel: number; bus: number; value: number; why: string }

export function buildSplitBusSends(
  layout: RigLayout,
  performers: readonly { name: string; monitorBus: number | null }[],
): BusSendWrite[] {
  const out: BusSendWrite[] = []
  for (const strip of splitStrips(layout)) {
    for (const p of performers) {
      if (!p.monitorBus) continue
      out.push({
        channel: strip.channel,
        bus: p.monitorBus,
        value: SPLIT_SEND_START,
        why: `${strip.role} → ${p.name} (bus ${p.monitorBus})`,
      })
    }
  }
  return out
}

/** The read-back that proves the strip config took. address → expected value. */
export function splitVerifyPlan(layout: RigLayout): { address: string; expect: number }[] {
  return splitStrips(layout).flatMap((s) => [
    { address: `/ch/${pad(s.channel)}/preamp/rtnsw`, expect: 1 },
    { address: `/ch/${pad(s.channel)}/config/rtnsrc`, expect: s.usbSource },
    { address: `/ch/${pad(s.channel)}/mix/lr`, expect: 0 },
  ])
}
