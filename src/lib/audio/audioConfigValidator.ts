import type { ProjectFile } from '$lib/project/types'
import type { CueEvent, CueTrack, SongMapV3 } from '$lib/songmap/types'

/**
 * Contract-only Live audio planning.
 *
 * This module owns validation and desired-routing decisions. It deliberately has
 * no runtime, Web Audio, device, persistence, store, or UI dependencies.
 */

export const LIVE_AUDIO_SHADOW_SCHEMA_VERSION = 1 as const

export type LiveSourceKind =
  | 'original-audio'
  | 'stem-audio'
  | 'detected-drum-midi'
  | 'drum-machine-midi'
  | 'detected-bass-midi'
  | 'bass-machine-midi'
  | 'chord-machine-keys-midi'
  | 'chord-machine-arp-midi'
  | 'keybed-midi'
  | 'chord-jam-keys-midi'
  | 'chord-jam-bass-midi'
  | 'chord-jam-arp-midi'
  | 'preview-audio'
  | 'test-signal'
  | 'unknown'

export type LiveSourceScope =
  | 'live-musical'
  | 'editor-only'
  | 'preview-only'
  | 'orphaned'
  | 'test-only'
  | 'unknown'

export type LiveSourceCandidate = Readonly<{
  id: string
  songId: string
  generationId: string
  label: string
  kind: LiveSourceKind
  scope: LiveSourceScope
  admissionStatus: 'included' | 'excluded' | 'unassigned'
  availability: 'available' | 'missing' | 'unavailable'
}>

export type LiveSourceIntent = Readonly<{
  sourceId: string
  songId: string
  generationId: string
  included: boolean
  required: boolean
  mixerChannelId: string
  main: boolean
  monitorSends: readonly Readonly<{
    performerId: string
    gain: unknown
  }>[]
}>

export type LiveMixerChannelInput = Readonly<{
  id: string
  sourceId: string
  songId: string
  generationId: string
  processing: Readonly<{
    gain: unknown
    eq?: unknown
  }>
  rigSourceLaneId: string | null
  sumGroupId?: string
}>

export type LiveSourceSumGroupInput = Readonly<{
  id: string
  rigSourceLaneId: string
  mixerChannelIds: readonly string[]
}>

export type RawLiveSourceLane = Readonly<{
  id: string
  role: 'program' | 'click' | 'cue' | unknown
  performerId?: string
  /** Web Audio and USB channels are zero-based; XR18 strips are one-based. */
  webAudioChannels: unknown
  usbReturnChannels: unknown
  xr18InputStrips: unknown
  mainPolicy: 'on' | 'off' | unknown
}>

export type RawPhysicalMonitorOutput = Readonly<{
  monitorBus: unknown
  physicalOutputId: unknown
}>

export type LiveRigProfileInput = Readonly<{
  id: string
  version: unknown
  mainPhysicalOutputId: unknown
  sourceLanes: readonly RawLiveSourceLane[]
  monitorOutputs: readonly RawPhysicalMonitorOutput[]
}>

export type LiveDeviceCapabilities = Readonly<{
  audioDeviceId: string | null
  audioDeviceAvailable: boolean
  outputChannelCount: unknown
  xr18UsbAudioAvailable: boolean
  usbReturnChannelCount: unknown
  xr18InputStripCount: unknown
  xr18MonitorBusCount: unknown
  /** OSC/control evidence only. It never proves an audio route. */
  xr18ControlConnected: boolean
}>

export type LivePerformerInput = Readonly<{
  id: string
  name: string
  monitorBus?: unknown
  required?: boolean
}>

export type LiveAudioProjectInput = Readonly<{
  id: string
  performers: readonly LivePerformerInput[]
}>

export type LiveAudioSongInput = Readonly<{
  id: string
  cueTracks: readonly CueTrack[]
}>

export type LivePracticeInput = Readonly<{
  /** This value must come from session state and must reset before every Live entry. */
  enabled: boolean
  selectedCueTrackId?: string
}>

export type LiveRoutingInputFactCode =
  | 'raw-project-routing-invalid'
  | 'project-id-mismatch'
  | 'performer-row-invalid'
  | 'rig-profile-missing'
  | 'rig-profile-field-invalid'
  | 'source-producer-ambiguous'
  | 'source-asset-ambiguous'
  | 'stale-source-asset'
  | 'legacy-source-unreviewed'

/** Structural facts found while adapting raw current state; policy stays here. */
export type LiveRoutingInputFact = Readonly<{
  code: LiveRoutingInputFactCode
  message: string
  sourceId?: string
  actualValue?: unknown
}>

export type LiveAudioShadowInput = Readonly<{
  schemaVersion: typeof LIVE_AUDIO_SHADOW_SCHEMA_VERSION
  generationId: string
  project: LiveAudioProjectInput
  song: LiveAudioSongInput
  candidates: readonly LiveSourceCandidate[]
  sourceIntents: readonly LiveSourceIntent[]
  mixerChannels: readonly LiveMixerChannelInput[]
  sourceSumGroups: readonly LiveSourceSumGroupInput[]
  supportedMusicalSourceKinds: readonly LiveSourceKind[]
  rigProfile: LiveRigProfileInput
  device: LiveDeviceCapabilities
  practice: LivePracticeInput
  /** Exact routing fields read from the project manifest, retained for diagnostics. */
  rawProjectRouting: unknown
  inputFacts: readonly LiveRoutingInputFact[]
}>

export type LiveAudioIssueCode =
  | 'duplicate-source-id'
  | 'duplicate-source-intent'
  | 'intent-source-missing'
  | 'stale-song-source'
  | 'stale-song-intent'
  | 'stale-generation-source'
  | 'stale-generation-intent'
  | 'stale-song-mixer-channel'
  | 'stale-generation-mixer-channel'
  | 'unassigned-source'
  | 'source-disabled'
  | 'source-admission-mismatch'
  | 'source-not-live-musical'
  | 'source-kind-unsupported'
  | 'source-missing'
  | 'source-unavailable'
  | 'source-lane-missing'
  | 'source-lane-invalid'
  | 'source-lane-not-program'
  | 'mixer-channel-missing'
  | 'duplicate-mixer-channel-id'
  | 'mixer-channel-source-mismatch'
  | 'source-mixer-channel-conflict'
  | 'invalid-channel-processing'
  | 'duplicate-sum-group-id'
  | 'implicit-source-summing'
  | 'sum-group-invalid'
  | 'duplicate-monitor-send'
  | 'invalid-monitor-send-level'
  | 'source-main-policy-off'
  | 'source-has-no-destination'
  | 'duplicate-lane-id'
  | 'invalid-rig-profile-version'
  | 'invalid-channel-vector'
  | 'channel-vector-length-mismatch'
  | 'channel-out-of-range'
  | 'duplicate-channel-in-lane'
  | 'invalid-lane-role'
  | 'invalid-main-policy'
  | 'private-lane-main-enabled'
  | 'cue-lane-performer-missing'
  | 'main-monitor-channel-collision'
  | 'private-channel-collision'
  | 'program-channel-collision'
  | 'main-output-missing'
  | 'audio-device-unavailable'
  | 'xr18-usb-audio-unavailable'
  | 'no-admitted-program-source'
  | 'required-program-source-unavailable'
  | 'duplicate-performer-id'
  | 'performer-monitor-unassigned'
  | 'performer-monitor-invalid'
  | 'performer-monitor-conflict'
  | 'monitor-output-missing'
  | 'monitor-output-conflict'
  | 'monitor-output-invalid'
  | 'invalid-device-capability'
  | 'source-monitor-performer-unknown'
  | 'main-output-blocked'
  | 'click-lane-missing'
  | 'click-lane-conflict'
  | 'cue-lane-missing'
  | 'cue-lane-conflict'
  | 'duplicate-cue-track-id'
  | 'cue-track-performer-missing'
  | 'cue-track-performer-unknown'
  | 'performer-cue-track-conflict'
  | 'practice-track-missing'
  | 'practice-track-disabled'
  | 'practice-track-invalid'
  | 'runtime-route-unverified'
  | 'xr18-control-is-not-audio-evidence'
  | LiveRoutingInputFactCode

export type LiveAudioIssue = Readonly<{
  code: LiveAudioIssueCode
  severity: 'blocking' | 'output' | 'warning'
  scope: 'configuration' | 'main' | 'performer' | 'source' | 'practice'
  message: string
  sourceId?: string
  performerId?: string
  laneId?: string
  cueTrackId?: string
  actualValue?: string
}>

export type ValidatedSourceLane = Readonly<{
  id: string
  role: 'program' | 'click' | 'cue'
  performerId?: string
  webAudioChannels: readonly number[]
  usbReturnChannels: readonly number[]
  xr18InputStrips: readonly number[]
  mainPolicy: 'on' | 'off'
}>

export type AdmittedLiveSource = Readonly<{
  id: string
  label: string
  kind: LiveSourceKind
  required: boolean
  mixerChannelId: string
  processing: Readonly<{
    gain: number
    eq?: unknown
  }>
  programLaneId: string
  destinations: readonly string[]
}>

export type ExcludedLiveSource = Readonly<{
  id: string
  label: string
  kind: LiveSourceKind
  reason: LiveAudioIssueCode
}>

export type CueContentState = 'enabled' | 'disabled' | 'missing'
export type AnnouncementContentState = 'enabled' | 'disabled' | 'missing'

export type PlannedCueTrack = Readonly<{
  id: string
  name: string
  performerId: string | null
  trackEnabled: boolean
  cueContent: CueContentState
  announcementContent: AnnouncementContentState
  cueDestinations: readonly string[]
  announcementDestinations: readonly string[]
}>

export type PlannedClickRoute = Readonly<{
  laneId: string | null
  destinations: readonly string[]
  mainEnabledByPractice: boolean
}>

export type ShadowReadiness = Readonly<{
  /** Contract vocabulary. A pure shadow can never advance a valid route past initializing. */
  state: 'unconfigured' | 'initializing' | 'failed' | 'disconnected'
  evidence: 'none' | 'configured'
  reasonCodes: readonly LiveAudioIssueCode[]
  runtimeActivationVerified: false
  physicallyConfirmed: false
}>

export type PlannedMainOutput = Readonly<{
  logicalOutputId: 'main'
  physicalOutputId: string | null
  sourceIds: readonly string[]
  sourceLaneIds: readonly string[]
  click: boolean
  cueTrackIds: readonly string[]
  announcementTrackIds: readonly string[]
  readiness: ShadowReadiness
}>

export type PlannedPerformerOutput = Readonly<{
  performerId: string
  performerName: string
  logicalOutputId: string
  monitorBus: number | null
  physicalOutputId: string | null
  required: boolean
  sourceIds: readonly string[]
  sourceSends: readonly Readonly<{
    sourceId: string
    mixerChannelId: string
    gain: number
  }>[]
  click: boolean
  cueTrackIds: readonly string[]
  announcementTrackIds: readonly string[]
  sourceLaneIds: readonly string[]
  readiness: ShadowReadiness
}>

export type LiveAudioShadowPlan = Readonly<{
  schemaVersion: typeof LIVE_AUDIO_SHADOW_SCHEMA_VERSION
  generationId: string
  projectId: string
  songId: string
  rigProfileId: string
  rigProfileVersion: number | null
  admittedSources: readonly AdmittedLiveSource[]
  excludedSources: readonly ExcludedLiveSource[]
  validatedSourceLanes: readonly ValidatedSourceLane[]
  main: PlannedMainOutput
  performers: readonly PlannedPerformerOutput[]
  click: PlannedClickRoute
  cueTracks: readonly PlannedCueTrack[]
  issues: readonly LiveAudioIssue[]
  configurationDisposition: 'blocked' | 'degraded' | 'routable' | 'main-only'
  xr18ControlConnected: boolean
  xr18AudioRouteVerified: false
}>

export type CurrentLiveAudioContext = Readonly<{
  project: LiveAudioProjectInput
  song: LiveAudioSongInput
}>

/**
 * Pure adapter for today's persisted project/song shapes. It does not infer
 * source admission or repair malformed route values.
 */
export function snapshotCurrentLiveAudioContext(
  project: Pick<ProjectFile, 'id' | 'performers'>,
  songId: string,
  songMap: Pick<SongMapV3, 'cueTracks'>,
): CurrentLiveAudioContext {
  return {
    project: {
      id: project.id,
      performers: (project.performers ?? []).map((performer) => ({
        id: performer.id,
        name: performer.name,
        monitorBus: performer.monitorBus,
        required: true,
      })),
    },
    song: {
      id: songId,
      cueTracks: songMap.cueTracks.map((track) => ({
        ...track,
        mix: track.mix
          ? { ...track.mix, stems: { ...track.mix.stems } }
          : undefined,
        renderExport: track.renderExport
          ? { ...track.renderExport }
          : undefined,
        events: track.events.map((event) => ({
          ...event,
          anchor: { ...event.anchor },
        })),
        suppressedGeneratedKeys: [...track.suppressedGeneratedKeys],
      })),
    },
  }
}

type MutableIssue = LiveAudioIssue

type LaneValidation = {
  lane: ValidatedSourceLane | null
  invalid: boolean
}

type MutablePerformer = {
  input: LivePerformerInput
  monitorBus: number | null
  physicalOutputId: string | null
  sourceIds: string[]
  sourceSends: Array<{ sourceId: string; mixerChannelId: string; gain: number }>
  sourceLaneIds: string[]
  cueTrackIds: string[]
  announcementTrackIds: string[]
  click: boolean
  reasons: LiveAudioIssueCode[]
  unconfigured: boolean
}

const PROHIBITED_SOURCE_SCOPES = new Set<LiveSourceScope>([
  'editor-only',
  'preview-only',
  'orphaned',
  'test-only',
  'unknown',
])

const PROHIBITED_SOURCE_KINDS = new Set<LiveSourceKind>([
  'preview-audio',
  'test-signal',
  'unknown',
])

function compareStrings(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareStrings)
}

function issueSortKey(issue: LiveAudioIssue): string {
  return [
    issue.scope,
    issue.performerId ?? '',
    issue.sourceId ?? '',
    issue.laneId ?? '',
    issue.cueTrackId ?? '',
    issue.code,
    issue.actualValue ?? '',
  ].join('|')
}

function stableDiagnosticValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function integerInRange(
  value: unknown,
  min: number,
  max: number,
): number | null {
  return Number.isInteger(value) &&
    (value as number) >= min &&
    (value as number) <= max
    ? (value as number)
    : null
}

function numericCapability(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0
    ? (value as number)
    : null
}

function contentState(
  events: readonly CueEvent[],
  include: (event: CueEvent) => boolean,
): CueContentState {
  const matching = events.filter(include)
  if (matching.length === 0) return 'missing'
  return matching.some((event) => event.enabled) ? 'enabled' : 'disabled'
}

function addReason(
  target: LiveAudioIssueCode[],
  code: LiveAudioIssueCode,
): void {
  if (!target.includes(code)) target.push(code)
}

function configuredReadiness(
  reasons: readonly LiveAudioIssueCode[],
): ShadowReadiness {
  if (reasons.includes('audio-device-unavailable')) {
    return {
      state: 'disconnected',
      evidence: 'none',
      reasonCodes: uniqueSorted(reasons),
      runtimeActivationVerified: false,
      physicallyConfirmed: false,
    }
  }
  if (reasons.length > 0) {
    return {
      state: 'failed',
      evidence: 'none',
      reasonCodes: uniqueSorted(reasons),
      runtimeActivationVerified: false,
      physicallyConfirmed: false,
    }
  }
  return {
    state: 'initializing',
    evidence: 'configured',
    reasonCodes: ['runtime-route-unverified'],
    runtimeActivationVerified: false,
    physicallyConfirmed: false,
  }
}

function validateChannelVector(
  raw: unknown,
  minimum: number,
  maximumExclusive: number | null,
  laneId: string,
  field: string,
  issues: MutableIssue[],
): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.push({
      code: 'invalid-channel-vector',
      severity: 'blocking',
      scope: 'configuration',
      laneId,
      message: `${field} for lane ${laneId} must be a non-empty integer array.`,
      actualValue: stableDiagnosticValue(raw),
    })
    return null
  }
  const parsed: number[] = []
  for (const value of raw) {
    if (!Number.isInteger(value) || (value as number) < minimum) {
      issues.push({
        code: 'invalid-channel-vector',
        severity: 'blocking',
        scope: 'configuration',
        laneId,
        message: `${field} for lane ${laneId} contains an invalid channel.`,
        actualValue: stableDiagnosticValue(value),
      })
      return null
    }
    if (maximumExclusive !== null && (value as number) >= maximumExclusive) {
      issues.push({
        code: 'channel-out-of-range',
        severity: 'blocking',
        scope: 'configuration',
        laneId,
        message: `${field} for lane ${laneId} exceeds current device capability.`,
        actualValue: stableDiagnosticValue(value),
      })
      return null
    }
    parsed.push(value as number)
  }
  if (new Set(parsed).size !== parsed.length) {
    issues.push({
      code: 'duplicate-channel-in-lane',
      severity: 'blocking',
      scope: 'configuration',
      laneId,
      message: `${field} for lane ${laneId} repeats a channel.`,
      actualValue: stableDiagnosticValue(raw),
    })
    return null
  }
  return parsed
}

function validateLanes(
  input: LiveAudioShadowInput,
  issues: MutableIssue[],
  mainReasons: LiveAudioIssueCode[],
): { lanes: Map<string, ValidatedSourceLane>; invalidLaneIds: Set<string> } {
  const outputCount = numericCapability(input.device.outputChannelCount)
  const usbReturnCount = numericCapability(input.device.usbReturnChannelCount)
  const stripCount = numericCapability(input.device.xr18InputStripCount)
  const idCounts = new Map<string, number>()
  for (const lane of input.rigProfile.sourceLanes)
    idCounts.set(lane.id, (idCounts.get(lane.id) ?? 0) + 1)

  const validations = new Map<string, LaneValidation>()
  const invalidLaneIds = new Set<string>()
  for (const raw of [...input.rigProfile.sourceLanes].sort((a, b) =>
    compareStrings(a.id, b.id),
  )) {
    let invalid = false
    if (!raw.id || (idCounts.get(raw.id) ?? 0) > 1) {
      issues.push({
        code: 'duplicate-lane-id',
        severity: 'blocking',
        scope: 'configuration',
        laneId: raw.id,
        message: `Source lane id ${raw.id || '(empty)'} is not unique.`,
      })
      invalid = true
    }
    if (raw.role !== 'program' && raw.role !== 'click' && raw.role !== 'cue') {
      issues.push({
        code: 'invalid-lane-role',
        severity: 'blocking',
        scope: 'configuration',
        laneId: raw.id,
        message: `Lane ${raw.id} has an unknown role.`,
        actualValue: stableDiagnosticValue(raw.role),
      })
      invalid = true
    }
    if (raw.mainPolicy !== 'on' && raw.mainPolicy !== 'off') {
      issues.push({
        code: 'invalid-main-policy',
        severity: 'blocking',
        scope: 'configuration',
        laneId: raw.id,
        message: `Lane ${raw.id} has an invalid Main policy.`,
        actualValue: stableDiagnosticValue(raw.mainPolicy),
      })
      invalid = true
    }
    if (
      (raw.role === 'click' || raw.role === 'cue') &&
      raw.mainPolicy === 'on'
    ) {
      issues.push({
        code: 'private-lane-main-enabled',
        severity: 'blocking',
        scope: 'main',
        laneId: raw.id,
        performerId: raw.performerId,
        message: `Private lane ${raw.id} is configured on Main.`,
      })
      addReason(mainReasons, 'private-lane-main-enabled')
      invalid = true
    }
    if (raw.role === 'cue' && !raw.performerId) {
      issues.push({
        code: 'cue-lane-performer-missing',
        severity: 'output',
        scope: 'configuration',
        laneId: raw.id,
        message: `Cue lane ${raw.id} has no performer owner.`,
      })
      invalid = true
    }

    const web = validateChannelVector(
      raw.webAudioChannels,
      0,
      outputCount,
      raw.id,
      'Web Audio channels',
      issues,
    )
    const usb = validateChannelVector(
      raw.usbReturnChannels,
      0,
      usbReturnCount,
      raw.id,
      'USB return channels',
      issues,
    )
    const strips = validateChannelVector(
      raw.xr18InputStrips,
      1,
      stripCount === null ? null : stripCount + 1,
      raw.id,
      'XR18 input strips',
      issues,
    )
    if (!web || !usb || !strips) invalid = true
    if (
      web &&
      usb &&
      strips &&
      (web.length !== usb.length || web.length !== strips.length)
    ) {
      issues.push({
        code: 'channel-vector-length-mismatch',
        severity: 'blocking',
        scope: 'configuration',
        laneId: raw.id,
        message: `Lane ${raw.id} does not map Web, USB, and XR18 channels one-to-one.`,
      })
      invalid = true
    }

    const lane: ValidatedSourceLane | null =
      !invalid &&
      web &&
      usb &&
      strips &&
      (raw.role === 'program' || raw.role === 'click' || raw.role === 'cue') &&
      (raw.mainPolicy === 'on' || raw.mainPolicy === 'off')
        ? {
            id: raw.id,
            role: raw.role,
            performerId: raw.performerId,
            webAudioChannels: web,
            usbReturnChannels: usb,
            xr18InputStrips: strips,
            mainPolicy: raw.mainPolicy,
          }
        : null
    validations.set(raw.id, { lane, invalid })
    if (invalid) invalidLaneIds.add(raw.id)
  }

  const initiallyValid = [...validations.values()]
    .map((value) => value.lane)
    .filter((lane): lane is ValidatedSourceLane => lane !== null)

  const collisionFields: Array<
    keyof Pick<
      ValidatedSourceLane,
      'webAudioChannels' | 'usbReturnChannels' | 'xr18InputStrips'
    >
  > = ['webAudioChannels', 'usbReturnChannels', 'xr18InputStrips']
  for (const field of collisionFields) {
    const users = new Map<number, ValidatedSourceLane[]>()
    for (const lane of initiallyValid) {
      for (const channel of lane[field]) {
        const existing = users.get(channel) ?? []
        existing.push(lane)
        users.set(channel, existing)
      }
    }
    for (const [channel, lanes] of [...users.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      const distinct = [
        ...new Map(lanes.map((lane) => [lane.id, lane])).values(),
      ]
      if (distinct.length < 2) continue
      const roles = new Set(
        distinct.map((lane) =>
          lane.role === 'program' ? 'program' : 'private',
        ),
      )
      let code: LiveAudioIssueCode
      if (roles.size > 1) code = 'main-monitor-channel-collision'
      else if (roles.has('private')) code = 'private-channel-collision'
      else code = 'program-channel-collision'
      issues.push({
        code,
        severity: code === 'private-channel-collision' ? 'output' : 'blocking',
        scope: code === 'private-channel-collision' ? 'configuration' : 'main',
        message: `${field} channel ${channel} is shared by ${distinct
          .map((lane) => lane.id)
          .sort(compareStrings)
          .join(', ')}.`,
        actualValue: String(channel),
      })
      for (const lane of distinct) invalidLaneIds.add(lane.id)
      if (code !== 'private-channel-collision') addReason(mainReasons, code)
    }
  }

  const lanes = new Map<string, ValidatedSourceLane>()
  for (const lane of initiallyValid) {
    if (!invalidLaneIds.has(lane.id)) lanes.set(lane.id, lane)
  }
  return { lanes, invalidLaneIds }
}

type ValidatedMixerChannel = Readonly<{
  id: string
  sourceId: string
  rigSourceLaneId: string
  processing: Readonly<{ gain: number; eq?: unknown }>
  sumGroupId?: string
}>

function sameStringMembers(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const a = [...left].sort(compareStrings)
  const b = [...right].sort(compareStrings)
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function validateMixerChannels(
  input: LiveAudioShadowInput,
  issues: MutableIssue[],
): {
  channels: Map<string, ValidatedMixerChannel>
  rawChannelIds: Set<string>
  invalidChannelIds: Set<string>
} {
  const idCounts = new Map<string, number>()
  const sourceCounts = new Map<string, number>()
  for (const channel of input.mixerChannels) {
    idCounts.set(channel.id, (idCounts.get(channel.id) ?? 0) + 1)
    sourceCounts.set(
      channel.sourceId,
      (sourceCounts.get(channel.sourceId) ?? 0) + 1,
    )
  }

  const sumGroupCounts = new Map<string, number>()
  for (const group of input.sourceSumGroups) {
    sumGroupCounts.set(group.id, (sumGroupCounts.get(group.id) ?? 0) + 1)
  }
  const validSumGroups = new Map<string, LiveSourceSumGroupInput>()
  for (const group of [...input.sourceSumGroups].sort((left, right) =>
    compareStrings(left.id, right.id),
  )) {
    if (!group.id || (sumGroupCounts.get(group.id) ?? 0) > 1) {
      issues.push({
        code: 'duplicate-sum-group-id',
        severity: 'blocking',
        scope: 'configuration',
        message: `Source sum group ${group.id || '(empty)'} is not unique.`,
      })
      continue
    }
    if (
      !group.rigSourceLaneId ||
      group.mixerChannelIds.length < 2 ||
      new Set(group.mixerChannelIds).size !== group.mixerChannelIds.length
    ) {
      issues.push({
        code: 'sum-group-invalid',
        severity: 'blocking',
        scope: 'configuration',
        message: `Source sum group ${group.id} has an invalid lane or member list.`,
        actualValue: stableDiagnosticValue(group),
      })
      continue
    }
    validSumGroups.set(group.id, group)
  }

  const channels = new Map<string, ValidatedMixerChannel>()
  const invalidChannelIds = new Set<string>()
  for (const channel of [...input.mixerChannels].sort((left, right) =>
    compareStrings(left.id, right.id),
  )) {
    let invalid = false
    if (!channel.id || (idCounts.get(channel.id) ?? 0) > 1) {
      issues.push({
        code: 'duplicate-mixer-channel-id',
        severity: 'blocking',
        scope: 'configuration',
        sourceId: channel.sourceId,
        message: `Mixer channel ${channel.id || '(empty)'} is not unique.`,
      })
      invalid = true
    }
    if (channel.songId !== input.song.id) {
      issues.push({
        code: 'stale-song-mixer-channel',
        severity: 'blocking',
        scope: 'source',
        sourceId: channel.sourceId,
        message: `Mixer channel ${channel.id} belongs to a different song.`,
      })
      invalid = true
    }
    if (channel.generationId !== input.generationId) {
      issues.push({
        code: 'stale-generation-mixer-channel',
        severity: 'blocking',
        scope: 'source',
        sourceId: channel.sourceId,
        message: `Mixer channel ${channel.id} belongs to a stale generation.`,
      })
      invalid = true
    }
    if ((sourceCounts.get(channel.sourceId) ?? 0) > 1) {
      issues.push({
        code: 'source-mixer-channel-conflict',
        severity: 'blocking',
        scope: 'source',
        sourceId: channel.sourceId,
        message: `Source ${channel.sourceId} is owned by more than one mixer channel.`,
      })
      invalid = true
    }
    const gain =
      typeof channel.processing.gain === 'number' &&
      Number.isFinite(channel.processing.gain) &&
      channel.processing.gain >= 0
        ? channel.processing.gain
        : null
    if (gain === null) {
      issues.push({
        code: 'invalid-channel-processing',
        severity: 'blocking',
        scope: 'source',
        sourceId: channel.sourceId,
        message: `Mixer channel ${channel.id} has an invalid processing gain.`,
        actualValue: stableDiagnosticValue(channel.processing.gain),
      })
      invalid = true
    }
    const rigSourceLaneId =
      typeof channel.rigSourceLaneId === 'string' &&
      channel.rigSourceLaneId.trim()
        ? channel.rigSourceLaneId
        : null
    if (!rigSourceLaneId) {
      invalid = true
    }
    if (invalid) {
      invalidChannelIds.add(channel.id)
      continue
    }
    channels.set(channel.id, {
      id: channel.id,
      sourceId: channel.sourceId,
      rigSourceLaneId: rigSourceLaneId!,
      processing: {
        gain: gain!,
        ...(channel.processing.eq === undefined
          ? {}
          : { eq: channel.processing.eq }),
      },
      ...(channel.sumGroupId ? { sumGroupId: channel.sumGroupId } : {}),
    })
  }

  const channelsByLane = new Map<string, ValidatedMixerChannel[]>()
  for (const channel of channels.values()) {
    const laneChannels = channelsByLane.get(channel.rigSourceLaneId) ?? []
    laneChannels.push(channel)
    channelsByLane.set(channel.rigSourceLaneId, laneChannels)
  }
  for (const [laneId, laneChannels] of channelsByLane) {
    if (laneChannels.length < 2) {
      if (laneChannels[0]?.sumGroupId) {
        issues.push({
          code: 'sum-group-invalid',
          severity: 'blocking',
          scope: 'configuration',
          laneId,
          message: `Mixer channel ${laneChannels[0].id} names a sum group but has no source to sum with.`,
        })
        invalidChannelIds.add(laneChannels[0].id)
        channels.delete(laneChannels[0].id)
      }
      continue
    }
    const groupIds = uniqueSorted(
      laneChannels
        .map((channel) => channel.sumGroupId)
        .filter((id): id is string => Boolean(id)),
    )
    const group = groupIds.length === 1 ? validSumGroups.get(groupIds[0]!) : null
    if (
      !group ||
      groupIds.length !== 1 ||
      group.rigSourceLaneId !== laneId ||
      !sameStringMembers(
        group.mixerChannelIds,
        laneChannels.map((channel) => channel.id),
      )
    ) {
      for (const channel of laneChannels) {
        issues.push({
          code: groupIds.length === 0 ? 'implicit-source-summing' : 'sum-group-invalid',
          severity: 'blocking',
          scope: 'source',
          sourceId: channel.sourceId,
          laneId,
          message:
            groupIds.length === 0
              ? `Mixer channel ${channel.id} shares ${laneId} without an explicit sum group.`
              : `Mixer channel ${channel.id} has an incomplete or conflicting sum group.`,
        })
        invalidChannelIds.add(channel.id)
        channels.delete(channel.id)
      }
    } else {
      const intentsBySource = new Map<string, LiveSourceIntent[]>()
      for (const intent of input.sourceIntents) {
        const sourceIntents = intentsBySource.get(intent.sourceId) ?? []
        sourceIntents.push(intent)
        intentsBySource.set(intent.sourceId, sourceIntents)
      }
      const routeSignatures = laneChannels.map((channel) => {
        const sourceIntents = intentsBySource.get(channel.sourceId) ?? []
        if (sourceIntents.length !== 1) return '__invalid-intent__'
        const intent = sourceIntents[0]!
        const sends = [...intent.monitorSends]
          .map((send) => `${send.performerId}:${stableDiagnosticValue(send.gain)}`)
          .sort(compareStrings)
        return `${intent.main ? 'main' : 'no-main'}|${sends.join(',')}`
      })
      if (new Set(routeSignatures).size !== 1) {
        for (const channel of laneChannels) {
          issues.push({
            code: 'sum-group-invalid',
            severity: 'blocking',
            scope: 'source',
            sourceId: channel.sourceId,
            laneId,
            message: `Summed lane ${laneId} has source-specific Main or monitor sends that cannot survive the sum.`,
          })
          invalidChannelIds.add(channel.id)
          channels.delete(channel.id)
        }
      }
    }
  }

  return {
    channels,
    rawChannelIds: new Set(input.mixerChannels.map((channel) => channel.id)),
    invalidChannelIds,
  }
}

function classifyCueTracks(
  input: LiveAudioShadowInput,
  issues: MutableIssue[],
): PlannedCueTrack[] {
  const performerIds = new Set(
    input.project.performers.map((performer) => performer.id),
  )
  const idCounts = new Map<string, number>()
  for (const track of input.song.cueTracks)
    idCounts.set(track.id, (idCounts.get(track.id) ?? 0) + 1)
  return [...input.song.cueTracks]
    .sort((a, b) => compareStrings(a.id, b.id))
    .map((track) => {
      if ((idCounts.get(track.id) ?? 0) > 1) {
        issues.push({
          code: 'duplicate-cue-track-id',
          severity: 'output',
          scope: 'configuration',
          cueTrackId: track.id,
          message: `Cue track id ${track.id} is not unique.`,
        })
      }
      if (!track.performerId) {
        issues.push({
          code: 'cue-track-performer-missing',
          severity: 'output',
          scope: 'configuration',
          cueTrackId: track.id,
          message: `Cue track ${track.id} has no performer owner.`,
        })
      } else if (!performerIds.has(track.performerId)) {
        issues.push({
          code: 'cue-track-performer-unknown',
          severity: 'output',
          scope: 'configuration',
          cueTrackId: track.id,
          performerId: track.performerId,
          message: `Cue track ${track.id} references an unknown performer.`,
        })
      }
      const cueContent = track.enabled
        ? contentState(track.events, (event) => event.kind !== 'intro')
        : 'disabled'
      const announcementContent = track.enabled
        ? contentState(track.events, (event) => event.kind === 'intro')
        : 'disabled'
      return {
        id: track.id,
        name: track.name,
        performerId: track.performerId ?? null,
        trackEnabled: track.enabled,
        cueContent,
        announcementContent,
        cueDestinations: [],
        announcementDestinations: [],
      }
    })
}

/**
 * Calculate intended Live routing. This is the sole owner of shadow admission
 * and route validation; callers may render or log the result but may not treat
 * it as runtime activation evidence.
 */
export function validateAudioConfiguration(
  input: LiveAudioShadowInput,
): LiveAudioShadowPlan {
  const issues: MutableIssue[] = []
  const mainReasons: LiveAudioIssueCode[] = []

  for (const fact of input.inputFacts) {
    const configurationBlocking =
      fact.code === 'raw-project-routing-invalid' ||
      fact.code === 'project-id-mismatch' ||
      fact.code === 'rig-profile-missing' ||
      fact.code === 'rig-profile-field-invalid'
    const sourceBlocking =
      fact.code === 'source-producer-ambiguous' ||
      fact.code === 'source-asset-ambiguous'
    issues.push({
      code: fact.code,
      severity:
        configurationBlocking || sourceBlocking
          ? 'blocking'
          : fact.code === 'performer-row-invalid'
            ? 'output'
            : 'warning',
      scope:
        fact.code === 'performer-row-invalid'
          ? 'performer'
          : sourceBlocking || fact.code === 'legacy-source-unreviewed' || fact.code === 'stale-source-asset'
            ? 'source'
            : 'configuration',
      sourceId: fact.sourceId,
      message: fact.message,
      actualValue:
        fact.actualValue === undefined
          ? undefined
          : stableDiagnosticValue(fact.actualValue),
    })
    if (configurationBlocking) addReason(mainReasons, fact.code)
  }

  const profileVersion = integerInRange(
    input.rigProfile.version,
    1,
    Number.MAX_SAFE_INTEGER,
  )
  if (profileVersion === null) {
    issues.push({
      code: 'invalid-rig-profile-version',
      severity: 'blocking',
      scope: 'configuration',
      message: 'The Live rig profile version must be a positive integer.',
      actualValue: stableDiagnosticValue(input.rigProfile.version),
    })
    addReason(mainReasons, 'invalid-rig-profile-version')
  }
  const mainPhysicalOutputId =
    typeof input.rigProfile.mainPhysicalOutputId === 'string' &&
    input.rigProfile.mainPhysicalOutputId.trim()
      ? input.rigProfile.mainPhysicalOutputId
      : null
  if (!mainPhysicalOutputId) {
    issues.push({
      code: 'main-output-missing',
      severity: 'blocking',
      scope: 'main',
      message: 'The rig profile has no physical Main output.',
      actualValue: stableDiagnosticValue(input.rigProfile.mainPhysicalOutputId),
    })
    addReason(mainReasons, 'main-output-missing')
  }
  if (!input.device.audioDeviceAvailable) {
    issues.push({
      code: 'audio-device-unavailable',
      severity: 'blocking',
      scope: 'main',
      message: 'The selected audio device is unavailable.',
    })
    addReason(mainReasons, 'audio-device-unavailable')
  }
  if (!input.device.xr18UsbAudioAvailable) {
    issues.push({
      code: 'xr18-usb-audio-unavailable',
      severity: 'blocking',
      scope: 'main',
      message: 'The XR18 USB audio interface is unavailable.',
    })
    addReason(mainReasons, 'xr18-usb-audio-unavailable')
  }
  const invalidCapabilities = [
    ['outputChannelCount', input.device.outputChannelCount],
    ['usbReturnChannelCount', input.device.usbReturnChannelCount],
    ['xr18InputStripCount', input.device.xr18InputStripCount],
    ['xr18MonitorBusCount', input.device.xr18MonitorBusCount],
  ].filter(([, value]) => numericCapability(value) === null)
  for (const [name, value] of invalidCapabilities) {
    issues.push({
      code: 'invalid-device-capability',
      severity: 'blocking',
      scope: 'configuration',
      message: `${name} must be a non-negative integer before Live routing can be planned.`,
      actualValue: stableDiagnosticValue(value),
    })
    addReason(mainReasons, 'invalid-device-capability')
  }
  if (input.device.xr18ControlConnected) {
    issues.push({
      code: 'xr18-control-is-not-audio-evidence',
      severity: 'warning',
      scope: 'configuration',
      message:
        'XR18 OSC control connectivity does not verify a USB or graph audio route.',
    })
  }

  const { lanes, invalidLaneIds } = validateLanes(input, issues, mainReasons)
  const mixerValidation = validateMixerChannels(input, issues)
  const rawLaneIds = new Set(
    input.rigProfile.sourceLanes.map((lane) => lane.id),
  )
  const laneValues = [...lanes.values()]
  const clickLanes = laneValues.filter((lane) => lane.role === 'click')
  const clickLane = clickLanes.length === 1 ? clickLanes[0]! : null
  if (clickLanes.length === 0) {
    issues.push({
      code: 'click-lane-missing',
      severity: 'output',
      scope: 'configuration',
      message: 'No valid private click lane exists.',
    })
  } else if (clickLanes.length > 1) {
    issues.push({
      code: 'click-lane-conflict',
      severity: 'output',
      scope: 'configuration',
      message: 'More than one private click lane exists.',
    })
  }

  const cueTracks = classifyCueTracks(input, issues)
  const cueTracksByPerformer = new Map<string, PlannedCueTrack[]>()
  for (const track of cueTracks) {
    if (!track.performerId) continue
    const list = cueTracksByPerformer.get(track.performerId) ?? []
    list.push(track)
    cueTracksByPerformer.set(track.performerId, list)
  }

  const outputCount = numericCapability(input.device.xr18MonitorBusCount)
  const monitorOutputByBus = new Map<number, string>()
  const conflictingMonitorBuses = new Set<number>()
  for (const raw of input.rigProfile.monitorOutputs) {
    const bus =
      outputCount === null
        ? null
        : integerInRange(raw.monitorBus, 1, outputCount)
    const physical =
      typeof raw.physicalOutputId === 'string' && raw.physicalOutputId.trim()
        ? raw.physicalOutputId
        : null
    if (bus === null || !physical) {
      issues.push({
        code: 'monitor-output-invalid',
        severity: 'output',
        scope: 'configuration',
        message:
          'A monitor output mapping has an invalid bus or physical output id.',
        actualValue: stableDiagnosticValue(raw),
      })
      continue
    }
    if (monitorOutputByBus.has(bus)) {
      conflictingMonitorBuses.add(bus)
      issues.push({
        code: 'monitor-output-conflict',
        severity: 'output',
        scope: 'configuration',
        message: `Monitor bus ${bus} has more than one physical output mapping.`,
        actualValue: String(bus),
      })
    } else {
      monitorOutputByBus.set(bus, physical)
    }
  }

  const performerIdCounts = new Map<string, number>()
  for (const performer of input.project.performers) {
    performerIdCounts.set(
      performer.id,
      (performerIdCounts.get(performer.id) ?? 0) + 1,
    )
  }
  const performers = new Map<string, MutablePerformer>()
  const performerBusUsers = new Map<number, string[]>()
  for (const performer of [...input.project.performers].sort((a, b) =>
    compareStrings(a.id, b.id),
  )) {
    const mutable: MutablePerformer = {
      input: performer,
      monitorBus: null,
      physicalOutputId: null,
      sourceIds: [],
      sourceSends: [],
      sourceLaneIds: [],
      cueTrackIds: [],
      announcementTrackIds: [],
      click: false,
      reasons: [],
      unconfigured: false,
    }
    if ((performerIdCounts.get(performer.id) ?? 0) > 1) {
      issues.push({
        code: 'duplicate-performer-id',
        severity: 'output',
        scope: 'performer',
        performerId: performer.id,
        message: `Performer id ${performer.id} is not unique.`,
      })
      addReason(mutable.reasons, 'duplicate-performer-id')
    }
    if (performer.monitorBus === undefined || performer.monitorBus === null) {
      issues.push({
        code: 'performer-monitor-unassigned',
        severity: 'output',
        scope: 'performer',
        performerId: performer.id,
        message: `${performer.name} has no monitor bus assignment.`,
      })
      addReason(mutable.reasons, 'performer-monitor-unassigned')
      mutable.unconfigured = true
    } else {
      const bus =
        outputCount === null
          ? null
          : integerInRange(performer.monitorBus, 1, outputCount)
      if (bus === null) {
        issues.push({
          code: 'performer-monitor-invalid',
          severity: 'output',
          scope: 'performer',
          performerId: performer.id,
          message: `${performer.name} has an invalid monitor bus assignment.`,
          actualValue: stableDiagnosticValue(performer.monitorBus),
        })
        addReason(mutable.reasons, 'performer-monitor-invalid')
      } else {
        mutable.monitorBus = bus
        const users = performerBusUsers.get(bus) ?? []
        users.push(performer.id)
        performerBusUsers.set(bus, users)
        if (conflictingMonitorBuses.has(bus))
          addReason(mutable.reasons, 'monitor-output-conflict')
        const physical = monitorOutputByBus.get(bus) ?? null
        if (!physical) {
          issues.push({
            code: 'monitor-output-missing',
            severity: 'output',
            scope: 'performer',
            performerId: performer.id,
            message: `Monitor bus ${bus} has no physical output mapping.`,
          })
          addReason(mutable.reasons, 'monitor-output-missing')
        }
        mutable.physicalOutputId = physical
      }
    }
    performers.set(performer.id, mutable)
  }

  for (const [bus, ids] of [...performerBusUsers.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    if (ids.length < 2) continue
    for (const id of ids) {
      const performer = performers.get(id)
      if (performer) addReason(performer.reasons, 'performer-monitor-conflict')
      issues.push({
        code: 'performer-monitor-conflict',
        severity: 'output',
        scope: 'performer',
        performerId: id,
        message: `Monitor bus ${bus} is assigned to multiple performers.`,
        actualValue: String(bus),
      })
    }
  }

  const cueLaneByPerformer = new Map<string, ValidatedSourceLane[]>()
  for (const lane of laneValues.filter(
    (candidate) => candidate.role === 'cue',
  )) {
    if (!lane.performerId) continue
    const list = cueLaneByPerformer.get(lane.performerId) ?? []
    list.push(lane)
    cueLaneByPerformer.set(lane.performerId, list)
  }

  for (const performer of performers.values()) {
    if (!input.device.audioDeviceAvailable)
      addReason(performer.reasons, 'audio-device-unavailable')
    if (!input.device.xr18UsbAudioAvailable)
      addReason(performer.reasons, 'xr18-usb-audio-unavailable')
    if (invalidCapabilities.length > 0)
      addReason(performer.reasons, 'invalid-device-capability')
    if (!clickLane)
      addReason(
        performer.reasons,
        clickLanes.length > 1 ? 'click-lane-conflict' : 'click-lane-missing',
      )

    const tracks = cueTracksByPerformer.get(performer.input.id) ?? []
    if (tracks.length > 1) {
      issues.push({
        code: 'performer-cue-track-conflict',
        severity: 'output',
        scope: 'performer',
        performerId: performer.input.id,
        message: `${performer.input.name} owns more than one cue track.`,
      })
      addReason(performer.reasons, 'performer-cue-track-conflict')
    }
    const activeContent = tracks.some(
      (track) =>
        track.trackEnabled &&
        (track.cueContent === 'enabled' ||
          track.announcementContent === 'enabled'),
    )
    const cueLanes = cueLaneByPerformer.get(performer.input.id) ?? []
    const cueLane = cueLanes.length === 1 ? cueLanes[0]! : null
    if (activeContent && cueLanes.length === 0) {
      issues.push({
        code: 'cue-lane-missing',
        severity: 'output',
        scope: 'performer',
        performerId: performer.input.id,
        message: `${performer.input.name} has enabled cue content but no private cue lane.`,
      })
      addReason(performer.reasons, 'cue-lane-missing')
    } else if (cueLanes.length > 1) {
      issues.push({
        code: 'cue-lane-conflict',
        severity: 'output',
        scope: 'performer',
        performerId: performer.input.id,
        message: `${performer.input.name} has more than one private cue lane.`,
      })
      addReason(performer.reasons, 'cue-lane-conflict')
    }

    if (performer.reasons.length === 0) {
      performer.click = clickLane !== null
      if (clickLane) performer.sourceLaneIds.push(clickLane.id)
      if (cueLane) {
        performer.sourceLaneIds.push(cueLane.id)
        for (const track of tracks) {
          if (!track.trackEnabled) continue
          if (track.cueContent === 'enabled')
            performer.cueTrackIds.push(track.id)
          if (track.announcementContent === 'enabled')
            performer.announcementTrackIds.push(track.id)
        }
      }
    }
  }

  const candidateCounts = new Map<string, number>()
  for (const candidate of input.candidates)
    candidateCounts.set(
      candidate.id,
      (candidateCounts.get(candidate.id) ?? 0) + 1,
    )
  const intentBySource = new Map<string, LiveSourceIntent[]>()
  for (const intent of input.sourceIntents) {
    const list = intentBySource.get(intent.sourceId) ?? []
    list.push(intent)
    intentBySource.set(intent.sourceId, list)
  }
  const candidateIds = new Set(
    input.candidates.map((candidate) => candidate.id),
  )
  for (const intent of [...input.sourceIntents].sort((a, b) =>
    compareStrings(a.sourceId, b.sourceId),
  )) {
    if (!candidateIds.has(intent.sourceId)) {
      issues.push({
        code: 'intent-source-missing',
        severity: intent.required ? 'blocking' : 'warning',
        scope: 'source',
        sourceId: intent.sourceId,
        message: `Source intent ${intent.sourceId} has no current-song candidate.`,
      })
      if (intent.required && intent.main)
        addReason(mainReasons, 'required-program-source-unavailable')
    }
  }

  const supportedKinds = new Set(input.supportedMusicalSourceKinds)
  const admittedSources: AdmittedLiveSource[] = []
  const excludedSources: ExcludedLiveSource[] = []

  const exclude = (
    candidate: LiveSourceCandidate,
    reason: LiveAudioIssueCode,
    message: string,
  ): void => {
    excludedSources.push({
      id: candidate.id,
      label: candidate.label,
      kind: candidate.kind,
      reason,
    })
    issues.push({
      code: reason,
      severity: 'warning',
      scope: 'source',
      sourceId: candidate.id,
      message,
    })
  }

  for (const candidate of [...input.candidates].sort((a, b) =>
    compareStrings(a.id, b.id),
  )) {
    if ((candidateCounts.get(candidate.id) ?? 0) > 1) {
      exclude(
        candidate,
        'duplicate-source-id',
        `Source id ${candidate.id} is not unique.`,
      )
      continue
    }
    if (candidate.songId !== input.song.id) {
      exclude(
        candidate,
        'stale-song-source',
        `Source ${candidate.id} belongs to a different song.`,
      )
      continue
    }
    if (candidate.generationId !== input.generationId) {
      exclude(
        candidate,
        'stale-generation-source',
        `Source ${candidate.id} belongs to a stale generation.`,
      )
      continue
    }
    const intents = intentBySource.get(candidate.id) ?? []
    if (candidate.admissionStatus === 'unassigned') {
      exclude(
        candidate,
        'unassigned-source',
        `Source ${candidate.id} has no explicit Live admission decision.`,
      )
      if (intents.some((intent) => intent.required && intent.main)) {
        addReason(mainReasons, 'required-program-source-unavailable')
      }
      continue
    }
    if (
      PROHIBITED_SOURCE_SCOPES.has(candidate.scope) ||
      candidate.scope !== 'live-musical' ||
      PROHIBITED_SOURCE_KINDS.has(candidate.kind)
    ) {
      exclude(
        candidate,
        'source-not-live-musical',
        `Source ${candidate.id} is ${candidate.scope} and cannot enter Live.`,
      )
      if (intents.some((intent) => intent.required && intent.main)) {
        addReason(mainReasons, 'required-program-source-unavailable')
      }
      continue
    }
    if (!supportedKinds.has(candidate.kind)) {
      exclude(
        candidate,
        'source-kind-unsupported',
        `Source kind ${candidate.kind} is not enabled by the Live policy.`,
      )
      if (intents.some((intent) => intent.required && intent.main)) {
        addReason(mainReasons, 'required-program-source-unavailable')
      }
      continue
    }
    if (intents.length === 0) {
      exclude(
        candidate,
        'unassigned-source',
        `Source ${candidate.id} has no explicit Live assignment.`,
      )
      continue
    }
    if (intents.length > 1) {
      exclude(
        candidate,
        'duplicate-source-intent',
        `Source ${candidate.id} has conflicting Live assignments.`,
      )
      const requiredMain = intents.some(
        (intent) => intent.required && intent.main,
      )
      if (requiredMain)
        addReason(mainReasons, 'required-program-source-unavailable')
      continue
    }
    const intent = intents[0]!
    if (
      (candidate.admissionStatus === 'included') !== intent.included
    ) {
      exclude(
        candidate,
        'source-admission-mismatch',
        `Source ${candidate.id} has conflicting candidate and intent admission state.`,
      )
      if (intent.required && intent.main)
        addReason(mainReasons, 'required-program-source-unavailable')
      continue
    }
    if (intent.songId !== input.song.id) {
      exclude(
        candidate,
        'stale-song-intent',
        `Source assignment ${candidate.id} belongs to a different song.`,
      )
      if (intent.required && intent.main)
        addReason(mainReasons, 'required-program-source-unavailable')
      continue
    }
    if (intent.generationId !== input.generationId) {
      exclude(
        candidate,
        'stale-generation-intent',
        `Source assignment ${candidate.id} belongs to a stale generation.`,
      )
      if (intent.required && intent.main)
        addReason(mainReasons, 'required-program-source-unavailable')
      continue
    }
    if (!intent.included) {
      exclude(
        candidate,
        'source-disabled',
        `Source ${candidate.id} is explicitly disabled for Live.`,
      )
      continue
    }
    if (candidate.availability !== 'available') {
      const code =
        candidate.availability === 'missing'
          ? 'source-missing'
          : 'source-unavailable'
      exclude(
        candidate,
        code,
        `Source ${candidate.id} is ${candidate.availability}.`,
      )
      if (intent.required && intent.main)
        addReason(mainReasons, 'required-program-source-unavailable')
      continue
    }
    if (!mixerValidation.rawChannelIds.has(intent.mixerChannelId)) {
      exclude(
        candidate,
        'mixer-channel-missing',
        `Source ${candidate.id} references a missing mixer channel.`,
      )
      if (intent.required && intent.main)
        addReason(mainReasons, 'required-program-source-unavailable')
      continue
    }
    const mixerChannel = mixerValidation.channels.get(intent.mixerChannelId)
    if (
      !mixerChannel ||
      mixerValidation.invalidChannelIds.has(intent.mixerChannelId)
    ) {
      exclude(
        candidate,
        'source-lane-invalid',
        `Source ${candidate.id} references an invalid mixer-to-rig binding.`,
      )
      if (intent.required && intent.main)
        addReason(mainReasons, 'required-program-source-unavailable')
      continue
    }
    if (mixerChannel.sourceId !== candidate.id) {
      exclude(
        candidate,
        'mixer-channel-source-mismatch',
        `Mixer channel ${mixerChannel.id} is owned by another source.`,
      )
      if (intent.required && intent.main)
        addReason(mainReasons, 'required-program-source-unavailable')
      continue
    }
    if (!rawLaneIds.has(mixerChannel.rigSourceLaneId)) {
      exclude(
        candidate,
        'source-lane-missing',
        `Mixer channel ${mixerChannel.id} references a missing programme lane.`,
      )
      if (intent.required && intent.main)
        addReason(mainReasons, 'required-program-source-unavailable')
      continue
    }
    const lane = lanes.get(mixerChannel.rigSourceLaneId)
    if (!lane || invalidLaneIds.has(mixerChannel.rigSourceLaneId)) {
      exclude(
        candidate,
        'source-lane-invalid',
        `Mixer channel ${mixerChannel.id} references an invalid programme lane.`,
      )
      if (intent.required && intent.main)
        addReason(mainReasons, 'required-program-source-unavailable')
      continue
    }
    if (lane.role !== 'program') {
      exclude(
        candidate,
        'source-lane-not-program',
        `Source ${candidate.id} references a non-programme lane.`,
      )
      if (intent.required && intent.main)
        addReason(mainReasons, 'required-program-source-unavailable')
      continue
    }
    if (intent.main && lane.mainPolicy !== 'on') {
      exclude(
        candidate,
        'source-main-policy-off',
        `Source ${candidate.id} requests Main through a lane kept off Main.`,
      )
      if (intent.required)
        addReason(mainReasons, 'required-program-source-unavailable')
      continue
    }

    const destinations: string[] = []
    if (intent.main) destinations.push('main')
    const monitorSendCounts = new Map<string, number>()
    for (const send of intent.monitorSends) {
      monitorSendCounts.set(
        send.performerId,
        (monitorSendCounts.get(send.performerId) ?? 0) + 1,
      )
    }
    for (const send of [...intent.monitorSends].sort((left, right) =>
      compareStrings(left.performerId, right.performerId),
    )) {
      const performerId = send.performerId
      if ((monitorSendCounts.get(performerId) ?? 0) > 1) {
        issues.push({
          code: 'duplicate-monitor-send',
          severity: 'warning',
          scope: 'source',
          sourceId: candidate.id,
          performerId,
          message: `Source ${candidate.id} has duplicate sends to ${performerId}.`,
        })
        continue
      }
      const gain =
        typeof send.gain === 'number' &&
        Number.isFinite(send.gain) &&
        send.gain >= 0
          ? send.gain
          : null
      if (gain === null) {
        issues.push({
          code: 'invalid-monitor-send-level',
          severity: 'warning',
          scope: 'source',
          sourceId: candidate.id,
          performerId,
          message: `Source ${candidate.id} has an invalid monitor send level.`,
          actualValue: stableDiagnosticValue(send.gain),
        })
        continue
      }
      const performer = performers.get(performerId)
      if (!performer) {
        issues.push({
          code: 'source-monitor-performer-unknown',
          severity: 'warning',
          scope: 'source',
          sourceId: candidate.id,
          performerId,
          message: `Source ${candidate.id} references an unknown monitor performer.`,
        })
        continue
      }
      if (performer.reasons.length > 0) continue
      if (gain > 0) {
        destinations.push(`performer:${performerId}`)
        performer.sourceIds.push(candidate.id)
        performer.sourceLaneIds.push(lane.id)
        performer.sourceSends.push({
          sourceId: candidate.id,
          mixerChannelId: mixerChannel.id,
          gain,
        })
      }
    }
    if (destinations.length === 0) {
      exclude(
        candidate,
        'source-has-no-destination',
        `Source ${candidate.id} has no valid Live destination.`,
      )
      continue
    }
    admittedSources.push({
      id: candidate.id,
      label: candidate.label,
      kind: candidate.kind,
      required: intent.required,
      mixerChannelId: mixerChannel.id,
      processing: mixerChannel.processing,
      programLaneId: lane.id,
      destinations: uniqueSorted(destinations),
    })
  }

  const mainSourceIds = admittedSources
    .filter((source) => source.destinations.includes('main'))
    .map((source) => source.id)
    .sort(compareStrings)
  const mainSourceLaneIds = uniqueSorted(
    admittedSources
      .filter((source) => source.destinations.includes('main'))
      .map((source) => source.programLaneId),
  )
  if (mainSourceIds.length === 0) {
    issues.push({
      code: 'no-admitted-program-source',
      severity: 'blocking',
      scope: 'main',
      message: 'No explicitly admitted musical source can reach Main.',
    })
    addReason(mainReasons, 'no-admitted-program-source')
  }

  let practiceValid = false
  let selectedPracticeTrack: PlannedCueTrack | null = null
  if (input.practice.enabled) {
    const matchingPracticeTracks = cueTracks.filter(
      (track) => track.id === input.practice.selectedCueTrackId,
    )
    selectedPracticeTrack = matchingPracticeTracks[0] ?? null
    if (matchingPracticeTracks.length === 0) {
      issues.push({
        code: 'practice-track-missing',
        severity: 'output',
        scope: 'practice',
        cueTrackId: input.practice.selectedCueTrackId,
        message: 'Practice is on but its selected cue track does not exist.',
      })
    } else if (matchingPracticeTracks.length > 1) {
      issues.push({
        code: 'practice-track-invalid',
        severity: 'output',
        scope: 'practice',
        cueTrackId: input.practice.selectedCueTrackId,
        message: 'Practice cannot route an ambiguous duplicate cue track id.',
      })
    } else if (!selectedPracticeTrack.trackEnabled) {
      issues.push({
        code: 'practice-track-disabled',
        severity: 'output',
        scope: 'practice',
        cueTrackId: selectedPracticeTrack.id,
        message: 'Practice cannot route a disabled cue track.',
      })
    } else if (
      !selectedPracticeTrack.performerId ||
      !performers.has(selectedPracticeTrack.performerId)
    ) {
      issues.push({
        code: 'practice-track-invalid',
        severity: 'output',
        scope: 'practice',
        cueTrackId: selectedPracticeTrack.id,
        message:
          'Practice cannot route a cue track without a known performer owner.',
      })
    } else {
      practiceValid = true
    }
  }

  const mainBlocked = mainReasons.length > 0
  if (mainBlocked) {
    for (const performer of performers.values()) {
      addReason(performer.reasons, 'main-output-blocked')
      performer.sourceIds = []
      performer.sourceLaneIds = []
      performer.cueTrackIds = []
      performer.announcementTrackIds = []
      performer.click = false
    }
  }
  const practiceMainActive = practiceValid && !mainBlocked

  const validPerformerIds = new Set(
    [...performers.values()]
      .filter((performer) => performer.reasons.length === 0)
      .map((performer) => performer.input.id),
  )
  const plannedCueTracks = cueTracks.map((track) => {
    const cueDestinations: string[] = []
    const announcementDestinations: string[] = []
    if (
      track.trackEnabled &&
      track.performerId &&
      validPerformerIds.has(track.performerId)
    ) {
      if (track.cueContent === 'enabled')
        cueDestinations.push(`performer:${track.performerId}`)
      if (track.announcementContent === 'enabled')
        announcementDestinations.push(`performer:${track.performerId}`)
    }
    if (practiceMainActive && selectedPracticeTrack?.id === track.id) {
      if (track.cueContent === 'enabled') cueDestinations.push('main')
      if (track.announcementContent === 'enabled')
        announcementDestinations.push('main')
    }
    return {
      ...track,
      cueDestinations: uniqueSorted(cueDestinations),
      announcementDestinations: uniqueSorted(announcementDestinations),
    }
  })

  const performerOutputs: PlannedPerformerOutput[] = [...performers.values()]
    .sort((a, b) => compareStrings(a.input.id, b.input.id))
    .map((performer) => {
      const readiness: ShadowReadiness = performer.unconfigured
        ? {
            state: 'unconfigured' as const,
            evidence: 'none' as const,
            reasonCodes: uniqueSorted(performer.reasons),
            runtimeActivationVerified: false as const,
            physicallyConfirmed: false as const,
          }
        : configuredReadiness(performer.reasons)
      return {
        performerId: performer.input.id,
        performerName: performer.input.name,
        logicalOutputId: `performer:${performer.input.id}`,
        monitorBus: performer.monitorBus,
        physicalOutputId: performer.physicalOutputId,
        required: performer.input.required !== false,
        sourceIds: uniqueSorted(performer.sourceIds),
        sourceSends: [...performer.sourceSends].sort((left, right) =>
          compareStrings(
            `${left.sourceId}|${left.mixerChannelId}`,
            `${right.sourceId}|${right.mixerChannelId}`,
          ),
        ),
        click: performer.click,
        cueTrackIds: uniqueSorted(performer.cueTrackIds),
        announcementTrackIds: uniqueSorted(performer.announcementTrackIds),
        sourceLaneIds: uniqueSorted(performer.sourceLaneIds),
        readiness,
      }
    })

  const mainReadiness = configuredReadiness(mainReasons)
  const mainCueTrackIds =
    practiceMainActive && selectedPracticeTrack?.cueContent === 'enabled'
      ? [selectedPracticeTrack.id]
      : []
  const mainAnnouncementTrackIds =
    practiceMainActive &&
    selectedPracticeTrack?.announcementContent === 'enabled'
      ? [selectedPracticeTrack.id]
      : []
  const clickDestinations = performerOutputs
    .filter((performer) => performer.click)
    .map((performer) => performer.logicalOutputId)
  if (practiceMainActive) clickDestinations.push('main')

  const invalidRequiredPerformers = performerOutputs.filter(
    (performer) =>
      performer.required && performer.readiness.state !== 'initializing',
  )
  const configurationDisposition =
    mainReadiness.state !== 'initializing'
      ? 'blocked'
      : performerOutputs.length === 0
        ? 'main-only'
        : invalidRequiredPerformers.length > 0
          ? 'degraded'
          : 'routable'

  return {
    schemaVersion: LIVE_AUDIO_SHADOW_SCHEMA_VERSION,
    generationId: input.generationId,
    projectId: input.project.id,
    songId: input.song.id,
    rigProfileId: input.rigProfile.id,
    rigProfileVersion: profileVersion,
    admittedSources: admittedSources.sort((a, b) => compareStrings(a.id, b.id)),
    excludedSources: excludedSources.sort((a, b) => compareStrings(a.id, b.id)),
    validatedSourceLanes: [...lanes.values()].sort((a, b) =>
      compareStrings(a.id, b.id),
    ),
    main: {
      logicalOutputId: 'main',
      physicalOutputId: mainPhysicalOutputId,
      sourceIds: mainReasons.length === 0 ? mainSourceIds : [],
      sourceLaneIds: mainReasons.length === 0 ? mainSourceLaneIds : [],
      click: practiceMainActive,
      cueTrackIds: mainReasons.length === 0 ? mainCueTrackIds : [],
      announcementTrackIds:
        mainReasons.length === 0 ? mainAnnouncementTrackIds : [],
      readiness: mainReadiness,
    },
    performers: performerOutputs,
    click: {
      laneId: clickLane?.id ?? null,
      destinations: uniqueSorted(clickDestinations),
      mainEnabledByPractice: practiceMainActive,
    },
    cueTracks: plannedCueTracks,
    issues: issues.sort((a, b) =>
      compareStrings(issueSortKey(a), issueSortKey(b)),
    ),
    configurationDisposition,
    xr18ControlConnected: input.device.xr18ControlConnected,
    xr18AudioRouteVerified: false,
  }
}
