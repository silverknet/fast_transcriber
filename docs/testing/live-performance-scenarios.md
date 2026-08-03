# Live Performance Scenarios And XR18 Verification

**Status:** target acceptance matrix. `A` means automatable; `M` means manual
hardware verification is required. These scenarios are not claims that the current
implementation passes.

## Reading the matrix

- **Main** means audience output; `music` excludes click/cues/announcements.
- **P outputs** means performer outputs. `own private` means configured monitor mix,
  shared click/count-in, and only that performer's cue/announcement events.
- **Recovery** always requires fresh generation-scoped evidence. No prior green or
  physical confirmation survives route/device identity change.
- Every automated scenario asserts runtime state, UI projection, destinations, and
  absence of forbidden Main connections. Manual checks add physical audibility.

## Critical observed regressions

These failures have already occurred in manual testing. They are release blockers,
not optional edge cases. Current code references explain why the target test must
initially fail until the implementation is migrated.

| Observed scenario / current evidence | Required target behavior and runtime | Main / performers | Acceptance test |
|---|---|---|---|
| Live Mode is broadly untrustworthy: Live mounts the Editor's `MixerView` and component-owned engine (`project/playback/+page.svelte:578`; `MixerView.svelte:3230-3248`) | Entering Live disposes Editor audition state, validates one mode-specific graph/source plan, and publishes readiness only after executor acknowledgements | Nothing sounds before valid activation; then only planned destinations | Browser host test enters Editor with active sources, enters Live, and asserts one runtime/graph generation, Practice off, no Editor nodes, and exact installed source/edge set |
| An unassigned source is audible: `loadAndRegisterTracks()` discovers and installs broad candidates (`MixerView.svelte:1710-2133`); `liveInitialMuted()` lets unlinked lanes inherit saved Editor mute (`liveSlotLinks.ts:160-178`) | `ValidatedLiveSourcePlan` is exhaustive. Unassigned, Editor-only, preview, orphaned, and ambiguous candidates have no nodes/edges regardless of saved mute/solo or filename | No excluded source in Main or any performer output | Pure allowlist table test plus browser graph test with a loud sentinel excluded source; assert executor never receives its ID and rendered output has zero sentinel energy |
| Filename/default inference admits audio: missing `liveSlot` falls back through `laneSlotIndex()` (`liveSlotLinks.ts:64-91`; `liveMidiMap.ts:223-238`) | Migration may propose an explicit assignment once; ambiguous/unreviewed sources default excluded | Only explicit/migrated reviewed sources | Parser/migration test converts recognized legacy sources deterministically and excludes ad-hoc/orphan names; runtime test never invokes excluded loader |
| Production Mixer still has filename-derived Editor `MixTrackState.key`; the new shadow path separately persists stable v7 `sourceId`, `mixerChannelId`, and `stemId` but is not connected to runtime | Stable `mixerChannelId -> sourceId/stemId` binding validates before admission; local `liveStemRefs[stemId]` resolves the file; labels, order, filenames, mute/solo, and `liveSlot` cannot change it | Only the source bound to that channel may reach the channel's programme/monitor routes | Pure binding, direct-load determinism, duplicate/ambiguous mapping, local-ref stripping, distinct-lane, and explicit-sum tests now pass. Browser graph sentinel coverage remains a cutover gate |
| Editor machine/audition state leaks: generated lanes are offered with `showBand = true`; unlinked machines use saved state (`MixerView.svelte:441-466,1844-1978`) | Editor preview and device-local switches are ignored by Live admission unless a separate explicit Live assignment exists | Preview machine silent everywhere in Live | Browser test enables/unmutes Editor machine, enters Live without assignment, and asserts no instrument construction/output; explicit assignment is the sole positive case |
| Click/cue reaches Main: production `new MixerEngine()` has no layout; default maps all lanes to `[0,1]`; cue uses `cueOutput ?? unshiftedInput` (`MixerView.svelte:3235-3246`; `liveOutputMap.ts:88-105`; `mixerEngine.ts:376-386`) | Without Practice, absence of a private route makes click/cue silent and affected performer output failed/degraded. Main remains music-only | Main: zero click/cue energy. Valid P routes: private content. Invalid P: silence | Browser graph test injects distinct music/click/cue tones on both 2-channel and multichannel capability sets; Practice off must produce only music on Main. Two-channel Live must fail/degrade private routes, never fold. Practice-on positive case admits one cue track |
| Monitor assignment exists but delivery is unknown: production graph ignores project layout; `/rig` programs only stereo USB sources; XAir panel writes later desk fragments (`MixerView.svelte:3235`; `routes/rig/+page.svelte:487-545`; `XAirSettingsPanel.svelte:330-424`) | One generation must acknowledge event lane -> Web channel -> USB source -> strip -> Main off -> intended bus send/master. Missing link prevents performer Ready | Main music-only; affected performer silent/failed until chain is complete | Pure mapping test and fake-XR18 integration test assert exact `rtnsrc`/`rtnsw`, LR-off, bus-send and master writes/readback for click and each `cue:<performerId>` before Ready |
| Monitor display can inspect the wrong click channel: UI uses 11 while current route default uses 15 (`MonitorStatusStrip.svelte:37-62`; `xairRouting.ts:112-138`) | UI receives active route IDs/channels from AudioRuntime; no hard-coded fallback. Mismatch is failed/unknown, never green | No routing change from display logic | Component test feeds active click strip 15 with strip 11 carrying another tone; only 15 may be labelled click evidence |
| Bus meter moves but click/cue may be absent: `monitorStatuses()` sees aggregate aux level (`monitorStatus.ts:88-150`) | Bus activity is labelled aggregate evidence. Content-specific readiness requires graph/readback chain and explicit test | No content claim solely from meter | Selector test proves a moving bus meter cannot promote click/cue route from initializing/failed to Ready |
| Song/mode transition leaves stale source | Current serialized reload removes tracks then rebuilds asynchronously (`MixerView.svelte:2993-3021`) outside an authoritative generation transaction | Old sources, sends, effects, instruments, click, cues, and announcements stop/disconnect before replacement; target starts stopped | Browser test holds a loud old-song sentinel and resolves its delayed loader after the new generation commits; assert no old node/energy/event and stale result is disposed |

## Startup and connections

| Scenario / preconditions | Expected behavior and runtime | UI | Main / P outputs | Failure and recovery | Verify |
|---|---|---|---|---|---|
| App starts with XR18 OSC and USB audio available; valid project | Practice resets off; open selected USB device, start OSC independently, validate/build routes, load song | Initializing, then exact output states | Main: music. Each ready P: own private | Any failed P -> degraded; Main/device/isolation -> blocked. Retry only failed scope or full device | A with fakes + M XR18 |
| App starts without XR18/selected audio | Do not silently choose audience/default output; device disconnected; Live blocked | Missing selected device and reconnect action | Main/P: silence | Device appearance triggers explicit/policy reconnect -> initializing -> revalidate | A + M |
| XR18 appears after startup | Discover control/audio independently; opening audio and OSC may complete in either order | Separate audio and control evidence; never green early | Silence until Main ready; P only after own routes ready | Failed open remains blocked; retry new generation | A + M |
| OSC succeeds, USB audio unavailable | Control connected is recorded, no graph activation/readiness | Control connected; audio disconnected; Live blocked | Silence everywhere | Connect/open audio, revalidate all channels, then build | A + M |
| USB audio ready, OSC unavailable | Known graph may operate; desk writes/readback frozen; state degraded/unverified if desk control is required | Audio route states plus OSC warning | Main music only; proven P routes may continue; no guessed routes | OSC reconnect reads current desk state before armed diff/application | A + M |
| Entire active audio device disconnects during playback | Stop, cancel all epochs/sources, invalidate routes and confirmations, block | Device disconnected, all outputs non-ready | Silence; no default-output fallback | New device instance -> opening/validation/activation; playback stays stopped | A browser + M |
| Audio device reconnects with fewer/changed channels | Treat capabilities as new; reject old out-of-range/colliding map | Exact invalid assignments; blocked or degraded by scope | Only newly proven safe routes; private failures silent | User repairs config or correct device returns; full revalidation | A + M |
| OSC disconnects/reconnects while USB graph remains | Freeze writes on loss; continue only known audio degraded; on reconnect re-read/diff with fresh control generation | Control warning then initializing; confirmation invalid if desk route may change | No routing fallback or Main content change | Re-arm before desk mutation; ready only after required fresh evidence | A + M |
| Application restarts with prior valid rig and Practice previously on | Persisted intent loads; all runtime evidence/arm/confirmation discarded; Practice off | Initializing; Practice visibly off | No private content in Main | Normal fresh startup/verification | A + M |

## Outputs, mappings, and content

| Scenario / preconditions | Expected behavior and runtime | UI | Main / P outputs | Failure and recovery | Verify |
|---|---|---|---|---|---|
| One performer route fails; P1/P2 ready, P3 fails | Isolate P3, keep safe routes, Live degraded | P1/P2 ready; P3 failed with cause; persistent Live warning | Main music; P1/P2 own private; P3 silence | Retry P3 only; never route P3 to Main/others | A + M |
| All performer routes fail; Main/song ready | Live degraded, playback permitted | Every P failed/unconfigured; Main ready; warning | Main music; all P silence | Recover each independently or repair mapping | A + M |
| Main fails | Stop/block; private routes are not treated as a substitute show output | Main failed, Live blocked, Play disabled | No trusted output | Repair/reinitialize Main and revalidate isolation | A + M |
| Song misses optional stems but has required programme | Prepare available lanes with explicit warning; song usable/degraded | Missing stem names; song usable | Main/monitor mixes omit only missing optional stems | Relink/hydrate and prepare new song generation | A + M content check |
| Song misses all required programme audio | Song failed; Live blocked | Missing source error, Play disabled | Silence | Hydrate/relink then prepare fresh generation | A |
| Song contains unassigned/editor-only/orphan audio and generated candidates | Validator excludes them before preparation/attachment; installed IDs exactly match Live plan | Excluded IDs shown as omitted, never as muted Live tracks | Main/P receive no excluded content | Add explicit Live assignment and activate a new generation | A browser |
| Two stems need independent performer monitor levels | Each stable mixer channel maps to a distinct rig programme lane and XR18 input strip | Show both source/channel/strip chains; no implied grouping | Main contains configured programme; performer buses receive independently adjustable stem sends | If capacity is insufficient, fail the assignment or require an explicit summed group; never silently sum | A mapping + sidecar; M hardware |
| Mixer channels are explicitly summed into one rig lane | Treat the sum as one named hardware source group and report that its members cannot have independent XR18 sends | Summed-group warning and member list | Group reaches configured destinations as one controllable source | Split onto distinct lanes to recover independent monitor control | A mapping + M |
| Enabled cue track has no events | No cue/announcement sources; output itself may stay ready | Track shown empty, not failed | Main music; assigned P gets music/click but no track cues | Add events/reload; do not substitute another track | A |
| Cue track disabled | Scheduler emits nothing for track including intro | Disabled state shown | No cue/announcement from that track anywhere | Explicit enable creates new schedule; no auto replay mid-song | A |
| Performer has no monitor assignment | Performer unconfigured; Live degraded if roster expects them | Clear unconfigured status, no green | Main music; that P silence | Persist valid assignment, revalidate/activate | A + M |
| Output channels changed since save | Validator uses current capability report; stale mapping rejected | Exact unavailable channel(s) | Safe Main only if isolation is proven; affected P silence | Repair map or restore expected device | A + M |
| Duplicate performer physical/bus assignment | Reject both ambiguous private routes; no implicit sharing | Collision references both performers | Main music if isolated; affected P routes silent | Explicit unique assignments; future shared group requires schema | A |
| Main overlaps click/cue/performer channel | Isolation compromised; configuration invalid; Live blocked | Blocking collision error | Silence; never test/play through ambiguous map | Repair and activate complete new config generation | A + M |
| Click/cue private graph edge is missing on stereo-only hardware; Practice off | Do not fold into stereo; private output failed/unavailable, Live degraded if Main is safe | Main ready/music-only; performer private warning | Main music only; affected P lacks click/cue | Provide supported private output or explicitly enable Practice | A browser + M |
| Click/cue desk strip listens to wrong USB return | Performer output failed; aggregate bus activity cannot override mismatch | Exact USB-source mismatch | Main music-only; affected private content silent/untrusted | Apply/read back correct USB source and rebuild route generation | A sidecar + M |
| Missing hardware channel for private cue lane | Fail that performer route, degraded if Main safe | Capacity error for performer | Main music; other P own private; affected P silence | Reduce/remap lanes or use supported hardware | A + M |
| Migrated project has ambiguous zero/one-based or stereo mapping | Preserve data but do not activate ambiguity | Needs-attention migration details | No ambiguous output; Main only if separately proven | User confirms/repairs explicit current mapping | A |
| Practice explicitly enabled with one selected enabled track | Runtime adds shared click/count-in and only selected track to Main | Practice on + selected track, distinct warning | Main music + click + selected cue; P unchanged | Disable removes private Main paths immediately; failure returns off | A browser + M |
| Practice enable requested with no/disabled selected track | Reject without graph mutation | Practice failed/off and actionable message | Main music only | Select eligible track and retry explicit action | A |

## Live entry, transport, and songs

| Scenario / preconditions | Expected behavior and runtime | UI | Main / P outputs | Failure and recovery | Verify |
|---|---|---|---|---|---|
| User enters Live Mode | New session generation; Practice off; initialize device/config/first song | Initializing until authoritative evidence settles | Nothing until ready; then normal policy | Cancelled navigation disposes session resources | A browser + M smoke |
| User exits then re-enters | Full cleanup; new session; no old song/epoch/arm/confirmation/Practice | Fresh initializing; Practice off | No stale source or private Main route | Reinitialize from persisted intent only | A browser + M |
| Song changes while stopped | Cancellable target prepare; atomic cleanup/commit; target stopped at zero | Loading target then stopped/ready | Current song until commit; no mixed generations | Prepare failure leaves old stopped song active | A browser |
| Song changes while playing | Old may play during prepare; deliberate stop boundary; target commits stopped at zero | Loading then target stopped; no false playing | Never overlap old/new or stale cues | Prepare failure keeps old playing; commit failure stops/blocks target | A browser + M long-song |
| Pause and resume | Pause snapshots position/cancels epoch; resume schedules new epoch, no Auto intro | Paused then playing at same position | Same routes; no duplicate click/cue | Scheduling failure stops and reports scoped error | A browser + M |
| Seek into middle while paused/playing | Cancel epoch; set target; reconstruct sustained state; skip past one-shots/Auto intro | Position changes once, stable transport state | Correct content at target; no stale cue | Failed reschedule stops/pauses with error, no old epoch | A browser + M |
| Restart from beginning | Cancel all sources; zero; fresh-start announcement/count-in policy | Position zero then announcement/count-in/play | Normal policy; no stacked intros | Failed intro asset follows explicit optional/required policy | A browser + M |
| Repeat section | Canonical loop boundary reschedules every timed class; no Auto intro | Repeat section shown; playhead loops coherently | Correct music/click/cues/MIDI per loop | Disable removes future loop; stale epoch ignored | A browser + M |
| Stop during count-in/announcement | Cancel announcement, delayed start, click/count-in, and song sources | Stopped at zero | Immediate silence except preserved route noise floor | Next play is a fresh start | A browser |

## Announcement modes

| Scenario / preconditions | Expected behavior and runtime | UI | Main / P outputs | Failure and recovery | Verify |
|---|---|---|---|---|---|
| Auto; fresh start; enabled performer intros | Fire each eligible track on its own route; delay shared count-in/song by longest intro | Announcing then count-in/playing | Main music only after delay; each P hears own intro | Missing optional speech yields track warning/silence, not cross-route fallback | A scheduler/browser + M |
| Triggered while stopped or playing | Explicit command fires eligible intro events without moving transport | Brief per-track announcement state | Each P own intro; Main only selected track if Practice on | Retrigger replaces same-output intro; transport unaffected | A browser + M |
| Announcement mode Off | Auto and trigger commands emit none | Off | No announcements; other cue events follow their enable policy | Switch mode affects future commands only | A |
| Explicit intro event disabled | Suppress that track's announcement; do not fall back to title | Disabled intro visible | No intro on that route | Explicit re-enable for future trigger/fresh start | A |
| Old migrated track has no explicit intro | Canonical migrator/scheduler may resolve song title according to documented migration rule | Resolved legacy intro identified | Routes exactly like owning track | Saving canonical data must preserve intent; never infer after explicit disable | A |
| Resume/seek/repeat with Auto mode | Do not replay Auto intro | Normal transport status | No announcement; ordinary scheduled content only | Restart is the explicit path to fresh Auto behavior | A browser |

## Tests and physical confirmation

| Scenario / preconditions | Expected behavior and runtime | UI | Main / P outputs | Failure and recovery | Verify |
|---|---|---|---|---|---|
| Main output test succeeds in software | Explicit bounded test source targets Main; runtime observes scheduling/current evidence | Test active/success evidence, not permanent readiness by itself | Main test only; P no test | Stop automatically; errors clear only on fresh success | A + M FOH |
| Performer output test succeeds | Explicit bounded signal addresses exactly one performer logical route | Named route test active; may invite confirmation | Main silent; target P test; other P silent | Stop automatically; preserve no test source | A + M performer |
| Output test fails to schedule/write/read back | Cancel test, scope structured failure, never mark confirmed | Failed with cause | No fallback to Main/other P | Repair/reinitialize then new test generation | A + M |
| Performer confirms hearing correct test | Store session-local physical confirmation tied to device/config/route generation | “Confirmed this session” separate from Ready | No routing change | Invalidate on route/device/reconnect/restart | A state + M action |
| Hardware reconnects after confirmation | Discard confirmation before activating replacement/control generation | Confirmation removed, initializing/degraded until proven | No private fallback; current safe graph only | Re-test and reconfirm physically | A + M |

## XR18 verification checklist

Run this with the exact supported computer, XR18 firmware, USB mode, network path,
and physical output patch intended for performance. Record versions and channel
map with the result.

### Before sound

- [ ] Confirm XR18 USB interface and OSC endpoint are presented as two independent
      connections in the runtime.
- [ ] Confirm the active playback context, not a probe context, identifies the
      selected XR18 audio device and reports enough output channels.
- [ ] Confirm Main stereo pair, click strip, each performer cue strip, musical
      strips, performer buses, and aux destinations have an unambiguous map.
- [ ] Inspect the active Live source plan. Confirm every intended source is named
      and every Editor-only, preview, orphaned, and unassigned source is omitted,
      not merely muted.
- [ ] Confirm Web Audio channels are documented zero-based and XR18 strips/buses
      one-based at the conversion boundary.
- [ ] Confirm validator rejects duplicate private channels/buses and every
      Main/private overlap before any desk write.
- [ ] Confirm OSC writes require a new session arm and fresh desired configuration.

### Signal isolation

- [ ] Test left and right Main separately; verify correct FOH channels and no
      performer-only content.
- [ ] Test shared click; verify all intended performer buses and zero Main send.
- [ ] Test each `cue:<performerId>` lane; verify only that performer's bus and zero
      Main/other-performer sends.
- [ ] Test musical programme/stems; verify Main plus intended monitor sends.
- [ ] Make an excluded source deliberately loud in Editor, enter Live, and verify
      it is absent from Main and every performer output.
- [ ] Trigger each performer's intro; verify text/voice and destination ownership.
- [ ] Enable Practice explicitly; verify Main receives click plus only the selected
      cue track. Disable and verify both private Main paths disappear immediately.

### Failure and recovery

- [ ] Disconnect OSC only; confirm writes freeze, audio does not reroute, and UI
      shows control degradation.
- [ ] Disconnect USB audio only; confirm immediate stop/block and no OS-default
      fallback.
- [ ] Break one performer assignment; confirm that output is silent while Main and
      other performers remain correct.
- [ ] Change reported channel capacity; confirm stale mappings become non-ready.
- [ ] Reconnect XR18; confirm old physical confirmations are gone and desk state is
      read before any armed diff is applied.
- [ ] Exit/re-enter Live and restart the app; confirm Practice and hardware arm are
      off and no stale song/test/cue source survives.

### Long playback

- [ ] Play multiple full songs and change songs while stopped and while playing;
      verify no old graph, cue, click, MIDI, repeat, or announcement survives.
- [ ] Exercise pause/resume, middle seek, restart, and section repeat; verify click,
      cue, MIDI, chords/grid, and audio remain on the canonical schedule.
- [ ] Confirm CPU/dropout behavior with maximum supported stems/cues/MIDI and all
      performer routes active.
- [ ] Have every performer confirm a route-specific test and an actual song mix;
      record confirmation only for the current session.

## Automated test boundaries

- Pure tests: parser/config validation, mapping conversions/collisions, schedule
  events, readiness selectors, reducers, generation/stale-result behavior.
- Browser/Web Audio tests: one-context ownership, graph activation, click/cue
  isolation, transport epochs, song replacement, cleanup, device-event projection.
- Sidecar tests: XAirSession connect/reconnect/timeout, serialized command/readback,
  generation handling, shutdown, and no writes while unarmed.
- Hardware manual tests: actual multichannel sink selection, USB channel-to-strip
  identity, desk sends/meters, analogue aux output, IEM audibility, dropout/load.

### Minimum critical acceptance suite

Before Live may be described as performance-ready, CI and hardware QA must prove:

1. **Source admission:** pure table tests cover original, every stem slot,
   generated MIDI/audio, machine, custom/ad-hoc stem, preview, orphan, stale, and
   migrated legacy source. Browser graph inspection proves excluded source IDs
   create no source, instrument, send, effect tap, or output edge.
2. **Mixer/source identity:** parser and validator tests prove every admitted
   `mixerChannelId` resolves to exactly one current-song `sourceId/stemId`, and
   every independently controlled stem resolves to a distinct rig source lane.
   Rename/order/filename/controller-slot changes preserve identity; missing,
   duplicate, stale, mismatched, and implicit-sum cases fail closed.
3. **Main isolation:** browser rendered-channel tests use spectrally distinct
   music/click/cue sentinels. With Practice off, Main contains music and zero
   private sentinel energy on both stereo-only and multichannel capability
   branches. No private route means silence/degradation, not fallback.
4. **Practice exception:** a fresh explicit command admits shared click and exactly
   one selected cue track to Main; disable, Live re-entry, reconnect, and app
   restart all remove those edges.
5. **Performer delivery:** a fake AudioDeviceAdapter plus fake XAirSession proves
   each scheduled private event's logical lane, Web channel, USB return, XR18
   strip, Main-off readback, intended bus send, and bus master share one config
   generation before readiness becomes `ready`.
6. **Performer isolation:** P1/P2 cue sentinels appear only on their own output;
   click appears on all intended performer buses; Main and other performers have
   zero cross-lane energy.
7. **Transition cleanup:** delayed old-song and Editor-preview completions after a
   Live/song generation change are disposed. Tests inspect node disconnect/stop,
   instrument disposal, send/effect removal, cue cancellation, and rendered
   silence from stale sentinels.
8. **Honest status:** assignment, OSC reply, configured send, aggregate bus meter,
   cached decode, or absence of error cannot independently produce green. Wrong
   hard-coded/default channel evidence is rejected.
9. **Real XR18 verification:** repeat the checklist above with click and a unique
   spoken cue for every performer, physically confirm each aux, and record zero
   click/cue on Main meters/PA throughout song changes and failure injection.
