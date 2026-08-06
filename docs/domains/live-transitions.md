# Programmed Live Transitions

## Status

Programmed echo handoffs are implemented on the current `/project/playback`
development surface. They do **not** make Live Mode show-safe and they do not
replace the target `AudioRuntime`, positive-admission, readiness, or hardware
acknowledgement work in [`../goal-plan.md`](../goal-plan.md).

The project manifest owns transition recipes because a transition relates two
setlist songs. Song `.smap` files and source audio are never changed. V1 supports
one echo recipe per outgoing song; saving a new one replaces that song's prior
recipe.

## Preparing A Transition

1. Put the two songs next to each other in the project setlist.
2. Open the outgoing song's menu and choose **Transition to next...**.
3. Set the outgoing end and incoming start anchors. Use the waveform zoom and
   bar/beat controls for exact placement.
4. Choose **Echo throw**, tune it, and use **Preview transition**.
5. Press **Save for Live**. Reopening the same pair restores the saved recipe.

The JSON panel is diagnostic/exportable text, not a second source of truth.
Recipes are stored in `ProjectFile.transitions[]` and validated by both the web
parser and the desktop sidecar before a manifest rewrite.

## Live Operation

Start the outgoing song normally in `/project/playback`. When a saved recipe
points to the immediate next visible song, Live Mode arms it automatically.
The compact transport status names the destination and number of audible
captured sources without adding another stage row. The full-song waveform marks
the programmed ending in orange.
At the programmed throw it performs the echo, cuts the outgoing music, loads
the next song under the tail, then starts its existing click count-in early
enough for the saved incoming anchor to land on the handoff. No live button
press is required.

Stop, pause, seek, restart, section jump/repeat, Previous, or Next cancels the
armed transition. Cue behavior stays derived from the existing song/project
configuration rather than transition-specific copies:

- The outgoing transition derives a short **End** cue before the echo throw when
  cues and TTS are available.
- When the incoming anchor is the song's canonical start beat, Live reuses that
  song's existing count-in clicks. It never invents a count-in for an unrelated
  arbitrary anchor.
- Auto announcement and the opening section/count cue use the existing project
  announcement mode and selected cue track.
- Click/cue/announcement still obey the private-output contract. On a split rig
  they go to the private outputs; on headphones/stereo they are audible only
  when the session-local **Practice** switch is explicitly on.
- If loading finishes too late, the complete announcement/count-in/anchor
  sequence moves later together. Live reports the late landing instead of
  dropping beats or starting the incoming music without click.

## Source Rules

- The echo input is post-fader and uses only musical lanes linked to the current
  song's live slots. Mute, solo, and fader state therefore shape the throw.
- If drums and bass are the only live-slot sources sounding, the echo contains
  drums and bass. The full original mix is not silently added.
- A song with no musical live-slot lanes may use `original`, matching the
  current Live full-mix fallback. Once any musical slot exists, that fallback
  is forbidden.
- If every linked musical source is off, the transition does not arm. The UI
  reports the blocker and the song follows ordinary end behavior.
- Click and cue track identities are rejected by the engine even if passed by a
  caller. Announcements use the cue scheduler and are never in the echo tap.
- Unlinked/editor/preview lanes are not captured, and every outgoing musical
  lane is silenced at the dry cut so stale audio cannot overlap the next song.
- The incoming song loads its own live-slot/default state. Outgoing stem-button
  state is never copied into it.

## Ending Types

`transition.type` is a discriminated union. Each arm owns its own parameter
block, so adding an ending cannot disturb the others.

| type | what it does | live? |
|---|---|---|
| `echo` | Throw the last fragment into a delay whose tail carries into the next song. | yes |
| `cut` | The backing stops dead on the anchor, with a de-click ramp. | yes |
| `hit` | Kick + crash land on the anchor and the backing stops. | yes |
| `fade` | A controlled fade over N bars reaching silence at the anchor. | yes |
| `fill-hit`, `filter` | Implemented in the lab, auditionable, **not saveable** — no live executor. | no |

`endingSchedule.ts` is the shared decision layer: recipe + local timing in,
timed actions out, in mixer-timeline seconds. The lab's preview and the live
engine run the same function so a rehearsal cannot lie about the gig.

Execution notes that are load-bearing:

- The stop is the engine's `setProgrammedEnd`, routed through `currentEndCtx()`
  — the single existing definition of where a song ends, so `scheduleAutoStop`
  re-derives it on every play, jump and seek. A programmed ending applies only
  to a pass that STARTED before it, so seeking past the anchor lets you
  rehearse an outro you have chosen to cut.
- `scheduleProgrammeFade` is the one mechanism behind `cut` and `fade`, and it
  excludes click and cue by identity.
- A faded programme is RESTORED on the next `play()`
  (`releaseProgrammeFade`), or ending a song would make the next press silent.
- The `hit` goes on `unshiftedBus`, not a mixer track: it must not be
  pitch-shifted with a transposed song, and a track linked to no live button is
  force-muted in live mode. It is torn down by `stopSourcesOnly` like every
  other scheduled source, so a pending crash cannot fire into the next song.

## Warning The Band

`transition.endWarning { text, leadBars }` speaks a warning that many BARS
before the anchor, for every ending type. It reuses `renderSectionCueClips`
(which never knew what a section was) and therefore inherits TTS caching, the
`downbeatOffsetSec` contract and the private-output gating. The clip cache
fingerprint includes the warning, or edits would re-use a stale clip.

## Current Limitations

- Recipes are local project-manifest data. Existing cloud manifest PATCH only
  syncs name/order/hidden state, so transition recipes are not yet cloud synced.
- **An ending still requires a NEXT song.** `incoming` is mandatory, so the last
  song of a set cannot be given a programmed ending, and reordering the setlist
  silently orphans a recipe. Making `incoming` optional is a small schema change
  but a real behavioural branch in the live hand-off state machine — 8 call
  sites assume a destination exists — and was deliberately not attempted in the
  days before a concert.
- The current implementation prepares the next song during the echo window.
  A slow cache/load/TTS response can produce a clearly reported late landing;
  speech has a short preparation budget and may be skipped, while click remains
  the hard requirement. Target runtime cutover must require acknowledged
  destination readiness before committing.
- Transition execution currently lives in `MixerView`/`MixerEngine`; it must be
  re-expressed as one generation-owned target-runtime schedule during cutover.

## Ownership

- Schema, parsing, lookup: `src/lib/project/transitions.ts` and
  `src/lib/project/types.ts`.
- Manifest mutation: `setProjectTransition()` in `src/lib/project/commit.ts`.
- Preparation/preview: `src/routes/project/transition/+page.svelte` using the
  Transition Lab implementation.
- Effect graph and private-lane exclusion: `MixerEngine.scheduleEchoTransition()`.
- Current Live arming, cancellation, song load, and handoff: `MixerView.svelte`.
