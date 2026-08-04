/**
 * Parse and validate `barbro.project.json`.
 * Path validation runs here — any invalid `folder` field fails parse with
 * a specific error pointing at the offending entry. The project will not
 * load with broken paths; this protects every downstream consumer that
 * might write to disk based on `entry.folder`.
 */

import {
  AUTO_STEM_NAMES,
  LIVE_SLOT_NAMES,
  AUTO_STEM_QUALITIES,
  PROJECT_FILE_VERSION,
  validateProjectFolderPath,
  type AutoStemName,
  type AutoStemQuality,
  type Performer,
  type ProjectAutoStems,
  type ProjectFile,
  type ProjectSongEntry,
} from './types'
import { parseProjectTransitions } from './transitions'

/**
 * Parse the optional `autoStems` block defensively. Unknown / malformed
 * shapes return `undefined` (treated as "not configured") rather than
 * failing the whole manifest — a future schema bump must not refuse to open
 * the project. `stems` is filtered to known names + de-duplicated; an
 * unknown `quality` falls back to `'balanced'`.
 */
function parseAutoStems(raw: unknown): ProjectAutoStems | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const enabled = o.enabled === true
  const stems: AutoStemName[] = []
  if (Array.isArray(o.stems)) {
    for (const s of o.stems) {
      if (typeof s === 'string' && (AUTO_STEM_NAMES as readonly string[]).includes(s)) {
        const name = s as AutoStemName
        if (!stems.includes(name)) stems.push(name)
      }
    }
  }
  const quality: AutoStemQuality =
    typeof o.quality === 'string' && (AUTO_STEM_QUALITIES as readonly string[]).includes(o.quality)
      ? (o.quality as AutoStemQuality)
      : 'balanced'
  return { enabled, stems, quality }
}

export class ProjectParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectParseError'
  }
}

export function parseProjectJson(text: string): ProjectFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ProjectParseError('Invalid barbro.project.json: not valid JSON')
  }
  if (!raw || typeof raw !== 'object') {
    throw new ProjectParseError('Invalid barbro.project.json: root must be an object')
  }

  const o = raw as Record<string, unknown>

  if (o.formatVersion !== PROJECT_FILE_VERSION) {
    throw new ProjectParseError(
      `Unsupported project formatVersion: ${String(o.formatVersion)} (expected ${PROJECT_FILE_VERSION})`,
    )
  }
  if (typeof o.id !== 'string' || o.id.length === 0) {
    throw new ProjectParseError('Invalid barbro.project.json: missing or invalid `id`')
  }
  if (typeof o.name !== 'string') {
    throw new ProjectParseError('Invalid barbro.project.json: missing or invalid `name`')
  }
  if (typeof o.createdAt !== 'string') {
    throw new ProjectParseError('Invalid barbro.project.json: missing or invalid `createdAt`')
  }
  if (typeof o.updatedAt !== 'string') {
    throw new ProjectParseError('Invalid barbro.project.json: missing or invalid `updatedAt`')
  }
  if (!Array.isArray(o.songs)) {
    throw new ProjectParseError('Invalid barbro.project.json: `songs` must be an array')
  }

  const songs: ProjectSongEntry[] = []
  for (let i = 0; i < o.songs.length; i++) {
    const e = o.songs[i] as Record<string, unknown> | null
    if (!e || typeof e !== 'object') {
      throw new ProjectParseError(`Invalid songs[${i}]: must be an object`)
    }
    if (typeof e.id !== 'string' || e.id.length === 0) {
      throw new ProjectParseError(`Invalid songs[${i}].id: must be a non-empty string`)
    }
    let folder: string
    try {
      folder = validateProjectFolderPath(e.folder, `songs[${i}].folder`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new ProjectParseError(msg)
    }
    const entry: ProjectSongEntry = { id: e.id, folder }
    if (typeof e.hidden === 'boolean' && e.hidden) entry.hidden = true
    if (typeof e.cloudSongId === 'string' && e.cloudSongId.length > 0) {
      entry.cloudSongId = e.cloudSongId
    }
    if (typeof e.lastSyncedRevision === 'number' && Number.isFinite(e.lastSyncedRevision)) {
      entry.lastSyncedRevision = e.lastSyncedRevision
    }
    if (typeof e.lastSyncedContentHash === 'string' && e.lastSyncedContentHash.length > 0) {
      entry.lastSyncedContentHash = e.lastSyncedContentHash
    }
    songs.push(entry)
  }

  // Cloud-link block is optional; only present on collab-enabled
  // projects. Unknown shapes are silently dropped so a future schema
  // bump doesn't refuse to open older clients' manifests.
  let cloud: ProjectFile['cloud']
  if (o.cloud && typeof o.cloud === 'object') {
    const c = o.cloud as Record<string, unknown>
    if (typeof c.projectId === 'string' && c.projectId.length > 0
        && typeof c.lastSyncedRevision === 'number' && Number.isFinite(c.lastSyncedRevision)) {
      cloud = {
        projectId: c.projectId,
        lastSyncedRevision: c.lastSyncedRevision,
      }
      if (typeof c.pendingChanges === 'number' && Number.isFinite(c.pendingChanges)) {
        cloud.pendingChanges = c.pendingChanges
      }
      if (typeof c.lastPushedAt === 'string') cloud.lastPushedAt = c.lastPushedAt
      if (typeof c.lastPulledAt === 'string') cloud.lastPulledAt = c.lastPulledAt
    }
  }

  const autoStems = parseAutoStems(o.autoStems)
  const defaults = parseDefaults(o.defaults)
  const mastering = parseMastering(o.mastering)
  const performers = parsePerformers(o.performers)
  const performerMixes = parsePerformerMixes(o.performerMixes)
  const liveRig = parseLiveRig(o.liveRig)
  const transitions = parseProjectTransitions(o.transitions, songs)

  return {
    formatVersion: PROJECT_FILE_VERSION,
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    songs,
    ...(cloud ? { cloud } : {}),
    ...(autoStems ? { autoStems } : {}),
    ...(defaults ? { defaults } : {}),
    ...(mastering ? { mastering } : {}),
    ...(performers ? { performers } : {}),
    ...(performerMixes ? { performerMixes } : {}),
    ...(liveRig ? { liveRig } : {}),
    ...(transitions ? { transitions } : {}),
  }
}

/**
 * Parse the optional per-performer mixes defensively. A malformed level is
 * dropped (falls back to the default at resolve time) — never coerced to 0,
 * which would silently mute someone's monitor.
 */
function parsePerformerMixes(raw: unknown): ProjectFile['performerMixes'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const clamp = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined
  const out: NonNullable<ProjectFile['performerMixes']> = {}
  for (const [performerId, rawMix] of Object.entries(raw as Record<string, unknown>)) {
    if (!rawMix || typeof rawMix !== 'object') continue
    const m = rawMix as Record<string, unknown>
    const stems: NonNullable<ProjectFile['performerMixes']>[string]['stems'] = {}
    if (m.stems && typeof m.stems === 'object') {
      for (const [name, v] of Object.entries(m.stems as Record<string, unknown>)) {
        const lv = clamp(v)
        if (lv !== undefined) stems[name as keyof typeof stems] = lv
      }
    }
    const mix: NonNullable<ProjectFile['performerMixes']>[string] = { stems }
    for (const key of ['original', 'click', 'cue', 'fallback'] as const) {
      const lv = clamp(m[key])
      if (lv !== undefined) mix[key] = lv
    }
    out[performerId] = mix
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Parse the optional `performers` roster defensively (skips malformed rows). */
/**
 * A performer's desk inputs (the band's patch plan). Channels are XR18 analog
 * inputs: 1 = mono, 2 = stereo pair; junk entries are dropped rather than
 * kept broken. Mirrored in the sidecar's `parseManifestPerformers` — a field
 * read here but not there is silently deleted on the next sidecar write.
 */
function parsePerformerInputs(raw: unknown): Performer['inputs'] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: NonNullable<Performer['inputs']> = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.id !== 'string' || !o.id) continue
    if (typeof o.label !== 'string') continue
    if (!Array.isArray(o.channels)) continue
    const channels = o.channels
      .filter((c): c is number => typeof c === 'number' && Number.isInteger(c) && c >= 1 && c <= 16)
      .slice(0, 2)
    if (channels.length < 1 || new Set(channels).size !== channels.length) continue
    out.push({ id: o.id, label: o.label, channels })
  }
  return out.length > 0 ? out : undefined
}

function parsePerformers(raw: unknown): ProjectFile['performers'] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: NonNullable<ProjectFile['performers']> = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.name !== 'string') continue
    const p: NonNullable<ProjectFile['performers']>[number] = { id: o.id, name: o.name }
    if (typeof o.role === 'string' && o.role.trim()) p.role = o.role
    if (typeof o.userId === 'string' && o.userId) p.userId = o.userId
    if (typeof o.monitorBus === 'number' && o.monitorBus >= 1 && o.monitorBus <= 6) {
      p.monitorBus = Math.round(o.monitorBus)
    }
    const inputs = parsePerformerInputs(o.inputs)
    if (inputs) p.inputs = inputs
    out.push(p)
  }
  return out.length > 0 ? out : undefined
}

/**
 * Parse the project-wide LIVE RIG block defensively.
 *
 * Every value is clamped to what an XR18 can actually accept — 16 channels, 6
 * buses, levels 0..1 — because this drives real hardware. A junk channel number
 * from a hand-edited manifest would otherwise become an OSC write to an address
 * the desk does not have, which X-AIR ignores in silence.
 *
 * Malformed rows are SKIPPED rather than defaulted. There is no safe default for
 * "which channel carries the click": guessing one could put it in the house.
 */
function parseLiveRig(raw: unknown): ProjectFile['liveRig'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: NonNullable<ProjectFile['liveRig']> = {}
  const channelVector = (value: unknown, minimum: number, maximum: number): number[] =>
    Array.isArray(value)
      ? [
          ...new Set(
            value
              .filter((channel): channel is number =>
                typeof channel === 'number' && Number.isInteger(channel),
              )
              .filter((channel) => channel >= minimum && channel <= maximum),
          ),
        ].sort((left, right) => left - right)
      : []
  const channelList = (value: unknown): number[] => channelVector(value, 1, 16)

  if (r.routingProfile && typeof r.routingProfile === 'object') {
    const profile = r.routingProfile as Record<string, unknown>
    if (
      typeof profile.id === 'string' &&
      profile.id.length > 0 &&
      typeof profile.version === 'number' &&
      Number.isInteger(profile.version) &&
      profile.version > 0 &&
      typeof profile.mainPhysicalOutputId === 'string' &&
      Array.isArray(profile.sourceLanes) &&
      Array.isArray(profile.monitorOutputs)
    ) {
      const sourceLanes: NonNullable<typeof out.routingProfile>['sourceLanes'] = []
      for (const rawLane of profile.sourceLanes) {
        if (!rawLane || typeof rawLane !== 'object') continue
        const lane = rawLane as Record<string, unknown>
        if (
          typeof lane.id !== 'string' ||
          (lane.role !== 'program' && lane.role !== 'click' && lane.role !== 'cue') ||
          (lane.mainPolicy !== 'on' && lane.mainPolicy !== 'off')
        ) continue
        const parsedLane: (typeof sourceLanes)[number] = {
          id: lane.id,
          role: lane.role,
          webAudioChannels: channelVector(lane.webAudioChannels, 0, 17),
          usbReturnChannels: channelVector(lane.usbReturnChannels, 0, 17),
          xr18InputStrips: channelList(lane.xr18InputStrips),
          mainPolicy: lane.mainPolicy,
        }
        if (typeof lane.performerId === 'string') parsedLane.performerId = lane.performerId
        sourceLanes.push(parsedLane)
      }
      const monitorOutputs: NonNullable<typeof out.routingProfile>['monitorOutputs'] = []
      for (const rawOutput of profile.monitorOutputs) {
        if (!rawOutput || typeof rawOutput !== 'object') continue
        const output = rawOutput as Record<string, unknown>
        if (
          typeof output.monitorBus === 'number' &&
          Number.isInteger(output.monitorBus) &&
          output.monitorBus >= 1 &&
          output.monitorBus <= 6 &&
          typeof output.physicalOutputId === 'string' &&
          output.physicalOutputId
        ) {
          monitorOutputs.push({
            monitorBus: output.monitorBus,
            physicalOutputId: output.physicalOutputId,
          })
        }
      }
      out.routingProfile = {
        id: profile.id,
        version: profile.version,
        mainPhysicalOutputId: profile.mainPhysicalOutputId,
        sourceLanes,
        monitorOutputs,
      }
    }
  }

  if (Array.isArray(r.routes)) {
    const routes: NonNullable<NonNullable<ProjectFile['liveRig']>['routes']> = []
    for (const row of r.routes) {
      if (!row || typeof row !== 'object') continue
      const o = row as Record<string, unknown>
      if (typeof o.laneKey !== 'string' || !o.laneKey) continue
      const entry: (typeof routes)[number] = { laneKey: o.laneKey, channels: channelList(o.channels) }
      if (typeof o.followVolume === 'boolean') entry.followVolume = o.followVolume
      if (typeof o.followMute === 'boolean') entry.followMute = o.followMute
      routes.push(entry)
    }
    if (routes.length > 0) out.routes = routes
  }

  const level = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null

  if (r.monitorSends && typeof r.monitorSends === 'object') {
    const sends: Record<number, Record<string, number>> = {}
    for (const [busKey, lanes] of Object.entries(r.monitorSends as Record<string, unknown>)) {
      const bus = Number(busKey)
      if (!Number.isInteger(bus) || bus < 1 || bus > 6) continue
      if (!lanes || typeof lanes !== 'object') continue
      const perLane: Record<string, number> = {}
      for (const [laneKey, v] of Object.entries(lanes as Record<string, unknown>)) {
        const lv = level(v)
        if (laneKey && lv !== null) perLane[laneKey] = lv
      }
      if (Object.keys(perLane).length > 0) sends[bus] = perLane
    }
    if (Object.keys(sends).length > 0) out.monitorSends = sends
  }

  if (r.busMaster && typeof r.busMaster === 'object') {
    const masters: Record<number, number> = {}
    for (const [busKey, v] of Object.entries(r.busMaster as Record<string, unknown>)) {
      const bus = Number(busKey)
      const lv = level(v)
      if (Number.isInteger(bus) && bus >= 1 && bus <= 6 && lv !== null) masters[bus] = lv
    }
    if (Object.keys(masters).length > 0) out.busMaster = masters
  }

  return Object.keys(out).length > 0 ? out : undefined
}

/** Parse the optional project-wide `mastering` (project sound) block. */
function parseMastering(raw: unknown): ProjectFile['mastering'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.enabled !== 'boolean') return undefined
  const out: NonNullable<ProjectFile['mastering']> = { enabled: r.enabled }
  if (typeof r.matchLoudness === 'boolean') out.matchLoudness = r.matchLoudness
  if (typeof r.masterGlue === 'boolean') out.masterGlue = r.masterGlue
  if (typeof r.kickPunch === 'number' && Number.isFinite(r.kickPunch)) {
    out.kickPunch = Math.max(0, Math.min(1, r.kickPunch))
  }
  const stems = r.stems as Record<string, unknown> | undefined
  if (stems && typeof stems === 'object') {
    const parsed: NonNullable<NonNullable<ProjectFile['mastering']>['stems']> = {}
    for (const name of AUTO_STEM_NAMES) {
      const v = stems[name]
      // Legacy shape (first release stored just the intensity string).
      if (v === 'off' || v === 'light' || v === 'firm') {
        parsed[name] = { intensity: v }
        continue
      }
      if (!v || typeof v !== 'object') continue
      const s = v as Record<string, unknown>
      const entry: NonNullable<typeof parsed[typeof name]> = {}
      if (s.intensity === 'off' || s.intensity === 'light' || s.intensity === 'firm') {
        entry.intensity = s.intensity
      }
      if (typeof s.trimDb === 'number' && Number.isFinite(s.trimDb)) {
        entry.trimDb = Math.max(-9, Math.min(9, s.trimDb))
      }
      if (s.tone === 'natural' || s.tone === 'shaped') entry.tone = s.tone
      if (Object.keys(entry).length > 0) parsed[name] = entry
    }
    if (Object.keys(parsed).length > 0) out.stems = parsed
  }
  return out
}

/** Parse the optional project-wide `defaults` (count-in + pre-count-in cue). */
function parseDefaults(raw: unknown): ProjectFile['defaults'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: NonNullable<ProjectFile['defaults']> = {}
  if (typeof r.countInBeats === 'number' && Number.isInteger(r.countInBeats) && r.countInBeats >= 0) {
    out.countInBeats = r.countInBeats
  }
  // WHICH STEMS START AUDIBLE LIVE. Dropping this was invisible and total: the
  // setting saved, the dialog reopened showing the LEGACY default (drums + bass
  // + other) as if nothing had been ticked, and live played 'other' on every
  // song because `audibleStemSet(undefined)` falls back to that same legacy
  // set. One missing parser line, and the whole project-wide live-stem config
  // silently did not exist.
  if (Array.isArray(r.liveStems)) {
    const seen = new Set<AutoStemName>()
    for (const v of r.liveStems) {
      if (typeof v === 'string' && (AUTO_STEM_NAMES as readonly string[]).includes(v)) {
        seen.add(v as AutoStemName)
      }
    }
    // An EMPTY array is meaningful — "start every stem muted" — and must not
    // collapse back to the legacy default, so it is stored whenever the key
    // was present and well-formed.
    out.liveStems = AUTO_STEM_NAMES.filter((n) => seen.has(n))
  }
  // The per-BUTTON start state. Same whitelist trap as `liveStems` above —
  // omitting it here would make the setting save and vanish, which is exactly
  // the bug this pair of lines is replacing.
  if (Array.isArray(r.liveSlots)) {
    const seen = new Set<string>()
    for (const v of r.liveSlots) if (typeof v === 'string') seen.add(v)
    // Empty is meaningful: "every button starts off".
    out.liveSlots = LIVE_SLOT_NAMES.filter((n) => seen.has(n))
  }
  const pc = r.preCountInCue as Record<string, unknown> | undefined
  if (pc && typeof pc.mode === 'string') {
    // Migrate legacy modes: 'title'/'custom' both announced the song → 'auto'.
    const mode =
      pc.mode === 'auto' || pc.mode === 'title' || pc.mode === 'custom'
        ? 'auto'
        : pc.mode === 'triggered'
          ? 'triggered'
          : 'off'
    out.preCountInCue = { mode }
    if (typeof pc.text === 'string') out.preCountInCue.text = pc.text
  }
  return Object.keys(out).length > 0 ? out : undefined
}
