# Ableton `.als` Export Notes

`.als` files are gzip-compressed XML. Live is not forgiving: malformed or
schema-mismatched XML can hard-crash Ableton, not merely show a validation
error.

## Inspecting Ground Truth

```bash
gzip -dc file.als | xmllint --format - | less
gzip -dc "/Applications/Ableton Live 12 Standard.app/Contents/App-Resources/Builtin/Templates/DefaultLiveSet.als" | less
```

Useful reference files:

```txt
/Applications/Ableton Live 12 Standard.app/Contents/App-Resources/Builtin/Templates/DefaultLiveSet.als
/Applications/Ableton Live 12 Standard.app/Contents/App-Resources/Core Library/Templates/Quick Start Beat.als
/Applications/Ableton Live 12 Standard.app/Contents/App-Resources/Core Library/Templates/Quick Start Song.als
```

When in doubt, compare generated XML against Ableton-saved files, not only the
bundled template. Some template structures differ from real saved projects.

## Live 12.3.7 Root Element

```xml
<Ableton MajorVersion="5" MinorVersion="12.0_12117" SchemaChangeCount="10" Creator="Ableton Live 12.0" Revision="">
```

- `MinorVersion` uses `major.minor_buildnumber`, e.g. `12.0_12117`.
- Do not write `12.0.2`; Live rejects it as unsupported.

## Core Set Structure

The root `LiveSet` child order matters. Use Ableton-saved output as the
authority. Two high-risk reminders:

- Use `<MainTrack>`, not `<MasterTrack>`.
- `<NextPointeeId Value="...">` must be greater than every used `Id`.

## Audio Tracks

- After `</DeviceChain>`, close the `AudioTrack`; do not add MIDI-only tail
  elements.
- Audio output routing target is `AudioOut/Main`, not `AudioOut/Master`.
- `MainSequencer` uses `<Sample>`.
- `FreezeSequencer` uses `<Sample>` with 8 modulation targets.

## MIDI Tracks

Current verified arrangement-view behavior:

- `MainSequencer` uses `<ClipTimeable>`.
- `MainSequencer` requires 128 `<MidiControllers>` targets
  (`ControllerTargets.0` through `.127`).
- `FreezeSequencer` uses `<Sample>` with 8 modulation targets and
  `TakeCounter Value="1"`.
- MIDI track tail elements are required in Ableton-saved arrangement MIDI
  files:
  - `ReWireDeviceMidiTargetId`
  - `PitchbendRange`
  - `IsTuned`
  - `ControllerLayoutRemoteable`
  - `ControllerLayoutCustomization`

Historical warning: earlier notes assumed MIDI `FreezeSequencer` should be
`ClipTimeable` and that MIDI tail elements should be removed. That combination
was part of a crash path. Do not copy it.

## MIDI Clips

For current BarBro arrangement-view MIDI export, use the fuller
session-style notes shape verified from an Ableton-saved arrangement MIDI note:

- `<KeyTracks>` wrapper.
- `<MidiKey>` after `<Notes>` inside each `<KeyTrack>`.
- `<NoteIdGenerator>`, not `NoteIdCounter`.
- Include clip-level fields such as:
  - `TimeSignature`
  - `ScrollerTimePreserver`
  - `TimeSelection`
  - `Legato`
  - `Ram`
  - `GrooveSettings`
  - `Disabled`
  - `VelocityAmount`
  - `FollowAction`
  - `Grid`
  - `FreezeStart` / `FreezeEnd`
  - `IsInKey`
  - `ScaleInformation`
- Include post-notes fields such as:
  - `BankSelectCoarse`
  - `BankSelectFine`
  - `ProgramChange`
  - `NoteEditorFold*`
  - `ExpressionGrid`

MIDI clips do not need session-view counterparts. Audio clips do.

## Audio Clips

Audio clips must exist in both places:

1. Arrangement:
   `MainSequencer/Sample/ArrangerAutomation/Events`
2. Session registration:
   `MainSequencer/ClipSlotList/ClipSlot Id="0"/ClipSlot/Value`

Removing the session clip while leaving the arrangement clip causes Live to
open the set but fail to resolve/play the audio.

For audio inside the Live project folder, use:

```xml
<RelativePathType Value="3" />
<RelativePath Value="stems/drums.wav" />
<Path Value="" />
<Type Value="2" />
```

Verified `RelativePathType` values:

| Value | Meaning |
|---:|---|
| `0` | absolute path |
| `1` | relative to `.als` location |
| `3` | relative to project folder root |

## Live Project Folder Marker

For project-relative audio references to resolve, the folder containing the
`.als` must be recognized by Live as a project folder. Live does that through
an empty subfolder:

```txt
Ableton Project Info/
```

BarBro creates this through
`src/lib/client/folderHandle.ts::ensureAbletonProjectFolder()`.

## Time Signatures

Live 12 stores time signatures as integer IDs. Confirmed:

| ID | Meter |
|---:|---|
| `201` | 4/4 |

Other meters need a lookup table from Ableton-saved reference files.

## Crash Debugging

1. Check `~/Library/Logs/DiagnosticReports/Live-*.ips`.
2. Repeated `EXC_BAD_ACCESS SIGSEGV` at `0x0` often means the same XML shape is
   still reaching the same bad code path.
3. Compare `imageOffset` values across crash reports.
4. Use non-crash Live error dialogs to pinpoint XML issues:
   - "Not all list members have ids" -> missing `Id` on a list member.
   - "slot count mismatch" -> `ClipSlotList` count differs from scene count.
   - "Required attribute X missing" -> wrong element/attribute shape.
5. Binary search by removing large sections, e.g. an entire track.

## Known Errors

| Error | Fix |
|---|---|
| "unsupported minorversion 12.0.2" | Use `MinorVersion="12.0_12117"` format. |
| "Not all list members have ids" | Add `Id="N"` to every list member such as `Locator`. |
| "Required attribute top missing" | Check exact attribute casing/shape for `VideoWindowRect`. |
| "unexpected value for int node: Major" | Use `<ScaleInformation><Root Value="0" /><Name Value="0" /></ScaleInformation>`. |
| "Set has no player tracks" | Use `<MainTrack>`, not `<MasterTrack>`. |
| "slot count mismatch" | `ClipSlotList` slot count must equal scene count. |
