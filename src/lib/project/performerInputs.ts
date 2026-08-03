/**
 * WHERE DOES EVERYONE PLUG IN? — the desk-input side of the band roster.
 *
 * The XR18 has 16 input strips. Some belong to BARBRO ITSELF (the USB returns
 * carrying song/click/cue — currently 9-12); the rest are analog jacks for
 * the band: piano stereo, sång mono, guitar mono, a keyboardist with three
 * keyboards. This module is the one source of truth for which channels are
 * FREE, which are TAKEN, and what would COLLIDE — pure functions, so the
 * settings picker, the patch list and the soundcheck panel cannot disagree.
 */
import type { Performer, PerformerInput } from './types'

export const DESK_INPUT_COUNT = 16

/** Channels BarBro's own output occupies on the desk — never offerable. */
export function reservedDeskChannels(layout: { slots: readonly { deskChannel: number }[] } | null): Set<number> {
  return new Set((layout?.slots ?? []).map((s) => s.deskChannel))
}

/** Every channel any performer's inputs claim. `except` skips one input (its own edit). */
export function takenInputChannels(
  performers: readonly Performer[],
  except?: string,
): Set<number> {
  const taken = new Set<number>()
  for (const p of performers) {
    for (const input of p.inputs ?? []) {
      if (input.id === except) continue
      for (const ch of input.channels) taken.add(ch)
    }
  }
  return taken
}

/**
 * The channels a picker may offer: 1-16, minus BarBro's own strips, minus
 * everything already claimed (except the input being edited).
 */
export function availableInputChannels(
  performers: readonly Performer[],
  layout: { slots: readonly { deskChannel: number }[] } | null,
  except?: string,
): number[] {
  const reserved = reservedDeskChannels(layout)
  const taken = takenInputChannels(performers, except)
  const out: number[] = []
  for (let ch = 1; ch <= DESK_INPUT_COUNT; ch++) {
    if (!reserved.has(ch) && !taken.has(ch)) out.push(ch)
  }
  return out
}

/** Is a single input well-formed? Empty label or bad channels are junk. */
export function isValidPerformerInput(input: PerformerInput): boolean {
  if (!input.id || typeof input.label !== 'string') return false
  if (!Array.isArray(input.channels) || input.channels.length < 1 || input.channels.length > 2)
    return false
  const seen = new Set<number>()
  for (const ch of input.channels) {
    if (!Number.isInteger(ch) || ch < 1 || ch > DESK_INPUT_COUNT) return false
    if (seen.has(ch)) return false
    seen.add(ch)
  }
  return true
}

/**
 * Everything wrong with the current patch plan, in stage language. Empty =
 * plug in with confidence. Never throws — at load-in the useful thing is a
 * LIST of what to fix, not an exception.
 */
export function performerInputProblems(
  performers: readonly Performer[],
  layout: { slots: readonly { deskChannel: number }[] } | null,
): string[] {
  const problems: string[] = []
  const reserved = reservedDeskChannels(layout)
  const claimedBy = new Map<number, string>()
  for (const p of performers) {
    for (const input of p.inputs ?? []) {
      const where = `${p.name}’s “${input.label || 'unnamed input'}”`
      if (!isValidPerformerInput(input)) {
        problems.push(`${where} has no valid desk channels — set them in Project settings.`)
        continue
      }
      for (const ch of input.channels) {
        if (reserved.has(ch)) {
          problems.push(
            `${where} is on channel ${ch}, which carries BarBro’s own audio — plugging in there silences the backing or the click. Move it to a free channel.`,
          )
        }
        const other = claimedBy.get(ch)
        if (other) {
          problems.push(`Channel ${ch} is claimed by both ${other} and ${where} — one of them is not actually plugged in there.`)
        } else {
          claimedBy.set(ch, where)
        }
      }
    }
  }
  return problems
}

/** "Piano → 1/2" — one patch-list line per input, in roster order. */
export function patchList(
  performers: readonly Performer[],
): { performer: string; label: string; channels: number[] }[] {
  const out: { performer: string; label: string; channels: number[] }[] = []
  for (const p of performers) {
    for (const input of p.inputs ?? []) {
      out.push({ performer: p.name, label: input.label, channels: [...input.channels] })
    }
  }
  return out
}
