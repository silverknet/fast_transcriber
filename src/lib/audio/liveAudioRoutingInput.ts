import type { ProjectFile } from '$lib/project/types'
import type {
  LiveProducerReference,
  SongLiveSourceIntent,
  SongMap,
} from '$lib/songmap/types'
import {
  LIVE_SUPPORTED_PERSISTED_PRODUCER_KINDS,
  migrateLegacyLiveRouting,
} from '$lib/songmap/liveRouting'
import {
  LIVE_AUDIO_SHADOW_SCHEMA_VERSION,
  validateAudioConfiguration,
  type LiveAudioShadowInput,
  type LiveAudioShadowPlan,
  type LiveDeviceCapabilities,
  type LivePracticeInput,
  type LiveRoutingInputFact,
  type LiveSourceCandidate,
  type LiveSourceKind,
  type LiveSourceScope,
  type RawLiveSourceLane,
  type RawPhysicalMonitorOutput,
} from './audioConfigValidator'

/**
 * Sole owner of current-state -> LiveAudioShadowInput construction.
 *
 * This module is pure after the caller captures the current manifest and asset
 * inventory. It never reads stores, devices, the filesystem, or a prior graph.
 */

export type RawProjectRoutingDto = Readonly<{
  projectId: unknown
  performers: unknown
  routingProfile: unknown
  /** Exact JSON routing fields, retained so malformed values are never lost. */
  raw: unknown
}>

export type CurrentSongAsset = Readonly<{
  sourceId: string
  songId: string
  generationId: string
  availability: 'available' | 'missing' | 'unavailable'
}>

export type LiveRoutingSnapshot = Readonly<{
  generationId: string
  project: Pick<ProjectFile, 'id'>
  rawProjectRouting: RawProjectRoutingDto
  songId: string
  songMap: SongMap
  currentSongAssets: readonly CurrentSongAsset[]
  device: LiveDeviceCapabilities
  practice: LivePracticeInput
}>

export type DerivedLiveAudioShadow = Readonly<{
  input: LiveAudioShadowInput
  plan: LiveAudioShadowPlan
  inputFacts: readonly LiveRoutingInputFact[]
}>

export type LiveSourceInstallEntry = Readonly<{
  instanceId: string
  generationId: string
  songId: string
  sourceId: string
  mixerChannelId: string
  rigSourceLaneId: string
}>

export type LiveSourceInstallManifest = Readonly<{
  generationId: string
  songId: string
  entries: readonly LiveSourceInstallEntry[]
}>

export type InstalledLiveSource = LiveSourceInstallEntry

export type LiveSourceInstallAudit = Readonly<{
  exact: boolean
  missingInstanceIds: readonly string[]
  unexpectedInstanceIds: readonly string[]
  teardownInstanceIds: readonly string[]
}>

const PERSISTED_SUPPORTED_KINDS = new Set<string>(
  LIVE_SUPPORTED_PERSISTED_PRODUCER_KINDS,
)

function compareStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function stableLegacyId(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Capture only JSON data. No normalization, clamping, filtering, or defaults. */
export function captureRawProjectRoutingDto(
  projectJsonOrValue: string | unknown,
): RawProjectRoutingDto {
  let raw: unknown = projectJsonOrValue
  if (typeof projectJsonOrValue === 'string') {
    try {
      raw = JSON.parse(projectJsonOrValue)
    } catch {
      raw = projectJsonOrValue
    }
  }
  const root = record(raw)
  const liveRig = record(root?.liveRig)
  if (!root) {
    return {
      projectId: undefined,
      performers: undefined,
      routingProfile: undefined,
      raw,
    }
  }
  return {
    projectId: root?.id,
    performers: root?.performers,
    routingProfile: liveRig?.routingProfile,
    raw: {
      id: root?.id,
      performers: root?.performers,
      liveRig: root?.liveRig,
    },
  }
}

function producerKey(producer: LiveProducerReference): string {
  if (producer.kind === 'stem-audio') return `stem-id:${producer.stemId}`
  if (producer.kind === 'unknown') return `unknown:${producer.producerType}`
  return producer.kind
}

function producerLabel(producer: LiveProducerReference): string {
  if (producer.kind === 'stem-audio') return `Stem ${producer.stemId}`
  return producer.kind
    .split('-')
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ')
}

function producerScope(producer: LiveProducerReference): LiveSourceScope {
  if (PERSISTED_SUPPORTED_KINDS.has(producer.kind)) return 'live-musical'
  if (producer.kind === 'preview-audio') return 'preview-only'
  if (producer.kind === 'test-signal') return 'test-only'
  if (producer.kind === 'unknown') return 'unknown'
  return 'editor-only'
}

function producerExists(song: SongMap, producer: LiveProducerReference): boolean {
  switch (producer.kind) {
    case 'original-audio':
      return Boolean(song.audio)
    case 'stem-audio':
      return Object.hasOwn(song.liveStemRefs ?? {}, producer.stemId)
    case 'detected-drum-midi':
      return Boolean(song.drumMidi)
    case 'drum-machine-midi':
      return Boolean(song.drumMachine?.enabled)
    case 'detected-bass-midi':
      return Boolean(song.bassMidi)
    case 'bass-machine-midi':
      return Boolean(song.bassMachine?.enabled)
    default:
      return false
  }
}

function configuredProducerAvailability(
  song: SongMap,
  source: SongLiveSourceIntent,
  assetBySource: ReadonlyMap<string, CurrentSongAsset>,
): LiveSourceCandidate['availability'] {
  if (!producerExists(song, source.producer)) return 'missing'
  if (
    source.producer.kind !== 'original-audio' &&
    source.producer.kind !== 'stem-audio'
  ) return 'available'
  return assetBySource.get(source.id)?.availability ?? 'unavailable'
}

function discoverUnconfiguredProducers(
  song: SongMap,
  claimedProducerKeys: ReadonlySet<string>,
  generationId: string,
  songId: string,
): LiveSourceCandidate[] {
  const candidates: LiveSourceCandidate[] = []
  const add = (
    key: string,
    kind: LiveSourceKind,
    label: string,
    identitySeed: string = key,
  ): void => {
    if (claimedProducerKeys.has(key)) return
    candidates.push({
      id: `unconfigured:${stableLegacyId(identitySeed)}`,
      songId,
      generationId,
      label,
      kind,
      scope: 'orphaned',
      admissionStatus: 'unassigned',
      availability: 'unavailable',
    })
  }

  if (song.audio) add('original-audio', 'original-audio', 'Unconfigured original audio')
  const canonicalStemPaths = new Set(Object.values(song.liveStemRefs ?? {}))
  for (const [stemId, relativePath] of Object.entries(song.liveStemRefs ?? {}).sort(
    ([left], [right]) => compareStrings(left, right),
  )) {
    add(
      `stem-id:${stemId}`,
      'stem-audio',
      'Unconfigured stem',
      `${stemId}\u0000${relativePath}`,
    )
  }
  for (const [legacyKey, relativePath] of Object.entries(song.stemRefs ?? {}).sort(
    ([left], [right]) => compareStrings(left, right),
  )) {
    if (canonicalStemPaths.has(relativePath)) continue
    add(
      `legacy-stem-ref:${legacyKey}`,
      'stem-audio',
      'Unconfigured legacy stem',
      `${legacyKey}\u0000${relativePath}`,
    )
  }
  if (song.drumMidi) add('detected-drum-midi', 'detected-drum-midi', 'Unconfigured detected drums')
  if (song.drumMachine) add('drum-machine-midi', 'drum-machine-midi', 'Unconfigured drum machine')
  if (song.bassMidi) add('detected-bass-midi', 'detected-bass-midi', 'Unconfigured detected bass')
  if (song.bassMachine) add('bass-machine-midi', 'bass-machine-midi', 'Unconfigured bass machine')
  return candidates
}

function adaptProjectRouting(
  snapshot: LiveRoutingSnapshot,
  issues: LiveRoutingInputFact[],
): Pick<LiveAudioShadowInput, 'project' | 'rigProfile' | 'rawProjectRouting'> {
  const dto = snapshot.rawProjectRouting
  if (!record(dto.raw)) {
    issues.push({
      code: 'raw-project-routing-invalid',
      message: 'The raw project routing DTO is not an object.',
      actualValue: dto.raw,
    })
  }
  if (dto.projectId !== snapshot.project.id) {
    issues.push({
      code: 'project-id-mismatch',
      message: 'The raw routing DTO belongs to another project.',
      actualValue: dto.projectId,
    })
  }

  const performers: LiveAudioShadowInput['project']['performers'][number][] = []
  if (Array.isArray(dto.performers)) {
    for (const [index, rawPerformer] of dto.performers.entries()) {
      const performer = record(rawPerformer)
      const id = typeof performer?.id === 'string' ? performer.id : `__invalid-performer-${index}`
      const name = typeof performer?.name === 'string' ? performer.name : `Invalid performer ${index + 1}`
      if (!performer || id.startsWith('__invalid-') || name.startsWith('Invalid performer')) {
        issues.push({
          code: 'performer-row-invalid',
          message: `Performer row ${index} has invalid identity fields.`,
          actualValue: rawPerformer,
        })
      }
      performers.push({
        id,
        name,
        monitorBus:
          id.startsWith('__invalid-') || name.startsWith('Invalid performer')
            ? undefined
            : performer?.monitorBus,
        required: true,
      })
    }
  } else {
    issues.push({
      code: 'raw-project-routing-invalid',
      message: 'The project performer roster is not an array.',
      actualValue: dto.performers,
    })
  }

  const rawProfile = record(dto.routingProfile)
  if (!rawProfile) {
    issues.push({
      code: 'rig-profile-missing',
      message: 'The project has no canonical Live rig routing profile.',
      actualValue: dto.routingProfile,
    })
  }
  if (rawProfile && (typeof rawProfile.id !== 'string' || !rawProfile.id)) {
    issues.push({
      code: 'rig-profile-field-invalid',
      message: 'The rig profile id is not a non-empty string.',
      actualValue: rawProfile.id,
    })
  }
  const rawLanes = Array.isArray(rawProfile?.sourceLanes)
    ? rawProfile.sourceLanes
    : []
  if (rawProfile && !Array.isArray(rawProfile.sourceLanes)) {
    issues.push({
      code: 'rig-profile-field-invalid',
      message: 'The rig profile sourceLanes field is not an array.',
      actualValue: rawProfile.sourceLanes,
    })
  }
  const sourceLanes: RawLiveSourceLane[] = rawLanes.map((rawLane, index) => {
    const lane = record(rawLane)
    if (!lane) {
      issues.push({
        code: 'rig-profile-field-invalid',
        message: `Rig source lane ${index} is not an object.`,
        actualValue: rawLane,
      })
    } else if (typeof lane.id !== 'string' || !lane.id) {
      issues.push({
        code: 'rig-profile-field-invalid',
        message: `Rig source lane ${index} has an invalid id.`,
        actualValue: lane.id,
      })
    }
    return {
      id: typeof lane?.id === 'string' ? lane.id : `__invalid-lane-${index}`,
      role: lane?.role,
      ...(typeof lane?.performerId === 'string'
        ? { performerId: lane.performerId }
        : {}),
      webAudioChannels: lane?.webAudioChannels,
      usbReturnChannels: lane?.usbReturnChannels,
      xr18InputStrips: lane?.xr18InputStrips,
      mainPolicy: lane?.mainPolicy,
    }
  })
  const rawOutputs = Array.isArray(rawProfile?.monitorOutputs)
    ? rawProfile.monitorOutputs
    : []
  if (rawProfile && !Array.isArray(rawProfile.monitorOutputs)) {
    issues.push({
      code: 'rig-profile-field-invalid',
      message: 'The rig profile monitorOutputs field is not an array.',
      actualValue: rawProfile.monitorOutputs,
    })
  }
  const monitorOutputs: RawPhysicalMonitorOutput[] = rawOutputs.map((rawOutput) => {
    const output = record(rawOutput)
    if (!output) {
      issues.push({
        code: 'rig-profile-field-invalid',
        message: 'A rig monitor output is not an object.',
        actualValue: rawOutput,
      })
    }
    return {
      monitorBus: output?.monitorBus,
      physicalOutputId: output?.physicalOutputId,
    }
  })

  return {
    project: { id: snapshot.project.id, performers },
    rigProfile: {
      id: typeof rawProfile?.id === 'string' ? rawProfile.id : '__invalid-rig-profile',
      version: rawProfile?.version,
      mainPhysicalOutputId: rawProfile?.mainPhysicalOutputId,
      sourceLanes,
      monitorOutputs,
    },
    rawProjectRouting: dto.raw,
  }
}

export function deriveLiveAudioShadow(
  snapshot: LiveRoutingSnapshot,
): DerivedLiveAudioShadow {
  const issues: LiveRoutingInputFact[] = []
  const projectRouting = adaptProjectRouting(snapshot, issues)
  const liveRouting =
    snapshot.songMap.liveRouting ?? migrateLegacyLiveRouting(snapshot.songMap)
  if (!snapshot.songMap.liveRouting) {
    issues.push({
      code: 'legacy-source-unreviewed',
      message: 'This song has no canonical Live routing block; all discovered legacy sources remain excluded.',
    })
  }

  const currentAssets = snapshot.currentSongAssets.filter((asset) => {
    const current =
      asset.songId === snapshot.songId &&
      asset.generationId === snapshot.generationId
    if (!current) {
      issues.push({
        code: 'stale-source-asset',
        sourceId: asset.sourceId,
        message: `Asset ${asset.sourceId} belongs to another song or generation.`,
        actualValue: asset,
      })
    }
    return current
  })
  const assetCounts = new Map<string, number>()
  for (const asset of currentAssets) {
    assetCounts.set(asset.sourceId, (assetCounts.get(asset.sourceId) ?? 0) + 1)
  }
  const assetBySource = new Map<string, CurrentSongAsset>()
  for (const asset of currentAssets) {
    if ((assetCounts.get(asset.sourceId) ?? 0) > 1) {
      issues.push({
        code: 'source-asset-ambiguous',
        sourceId: asset.sourceId,
        message: `Source ${asset.sourceId} has more than one current asset record.`,
      })
      continue
    }
    assetBySource.set(asset.sourceId, asset)
  }

  const producerKeyCounts = new Map<string, number>()
  for (const source of liveRouting.sources) {
    const key = producerKey(source.producer)
    producerKeyCounts.set(key, (producerKeyCounts.get(key) ?? 0) + 1)
  }

  const candidates: LiveSourceCandidate[] = liveRouting.sources.map(
    (source) => {
      const key = producerKey(source.producer)
      const ambiguous = (producerKeyCounts.get(key) ?? 0) > 1
      if (ambiguous) {
        issues.push({
          code: 'source-producer-ambiguous',
          sourceId: source.id,
          message: `More than one source claims producer ${key}.`,
        })
      }
      if (
        source.admission === 'excluded' &&
        source.producer.kind === 'stem-audio' &&
        source.producer.stemId.startsWith('legacy-stem:')
      ) {
        issues.push({
          code: 'legacy-source-unreviewed',
          sourceId: source.id,
          message: `Legacy source ${source.id} remains excluded until reviewed.`,
        })
      }
      const assetAmbiguous = (assetCounts.get(source.id) ?? 0) > 1
      return {
        id: source.id,
        songId: snapshot.songId,
        generationId: snapshot.generationId,
        label: producerLabel(source.producer),
        kind: source.producer.kind as LiveSourceKind,
        scope: ambiguous ? 'orphaned' : producerScope(source.producer),
        admissionStatus: source.admission,
        availability: assetAmbiguous
          ? 'unavailable'
          : configuredProducerAvailability(
              snapshot.songMap,
              source,
              assetBySource,
            ),
      }
    },
  )

  const claimedProducerKeys = new Set(
    liveRouting.sources.map((source) => producerKey(source.producer)),
  )
  candidates.push(
    ...discoverUnconfiguredProducers(
      snapshot.songMap,
      claimedProducerKeys,
      snapshot.generationId,
      snapshot.songId,
    ),
  )

  const sourceIntents = liveRouting.sources.map((source) => ({
    sourceId: source.id,
    songId: snapshot.songId,
    generationId: snapshot.generationId,
    included: source.admission === 'included',
    required: source.required,
    mixerChannelId: source.mixerChannelId,
    main: source.main,
    monitorSends: source.monitorSends.map((send) => ({ ...send })),
  }))
  const mixerChannels = liveRouting.mixerChannels.map((channel) => ({
    id: channel.id,
    sourceId: channel.sourceId,
    songId: snapshot.songId,
    generationId: snapshot.generationId,
    processing: { ...channel.processing },
    rigSourceLaneId: channel.rigSourceLaneId ?? null,
    ...(channel.sumGroupId ? { sumGroupId: channel.sumGroupId } : {}),
  }))

  const input: LiveAudioShadowInput = {
    schemaVersion: LIVE_AUDIO_SHADOW_SCHEMA_VERSION,
    generationId: snapshot.generationId,
    ...projectRouting,
    song: {
      id: snapshot.songId,
      cueTracks: snapshot.songMap.cueTracks.map((track) => ({
        ...track,
        events: track.events.map((event) => ({
          ...event,
          anchor: { ...event.anchor },
        })),
        suppressedGeneratedKeys: [...track.suppressedGeneratedKeys],
      })),
    },
    candidates: candidates.sort((left, right) => compareStrings(left.id, right.id)),
    sourceIntents: sourceIntents.sort((left, right) =>
      compareStrings(left.sourceId, right.sourceId),
    ),
    mixerChannels: mixerChannels.sort((left, right) =>
      compareStrings(left.id, right.id),
    ),
    sourceSumGroups: liveRouting.sumGroups
      .map((group) => ({
        ...group,
        mixerChannelIds: [...group.mixerChannelIds].sort(compareStrings),
      }))
      .sort((left, right) => compareStrings(left.id, right.id)),
    supportedMusicalSourceKinds: [...LIVE_SUPPORTED_PERSISTED_PRODUCER_KINDS],
    device: { ...snapshot.device },
    practice: { ...snapshot.practice },
    inputFacts: issues.sort((left, right) =>
      compareStrings(
        `${left.code}|${left.sourceId ?? ''}|${left.message}`,
        `${right.code}|${right.sourceId ?? ''}|${right.message}`,
      ),
    ),
  }
  return {
    input,
    plan: validateAudioConfiguration(input),
    inputFacts: input.inputFacts,
  }
}

export function buildLiveSourceInstallManifest(
  plan: LiveAudioShadowPlan,
): LiveSourceInstallManifest {
  const installableSources =
    plan.configurationDisposition === 'blocked' ? [] : plan.admittedSources
  return {
    generationId: plan.generationId,
    songId: plan.songId,
    entries: installableSources
      .map((source) => ({
        instanceId: `${plan.generationId}:${plan.songId}:${source.id}`,
        generationId: plan.generationId,
        songId: plan.songId,
        sourceId: source.id,
        mixerChannelId: source.mixerChannelId,
        rigSourceLaneId: source.programLaneId,
      }))
      .sort((left, right) => compareStrings(left.instanceId, right.instanceId)),
  }
}

/** Exact-set audit. Anything not in the current manifest is teardown work. */
export function auditInstalledLiveSources(
  expected: LiveSourceInstallManifest,
  installed: readonly InstalledLiveSource[],
): LiveSourceInstallAudit {
  const expectedIds = new Set(expected.entries.map((entry) => entry.instanceId))
  const installedCounts = new Map<string, number>()
  for (const entry of installed) {
    installedCounts.set(
      entry.instanceId,
      (installedCounts.get(entry.instanceId) ?? 0) + 1,
    )
  }
  const installedIds = new Set(installed.map((entry) => entry.instanceId))
  const missingInstanceIds = [...expectedIds]
    .filter((id) => !installedIds.has(id))
    .sort(compareStrings)
  const unexpectedInstanceIds = [...installedIds]
    .filter(
      (id) =>
        !expectedIds.has(id) ||
        (installedCounts.get(id) ?? 0) !== 1,
    )
    .sort(compareStrings)
  return {
    exact:
      missingInstanceIds.length === 0 &&
      unexpectedInstanceIds.length === 0 &&
      installed.length === expected.entries.length,
    missingInstanceIds,
    unexpectedInstanceIds,
    teardownInstanceIds: unexpectedInstanceIds,
  }
}
