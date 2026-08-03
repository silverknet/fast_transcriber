/**
 * WHAT IS "THE DRUMS" IN THIS SONG?
 *
 * Rarely one lane. A song can carry the separated `stem:drums.wav`, BarBro's
 * `drum-machine` and a generated `drums-gen` all at once, and what a listener
 * hears — what has to sit at the same level in every song — is their SUM.
 *
 * Loudness matching originally asked `stemKindForLaneKey`, which only
 * recognises `stem:*` keys, so every machine and generated lane was invisible
 * to it: the separated stem was pulled to target and the machine rode on top
 * unmeasured. This module names the musical ROLE of any lane, so level
 * decisions can be made about the role rather than about one file.
 */
import type { AutoStemName } from '$lib/project/types'
import { stemKindForLaneKey } from './mastering'

/** Lanes that are not part of a musical role: the full mix, and the private cues. */
const NOT_A_ROLE = new Set(['original', 'click', 'cue'])

/**
 * The role a lane contributes to, or null when it is not programme material.
 *
 * Generated and machine lanes are deliberately included — a drum machine IS
 * drums to everyone except a string comparison.
 */
export function roleForLaneKey(key: string): AutoStemName | null {
  if (NOT_A_ROLE.has(key)) return null
  const fromStem = stemKindForLaneKey(key)
  if (fromStem) return fromStem
  // Machine / generated lanes, named by convention elsewhere in the app.
  if (/^drums?[-_]/.test(key) || key.startsWith('drum-')) return 'drums'
  if (key.startsWith('bass-')) return 'bass'
  if (key.startsWith('keys-') || key.startsWith('chord-') || key.startsWith('arp-')) return 'other'
  if (key.startsWith('vocal')) return 'vocals'
  return null
}

export type RoleLane = {
  key: string
  /** Fader position; 1 = unity. */
  volume: number
  muted?: boolean
}

/** Lanes that actually reach the mix right now (audible, non-zero fader). */
export function audibleLanes(lanes: readonly RoleLane[]): RoleLane[] {
  return lanes.filter((l) => !l.muted && l.volume > 0.001)
}

/** role → the audible lanes feeding it, in the order given. */
export function lanesByRole(lanes: readonly RoleLane[]): Map<AutoStemName, RoleLane[]> {
  const out = new Map<AutoStemName, RoleLane[]>()
  for (const lane of audibleLanes(lanes)) {
    const role = roleForLaneKey(lane.key)
    if (!role) continue
    const list = out.get(role)
    if (list) list.push(lane)
    else out.set(role, [lane])
  }
  return out
}

/**
 * Roles built from MORE THAN ONE audible lane.
 *
 * These are where per-lane loudness matching gives the wrong answer: matching
 * each contributor to the role's target makes the role itself that many times
 * too loud. They are also where a blind "reset every fader to unity" is
 * destructive, because the balance BETWEEN the contributors is a deliberate
 * mix decision nobody asked us to flatten.
 */
export function stackedRoles(lanes: readonly RoleLane[]): AutoStemName[] {
  const out: AutoStemName[] = []
  for (const [role, list] of lanesByRole(lanes)) {
    if (list.length > 1) out.push(role)
  }
  return out.sort()
}

/**
 * How much louder a role is than one contributor at unity would be, in dB.
 *
 * Power sum of the faders: two lanes at unity make the role ~3 dB hotter than
 * a single lane, which is precisely the amount a per-lane target misses by.
 * Reported so the UI can say WHY a role sits above its target instead of the
 * user hunting for it.
 */
export function roleStackGainDb(lanes: readonly RoleLane[]): number {
  const audible = lanes.filter((l) => !l.muted && l.volume > 0.001)
  if (audible.length === 0) return 0
  const power = audible.reduce((sum, l) => sum + l.volume * l.volume, 0)
  return 10 * Math.log10(power)
}
