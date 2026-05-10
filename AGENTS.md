# Ableton .als Reverse Engineering Notes

## Agents and roadmap

Anyone automating or assisting on this repo (Cursor agents, bots, etc.) **must record progress in [`docs/goal-plan.md`](docs/goal-plan.md)** whenever work finishes or meaningfully advances something listed there: bump **Lvl**, tighten **Notes**, and adjust the epic **Detail** bullets so the file stays an accurate snapshot of maturity.

---

## Overview
`.als` files are **gzip-compressed XML**. Decompress with:
```bash
gzip -dc file.als | xmllint --format - | less
# Or to inspect Ableton's own default template:
gzip -dc "/Applications/Ableton Live 12 Standard.app/Contents/App-Resources/Builtin/Templates/DefaultLiveSet.als" | less
```

## Live 12.3.7 Root Element
```xml
<Ableton MajorVersion="5" MinorVersion="12.0_12117" SchemaChangeCount="10" Creator="Ableton Live 12.0" Revision="">
```
- `MinorVersion` format is `major.minor_buildnumber` (e.g. `12.0_12117`), NOT `12.0.2`
- Wrong MinorVersion → "unsupported minorversion" dialog, file refuses to load

## Key Reference Files
```
/Applications/Ableton Live 12 Standard.app/Contents/App-Resources/Builtin/Templates/DefaultLiveSet.als
/Applications/Ableton Live 12 Standard.app/Contents/App-Resources/Core Library/Templates/Quick Start Beat.als
/Applications/Ableton Live 12 Standard.app/Contents/App-Resources/Core Library/Templates/Quick Start Song.als
```
Always use these as ground truth for XML structure. When in doubt, diff against them.

## Document Structure (LiveSet children, in order)
```xml
<NextPointeeId Value="22182" />   <!-- must be > all Id attributes used -->
<OverwriteProtectionNumber Value="3072" />
<LomId Value="0" />
<LomIdView Value="0" />
<Tracks>
  <!-- AudioTrack, MidiTrack, ReturnTrack elements -->
</Tracks>
<MainTrack ...>   <!-- NOT MasterTrack — that crashes Live 12 -->
<PreHearTrack ...>
<SendsPre>
  <!-- one SendPreBool per ReturnTrack; empty element if no returns -->
</SendsPre>
<Scenes>...</Scenes>
<Transport>...</Transport>
<SessionScrollPos X="0" Y="0" />
<SignalModulations />
<GlobalQuantisation Value="4" />
<AutoQuantisation Value="0" />
<Grid>...</Grid>
<ScaleInformation><Root Value="0" /><Name Value="0" /></ScaleInformation>
<InKey Value="true" />
<SmpteFormat Value="0" />
<TimeSelection>...</TimeSelection>
<SequencerNavigator>...</SequencerNavigator>
<IsContentSplitterOpen Value="true" />
<IsExpressionSplitterOpen Value="true" />
<ExpressionLanes>...</ExpressionLanes>
<ContentLanes>...</ContentLanes>
<ViewStateFxSlotCount Value="4" />
<ViewStateSessionMixerVolumeSectionHeight Value="120" />
<ViewStateArrangerMixerVolumeSectionHeight Value="120" />
<ShouldSceneTempoAndTimeSignatureBeVisible Value="false" />
<WaveformVerticalZoomFactor Value="1" />
<IsWaveformVerticalZoomActive Value="true" />
<Locators>...</Locators>
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
  <LomId Value="0" />
  <Grooves />
  <DefaultGrooveId Value="-1" />
</GroovePool>
<AutomationMode Value="false" />
<SnapAutomationToGrid Value="true" />
<ArrangementOverdub Value="false" />
<ColorSequenceIndex Value="0" />
<AutoColorPickerForPlayerAndGroupTracks><NextColorIndex Value="0" /></AutoColorPickerForPlayerAndGroupTracks>
<AutoColorPickerForReturnAndMainTracks><NextColorIndex Value="0" /></AutoColorPickerForReturnAndMainTracks>
<ViewData Value="{}" />
<ResetNonautomatedMidiControllersOnClipStarts Value="true" />
<MidiFoldIn Value="false" />
<MidiFoldMode Value="-99" />
<MultiClipFocusMode Value="false" />
<MultiClipLoopBarHeight Value="0" />
<MidiPrelisten Value="false" />
<LinkedTrackGroups />
<NoteSpellingPreference Value="0" />
<AccidentalSpellingPreference Value="3" />
<PreferFlatRootNote Value="false" />
<UseWarperLegacyHiQMode Value="false" />
<VideoWindowRect Top="-2147483648" Left="-2147483648" Bottom="-2147483648" Right="-2147483648" />
<ShowVideoWindow Value="true" />
<TuningSystems />
<TrackHeaderWidth Value="93" />
<ViewStateMainWindowClipDetailOpen Value="false" />
<ViewStateMainWindowHiddenOtherDocViewTypeClipDetailOpen Value="false" />
<ViewStateMainWindowHiddenOtherDocViewTypeDeviceDetailOpen Value="true" />
<ViewStateMainWindowDeviceDetailOpen Value="true" />
```

## AudioTrack Structure
- After `</DeviceChain>`, NO extra elements (unlike MidiTrack)
- AudioOutputRouting target: `AudioOut/Main` (NOT `AudioOut/Master`)
- MainSequencer uses `<Sample>` (not `<ClipTimeable>`)
- FreezeSequencer also uses `<Sample>` with 8 modulation targets

## MidiTrack Structure
- MainSequencer uses `<ClipTimeable>` (not `<Sample>`)
- MainSequencer requires 128 `<MidiControllers>` (`ControllerTargets.0` through `.127`)
- FreezeSequencer uses `<ClipTimeable>` + `<MidiControllers>` (128 targets) — same structure as MainSequencer. The DefaultLiveSet.als bundle template incorrectly shows `<Sample>` here; real Ableton-saved projects use ClipTimeable.
- After the outer `</DeviceChain>`, MidiTrack should have NO additional elements (just close `</MidiTrack>`).
  The DefaultLiveSet.als template shows `ReWireDeviceMidiTargetId`, `PitchbendRange`, `IsTuned`, `ControllerLayoutCustomization` here, but real BarBro-generated working files don't have these — and adding them WITH a clip in the MainSequencer's ClipTimeable causes a SIGSEGV null pointer crash. If you need to support midi-routing-specific features later, add them carefully and test each one.

## MidiClip Structure — TWO DIFFERENT FORMATS (CRITICAL)

**Arrangement view** (inside `ClipTimeable/ArrangerAutomation/Events`) and
**Session view** (inside `ClipSlot/ClipSlot/Value`) use completely different XML schemas.
Applying session-view schema to arrangement view **crashes Live** every time.

### Arrangement-view MidiClip (CORRECT for ClipTimeable)
```xml
<MidiClip Id="0" Time="0">
  <LomId Value="0" /><LomIdView Value="0" />
  <CurrentStart Value="0" /><CurrentEnd Value="16" />
  <Loop>...</Loop>
  <Name Value="..." /><Annotation Value="" />
  <Color Value="6" /><LaunchMode Value="0" /><LaunchQuantisation Value="0" />
  <!-- NO TimeSignature, ScrollerTimePreserver, TimeSelection, Legato etc. in arrangement clips! -->
  <Envelopes><Envelopes /></Envelopes>
  <!-- NO IsInKey, ScaleInformation before Notes in arrangement clips! -->
  <!-- Notes use OLD format — no KeyTracks wrapper, MidiKey BEFORE Notes -->
  <Legato Value="false" /><Ram Value="false" />
  <GrooveSettings><GrooveId Value="-1" /></GrooveSettings>
  <Disabled Value="false" /><VelocityAmount Value="0" />
  <FollowAction>...</FollowAction>
  <Grid>...</Grid>
  <FreezeStart Value="0" /><FreezeEnd Value="0" />
  <IsWarped Value="false" /><TakeId Value="0" />
  <IsInKey Value="false" />           <!-- REQUIRED — absence causes SIGSEGV -->
  <ScaleInformation><Root Value="0" /><Name Value="0" /></ScaleInformation>  <!-- REQUIRED -->
  <Notes>
    <!-- OLD format — KeyTrack directly, MidiKey BEFORE Notes -->
    <KeyTrack Id="0">
      <MidiKey Value="36" />
      <Notes>
        <MidiNoteEvent Time="0" Duration="0.125" Velocity="127" OffVelocity="64" Probability="1" IsEnabled="true" NoteId="1" />
      </Notes>
      <IsRangeSelected Value="false" />
      <HighlightedTime Value="0" />
      <TimeableColor Value="-1" />
    </KeyTrack>
  </Notes>
  <NoteIdCounter Value="N" />   <!-- OLD NoteIdCounter, not NoteIdGenerator -->
  <IsWarped Value="false" />
  <TakeId Value="0" />
</MidiClip>
```

### Session-view MidiClip (inside ClipSlot — DO NOT use in ClipTimeable)
Uses `<KeyTracks>` wrapper, `<MidiKey>` after `<Notes>`, `<NoteIdGenerator>`, plus
`<TimeSignature>`, `<ScrollerTimePreserver>`, `<TimeSelection>`, `<IsInKey>`, `<ScaleInformation>`,
`<BankSelectCoarse>`, `<NoteEditorFold*>`, `<ExpressionGrid>` etc.

**Common wrong patterns (arrangement view):**
- Adding `<TimeSignature>`, `<ScrollerTimePreserver>`, `<TimeSelection>` → session-view only, crashes Live
- Adding `<IsInKey>`, `<ScaleInformation>` before Notes → crashes Live
- Using `<KeyTracks>` wrapper → session-view only, crashes Live
- Using `<NoteIdGenerator>` instead of `<NoteIdCounter>` → wrong for arrangement view

## Time Signature Encoding
Live 12 encodes time signatures as integer IDs in `<TimeSignature>` and `<Scene>` elements.
- `201` = 4/4 (from DefaultLiveSet.als)
- Other time signatures require a lookup table (not yet reverse-engineered)

## Ableton Project Folder Recognition (CRITICAL for audio resolution)

For `RelativePathType="1"` (project-relative) audio file refs to resolve, the folder containing the `.als` MUST be a recognized **Live Project folder**. Ableton marks project folders by creating an empty subfolder named `Ableton Project Info/` at the project root.

Without this marker:
- Ableton opens the file but cannot find audio files referenced by relative path
- Audio clips appear as "media files missing" / silent

To make a folder Ableton-recognizable as a project:
```javascript
await dir.getDirectoryHandle('Ableton Project Info', { create: true })
```

This is automated in `src/lib/client/folderHandle.ts::ensureAbletonProjectFolder()` and called from the Set page before writing the `.als`.

## CRITICAL: Audio loading requires session-view clips

Through experiment (taking an Ableton-saved working `.als` and removing only the session clips, keeping arrangement clips), audio fails to load. **Ableton requires AudioClips to also exist in `<ClipSlot>/<ClipSlot>/<Value>` (session view) for arrangement-view clips on the same track to play audio.**

When a track has audio:
- Add the AudioClip in `<MainSequencer>/<Sample>/<ArrangerAutomation>/<Events>` (arrangement)
- Add the SAME AudioClip (or one with matching `<SampleRef>`) in `<MainSequencer>/<ClipSlotList>/<ClipSlot Id="0">/<ClipSlot>/<Value>` (session)

If the arrangement clip exists alone, Ableton opens the file but never resolves the audio. The session clip seems to act as the "registration" for the file in Ableton's internal lookup.

## AudioClip Structure (arrangement view)
**RelativePathType values** (verified against an Ableton-saved .als):
- `1` = relative to .als file location (uses `../` for files outside, e.g. `../../../stems_output/foo.wav`)
- `3` = relative to project folder root (subpath only, e.g. `stems/drums.wav`)
- `0` = absolute path only

When the audio is INSIDE the project folder, use **Type 3**.

`Type` (separate field): `2` for audio file references.

```xml
<AudioClip Id="0" Time="0">
  ...standard header...
  <IsWarped Value="true" />
  <TakeId Value="1" />
  <SampleRef>
    <FileRef>
      <RelativePathType Value="3" />          <!-- 3 = project-relative -->
      <RelativePath Value="stems/drums.wav" />
      <Path Value="" />                       <!-- absolute can be empty -->
      <Type Value="2" />                      <!-- 2 = audio file -->
      <LivePackName Value="" /><LivePackId Value="" />
      <OriginalFileSize Value="0" /><OriginalCrc Value="0" />
      <SourceHint Value="" />
    </FileRef>
    <LastModDate Value="0" /><SourceContext />
    <SampleUsageHint Value="0" />
    <DefaultDuration Value="SAMPLE_COUNT" />
    <DefaultSampleRate Value="44100" />
    <SamplesToAutoWarp Value="0" />
  </SampleRef>
  <Onsets><UserOnsets /><HasUserOnsets Value="false" /></Onsets>
  <WarpMode Value="0" />
  <WarpMarkers>
    <WarpMarker Id="0" SecTime="0" BeatTime="0" />
    <WarpMarker Id="1" SecTime="DURATION_SEC" BeatTime="DURATION_BEATS" />
  </WarpMarkers>
  <SavedWarpMarkersForStretched />
  <MarkersGenerated Value="false" />
</AudioClip>
```

Ableton-saved clips also include `TimeSignature`, `ScrollerTimePreserver`, `TimeSelection`, `Legato`, `Ram`, `GrooveSettings`, `Disabled`, `VelocityAmount`, `FollowAction`, `Grid`, `FreezeStart`, `FreezeEnd`, `IsInKey`, `ScaleInformation`, plus granular synthesis params (`GranularityTones`, etc.) and `Fades`. None of these are required for the file to LOAD; missing them just means simpler defaults.

## MidiTrack arrangement-view notes (RESOLVED)

After getting a ground-truth `.als` from Ableton (record one MIDI note in arrangement view, save), the correct format was confirmed:

- **MidiTrack tail elements ARE required** (`ReWireDeviceMidiTargetId`, `PitchbendRange`, `IsTuned`, `ControllerLayoutRemoteable`, `ControllerLayoutCustomization`).
- **MidiTrack FreezeSequencer uses `<Sample>` (audio-style) with 8 modulation targets and `TakeCounter Value="1"`** — NOT `<ClipTimeable>` as I had wrongly assumed.
- **MidiClip uses the FULL session-view-style schema** with `<KeyTracks>` wrapper, `<MidiKey>` AFTER `<Notes>` inside `<KeyTrack>`, `<NoteIdGenerator>`, all clip-level fields (`TimeSignature`, `ScrollerTimePreserver`, `TimeSelection`, `Legato`, `Ram`, `GrooveSettings`, `Disabled`, `VelocityAmount`, `FollowAction`, `Grid`, `FreezeStart/End`, `IsInKey`, `ScaleInformation`), and post-Notes fields (`BankSelect*`, `NoteEditorFold*`, `ExpressionGrid`).
- **MidiClips do NOT need session-view counterparts** (only AudioClips do — see "CRITICAL: Audio loading" section).

The persistent crash from earlier was caused by the wrong simple Notes format combined with using ClipTimeable in the FreezeSequencer.

## Crash Debugging Methodology
1. Check crash reports at `~/Library/Logs/DiagnosticReports/Live-*.ips`
2. All crashes have been `EXC_BAD_ACCESS SIGSEGV` at address `0x0` (null pointer dereference)
3. The crashing instruction is a vtable call: `LDR X8, [X19, #0]` where X19=0
4. When the SAME crash instruction repeats across fixes, it means the root element hasn't been touched yet
5. The binary is stripped — use `nm` won't give useful symbols. Instead:
   - Compare call stack `imageOffset` values across crashes to see if they changed
   - If offsets are IDENTICAL, the same code path is crashing → your fix didn't reach the problem
6. Use error dialogs (non-crash errors) to pinpoint XML structure issues:
   - "Not all list members have ids" → missing `Id` attr on `<Locator>`
   - "slot count mismatch" → ClipSlotList count ≠ Scene count
   - "Required attribute X missing" → check that element's attribute names
7. **Binary search approach**: comment out large sections (e.g., the entire MidiTrack) to isolate which section triggers the crash

## Reverse Engineering Resources
- Ableton template files (see above) — ground truth for XML schema
- `gzip -dc file.als | xmllint --format -` to pretty-print any .als
- Crash reports in `~/Library/Logs/DiagnosticReports/`
- Python for decoding base64 instruction bytes from crash reports
- The `.000.ips` variant of a crash is the pretty-printed version (1000+ lines)

## Known Errors and Their Fixes
| Error | Fix |
|-------|-----|
| "unsupported minorversion 12.0.2" | Use `MinorVersion="12.0_12117"` format |
| "Not all list members have ids" | Add `Id="N"` to every `<Locator>` |
| "Required attribute top missing" | `<VideoWindowRect top="0" .../>` uses attributes not children |
| "unexpected value for int node: Major" | `<ScaleInformation><Root Value="0" /><Name Value="0" /></ScaleInformation>` |
| "Set has no player tracks" | Was using `<MasterTrack>` — correct element is `<MainTrack>` |
| "slot count mismatch" | `ClipSlotList` slot count must equal `Scenes` count (not hardcoded 8) |
| SIGSEGV null ptr on open | MidiTrack tail elements (ReWireDeviceMidiTargetId etc.) PRESENT alongside a clip — remove them; they conflict with arrangement-view MidiClips |
| SIGSEGV null ptr (persistent) | MidiClip missing `<TimeSignature>`, `<ScrollerTimePreserver>`, `<TimeSelection>`, `<IsInKey>`, `<ScaleInformation>` — all required before `<Notes>` |
