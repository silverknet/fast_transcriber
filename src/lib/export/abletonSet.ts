/**
 * Experimental: generate an Ableton Live 12 set (.als) from a SongMap.
 * .als = gzip-compressed XML. Structure reverse-engineered from Live 12.0_12117.
 *
 * Generates a set with correct BPM, time signature, section locators,
 * and one empty AudioTrack per call.
 */

import type { SongMap } from '$lib/songmap/types'
// 505-style Drum Rack extracted from a real Ableton-saved project. Verbatim XML;
// Live's factory samples (paths inside) are referenced by Type=5 (factory library)
// so they resolve on every Ableton 12 install. Internal IDs 3808-7206 (above our gen range).
import clickDrumRackXml from './clickDrumRack.xml?raw'

const CLICK_DRUM_RACK_MAX_ID = 7206

// ---------------------------------------------------------------------------
// ID counter helpers
// ---------------------------------------------------------------------------

function makeCounter(start = 1) {
  let n = start
  return () => n++
}

// ---------------------------------------------------------------------------
// Shared XML fragments matching Live 12 format exactly
// ---------------------------------------------------------------------------

function xmlOn(nextId: () => number): string {
  return `<On>
					<LomId Value="0" />
					<Manual Value="true" />
					<AutomationTarget Id="${nextId()}">
						<LockEnvelope Value="0" />
					</AutomationTarget>
					<MidiCCOnOffThresholds>
						<Min Value="64" />
						<Max Value="127" />
					</MidiCCOnOffThresholds>
				</On>`
}

function xmlMpeSettings(): string {
  return `<MpeSettings>
						<ZoneType Value="0" />
						<FirstNoteChannel Value="1" />
						<LastNoteChannel Value="15" />
					</MpeSettings>`
}

function xmlAutomationTarget(nextId: () => number): string {
  return `<AutomationTarget Id="${nextId()}">
						<LockEnvelope Value="0" />
					</AutomationTarget>`
}

function xmlModulationTarget(nextId: () => number): string {
  return `<ModulationTarget Id="${nextId()}">
						<LockEnvelope Value="0" />
					</ModulationTarget>`
}

function xmlDeviceBoilerplate(nextId: () => number): string {
  return `<ModulationSourceCount Value="0" />
					<ParametersListWrapper LomId="0" />
					<Pointee Id="${nextId()}" />
					<LastSelectedTimeableIndex Value="0" />
					<LastSelectedClipEnvelopeIndex Value="0" />
					<LastPresetRef>
						<Value />
					</LastPresetRef>
					<LockedScripts />
					<IsFolded Value="false" />
					<ShouldShowPresetName Value="false" />
					<UserName Value="" />
					<Annotation Value="" />
					<SourceContext>
						<Value />
					</SourceContext>`
}

/** Empty session clip slots (matching default template). */
function xmlClipSlotList(count: number, sessionClipXml = ''): string {
  return Array.from({ length: count }, (_, i) => {
    // First slot gets the session-view clip (if provided); rest are empty.
    const value = i === 0 && sessionClipXml ? `<Value>${sessionClipXml}</Value>` : '<Value />'
    return `<ClipSlot Id="${i}">
							<LomId Value="0" />
							<ClipSlot>
								${value}
							</ClipSlot>
							<HasStop Value="true" />
							<NeedRefreeze Value="true" />
						</ClipSlot>`
  }).join('\n\t\t\t\t\t\t')
}

/**
 * Session clip slots populated from a per-scene array.
 * Array length = scene count; each entry is the audio-clip XML or null
 * for an empty slot. Used by the project-set (setlist) export where each
 * scene = one song and each track has at most one clip per scene.
 */
function xmlClipSlotListMulti(slotClipXml: Array<string | null>): string {
  return slotClipXml
    .map((clipXml, i) => {
      const value = clipXml ? `<Value>${clipXml}</Value>` : '<Value />'
      return `<ClipSlot Id="${i}">
							<LomId Value="0" />
							<ClipSlot>
								${value}
							</ClipSlot>
							<HasStop Value="true" />
							<NeedRefreeze Value="true" />
						</ClipSlot>`
    })
    .join('\n\t\t\t\t\t\t')
}

/**
 * Multi-scene variant of `xmlSequencerBody` — emits one ClipSlot per scene
 * (each potentially holding a different session-view clip) and NO
 * arrangement-view clip. Used by the project setlist export where each
 * scene = one song.
 */
function xmlSequencerBodyMulti(
  nextId: () => number,
  monitoringEnum: number,
  sessionClipsXml: Array<string | null>,
): string {
  return `${xmlDeviceBoilerplate(nextId)}
						<ClipSlotList>
							${xmlClipSlotListMulti(sessionClipsXml)}
						</ClipSlotList>
						<MonitoringEnum Value="${monitoringEnum}" />
						<KeepRecordMonitoringLatency Value="true" />
						<Sample>
							<ArrangerAutomation>
								<Events />
								<AutomationTransformViewState>
									<IsTransformPending Value="false" />
									<TimeAndValueTransforms />
								</AutomationTransformViewState>
							</ArrangerAutomation>
						</Sample>
						<VolumeModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</VolumeModulationTarget>
						<TranspositionModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</TranspositionModulationTarget>
						<TransientEnvelopeModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</TransientEnvelopeModulationTarget>
						<GrainSizeModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</GrainSizeModulationTarget>
						<FluxModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</FluxModulationTarget>
						<SampleOffsetModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</SampleOffsetModulationTarget>
						<ComplexProFormantsModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</ComplexProFormantsModulationTarget>
						<ComplexProEnvelopeModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</ComplexProEnvelopeModulationTarget>
						<PitchViewScrollPosition Value="-1073741824" />
						<SampleOffsetModulationScrollPosition Value="-1073741824" />
						<Recorder>
							<IsArmed Value="false" />
							<TakeCounter Value="1" />
						</Recorder>`
}

function xmlSequencerBody(nextId: () => number, monitoringEnum: number, clipXml = '', sceneCount = 1, sessionClipXml = ''): string {
  return `${xmlDeviceBoilerplate(nextId)}
					<ClipSlotList>
						${xmlClipSlotList(sceneCount, sessionClipXml)}
					</ClipSlotList>
					<MonitoringEnum Value="${monitoringEnum}" />
					<KeepRecordMonitoringLatency Value="true" />
					<Sample>
						<ArrangerAutomation>
							${clipXml ? `<Events>${clipXml}</Events>` : '<Events />'}
							<AutomationTransformViewState>
								<IsTransformPending Value="false" />
								<TimeAndValueTransforms />
							</AutomationTransformViewState>
						</ArrangerAutomation>
					</Sample>
					<VolumeModulationTarget Id="${nextId()}">
						<LockEnvelope Value="0" />
					</VolumeModulationTarget>
					<TranspositionModulationTarget Id="${nextId()}">
						<LockEnvelope Value="0" />
					</TranspositionModulationTarget>
					<TransientEnvelopeModulationTarget Id="${nextId()}">
						<LockEnvelope Value="0" />
					</TransientEnvelopeModulationTarget>
					<GrainSizeModulationTarget Id="${nextId()}">
						<LockEnvelope Value="0" />
					</GrainSizeModulationTarget>
					<FluxModulationTarget Id="${nextId()}">
						<LockEnvelope Value="0" />
					</FluxModulationTarget>
					<SampleOffsetModulationTarget Id="${nextId()}">
						<LockEnvelope Value="0" />
					</SampleOffsetModulationTarget>
					<ComplexProFormantsModulationTarget Id="${nextId()}">
						<LockEnvelope Value="0" />
					</ComplexProFormantsModulationTarget>
					<ComplexProEnvelopeModulationTarget Id="${nextId()}">
						<LockEnvelope Value="0" />
					</ComplexProEnvelopeModulationTarget>
					<PitchViewScrollPosition Value="-1073741824" />
					<SampleOffsetModulationScrollPosition Value="-1073741824" />
					<Recorder>
						<IsArmed Value="false" />
						<TakeCounter Value="1" />
					</Recorder>`
}

// ---------------------------------------------------------------------------
// Stem track definitions — shared with the Set editor UI
// ---------------------------------------------------------------------------

export const STEM_TRACKS = [
  { name: 'Drums',  color: 13 },
  { name: 'Bass',   color: 25 },
  { name: 'Guitar', color: 14 },
  { name: 'Vocals', color: 9  },
  { name: 'FX',     color: 11 },
] as const

export type StemName = (typeof STEM_TRACKS)[number]['name']

export type StemClip = {
  fileName: string
  /** Relative path from the project folder (e.g. "drums.wav" or "stems/drums.wav"). */
  relativePath: string
  durationSec: number
  sampleRate: number
  /**
   * Absolute filesystem path. Ableton falls back to this when the relative
   * path doesn't resolve (e.g. project hasn't been marked as an Ableton
   * Project folder). Without it, Ableton shows "media not found."
   */
  absolutePath?: string
  /** Used by Ableton to verify the file hasn't been replaced. 0 when unknown. */
  fileSize?: number
  /**
   * Play region within the file, in seconds. Used to virtually trim a clip
   * in Session View: stems can start past `audio.trim.startSec`, click
   * WAVs can skip the prelude+count-in head. Default `[0, durationSec]`.
   */
  playStartSec?: number
  playEndSec?: number
  /**
   * Per-clip linear gain ("SampleVolume" in Live), default `1.0`. Driven by
   * the BarBro mixer's per-song volume so the user's headphone mix shows up
   * 1:1 in the exported scene. Range mirrors Live: 0..~2 (anything > ~1.995
   * is over-the-top loud but valid).
   */
  volume?: number
  /**
   * When true, the clip plays silently — implemented as `SampleVolume=0`
   * (Live has no native per-clip enable/disable for Session-View clips
   * that we want to rely on across versions; muting the sample is robust).
   */
  muted?: boolean
}

/**
 * One song's contribution to the project setlist export — all the
 * resolved file paths and durations needed to build that song's scene.
 * `relativePath` values are PROJECT-relative (e.g.
 * `"songs/opener-7f3a9c2d/stems/best/drums.wav"`) so they resolve from
 * the .als sitting at the project root.
 */
export type ProjectSongExportInput = {
  title: string
  bpm: number
  /** "Drums" → StemClip; only entries in `STEM_TRACKS` are honored. */
  stems: Map<string, StemClip>
  /** Rendered, song-aligned click WAV (always present per V1 preflight). */
  click: StemClip
}

/** Track row identifier used to label the Click row. */
const CLICK_TRACK_NAME = 'Click'
const CLICK_TRACK_COLOR = 26 // grey-ish

// ---------------------------------------------------------------------------
// MIDI click track
// ---------------------------------------------------------------------------

/** 128 MIDI CC controller automation targets required by Live 12 MidiTrack. */
function xmlMidiControllers(nextId: () => number): string {
  return Array.from({ length: 128 }, (_, i) =>
    `<ControllerTargets.${i} Id="${nextId()}">
							<LockEnvelope Value="0" />
						</ControllerTargets.${i}>`
  ).join('\n\t\t\t\t\t\t')
}

/**
 * One MIDI clip spanning the full arrangement with a note per beat:
 * - MIDI note 36 (C1) = downbeat (GM kick — present in any drum rack)
 * - MIDI note 42 (F#1) = offbeat (GM closed hi-hat — present in any drum rack)
 * Velocity also differentiates: 127 (downbeat) vs 64 (offbeat).
 * Drag any Drum Rack from Live's browser onto this track for sound.
 */
/**
 * Arrangement-view MidiClip — full schema verified against a real Ableton 12-saved .als
 * (one MIDI note in arrangement view, then saved). Uses NEW format with `<KeyTracks>` wrapper,
 * `<NoteIdGenerator>`, and all clip-level fields parallel to AudioClip (TimeSignature etc.).
 */
function xmlMidiClickClip(
  beats: { timeSec: number; indexInBar: number }[],
  bpm: number,
  trimStart: number,
): string {
  const noteDur = 0.125
  const downbeatNotes: string[] = []
  const offbeatNotes: string[] = []
  let noteId = 1

  for (const beat of beats) {
    const pos = secToBeat(beat.timeSec, bpm, trimStart)
    if (pos < 0) continue
    const vel = beat.indexInBar === 0 ? 127 : 64
    const line = `<MidiNoteEvent Time="${pos.toFixed(6)}" Duration="${noteDur}" Velocity="${vel}" OffVelocity="64" NoteId="${noteId++}" />`
    if (beat.indexInBar === 0) downbeatNotes.push(line)
    else offbeatNotes.push(line)
  }

  const lastBeat = beats.at(-1)
  const durationBeats = lastBeat ? secToBeat(lastBeat.timeSec, bpm, trimStart) + 1 : 8
  const d = durationBeats.toFixed(6)
  const nextNoteId = noteId

  return `<MidiClip Id="0" Time="0">
						<LomId Value="0" />
						<LomIdView Value="0" />
						<CurrentStart Value="0" />
						<CurrentEnd Value="${d}" />
						<Loop>
							<LoopStart Value="0" />
							<LoopEnd Value="${d}" />
							<StartRelative Value="0" />
							<LoopOn Value="false" />
							<OutMarker Value="${d}" />
							<HiddenLoopStart Value="0" />
							<HiddenLoopEnd Value="${d}" />
						</Loop>
						<Name Value="Click" />
						<Annotation Value="" />
						<Color Value="6" />
						<LaunchMode Value="0" />
						<LaunchQuantisation Value="0" />
						<TimeSignature>
							<TimeSignatures>
								<RemoteableTimeSignature Id="0">
									<Numerator Value="4" />
									<Denominator Value="4" />
									<Time Value="0" />
								</RemoteableTimeSignature>
							</TimeSignatures>
						</TimeSignature>
						<Envelopes>
							<Envelopes />
						</Envelopes>
						<ScrollerTimePreserver>
							<LeftTime Value="0" />
							<RightTime Value="${d}" />
						</ScrollerTimePreserver>
						<TimeSelection>
							<AnchorTime Value="0" />
							<OtherTime Value="0" />
						</TimeSelection>
						<Legato Value="false" />
						<Ram Value="false" />
						<GrooveSettings>
							<GrooveId Value="-1" />
						</GrooveSettings>
						<Disabled Value="false" />
						<VelocityAmount Value="0" />
						<FollowAction>
							<FollowTime Value="4" />
							<IsLinked Value="true" />
							<LoopIterations Value="1" />
							<FollowActionA Value="4" />
							<FollowActionB Value="0" />
							<FollowChanceA Value="100" />
							<FollowChanceB Value="0" />
							<JumpIndexA Value="1" />
							<JumpIndexB Value="1" />
							<FollowActionEnabled Value="false" />
						</FollowAction>
						<Grid>
							<FixedNumerator Value="1" />
							<FixedDenominator Value="16" />
							<GridIntervalPixel Value="20" />
							<Ntoles Value="2" />
							<SnapToGrid Value="true" />
							<Fixed Value="true" />
						</Grid>
						<FreezeStart Value="0" />
						<FreezeEnd Value="0" />
						<IsWarped Value="true" />
						<TakeId Value="1" />
						<IsInKey Value="true" />
						<ScaleInformation>
							<Root Value="0" />
							<Name Value="0" />
						</ScaleInformation>
						<Notes>
							<KeyTracks>
								<KeyTrack Id="0">
									<Notes>
										${downbeatNotes.join('\n\t\t\t\t\t\t\t\t\t\t')}
									</Notes>
									<MidiKey Value="36" />
								</KeyTrack>
								<KeyTrack Id="1">
									<Notes>
										${offbeatNotes.join('\n\t\t\t\t\t\t\t\t\t\t')}
									</Notes>
									<MidiKey Value="42" />
								</KeyTrack>
							</KeyTracks>
							<PerNoteEventStore>
								<EventLists />
							</PerNoteEventStore>
							<NoteProbabilityGroups />
							<ProbabilityGroupIdGenerator>
								<NextId Value="1" />
							</ProbabilityGroupIdGenerator>
							<NoteIdGenerator>
								<NextId Value="${nextNoteId}" />
							</NoteIdGenerator>
						</Notes>
						<BankSelectCoarse Value="-1" />
						<BankSelectFine Value="-1" />
						<ProgramChange Value="-1" />
						<NoteEditorFoldInZoom Value="-1" />
						<NoteEditorFoldInScroll Value="0" />
						<NoteEditorFoldOutZoom Value="-1" />
						<NoteEditorFoldOutScroll Value="0" />
						<NoteEditorFoldScaleZoom Value="-1" />
						<NoteEditorFoldScaleScroll Value="0" />
						<NoteSpellingPreference Value="0" />
						<AccidentalSpellingPreference Value="3" />
						<PreferFlatRootNote Value="false" />
						<ExpressionGrid>
							<FixedNumerator Value="1" />
							<FixedDenominator Value="16" />
							<GridIntervalPixel Value="20" />
							<Ntoles Value="2" />
							<SnapToGrid Value="false" />
							<Fixed Value="false" />
						</ExpressionGrid>
					</MidiClip>`
}

function xmlMidiClickTrack(
  id: number,
  beats: { timeSec: number; indexInBar: number }[],
  bpm: number,
  trimStart: number,
  nextId: () => number,
): string {
  const clipXml = beats.length > 0 ? xmlMidiClickClip(beats, bpm, trimStart) : ''
  return `<MidiTrack Id="${id}" SelectedToolPanel="7" SelectedTransformationName="" SelectedGeneratorName="">
			<LomId Value="0" />
			<LomIdView Value="0" />
			<IsContentSelectedInDocument Value="false" />
			<PreferredContentViewMode Value="0" />
			<TrackDelay>
				<Value Value="0" />
				<IsValueSampleBased Value="false" />
			</TrackDelay>
			<Name>
				<EffectiveName Value="Click" />
				<UserName Value="Click" />
				<Annotation Value="" />
				<MemorizedFirstClipName Value="" />
			</Name>
			<Color Value="6" />
			<AutomationEnvelopes>
				<Envelopes />
			</AutomationEnvelopes>
			<TrackGroupId Value="-1" />
			<TrackUnfolded Value="false" />
			<DevicesListWrapper LomId="0" />
			<ClipSlotsListWrapper LomId="0" />
			<ViewData Value="{}" />
			<TakeLanes>
				<TakeLanes />
				<AreTakeLanesFolded Value="true" />
			</TakeLanes>
			<LinkedTrackGroupId Value="-1" />
			<SavedPlayingSlot Value="-1" />
			<SavedPlayingOffset Value="0" />
			<Freeze Value="false" />
			<NeedArrangerRefreeze Value="true" />
			<PostProcessFreezeClips Value="0" />
			<DeviceChain>
				<AutomationLanes>
					<AutomationLanes>
						<AutomationLane Id="0">
							<SelectedDevice Value="0" />
							<SelectedEnvelope Value="0" />
							<IsContentSelectedInDocument Value="false" />
							<LaneHeight Value="68" />
						</AutomationLane>
					</AutomationLanes>
					<AreAdditionalAutomationLanesFolded Value="false" />
				</AutomationLanes>
				<ClipEnvelopeChooserViewState>
					<SelectedDevice Value="1" />
					<SelectedEnvelope Value="0" />
					<PreferModulationVisible Value="false" />
				</ClipEnvelopeChooserViewState>
				<AudioInputRouting>
					<Target Value="AudioIn/External/S0" />
					<UpperDisplayString Value="Ext. In" />
					<LowerDisplayString Value="1/2" />
					${xmlMpeSettings()}
				</AudioInputRouting>
				<MidiInputRouting>
					<Target Value="MidiIn/External.All/-1" />
					<UpperDisplayString Value="Ext: All Ins" />
					<LowerDisplayString Value="" />
					${xmlMpeSettings()}
				</MidiInputRouting>
				<AudioOutputRouting>
					<Target Value="AudioOut/Main" />
					<UpperDisplayString Value="Master" />
					<LowerDisplayString Value="" />
					${xmlMpeSettings()}
				</AudioOutputRouting>
				<MidiOutputRouting>
					<Target Value="MidiOut/None" />
					<UpperDisplayString Value="None" />
					<LowerDisplayString Value="" />
					${xmlMpeSettings()}
				</MidiOutputRouting>
				<Mixer>
					<LomId Value="0" />
					<LomIdView Value="0" />
					<IsExpanded Value="true" />
					<BreakoutIsExpanded Value="false" />
					${xmlOn(nextId)}
					${xmlDeviceBoilerplate(nextId)}
					<Sends />
					<Speaker>
						<LomId Value="0" />
						<Manual Value="true" />
						${xmlAutomationTarget(nextId)}
						<MidiCCOnOffThresholds>
							<Min Value="64" />
							<Max Value="127" />
						</MidiCCOnOffThresholds>
					</Speaker>
					<SoloSink Value="false" />
					<PanMode Value="0" />
					<Pan>
						<LomId Value="0" />
						<Manual Value="0" />
						<MidiControllerRange>
							<Min Value="-1" />
							<Max Value="1" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</Pan>
					<SplitStereoPanL>
						<LomId Value="0" />
						<Manual Value="-1" />
						<MidiControllerRange>
							<Min Value="-1" />
							<Max Value="1" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</SplitStereoPanL>
					<SplitStereoPanR>
						<LomId Value="0" />
						<Manual Value="1" />
						<MidiControllerRange>
							<Min Value="-1" />
							<Max Value="1" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</SplitStereoPanR>
					<Volume>
						<LomId Value="0" />
						<Manual Value="1" />
						<MidiControllerRange>
							<Min Value="0.0003162277571" />
							<Max Value="1.99526238" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</Volume>
					<ViewStateSessionTrackWidth Value="93" />
					<CrossFadeState>
						<LomId Value="0" />
						<Manual Value="1" />
						${xmlAutomationTarget(nextId)}
					</CrossFadeState>
					<SendsListWrapper LomId="0" />
				</Mixer>
				<MainSequencer>
					<LomId Value="0" />
					<LomIdView Value="0" />
					<IsExpanded Value="true" />
					<BreakoutIsExpanded Value="false" />
					${xmlOn(nextId)}
					${xmlDeviceBoilerplate(nextId)}
					<ClipSlotList>
						${xmlClipSlotList(1)}
					</ClipSlotList>
					<MonitoringEnum Value="1" />
					<KeepRecordMonitoringLatency Value="true" />
					<ClipTimeable>
						<ArrangerAutomation>
							${clipXml ? `<Events>${clipXml}</Events>` : '<Events />'}
							<AutomationTransformViewState>
								<IsTransformPending Value="false" />
								<TimeAndValueTransforms />
							</AutomationTransformViewState>
						</ArrangerAutomation>
					</ClipTimeable>
					<Recorder>
						<IsArmed Value="false" />
						<TakeCounter Value="0" />
					</Recorder>
					<MidiControllers>
						${xmlMidiControllers(nextId)}
					</MidiControllers>
				</MainSequencer>
				<FreezeSequencer>
					<LomId Value="0" />
					<LomIdView Value="0" />
					<IsExpanded Value="true" />
					<BreakoutIsExpanded Value="false" />
					${xmlOn(nextId)}
					${xmlSequencerBody(nextId, 1)}
				</FreezeSequencer>
				<DeviceChain>
					<Devices>
						${clickDrumRackXml}
					</Devices>
					<SignalModulations />
				</DeviceChain>
			</DeviceChain>
			<ReWireDeviceMidiTargetId Value="0" />
			<PitchbendRange Value="96" />
			<IsTuned Value="true" />
			<ControllerLayoutRemoteable Value="0" />
			<ControllerLayoutCustomization>
				<PitchClassSource Value="0" />
				<OctaveSource Value="2" />
				<KeyNoteTarget Value="60" />
				<StepSize Value="1" />
				<OctaveEvery Value="12" />
				<AllowedKeys Value="0" />
				<FillerKeysMapTo Value="0" />
			</ControllerLayoutCustomization>
		</MidiTrack>`
}

// ---------------------------------------------------------------------------
// AudioClip XML (arrangement view clip referencing an audio file)
// ---------------------------------------------------------------------------

/**
 * Arrangement-view AudioClip — full structure matching Ableton-saved .als output.
 * Required fields (verified by saving a manually-imported clip and diffing):
 * - TimeSignature, ScrollerTimePreserver, TimeSelection
 * - Legato, Ram, GrooveSettings, Disabled, VelocityAmount, FollowAction, Grid
 * - FreezeStart/End, IsInKey, ScaleInformation
 * - Granular synth params, Sync/HiQ/Fade, Fades block, PitchCoarse/Fine, SampleVolume
 * - IsSongTempoLeader (after WarpMarkers)
 */
function xmlAudioClip(clip: StemClip, bpm: number): string {
  const durationBeats = (clip.durationSec / 60) * bpm
  const durationSamples = Math.round(clip.durationSec * clip.sampleRate)
  // Full-file duration in beats — used by the WarpMarker anchored at the end
  // of the audio file (independent of the play region).
  const d = durationBeats.toFixed(6)
  // Per-clip play range. Defaults to the full file. For session-view clips,
  // Ableton uses LoopStart/LoopEnd/OutMarker/HiddenLoop* as the load-bearing
  // playback region (even with LoopOn=false); we set all six fields to the
  // same range so arrangement-view positions agree too.
  const playStartSec = Math.max(0, clip.playStartSec ?? 0)
  const playEndSec = Math.max(playStartSec, clip.playEndSec ?? clip.durationSec)
  const playStartBeats = (playStartSec / 60) * bpm
  const playEndBeats = (playEndSec / 60) * bpm
  const ps = playStartBeats.toFixed(6)
  const pe = playEndBeats.toFixed(6)
  return `<AudioClip Id="0" Time="0">
						<LomId Value="0" />
						<LomIdView Value="0" />
						<CurrentStart Value="${ps}" />
						<CurrentEnd Value="${pe}" />
						<Loop>
							<LoopStart Value="${ps}" />
							<LoopEnd Value="${pe}" />
							<StartRelative Value="0" />
							<LoopOn Value="false" />
							<OutMarker Value="${pe}" />
							<HiddenLoopStart Value="${ps}" />
							<HiddenLoopEnd Value="${pe}" />
						</Loop>
						<Name Value="${clip.fileName}" />
						<Annotation Value="" />
						<Color Value="-1" />
						<LaunchMode Value="0" />
						<LaunchQuantisation Value="0" />
						<TimeSignature>
							<TimeSignatures>
								<RemoteableTimeSignature Id="0">
									<Numerator Value="4" />
									<Denominator Value="4" />
									<Time Value="0" />
								</RemoteableTimeSignature>
							</TimeSignatures>
						</TimeSignature>
						<Envelopes>
							<Envelopes />
						</Envelopes>
						<ScrollerTimePreserver>
							<LeftTime Value="0" />
							<RightTime Value="0" />
						</ScrollerTimePreserver>
						<TimeSelection>
							<AnchorTime Value="0" />
							<OtherTime Value="0" />
						</TimeSelection>
						<Legato Value="false" />
						<Ram Value="false" />
						<GrooveSettings>
							<GrooveId Value="-1" />
						</GrooveSettings>
						<Disabled Value="false" />
						<VelocityAmount Value="0" />
						<FollowAction>
							<FollowTime Value="4" />
							<IsLinked Value="true" />
							<LoopIterations Value="1" />
							<FollowActionA Value="4" />
							<FollowActionB Value="0" />
							<FollowChanceA Value="100" />
							<FollowChanceB Value="0" />
							<JumpIndexA Value="1" />
							<JumpIndexB Value="1" />
							<FollowActionEnabled Value="false" />
						</FollowAction>
						<Grid>
							<FixedNumerator Value="1" />
							<FixedDenominator Value="16" />
							<GridIntervalPixel Value="20" />
							<Ntoles Value="2" />
							<SnapToGrid Value="true" />
							<Fixed Value="false" />
						</Grid>
						<FreezeStart Value="0" />
						<FreezeEnd Value="0" />
						<IsWarped Value="false" />
						<TakeId Value="-1" />
						<IsInKey Value="true" />
						<ScaleInformation>
							<Root Value="0" />
							<Name Value="0" />
						</ScaleInformation>
						<SampleRef>
							<FileRef>
								<RelativePathType Value="3" />
								<RelativePath Value="${escapeXmlAttr(clip.relativePath)}" />
								<Path Value="${escapeXmlAttr(clip.absolutePath ?? '')}" />
								<Type Value="2" />
								<LivePackName Value="" />
								<LivePackId Value="" />
								<OriginalFileSize Value="${clip.fileSize ?? 0}" />
								<OriginalCrc Value="0" />
								<SourceHint Value="" />
							</FileRef>
							<LastModDate Value="0" />
							<SourceContext />
							<SampleUsageHint Value="0" />
							<DefaultDuration Value="${durationSamples}" />
							<DefaultSampleRate Value="${clip.sampleRate}" />
							<SamplesToAutoWarp Value="1" />
						</SampleRef>
						<Onsets>
							<UserOnsets />
							<HasUserOnsets Value="false" />
						</Onsets>
						<WarpMode Value="0" />
						<GranularityTones Value="30" />
						<GranularityTexture Value="65" />
						<FluctuationTexture Value="25" />
						<TransientResolution Value="6" />
						<TransientLoopMode Value="2" />
						<TransientEnvelope Value="100" />
						<ComplexProFormants Value="100" />
						<ComplexProEnvelope Value="128" />
						<Sync Value="true" />
						<HiQ Value="true" />
						<Fade Value="false" />
						<Fades>
							<FadeInLength Value="0" />
							<FadeOutLength Value="0" />
							<ClipFadesAreInitialized Value="true" />
							<CrossfadeInState Value="0" />
							<FadeInCurveSkew Value="0" />
							<FadeInCurveSlope Value="0" />
							<FadeOutCurveSkew Value="0" />
							<FadeOutCurveSlope Value="0" />
							<IsDefaultFadeIn Value="false" />
							<IsDefaultFadeOut Value="false" />
						</Fades>
						<PitchCoarse Value="0" />
						<PitchFine Value="0" />
						<SampleVolume Value="${(clip.muted ? 0 : Math.max(0, clip.volume ?? 1)).toFixed(6)}" />
						<WarpMarkers>
							<WarpMarker Id="0" SecTime="0" BeatTime="0" />
							<WarpMarker Id="1" SecTime="${clip.durationSec.toFixed(6)}" BeatTime="${d}" />
						</WarpMarkers>
						<SavedWarpMarkersForStretched />
						<MarkersGenerated Value="true" />
						<IsSongTempoLeader Value="false" />
					</AudioClip>`
}

// ---------------------------------------------------------------------------
// AudioTrack
// ---------------------------------------------------------------------------

function xmlAudioTrack(id: number, name: string, color: number, nextId: () => number, stem?: { clip: StemClip; bpm: number }): string {
  const clipXml = stem ? xmlAudioClip(stem.clip, stem.bpm) : ''
  return `<AudioTrack Id="${id}" SelectedToolPanel="7" SelectedTransformationName="" SelectedGeneratorName="">
			<LomId Value="0" />
			<LomIdView Value="0" />
			<IsContentSelectedInDocument Value="false" />
			<PreferredContentViewMode Value="0" />
			<TrackDelay>
				<Value Value="0" />
				<IsValueSampleBased Value="false" />
			</TrackDelay>
			<Name>
				<EffectiveName Value="${name}" />
				<UserName Value="${name}" />
				<Annotation Value="" />
				<MemorizedFirstClipName Value="" />
			</Name>
			<Color Value="${color}" />
			<AutomationEnvelopes>
				<Envelopes />
			</AutomationEnvelopes>
			<TrackGroupId Value="-1" />
			<TrackUnfolded Value="false" />
			<DevicesListWrapper LomId="0" />
			<ClipSlotsListWrapper LomId="0" />
			<ViewData Value="{}" />
			<TakeLanes>
				<TakeLanes />
				<AreTakeLanesFolded Value="true" />
			</TakeLanes>
			<LinkedTrackGroupId Value="-1" />
			<SavedPlayingSlot Value="-1" />
			<SavedPlayingOffset Value="0" />
			<Freeze Value="false" />
			<NeedArrangerRefreeze Value="true" />
			<PostProcessFreezeClips Value="0" />
			<DeviceChain>
				<AutomationLanes>
					<AutomationLanes>
						<AutomationLane Id="0">
							<SelectedDevice Value="0" />
							<SelectedEnvelope Value="0" />
							<IsContentSelectedInDocument Value="false" />
							<LaneHeight Value="68" />
						</AutomationLane>
					</AutomationLanes>
					<AreAdditionalAutomationLanesFolded Value="false" />
				</AutomationLanes>
				<ClipEnvelopeChooserViewState>
					<SelectedDevice Value="1" />
					<SelectedEnvelope Value="2" />
					<PreferModulationVisible Value="false" />
				</ClipEnvelopeChooserViewState>
				<AudioInputRouting>
					<Target Value="AudioIn/External/M0" />
					<UpperDisplayString Value="Ext. In" />
					<LowerDisplayString Value="1" />
					${xmlMpeSettings()}
				</AudioInputRouting>
				<MidiInputRouting>
					<Target Value="MidiIn/External.All/-1" />
					<UpperDisplayString Value="Ext: All Ins" />
					<LowerDisplayString Value="" />
					${xmlMpeSettings()}
				</MidiInputRouting>
				<AudioOutputRouting>
					<Target Value="AudioOut/Main" />
					<UpperDisplayString Value="Master" />
					<LowerDisplayString Value="" />
					${xmlMpeSettings()}
				</AudioOutputRouting>
				<MidiOutputRouting>
					<Target Value="MidiOut/None" />
					<UpperDisplayString Value="None" />
					<LowerDisplayString Value="" />
					${xmlMpeSettings()}
				</MidiOutputRouting>
				<Mixer>
					<LomId Value="0" />
					<LomIdView Value="0" />
					<IsExpanded Value="true" />
					<BreakoutIsExpanded Value="false" />
					${xmlOn(nextId)}
					${xmlDeviceBoilerplate(nextId)}
					<Sends />
					<Speaker>
						<LomId Value="0" />
						<Manual Value="true" />
						${xmlAutomationTarget(nextId)}
						<MidiCCOnOffThresholds>
							<Min Value="64" />
							<Max Value="127" />
						</MidiCCOnOffThresholds>
					</Speaker>
					<SoloSink Value="false" />
					<PanMode Value="0" />
					<Pan>
						<LomId Value="0" />
						<Manual Value="0" />
						<MidiControllerRange>
							<Min Value="-1" />
							<Max Value="1" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</Pan>
					<SplitStereoPanL>
						<LomId Value="0" />
						<Manual Value="-1" />
						<MidiControllerRange>
							<Min Value="-1" />
							<Max Value="1" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</SplitStereoPanL>
					<SplitStereoPanR>
						<LomId Value="0" />
						<Manual Value="1" />
						<MidiControllerRange>
							<Min Value="-1" />
							<Max Value="1" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</SplitStereoPanR>
					<Volume>
						<LomId Value="0" />
						<Manual Value="1" />
						<MidiControllerRange>
							<Min Value="0.0003162277571" />
							<Max Value="1.99526238" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</Volume>
					<ViewStateSessionTrackWidth Value="93" />
					<CrossFadeState>
						<LomId Value="0" />
						<Manual Value="1" />
						${xmlAutomationTarget(nextId)}
					</CrossFadeState>
					<SendsListWrapper LomId="0" />
				</Mixer>
				<MainSequencer>
					<LomId Value="0" />
					<LomIdView Value="0" />
					<IsExpanded Value="true" />
					<BreakoutIsExpanded Value="false" />
					${xmlOn(nextId)}
					${xmlSequencerBody(nextId, 2, clipXml, 1, clipXml)}
				</MainSequencer>
				<FreezeSequencer>
					<LomId Value="0" />
					<LomIdView Value="0" />
					<IsExpanded Value="true" />
					<BreakoutIsExpanded Value="false" />
					${xmlOn(nextId)}
					${xmlSequencerBody(nextId, 1)}
				</FreezeSequencer>
				<DeviceChain>
					<Devices />
					<SignalModulations />
				</DeviceChain>
			</DeviceChain>
		</AudioTrack>`
}

/**
 * Multi-scene variant of `xmlAudioTrack`. `sessionClips` length equals the
 * scene count; each entry is a clip to place in that scene's slot for this
 * track (or null for an empty slot). Used by the project setlist export.
 */
function xmlAudioTrackMulti(
  id: number,
  name: string,
  color: number,
  nextId: () => number,
  sessionClips: Array<{ clip: StemClip; bpm: number } | null>,
): string {
  const slotXml = sessionClips.map((s) => (s ? xmlAudioClip(s.clip, s.bpm) : null))
  return `<AudioTrack Id="${id}" SelectedToolPanel="7" SelectedTransformationName="" SelectedGeneratorName="">
			<LomId Value="0" />
			<LomIdView Value="0" />
			<IsContentSelectedInDocument Value="false" />
			<PreferredContentViewMode Value="0" />
			<TrackDelay>
				<Value Value="0" />
				<IsValueSampleBased Value="false" />
			</TrackDelay>
			<Name>
				<EffectiveName Value="${name}" />
				<UserName Value="${name}" />
				<Annotation Value="" />
				<MemorizedFirstClipName Value="" />
			</Name>
			<Color Value="${color}" />
			<AutomationEnvelopes>
				<Envelopes />
			</AutomationEnvelopes>
			<TrackGroupId Value="-1" />
			<TrackUnfolded Value="false" />
			<DevicesListWrapper LomId="0" />
			<ClipSlotsListWrapper LomId="0" />
			<ViewData Value="{}" />
			<TakeLanes>
				<TakeLanes />
				<AreTakeLanesFolded Value="true" />
			</TakeLanes>
			<LinkedTrackGroupId Value="-1" />
			<SavedPlayingSlot Value="-1" />
			<SavedPlayingOffset Value="0" />
			<Freeze Value="false" />
			<NeedArrangerRefreeze Value="true" />
			<PostProcessFreezeClips Value="0" />
			<DeviceChain>
				<AutomationLanes>
					<AutomationLanes>
						<AutomationLane Id="0">
							<SelectedDevice Value="0" />
							<SelectedEnvelope Value="0" />
							<IsContentSelectedInDocument Value="false" />
							<LaneHeight Value="68" />
						</AutomationLane>
					</AutomationLanes>
					<AreAdditionalAutomationLanesFolded Value="false" />
				</AutomationLanes>
				<ClipEnvelopeChooserViewState>
					<SelectedDevice Value="1" />
					<SelectedEnvelope Value="2" />
					<PreferModulationVisible Value="false" />
				</ClipEnvelopeChooserViewState>
				<AudioInputRouting>
					<Target Value="AudioIn/External/M0" />
					<UpperDisplayString Value="Ext. In" />
					<LowerDisplayString Value="1" />
					${xmlMpeSettings()}
				</AudioInputRouting>
				<MidiInputRouting>
					<Target Value="MidiIn/External.All/-1" />
					<UpperDisplayString Value="Ext: All Ins" />
					<LowerDisplayString Value="" />
					${xmlMpeSettings()}
				</MidiInputRouting>
				<AudioOutputRouting>
					<Target Value="AudioOut/Main" />
					<UpperDisplayString Value="Master" />
					<LowerDisplayString Value="" />
					${xmlMpeSettings()}
				</AudioOutputRouting>
				<MidiOutputRouting>
					<Target Value="MidiOut/None" />
					<UpperDisplayString Value="None" />
					<LowerDisplayString Value="" />
					${xmlMpeSettings()}
				</MidiOutputRouting>
				<Mixer>
					<LomId Value="0" />
					<LomIdView Value="0" />
					<IsExpanded Value="true" />
					<BreakoutIsExpanded Value="false" />
					${xmlOn(nextId)}
					${xmlDeviceBoilerplate(nextId)}
					<Sends />
					<Speaker>
						<LomId Value="0" />
						<Manual Value="true" />
						${xmlAutomationTarget(nextId)}
						<MidiCCOnOffThresholds>
							<Min Value="64" />
							<Max Value="127" />
						</MidiCCOnOffThresholds>
					</Speaker>
					<SoloSink Value="false" />
					<PanMode Value="0" />
					<Pan>
						<LomId Value="0" />
						<Manual Value="0" />
						<MidiControllerRange>
							<Min Value="-1" />
							<Max Value="1" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</Pan>
					<SplitStereoPanL>
						<LomId Value="0" />
						<Manual Value="-1" />
						<MidiControllerRange>
							<Min Value="-1" />
							<Max Value="1" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</SplitStereoPanL>
					<SplitStereoPanR>
						<LomId Value="0" />
						<Manual Value="1" />
						<MidiControllerRange>
							<Min Value="-1" />
							<Max Value="1" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</SplitStereoPanR>
					<Volume>
						<LomId Value="0" />
						<Manual Value="1" />
						<MidiControllerRange>
							<Min Value="0.0003162277571" />
							<Max Value="1.99526238" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</Volume>
					<ViewStateSessionTrackWidth Value="93" />
					<CrossFadeState>
						<LomId Value="0" />
						<Manual Value="1" />
						${xmlAutomationTarget(nextId)}
					</CrossFadeState>
					<SendsListWrapper LomId="0" />
				</Mixer>
				<MainSequencer>
					<LomId Value="0" />
					<LomIdView Value="0" />
					<IsExpanded Value="true" />
					<BreakoutIsExpanded Value="false" />
					${xmlOn(nextId)}
					${xmlSequencerBodyMulti(nextId, 2, slotXml)}
				</MainSequencer>
				<FreezeSequencer>
					<LomId Value="0" />
					<LomIdView Value="0" />
					<IsExpanded Value="true" />
					<BreakoutIsExpanded Value="false" />
					${xmlOn(nextId)}
					${xmlSequencerBody(nextId, 1, '', slotXml.length)}
				</FreezeSequencer>
				<DeviceChain>
					<Devices />
					<SignalModulations />
				</DeviceChain>
			</DeviceChain>
		</AudioTrack>`
}

// ---------------------------------------------------------------------------
// MainTrack (master) — BPM and time sig live here
// ---------------------------------------------------------------------------

function xmlMainTrack(bpm: number, timeSigId: number, nextId: () => number): string {
  // Pre-allocate IDs for Tempo and TimeSignature so we can reference them
  // in AutomationEnvelopes (same pattern as the default template)
  const tempoAtId = nextId()
  const tempoModId = nextId()
  const timeSigAtId = nextId()

  return `<MainTrack SelectedToolPanel="7" SelectedTransformationName="" SelectedGeneratorName="">
			<LomId Value="0" />
			<LomIdView Value="0" />
			<IsContentSelectedInDocument Value="false" />
			<PreferredContentViewMode Value="0" />
			<TrackDelay>
				<Value Value="0" />
				<IsValueSampleBased Value="false" />
			</TrackDelay>
			<Name>
				<EffectiveName Value="Main" />
				<UserName Value="" />
				<Annotation Value="" />
				<MemorizedFirstClipName Value="" />
			</Name>
			<Color Value="4" />
			<AutomationEnvelopes>
				<Envelopes>
					<AutomationEnvelope Id="0">
						<EnvelopeTarget>
							<PointeeId Value="${timeSigAtId}" />
						</EnvelopeTarget>
						<Automation>
							<Events>
								<EnumEvent Id="0" Time="-63072000" Value="${timeSigId}" />
							</Events>
							<AutomationTransformViewState>
								<IsTransformPending Value="false" />
								<TimeAndValueTransforms />
							</AutomationTransformViewState>
						</Automation>
					</AutomationEnvelope>
					<AutomationEnvelope Id="1">
						<EnvelopeTarget>
							<PointeeId Value="${tempoAtId}" />
						</EnvelopeTarget>
						<Automation>
							<Events>
								<FloatEvent Id="0" Time="-63072000" Value="${bpm}" />
							</Events>
							<AutomationTransformViewState>
								<IsTransformPending Value="false" />
								<TimeAndValueTransforms />
							</AutomationTransformViewState>
						</Automation>
					</AutomationEnvelope>
				</Envelopes>
			</AutomationEnvelopes>
			<TrackGroupId Value="-1" />
			<TrackUnfolded Value="false" />
			<DevicesListWrapper LomId="0" />
			<ClipSlotsListWrapper LomId="0" />
			<ViewData Value="{}" />
			<TakeLanes>
				<TakeLanes />
				<AreTakeLanesFolded Value="true" />
			</TakeLanes>
			<LinkedTrackGroupId Value="-1" />
			<DeviceChain>
				<AutomationLanes>
					<AutomationLanes>
						<AutomationLane Id="0">
							<SelectedDevice Value="1" />
							<SelectedEnvelope Value="4" />
							<IsContentSelectedInDocument Value="false" />
							<LaneHeight Value="85" />
						</AutomationLane>
					</AutomationLanes>
					<AreAdditionalAutomationLanesFolded Value="false" />
				</AutomationLanes>
				<ClipEnvelopeChooserViewState>
					<SelectedDevice Value="0" />
					<SelectedEnvelope Value="0" />
					<PreferModulationVisible Value="false" />
				</ClipEnvelopeChooserViewState>
				<AudioInputRouting>
					<Target Value="AudioIn/External/S0" />
					<UpperDisplayString Value="Ext. In" />
					<LowerDisplayString Value="1/2" />
					${xmlMpeSettings()}
				</AudioInputRouting>
				<MidiInputRouting>
					<Target Value="MidiIn/External.All/-1" />
					<UpperDisplayString Value="Ext: All Ins" />
					<LowerDisplayString Value="" />
					${xmlMpeSettings()}
				</MidiInputRouting>
				<AudioOutputRouting>
					<Target Value="AudioOut/External/S0" />
					<UpperDisplayString Value="Ext. Out" />
					<LowerDisplayString Value="1/2" />
					${xmlMpeSettings()}
				</AudioOutputRouting>
				<MidiOutputRouting>
					<Target Value="MidiOut/None" />
					<UpperDisplayString Value="None" />
					<LowerDisplayString Value="" />
					${xmlMpeSettings()}
				</MidiOutputRouting>
				<Mixer>
					<LomId Value="0" />
					<LomIdView Value="0" />
					<IsExpanded Value="true" />
					<BreakoutIsExpanded Value="false" />
					${xmlOn(nextId)}
					${xmlDeviceBoilerplate(nextId)}
					<Sends />
					<Speaker>
						<LomId Value="0" />
						<Manual Value="true" />
						${xmlAutomationTarget(nextId)}
						<MidiCCOnOffThresholds>
							<Min Value="64" />
							<Max Value="127" />
						</MidiCCOnOffThresholds>
					</Speaker>
					<SoloSink Value="false" />
					<PanMode Value="0" />
					<Pan>
						<LomId Value="0" />
						<Manual Value="0" />
						<MidiControllerRange>
							<Min Value="-1" />
							<Max Value="1" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</Pan>
					<SplitStereoPanL>
						<LomId Value="0" />
						<Manual Value="-1" />
						<MidiControllerRange>
							<Min Value="-1" />
							<Max Value="1" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</SplitStereoPanL>
					<SplitStereoPanR>
						<LomId Value="0" />
						<Manual Value="1" />
						<MidiControllerRange>
							<Min Value="-1" />
							<Max Value="1" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</SplitStereoPanR>
					<Volume>
						<LomId Value="0" />
						<Manual Value="1" />
						<MidiControllerRange>
							<Min Value="0.0003162277571" />
							<Max Value="1.99526238" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</Volume>
					<ViewStateSessionTrackWidth Value="103" />
					<CrossFadeState>
						<LomId Value="0" />
						<Manual Value="1" />
						${xmlAutomationTarget(nextId)}
					</CrossFadeState>
					<SendsListWrapper LomId="0" />
					<Tempo>
						<LomId Value="0" />
						<Manual Value="${bpm}" />
						<MidiControllerRange>
							<Min Value="60" />
							<Max Value="200" />
						</MidiControllerRange>
						<AutomationTarget Id="${tempoAtId}">
							<LockEnvelope Value="0" />
						</AutomationTarget>
						<ModulationTarget Id="${tempoModId}">
							<LockEnvelope Value="0" />
						</ModulationTarget>
					</Tempo>
					<TimeSignature>
						<LomId Value="0" />
						<Manual Value="${timeSigId}" />
						<AutomationTarget Id="${timeSigAtId}">
							<LockEnvelope Value="0" />
						</AutomationTarget>
					</TimeSignature>
					<GlobalGrooveAmount>
						<LomId Value="0" />
						<Manual Value="0" />
						<MidiControllerRange>
							<Min Value="0" />
							<Max Value="131.25" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</GlobalGrooveAmount>
					<CrossFade>
						<LomId Value="0" />
						<Manual Value="0" />
						<MidiControllerRange>
							<Min Value="-1" />
							<Max Value="1" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</CrossFade>
					<TempoAutomationViewBottom Value="60" />
					<TempoAutomationViewTop Value="200" />
				</Mixer>
				<FreezeSequencer>
					<AudioSequencer Id="0">
						<LomId Value="0" />
						<LomIdView Value="0" />
						<IsExpanded Value="true" />
						<BreakoutIsExpanded Value="false" />
						${xmlOn(nextId)}
						${xmlDeviceBoilerplate(nextId)}
						<ClipSlotList />
						<MonitoringEnum Value="1" />
						<KeepRecordMonitoringLatency Value="true" />
						<Sample>
							<ArrangerAutomation>
								<Events />
								<AutomationTransformViewState>
									<IsTransformPending Value="false" />
									<TimeAndValueTransforms />
								</AutomationTransformViewState>
							</ArrangerAutomation>
						</Sample>
						<VolumeModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</VolumeModulationTarget>
						<TranspositionModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</TranspositionModulationTarget>
						<TransientEnvelopeModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</TransientEnvelopeModulationTarget>
						<GrainSizeModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</GrainSizeModulationTarget>
						<FluxModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</FluxModulationTarget>
						<SampleOffsetModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</SampleOffsetModulationTarget>
						<ComplexProFormantsModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</ComplexProFormantsModulationTarget>
						<ComplexProEnvelopeModulationTarget Id="${nextId()}">
							<LockEnvelope Value="0" />
						</ComplexProEnvelopeModulationTarget>
						<PitchViewScrollPosition Value="-1073741824" />
						<SampleOffsetModulationScrollPosition Value="-1073741824" />
						<Recorder>
							<IsArmed Value="false" />
							<TakeCounter Value="1" />
						</Recorder>
					</AudioSequencer>
				</FreezeSequencer>
				<DeviceChain>
					<Devices />
					<SignalModulations />
				</DeviceChain>
			</DeviceChain>
		</MainTrack>`
}

// ---------------------------------------------------------------------------
// PreHearTrack
// ---------------------------------------------------------------------------

function xmlPreHearTrack(nextId: () => number): string {
  return `<PreHearTrack SelectedToolPanel="7" SelectedTransformationName="" SelectedGeneratorName="">
			<LomId Value="0" />
			<LomIdView Value="0" />
			<IsContentSelectedInDocument Value="false" />
			<PreferredContentViewMode Value="0" />
			<TrackDelay>
				<Value Value="0" />
				<IsValueSampleBased Value="false" />
			</TrackDelay>
			<Name>
				<EffectiveName Value="Preview" />
				<UserName Value="" />
				<Annotation Value="" />
				<MemorizedFirstClipName Value="" />
			</Name>
			<Color Value="0" />
			<AutomationEnvelopes>
				<Envelopes />
			</AutomationEnvelopes>
			<TrackGroupId Value="-1" />
			<TrackUnfolded Value="false" />
			<DevicesListWrapper LomId="0" />
			<ClipSlotsListWrapper LomId="0" />
			<ViewData Value="{}" />
			<TakeLanes>
				<TakeLanes />
				<AreTakeLanesFolded Value="true" />
			</TakeLanes>
			<LinkedTrackGroupId Value="-1" />
			<DeviceChain>
				<AutomationLanes>
					<AutomationLanes />
					<AreAdditionalAutomationLanesFolded Value="false" />
				</AutomationLanes>
				<ClipEnvelopeChooserViewState>
					<SelectedDevice Value="0" />
					<SelectedEnvelope Value="0" />
					<PreferModulationVisible Value="false" />
				</ClipEnvelopeChooserViewState>
				<AudioInputRouting>
					<Target Value="AudioIn/External/S0" />
					<UpperDisplayString Value="Ext. In" />
					<LowerDisplayString Value="1/2" />
					${xmlMpeSettings()}
				</AudioInputRouting>
				<MidiInputRouting>
					<Target Value="MidiIn/External.All/-1" />
					<UpperDisplayString Value="Ext: All Ins" />
					<LowerDisplayString Value="" />
					${xmlMpeSettings()}
				</MidiInputRouting>
				<AudioOutputRouting>
					<Target Value="AudioOut/External/S0" />
					<UpperDisplayString Value="Ext. Out" />
					<LowerDisplayString Value="1/2" />
					${xmlMpeSettings()}
				</AudioOutputRouting>
				<MidiOutputRouting>
					<Target Value="MidiOut/None" />
					<UpperDisplayString Value="None" />
					<LowerDisplayString Value="" />
					${xmlMpeSettings()}
				</MidiOutputRouting>
				<Mixer>
					<LomId Value="0" />
					<LomIdView Value="0" />
					<IsExpanded Value="true" />
					<BreakoutIsExpanded Value="false" />
					${xmlOn(nextId)}
					${xmlDeviceBoilerplate(nextId)}
					<Sends />
					<Speaker>
						<LomId Value="0" />
						<Manual Value="true" />
						${xmlAutomationTarget(nextId)}
						<MidiCCOnOffThresholds>
							<Min Value="64" />
							<Max Value="127" />
						</MidiCCOnOffThresholds>
					</Speaker>
					<SoloSink Value="false" />
					<PanMode Value="0" />
					<Pan>
						<LomId Value="0" />
						<Manual Value="0" />
						<MidiControllerRange>
							<Min Value="-1" />
							<Max Value="1" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</Pan>
					<Volume>
						<LomId Value="0" />
						<Manual Value="0.7000000000000001" />
						<MidiControllerRange>
							<Min Value="0.0003162277571" />
							<Max Value="1.99526238" />
						</MidiControllerRange>
						${xmlAutomationTarget(nextId)}
						${xmlModulationTarget(nextId)}
					</Volume>
					<ViewStateSessionTrackWidth Value="93" />
					<SendsListWrapper LomId="0" />
				</Mixer>
				<DeviceChain>
					<Devices />
					<SignalModulations />
				</DeviceChain>
			</DeviceChain>
		</PreHearTrack>`
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

function xmlScene(id: number, bpm: number, timeSigId: number): string {
  return `<Scene Id="${id}">
				<FollowAction>
					<FollowTime Value="4" />
					<IsLinked Value="true" />
					<LoopIterations Value="1" />
					<FollowActionA Value="4" />
					<FollowActionB Value="0" />
					<FollowChanceA Value="100" />
					<FollowChanceB Value="0" />
					<JumpIndexA Value="0" />
					<JumpIndexB Value="0" />
					<FollowActionEnabled Value="false" />
				</FollowAction>
				<Name Value="" />
				<Annotation Value="" />
				<Color Value="-1" />
				<Tempo Value="${bpm}" />
				<IsTempoEnabled Value="false" />
				<TimeSignatureId Value="${timeSigId}" />
				<IsTimeSignatureEnabled Value="false" />
				<LomId Value="0" />
				<ClipSlotsListWrapper LomId="0" />
			</Scene>`
}

/**
 * Named scene with tempo + time-sig enabled — launching the scene changes
 * Ableton's master tempo. Used in the project setlist export so each song
 * plays at its own BPM when the performer fires that scene.
 */
function xmlSceneForSong(id: number, name: string, bpm: number, timeSigId: number): string {
  const safeName = escapeXmlAttr(name)
  return `<Scene Id="${id}">
				<FollowAction>
					<FollowTime Value="4" />
					<IsLinked Value="true" />
					<LoopIterations Value="1" />
					<FollowActionA Value="4" />
					<FollowActionB Value="0" />
					<FollowChanceA Value="100" />
					<FollowChanceB Value="0" />
					<JumpIndexA Value="0" />
					<JumpIndexB Value="0" />
					<FollowActionEnabled Value="false" />
				</FollowAction>
				<Name Value="${safeName}" />
				<Annotation Value="" />
				<Color Value="-1" />
				<Tempo Value="${bpm}" />
				<IsTempoEnabled Value="true" />
				<TimeSignatureId Value="${timeSigId}" />
				<IsTimeSignatureEnabled Value="true" />
				<LomId Value="0" />
				<ClipSlotsListWrapper LomId="0" />
			</Scene>`
}

/** XML attribute-safe escape (handles & < > " '). */
function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ---------------------------------------------------------------------------
// Locator
// ---------------------------------------------------------------------------

function xmlLocator(id: number, beatTime: number, name: string): string {
  return `<Locator Id="${id}">
				<LomId Value="0" />
				<Time Value="${beatTime.toFixed(6)}" />
				<Name Value="${name}" />
				<Annotation Value="" />
				<IsSongStart Value="false" />
			</Locator>`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bpmFromSongMap(sm: SongMap): number {
  if (sm.metadata.bpm && sm.metadata.bpm > 0) return sm.metadata.bpm
  const bar = sm.timeline.bars[0]
  if (!bar || bar.beatCount <= 0) return 120
  const dur = bar.endSec - bar.startSec
  if (dur <= 0) return 120
  return Math.round(((bar.beatCount / dur) * 60) * 100) / 100
}

/**
 * Live 12 packs time signatures as integer IDs (201 = 4/4 per default template).
 * For now we always use 201; extending to other meters requires a lookup table.
 */
function timeSigId(_numerator: number, _denominator: number): number {
  return 201
}

function secToBeat(sec: number, bpm: number, trimStart: number): number {
  return ((sec - trimStart) / 60) * bpm
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export type AbletonSetOptions = {
  title: string
  bpm?: number
  /** Stem clips keyed by stem name (e.g. "Drums"). Only named stems that appear in STEM_TRACKS are used. */
  stems?: Map<string, StemClip>
}

/**
 * Generate raw XML for an Ableton Live 12 set.
 * Caller must gzip-compress before saving as .als.
 */
export function generateAbletonSetXml(sm: SongMap, options: AbletonSetOptions = { title: 'Untitled' }): string {
  const bpm = options.bpm ?? bpmFromSongMap(sm)
  const firstBar = sm.timeline.bars[0]
  const timeSig = timeSigId(firstBar?.meter.numerator ?? 4, firstBar?.meter.denominator ?? 4)
  const trimStart = sm.audio?.trim.startSec ?? 0

  // Start IDs above the embedded Click Drum Rack range (max 7206) to avoid collisions.
  const nextId = makeCounter(CLICK_DRUM_RACK_MAX_ID + 100)

  const audioTracksXml = STEM_TRACKS
    .map((t, i) => {
      const clip = options.stems?.get(t.name)
      return xmlAudioTrack(i, t.name, t.color, nextId, clip ? { clip, bpm } : undefined)
    })
    .join('\n\t\t\t')

  // MIDI click track — notes at every beat position, placed after stem tracks
  const clickTrackXml = xmlMidiClickTrack(
    STEM_TRACKS.length,
    sm.timeline.beats,
    bpm,
    trimStart,
    nextId,
  )

  // Build MainTrack (master) — allocates IDs for Tempo/TimeSignature
  const mainTrackXml = xmlMainTrack(bpm, timeSig, nextId)

  // Build PreHearTrack
  const preHearTrackXml = xmlPreHearTrack(nextId)

  // Build section locators
  const locators: string[] = []
  for (const section of sm.sections) {
    const bar = sm.timeline.bars.find((b) => b.index === section.barRange.startBarIndex)
    if (!bar) continue
    const beatTime = secToBeat(bar.startSec, bpm, trimStart)
    locators.push(xmlLocator(nextId(), beatTime, section.label))
  }

  const nextPointeeId = nextId() + 50

  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12117" SchemaChangeCount="10" Creator="Ableton Live 12.0" Revision="">
	<LiveSet>
		<NextPointeeId Value="${nextPointeeId}" />
		<OverwriteProtectionNumber Value="3072" />
		<LomId Value="0" />
		<LomIdView Value="0" />
		<Tracks>
			${audioTracksXml}
			${clickTrackXml}
		</Tracks>
		${mainTrackXml}
		${preHearTrackXml}
		<SendsPre />
		<Scenes>
			${xmlScene(0, bpm, timeSig)}
		</Scenes>
		<Transport>
			<PhaseNudgeTempo Value="10" />
			<LoopOn Value="false" />
			<LoopStart Value="8" />
			<LoopLength Value="16" />
			<LoopIsSongStart Value="false" />
			<CurrentTime Value="0" />
			<PunchIn Value="false" />
			<PunchOut Value="false" />
			<MetronomeTickDuration Value="0" />
			<DrawMode Value="false" />
		</Transport>
		<SessionScrollPos X="0" Y="0" />
		<SignalModulations />
		<GlobalQuantisation Value="4" />
		<AutoQuantisation Value="0" />
		<Grid>
			<FixedNumerator Value="1" />
			<FixedDenominator Value="16" />
			<GridIntervalPixel Value="20" />
			<Ntoles Value="2" />
			<SnapToGrid Value="true" />
			<Fixed Value="false" />
		</Grid>
		<ScaleInformation>
			<Root Value="0" />
			<Name Value="0" />
		</ScaleInformation>
		<InKey Value="true" />
		<SmpteFormat Value="0" />
		<TimeSelection>
			<AnchorTime Value="0" />
			<OtherTime Value="0" />
		</TimeSelection>
		<Locators>
			<Locators>
				${locators.length > 0 ? locators.join('\n\t\t\t\t') : ''}
			</Locators>
		</Locators>
		<DetailClipKeyMidis />
		<TracksListWrapper LomId="0" />
		<VisibleTracksListWrapper LomId="0" />
		<ReturnTracksListWrapper LomId="0" />
		<ScenesListWrapper LomId="0" />
		<CuePointsListWrapper LomId="0" />
		<SelectedDocumentViewInMainWindow Value="1" />
		<Annotation Value="" />
		<SoloOrPflSavedValue Value="true" />
		<SoloInPlace Value="true" />
		<CrossfadeCurve Value="2" />
		<LatencyCompensation Value="2" />
		<HighlightedTrackIndex Value="0" />
		<GroovePool>
			<Grooves />
		</GroovePool>
	</LiveSet>
</Ableton>`
}

// ---------------------------------------------------------------------------
// Project setlist export — one .als for the whole project (Session View)
// ---------------------------------------------------------------------------

export type AbletonProjectSetOptions = {
  projectTitle: string
  /** One entry per song in setlist order. */
  songs: ProjectSongExportInput[]
}

/**
 * Generate the raw .als XML for a project-level Session View setlist.
 *
 * Layout: rows = 5 stem audio tracks + Click [+ Cue when any song has
 * one]. Columns/scenes = one per song. Each scene carries its own tempo
 * (`IsTempoEnabled=true`), so launching it in Ableton auto-sets master
 * BPM to that song. Per-clip warp is off — clips play at their native
 * tempo, which matches the scene tempo.
 *
 * Audio clip references are PROJECT-relative; the caller is expected to
 * save the .als at the project root so paths resolve.
 *
 * Caller must gzip the result before saving as `.als`.
 */
export function generateAbletonProjectSetXml(options: AbletonProjectSetOptions): string {
  const { projectTitle, songs } = options
  if (songs.length === 0) {
    throw new Error('Project setlist export needs at least one song')
  }
  const sceneCount = songs.length
  const timeSig = timeSigId(4, 4)
  const nextId = makeCounter(CLICK_DRUM_RACK_MAX_ID + 100)

  // First scene's BPM doubles as the default master tempo.
  const masterBpm = songs[0].bpm

  // Audio-track rows: 5 stems + a single click. (Cue tracks are deferred —
  // see `src/lib/export/setlist/` for the live-export architecture.)
  const stemTracksXml = STEM_TRACKS.map((track, i) => {
    const slots: Array<{ clip: StemClip; bpm: number } | null> = songs.map((song) => {
      const clip = song.stems.get(track.name)
      return clip ? { clip, bpm: song.bpm } : null
    })
    return xmlAudioTrackMulti(i, track.name, track.color, nextId, slots)
  }).join('\n\t\t\t')

  const clickSlots: Array<{ clip: StemClip; bpm: number } | null> = songs.map((song) => ({
    clip: song.click,
    bpm: song.bpm,
  }))
  const clickTrackXml = xmlAudioTrackMulti(
    STEM_TRACKS.length,
    CLICK_TRACK_NAME,
    CLICK_TRACK_COLOR,
    nextId,
    clickSlots,
  )

  const mainTrackXml = xmlMainTrack(masterBpm, timeSig, nextId)
  const preHearTrackXml = xmlPreHearTrack(nextId)

  // One scene per song. Scene tempo + time-sig enabled so launching sets
  // master BPM to that song's tempo.
  const scenesXml = songs
    .map((song, i) => xmlSceneForSong(i, song.title, song.bpm, timeSig))
    .join('\n\t\t\t')

  const nextPointeeId = nextId() + 50

  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12117" SchemaChangeCount="10" Creator="Ableton Live 12.0" Revision="">
	<LiveSet>
		<NextPointeeId Value="${nextPointeeId}" />
		<OverwriteProtectionNumber Value="3072" />
		<LomId Value="0" />
		<LomIdView Value="0" />
		<Tracks>
			${stemTracksXml}
			${clickTrackXml}
		</Tracks>
		${mainTrackXml}
		${preHearTrackXml}
		<SendsPre />
		<Scenes>
			${scenesXml}
		</Scenes>
		<Transport>
			<PhaseNudgeTempo Value="10" />
			<LoopOn Value="false" />
			<LoopStart Value="8" />
			<LoopLength Value="16" />
			<LoopIsSongStart Value="false" />
			<CurrentTime Value="0" />
			<PunchIn Value="false" />
			<PunchOut Value="false" />
			<MetronomeTickDuration Value="0" />
			<DrawMode Value="false" />
		</Transport>
		<SessionScrollPos X="0" Y="0" />
		<SignalModulations />
		<GlobalQuantisation Value="4" />
		<AutoQuantisation Value="0" />
		<Grid>
			<FixedNumerator Value="1" />
			<FixedDenominator Value="16" />
			<GridIntervalPixel Value="20" />
			<Ntoles Value="2" />
			<SnapToGrid Value="true" />
			<Fixed Value="false" />
		</Grid>
		<ScaleInformation>
			<Root Value="0" />
			<Name Value="0" />
		</ScaleInformation>
		<InKey Value="true" />
		<SmpteFormat Value="0" />
		<TimeSelection>
			<AnchorTime Value="0" />
			<OtherTime Value="0" />
		</TimeSelection>
		<Locators>
			<Locators />
		</Locators>
		<DetailClipKeyMidis />
		<TracksListWrapper LomId="0" />
		<VisibleTracksListWrapper LomId="0" />
		<ReturnTracksListWrapper LomId="0" />
		<ScenesListWrapper LomId="0" />
		<CuePointsListWrapper LomId="0" />
		<SelectedDocumentViewInMainWindow Value="0" />
		<Annotation Value="${escapeXmlAttr(`BarBro setlist: ${projectTitle}`)}" />
		<SoloOrPflSavedValue Value="true" />
		<SoloInPlace Value="true" />
		<CrossfadeCurve Value="2" />
		<LatencyCompensation Value="2" />
		<HighlightedTrackIndex Value="0" />
		<GroovePool>
			<Grooves />
		</GroovePool>
	</LiveSet>
</Ableton>`
}
