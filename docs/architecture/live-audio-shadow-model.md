# Live Audio Shadow Model

**Status:** implemented contract-only shadow plus canonical current-state input
pipeline. Neither is production routing, readiness, or UI state.

## Owner And Boundary

[`audioConfigValidator.ts`](../../src/lib/audio/audioConfigValidator.ts) is the
single owner of Live source admission, desired-routing validation, collision
detection, and shadow readiness reasons. Its public calculation is
`validateAudioConfiguration(input)`.

[`liveAudioRoutingInput.ts`](../../src/lib/audio/liveAudioRoutingInput.ts) is the
single owner of constructing `LiveAudioShadowInput`. It captures the complete
current-song producer census, canonical source intents, mixer bindings,
generation ownership, direct asset availability, and the lossless raw project
routing DTO. UI components and runtime stores must not reconstruct this input.

The model is pure. It cannot open a device, create an audio node, access the
XR18, read or write storage, use a Svelte store, mutate UI, schedule sound, or
change the active runtime graph. No production route imports it. The optional
[`liveAudioShadowDiagnostics.ts`](../../src/lib/audio/liveAudioShadowDiagnostics.ts)
formatter/logger only projects a completed plan supplied by a caller.

The future `AudioRuntime` remains the owner of generation lifecycle, exact
source installation, graph activation, XR18 application, route acknowledgement,
and runtime readiness. A shadow plan is configuration evidence only.

## Inputs

`LiveAudioShadowInput` contains:

- one explicit `generationId`, project ID, and song ID on the snapshot and every
  candidate, intent, mixer channel, and installed-source record;
- the current performer roster with raw monitor-bus values;
- the current song's cue tracks and announcement events;
- an exhaustive candidate source manifest with stable IDs, producer kind,
  song/generation ownership, scope, explicit admission status, and availability;
- explicit per-source Live intents and monitor send gains;
- explicit `sourceId -> mixerChannelId -> channel processing -> rigSourceLaneId`
  bindings plus exact sum-group declarations;
- an explicit supported-producer policy;
- a versioned raw rig profile separating source-lane Web/USB/XR18-strip
  mappings from performer monitor-bus/physical-output mappings;
- current device capabilities and separate XR18 USB-audio/control facts;
- session-local Practice state and its one selected cue track.

Raw channel and assignment values are `unknown` at the validator boundary. The
validator checks them before use and includes malformed values in diagnostics;
it does not round, clamp, or silently substitute them.

`captureRawProjectRoutingDto()` selects the project ID, performer rows, and rig
profile without normalization. `deriveLiveAudioShadow()` is pure and consumes
that DTO alongside the current SongMap, generation, direct asset census, device
capabilities, and session Practice state. Existing `mixState` keys, labels,
filenames, ordering, mute/solo, and `liveSlot` are never read by this path.

## Outputs

`LiveAudioShadowPlan` deterministically returns:

- every admitted musical source, owning mixer channel, channel processing, rig
  lane, and explicit Main/performer destinations and send gains;
- every excluded candidate and one typed exclusion reason;
- validated source-lane Web Audio, USB return, and XR18 input-strip mappings;
- Main's allowed source set plus Practice-only click/cue/announcement edges;
- every performer logical output, XR18 bus, physical output, programme sources,
  click, owned cue tracks, owned announcements, and source lanes;
- separate cue and announcement content states and destinations;
- exhaustive typed configuration/source/output/Practice issues;
- Main and per-performer readiness reasons;
- a configuration disposition: `blocked`, `degraded`, `routable`, or
  `main-only`.

A valid desired route is reported as `initializing` with `configured` evidence.
This pure model always returns `runtimeActivationVerified: false` and
`physicallyConfirmed: false`. XR18 OSC connectivity is reported separately and
never upgrades either value.

## Fail-Closed Rules

- A musical source reaches Main only when its current-song candidate, explicit
  intent, supported kind, availability, programme lane, and Main policy all
  validate.
- Unassigned, orphaned, stale-song, editor-only, preview, test, unavailable,
  duplicate, and unknown sources are excluded. They do not receive a muted edge.
- Click, cues, and announcements have no Main destination unless Practice is on
  and exactly one existing, enabled, performer-owned cue track is selected.
- An empty selected Practice track adds click to Main but substitutes no cue or
  announcement content.
- A private lane configured on Main, or any Main/private Web/USB/XR18-strip
  collision, blocks Main and removes its planned source edges.
- An invalid performer route removes only that performer's private destinations.
  It never adds Main or changes another performer.
- Disabled and missing cue/announcement content remain distinct and silent.
- Every candidate and intent carries `songId`; stale records are excluded even
  when accidentally included in a new-song calculation. Candidate, intent,
  mixer channel, asset, and install records also carry `generationId`.
- Sharing a rig source lane is rejected unless every mixer channel names one
  exact sum group. Summed members must have identical Main and monitor-send
  policy because independent XR18 control no longer exists after the sum.
- `buildLiveSourceInstallManifest()` and `auditInstalledLiveSources()` define
  exact generation-owned expected/installed sets. Any prior-song, duplicate, or
  unplanned install is teardown work, never an implicit route.

## Responsibility For Known Failures

| Observed failure                            | Shadow prevention owner                                                          | Later enforcement owner                              |
| ------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Unassigned or stale sources sound in Live   | Validator exhaustive candidate classification and positive admission             | AudioRuntime/MixerEngine exact installed-set check   |
| Click, cues, or announcements reach Main    | Validator private-lane Main policy, collision checks, and explicit Practice gate | Graph executor and XR18 transaction                  |
| Performer monitor route is missing or wrong | Validator source-lane chain plus performer bus/physical-output validation        | AudioRuntime route acknowledgement and XR18 readback |
| XR18 control looks like audio readiness     | Validator evidence separation                                                    | AudioRuntime readiness reducer                       |
| Old-song state survives a switch            | Input owner generation-tags every record; validator rejects stale records; exact install audit marks prior entries for teardown | AudioRuntime generation cleanup |

## Example: Three Performers

For a valid XR18 profile with a stereo programme lane, one private click lane,
three private cue lanes, and buses 1-3 mapped to Aux 1-3, the relevant shadow
projection is:

```json
{
  "configurationDisposition": "routable",
  "main": {
    "sourceIds": ["stem:bass", "stem:drums"],
    "click": false,
    "cueTrackIds": [],
    "announcementTrackIds": [],
    "readiness": { "state": "initializing", "evidence": "configured" }
  },
  "performers": [
    {
      "performerId": "p1",
      "monitorBus": 1,
      "physicalOutputId": "xr18-aux-1",
      "click": true,
      "cueTrackIds": ["cue-p1"]
    },
    {
      "performerId": "p2",
      "monitorBus": 2,
      "physicalOutputId": "xr18-aux-2",
      "click": true,
      "cueTrackIds": ["cue-p2"]
    },
    {
      "performerId": "p3",
      "monitorBus": 3,
      "physicalOutputId": "xr18-aux-3",
      "click": true,
      "cueTrackIds": ["cue-p3"]
    }
  ],
  "xr18AudioRouteVerified": false
}
```

The `routable` disposition means the desired configuration validates. It does
not mean that the graph, desk, cables, packs, or human audibility are ready.

## Persisted Contract And Compatibility

SongMap v7 persists canonical `liveRouting`: stable source IDs, producer
references, explicit included/excluded intent, mixer ownership, Live channel
processing, rig source lane, monitor sends, and explicit sum groups. V1-v6 songs
migrate every persisted producer into stable records with `admission: excluded`
and no rig lane. The one-time stem compatibility ID may inspect its old stem ref,
but it cannot admit the stem; after save, identity is persisted.

Stem producers reference only stable `stemId`. Local
`liveStemRefs[stemId] -> relativePath` resolves the machine's asset and is
removed by `toCollabSongMap`; no path or legacy stem label participates in
identity or admission.

`ProjectFile.liveRig.routingProfile` persists the complete versioned lane and
monitor-output topology when configured. The raw DTO path, rather than the
defensive normalized project parser, is authoritative for shadow validation.

The supported persisted producer census currently covers original audio, every
stem ref, detected drums, drum machine, detected bass, and bass machine. Chord
machines, arp, keybed, chord-jam, preview, and test producers are explicitly
unsupported/editor-only until they gain canonical persisted producer state.

## Cutover Blockers

- No product UI/command yet reviews migrated excluded intents, creates stable
  stem mappings, or selects a canonical rig profile.
- The runtime does not consume the plan or compare its installed source IDs to
  `buildLiveSourceInstallManifest()`.
- Runtime generation cleanup, activation acknowledgements, XR18 transactions,
  and physical confirmation are later phases.
- The production-destination sentinel and full generation reducer remain Phase
  1 work.

Until those close, this result is for tests and opt-in diagnostics only.
