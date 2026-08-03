/**
 * WHAT ONE PERFORMER HEARS IN THEIR EARS.
 *
 * A drummer wants the click loud and the drums quiet — they are playing the
 * drums. A singer wants the opposite. Both are listening to the same backing
 * track, so "the monitor mix" is not one thing, it is one thing per person.
 *
 * ## Where it lives, and why in two places
 *
 * A performer's balance is mostly a preference about THEMSELVES, not about a
 * song: "I want more bass and barely any vocals" is true across the whole set.
 * Making it per-song would mean building the same mix twenty times and being
 * unable to change a preference without editing twenty songs.
 *
 * But one song in a set is always the exception — the acoustic one, the one
 * with a different arrangement. So:
 *
 *   - the PROJECT holds each performer's default (`ProjectFile.performerMixes`)
 *   - a SONG may override it, on that performer's own cue track (`CueTrack.mix`)
 *
 * Exactly the shape the count-in already uses, so there is one idea to learn
 * rather than two. A song with no override follows the default and keeps
 * following it as the default changes — inheritance, not a copy, because a copy
 * silently stops tracking and nobody notices until the gig.
 *
 * ## Stems are named, never keyed by file
 *
 * Lane keys carry filenames (`stem:drums.wav`, `stem:Drums_1.wav`), which differ
 * per song. A project-wide default keyed on those would apply to some songs and
 * not others for no reason a person could see. So mixes are keyed by the
 * canonical stem NAME, and `stemNameForKey` maps a lane onto it.
 */
import type { AutoStemName, ProjectPerformerMix } from './types'

/**
 * Levels are linear gain, 0 = silent, 1 = unity. Structurally the manifest's
 * `ProjectPerformerMix` — one shape, aliased so callers import the semantics
 * from here and the schema stays import-free of this layer.
 */
export type PerformerMix = ProjectPerformerMix

/**
 * What a performer hears before anyone touches anything.
 *
 * The click is LOUDER than the music by default and the cues louder still.
 * They are information, not entertainment: a click you have to strain for is
 * the same as no click, and a section cue arriving under the band is a cue that
 * did not happen. Everything else sits at a level that leaves room for them.
 */
export const DEFAULT_PERFORMER_MIX: Required<Omit<PerformerMix, 'stems'>> & {
  stems: Partial<Record<AutoStemName, number>>
} = {
  stems: {},
  original: 0.8,
  click: 0.9,
  cue: 1,
  fallback: 0.8,
}

/** Clamp to a sane gain, treating rubbish as "not set". */
function level(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return Math.max(0, Math.min(1, v))
}

/**
 * The mix actually in force for one performer on one song.
 *
 * Field by field, not wholesale: overriding the click level for a song must not
 * silently drop that performer's stem balance with it. A song that sets only
 * `click` keeps every other level from the default, and keeps INHERITING them.
 */
export function resolvePerformerMix(
  projectDefault: PerformerMix | undefined,
  songOverride: PerformerMix | undefined,
): Required<Omit<PerformerMix, 'stems'>> & { stems: Partial<Record<AutoStemName, number>> } {
  const base: PerformerMix = projectDefault ?? { stems: {} }
  const over: PerformerMix = songOverride ?? { stems: {} }
  return {
    stems: { ...base.stems, ...over.stems },
    original: level(over.original) ?? level(base.original) ?? DEFAULT_PERFORMER_MIX.original,
    click: level(over.click) ?? level(base.click) ?? DEFAULT_PERFORMER_MIX.click,
    cue: level(over.cue) ?? level(base.cue) ?? DEFAULT_PERFORMER_MIX.cue,
    fallback: level(over.fallback) ?? level(base.fallback) ?? DEFAULT_PERFORMER_MIX.fallback,
  }
}

/**
 * The level for one lane in a resolved mix.
 *
 * `stemName` comes from `stemNameForKey`; a lane it does not recognise (an
 * ad-hoc stem, a machine) takes `fallback` rather than being silenced. Turning
 * something a performer can hear today into silence because the code did not
 * recognise its name is the worst possible default.
 */
export function levelForLane(
  mix: ReturnType<typeof resolvePerformerMix>,
  laneKey: string,
  stemName: AutoStemName | null,
): number {
  if (laneKey === 'click') return mix.click
  if (laneKey === 'cue') return mix.cue
  if (laneKey === 'original') return mix.original
  if (stemName && mix.stems[stemName] !== undefined) return mix.stems[stemName]!
  return mix.fallback
}

/** Is a lane switched off entirely for this performer? */
export function laneIsSilent(
  mix: ReturnType<typeof resolvePerformerMix>,
  laneKey: string,
  stemName: AutoStemName | null,
): boolean {
  return levelForLane(mix, laneKey, stemName) <= 0
}

/**
 * Does this song actually override anything for this performer?
 *
 * Drives the "following your default" / "overridden for this song" state. An
 * override object with nothing in it is NOT an override — otherwise opening the
 * editor would quietly detach a song from the default it was inheriting.
 */
export function hasSongOverride(songOverride: PerformerMix | undefined): boolean {
  if (!songOverride) return false
  if (Object.keys(songOverride.stems ?? {}).length > 0) return true
  return (
    songOverride.original !== undefined ||
    songOverride.click !== undefined ||
    songOverride.cue !== undefined ||
    songOverride.fallback !== undefined
  )
}

/** Read a stored mix defensively — anything unrecognised is simply not set. */
export function parsePerformerMix(raw: unknown): PerformerMix | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const stems: Partial<Record<AutoStemName, number>> = {}
  if (o.stems && typeof o.stems === 'object') {
    for (const [name, value] of Object.entries(o.stems as Record<string, unknown>)) {
      const v = level(value)
      if (v !== undefined) stems[name as AutoStemName] = v
    }
  }
  const mix: PerformerMix = { stems }
  const original = level(o.original)
  const click = level(o.click)
  const cue = level(o.cue)
  const fallback = level(o.fallback)
  if (original !== undefined) mix.original = original
  if (click !== undefined) mix.click = click
  if (cue !== undefined) mix.cue = cue
  if (fallback !== undefined) mix.fallback = fallback
  return mix
}
