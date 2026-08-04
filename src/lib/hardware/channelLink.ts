/**
 * ONE FADER FOR A STEREO SOURCE — `/config/chlink`.
 *
 * BarBro's backing track arrives on the desk as two channels (9 and 10). To
 * the band's phones that is TWO strips called "BarBro L" and "BarBro R", and
 * turning the backing down in your ears means finding both and matching them
 * by eye. Half a set later one is 3 dB above the other and the track is
 * lopsided in someone's head. The same is true of a stereo keyboard (5/6) and
 * a stereo guitar (7/8).
 *
 * The desk fixes this itself: `/config/chlink/9-10` = 1 makes the pair move
 * together, so everyone sees ONE BarBro fader.
 *
 * Three things this module refuses to get wrong:
 *
 *  - **The pairs are FIXED.** The desk links 1-2, 3-4, … 15-16 and nothing
 *    else. A stereo input patched to 6/7 cannot be linked at all, and writing
 *    `/config/chlink/6-7` is an address the desk does not have — it ignores it
 *    in silence, which reads exactly like success. Those get named as a
 *    problem instead of written.
 *  - **Click and cue are never linked.** They are two DIFFERENT signals that
 *    happen to sit on adjacent strips (11 and 12). Linking them would tie the
 *    drummer's click level to the cue level forever. Only `program` slots are
 *    ever offered, so the click/cue pair cannot be produced by this module.
 *  - **Linking must not move the audio.** X-Air couples a linked pair's
 *    settings, and it is not documented which way the copy runs. If it were to
 *    copy `config/rtnsrc` from the odd strip to the even one, both strips
 *    would carry USB channel 1 and the backing track would silently go
 *    left-signal-in-both-ears. So the caller reads the guarded addresses
 *    BEFORE the write and again after, and compares — measured, not assumed.
 *    See `linkGuardAddresses` / `guardDrift`.
 */
import type { RigLayout } from './liveRigPlan'
import type { Performer } from '$lib/project/types'

/** The desk links channels in FIXED pairs. `6-7` is not one of them. */
export const CHANNEL_LINK_PAIRS = [
  '1-2',
  '3-4',
  '5-6',
  '7-8',
  '9-10',
  '11-12',
  '13-14',
  '15-16',
] as const

export type ChannelLinkPair = (typeof CHANNEL_LINK_PAIRS)[number]

const pad = (n: number) => String(n).padStart(2, '0')

/** The desk pair two channels form, or `null` when the desk cannot link them. */
export function linkPairFor(channels: readonly number[]): ChannelLinkPair | null {
  if (channels.length !== 2) return null
  const [a, b] = [...channels].sort((x, y) => x - y)
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null
  if (a % 2 !== 1 || b !== a + 1) return null
  const label = `${a}-${b}` as ChannelLinkPair
  return (CHANNEL_LINK_PAIRS as readonly string[]).includes(label) ? label : null
}

export function chLinkAddress(pair: ChannelLinkPair): string {
  return `/config/chlink/${pair}`
}

/** The pair a single channel belongs to, as `"7/8"` — for "move it to …". */
function pairContaining(channel: number): string {
  const odd = channel % 2 === 1 ? channel : channel - 1
  return `${odd}/${odd + 1}`
}

export type LinkTarget = {
  pair: ChannelLinkPair
  address: string
  channels: [number, number]
  /** The one fader's name, as a person reading their phone would say it. */
  label: string
}

/**
 * Every stereo source that deserves to be one fader: BarBro's own programme
 * pair, plus each performer input patched to two channels.
 *
 * `program` only, on purpose — see the click/cue note at the top of the file.
 */
export function stereoLinkTargets(
  layout: RigLayout | null,
  performers: readonly Performer[],
): LinkTarget[] {
  const out: LinkTarget[] = []
  const seen = new Set<string>()
  const push = (channels: number[], label: string) => {
    const pair = linkPairFor(channels)
    if (!pair || seen.has(pair)) return
    seen.add(pair)
    const [a, b] = [...channels].sort((x, y) => x - y)
    out.push({ pair, address: chLinkAddress(pair), channels: [a, b], label })
  }

  const program = (layout?.slots ?? []).filter((s) => s.role === 'program')
  if (program.length === 2) push(program.map((s) => s.deskChannel), 'BarBro (song)')

  for (const p of performers) {
    for (const input of p.inputs ?? []) {
      if ((input.channels ?? []).length !== 2) continue
      push(input.channels, `${p.name} · ${input.label || 'stereo input'}`)
    }
  }
  return out
}

/**
 * Stereo sources the desk CANNOT give one fader, in stage language.
 *
 * A patch of 6/7 is legal audio and an illegal link. The fix is repatching one
 * cable, which is a thing a person does at load-in — so it has to be said out
 * loud rather than swallowed.
 */
export function stereoLinkProblems(
  layout: RigLayout | null,
  performers: readonly Performer[],
): string[] {
  const problems: string[] = []

  const program = (layout?.slots ?? []).filter((s) => s.role === 'program')
  if (program.length === 2 && !linkPairFor(program.map((s) => s.deskChannel))) {
    const [a, b] = program.map((s) => s.deskChannel).sort((x, y) => x - y)
    problems.push(
      `BarBro’s song lands on strips ${a} and ${b}, which the desk cannot join into one fader — it only joins 1-2, 3-4, 5-6 and so on. Start BarBro on an odd-numbered channel and the band gets a single “BarBro” fader.`,
    )
  }

  for (const p of performers) {
    for (const input of p.inputs ?? []) {
      const channels = input.channels ?? []
      if (channels.length !== 2 || linkPairFor(channels)) continue
      const [a, b] = [...channels].sort((x, y) => x - y)
      const moves = [...new Set([a, b].map(pairContaining))].filter(Boolean)
      problems.push(
        `${p.name}’s “${input.label || 'stereo input'}” is on ${a}/${b}, which the desk cannot join into one fader — move it to ${moves.join(' or ')} so it behaves as one stereo source.`,
      )
    }
  }
  return problems
}

type OscValue = { type: string; value: number | string }
export type OscReplies = Record<string, OscValue[] | undefined>

/** The read-back that proves the link took. */
export function linkVerifyPlan(targets: readonly LinkTarget[]): { address: string; expect: number }[] {
  return targets.map((t) => ({ address: t.address, expect: 1 }))
}

/**
 * The addresses that must read the SAME after linking as before it.
 *
 * `rtnsw` + `rtnsrc` are what makes a strip carry the correct half of BarBro's
 * output; `mix/lr` is what keeps the click out of the house. If the desk's link
 * copies any of them across the pair, the rig is broken in a way nobody hears
 * until the room does.
 */
export function linkGuardAddresses(target: LinkTarget): string[] {
  return target.channels.flatMap((ch) => [
    `/ch/${pad(ch)}/preamp/rtnsw`,
    `/ch/${pad(ch)}/config/rtnsrc`,
    `/ch/${pad(ch)}/mix/lr`,
  ])
}

const GUARD_NAMES: Record<string, string> = {
  rtnsw: 'its input source (socket vs USB)',
  rtnsrc: 'which USB channel it listens to',
  lr: 'whether the house hears it',
}

/**
 * What the link changed that it had no business changing.
 *
 * Only addresses the desk answered BOTH times are judged — an unanswered read
 * is not evidence of anything, and reporting it as drift would send someone
 * chasing a Wi-Fi hiccup around a stage.
 */
export function guardDrift(
  before: OscReplies,
  after: OscReplies,
  addresses: readonly string[],
): string[] {
  const drifted: string[] = []
  for (const address of addresses) {
    const a = before[address]?.[0]?.value
    const b = after[address]?.[0]?.value
    if (typeof a !== 'number' || typeof b !== 'number') continue
    if (a === b) continue
    const leaf = address.split('/').pop() ?? address
    const channel = Number(address.split('/')[2])
    drifted.push(
      `strip ${channel}: ${GUARD_NAMES[leaf] ?? leaf} changed (${a} → ${b})`,
    )
  }
  return drifted
}

/** Which pairs the desk currently reports as linked. */
export function readChannelLinks(replies: OscReplies): {
  linked: ChannelLinkPair[]
  answered: number
} {
  const linked: ChannelLinkPair[] = []
  let answered = 0
  for (const pair of CHANNEL_LINK_PAIRS) {
    const v = replies[chLinkAddress(pair)]?.[0]?.value
    if (typeof v !== 'number') continue
    answered++
    if (v !== 0) linked.push(pair)
  }
  return { linked, answered }
}
