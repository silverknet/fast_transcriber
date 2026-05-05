/**
 * Experimental: generate an Ableton Live 12 set (.als) from a SongMap.
 * .als = gzip-compressed XML. Structure reverse-engineered from Live 12.0_12117.
 *
 * Generates a set with correct BPM, time signature, section locators,
 * and one empty AudioTrack per call.
 */

import type { SongMap } from '$lib/songmap/types'

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

/** 8 empty session clip slots (matching default template). */
function xmlClipSlotList(count: number): string {
  return Array.from({ length: count }, (_, i) => `<ClipSlot Id="${i}">
							<LomId Value="0" />
							<ClipSlot>
								<Value />
							</ClipSlot>
							<HasStop Value="true" />
							<NeedRefreeze Value="true" />
						</ClipSlot>`).join('\n\t\t\t\t\t\t')
}

function xmlSequencerBody(nextId: () => number, monitoringEnum: number, clipXml = '', sceneCount = 1): string {
  return `${xmlDeviceBoilerplate(nextId)}
					<ClipSlotList>
						${xmlClipSlotList(sceneCount)}
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
  /** Absolute path to the audio file on the user's machine. */
  absolutePath: string
  durationSec: number
  sampleRate: number
}

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
 * - MIDI note 36 (C1) = downbeat  velocity 127
 * - MIDI note 37 (C#1) = other beats  velocity 64
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
    const line = `<MidiNoteEvent Time="${pos.toFixed(6)}" Duration="${noteDur}" Velocity="${beat.indexInBar === 0 ? 127 : 64}" OffVelocity="64" Probability="1" IsEnabled="true" NoteId="${noteId++}" />`
    if (beat.indexInBar === 0) downbeatNotes.push(line)
    else offbeatNotes.push(line)
  }

  const lastBeat = beats.at(-1)
  const durationBeats = lastBeat ? secToBeat(lastBeat.timeSec, bpm, trimStart) + 1 : 8

  return `<MidiClip Id="0" Time="0">
						<LomId Value="0" />
						<LomIdView Value="0" />
						<CurrentStart Value="0" />
						<CurrentEnd Value="${durationBeats.toFixed(6)}" />
						<Loop>
							<LoopStart Value="0" />
							<LoopEnd Value="${durationBeats.toFixed(6)}" />
							<StartRelative Value="0" />
							<LoopOn Value="false" />
							<OutMarker Value="${durationBeats.toFixed(6)}" />
							<HiddenLoopStart Value="0" />
							<HiddenLoopEnd Value="${durationBeats.toFixed(6)}" />
						</Loop>
						<Name Value="Click" />
						<Annotation Value="" />
						<Color Value="6" />
						<LaunchMode Value="0" />
						<LaunchQuantisation Value="0" />
						<Envelopes>
							<Envelopes />
						</Envelopes>
						<Notes>
							<KeyTrack Id="0">
								<MidiKey Value="36" />
								<Notes>
									${downbeatNotes.join('\n\t\t\t\t\t\t\t\t\t')}
								</Notes>
								<IsRangeSelected Value="false" />
								<HighlightedTime Value="0" />
								<TimeableColor Value="-1" />
							</KeyTrack>
							<KeyTrack Id="1">
								<MidiKey Value="37" />
								<Notes>
									${offbeatNotes.join('\n\t\t\t\t\t\t\t\t\t')}
								</Notes>
								<IsRangeSelected Value="false" />
								<HighlightedTime Value="0" />
								<TimeableColor Value="-1" />
							</KeyTrack>
						</Notes>
						<NoteIdCounter Value="${noteId}" />
						<IsWarped Value="false" />
						<TakeId Value="0" />
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
				<DeviceChain>
					<Devices />
					<SignalModulations />
				</DeviceChain>
			</DeviceChain>
		</MidiTrack>`
}

// ---------------------------------------------------------------------------
// AudioClip XML (arrangement view clip referencing an audio file)
// ---------------------------------------------------------------------------

function xmlAudioClip(clip: StemClip, bpm: number): string {
  const durationBeats = (clip.durationSec / 60) * bpm
  const durationSamples = Math.round(clip.durationSec * clip.sampleRate)
  return `<AudioClip Id="0" Time="0">
						<LomId Value="0" />
						<LomIdView Value="0" />
						<CurrentStart Value="0" />
						<CurrentEnd Value="${durationBeats.toFixed(6)}" />
						<Loop>
							<LoopStart Value="0" />
							<LoopEnd Value="${durationBeats.toFixed(6)}" />
							<StartRelative Value="0" />
							<LoopOn Value="false" />
							<OutMarker Value="${durationBeats.toFixed(6)}" />
							<HiddenLoopStart Value="0" />
							<HiddenLoopEnd Value="${durationBeats.toFixed(6)}" />
						</Loop>
						<Name Value="${clip.fileName}" />
						<Annotation Value="" />
						<Color Value="-1" />
						<LaunchMode Value="0" />
						<LaunchQuantisation Value="0" />
						<Envelopes>
							<Envelopes />
						</Envelopes>
						<IsWarped Value="true" />
						<TakeId Value="1" />
						<SampleRef>
							<FileRef>
								<RelativePathType Value="0" />
								<RelativePath Value="" />
								<Path Value="${clip.absolutePath}" />
								<Type Value="1" />
								<LivePackName Value="" />
								<LivePackId Value="" />
								<OriginalFileSize Value="0" />
								<OriginalCrc Value="0" />
							</FileRef>
							<LastModDate Value="0" />
							<SourceContext />
							<SampleUsageHint Value="0" />
							<DefaultDuration Value="${durationSamples}" />
							<DefaultSampleRate Value="${clip.sampleRate}" />
						</SampleRef>
						<Onsets>
							<UserOnsets />
							<HasUserOnsets Value="false" />
						</Onsets>
						<WarpMode Value="0" />
						<WarpMarkers>
							<WarpMarker Id="0" SecTime="0" BeatTime="0" />
							<WarpMarker Id="1" SecTime="${clip.durationSec.toFixed(6)}" BeatTime="${durationBeats.toFixed(6)}" />
						</WarpMarkers>
						<SavedWarpMarkersForStretched />
						<MarkersGenerated Value="false" />
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
					${xmlSequencerBody(nextId, 2, clipXml)}
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

  const nextId = makeCounter(1)

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
		<SendsPre>
			<SendPreBool Id="0" Value="false" />
			<SendPreBool Id="1" Value="false" />
		</SendsPre>
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
