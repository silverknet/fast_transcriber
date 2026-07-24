# Audio / project modes — the definitive state model

There is **one** signal for a project's mode: `project.osPath`.
- `osPath !== null` → **disk project** (a local folder, managed via the desktop
  sidecar). Audio = the local **HD master**.
- `osPath === null && data !== null` → **browser-cloud project** (no local folder;
  it came from the cloud). Audio = the compressed **cloud** copy.

The desktop sidecar (`desktopCompanionStatus.reachable`) is a **capability** flag
(can we analyze / read local files) — it is NOT the same as "which audio am I
hearing". Conflating the two is what produced the "it says Studio but plays cloud"
confusion. The honest per-project answer is the `audioMode` store
([`src/lib/stores/appMode.ts`](../src/lib/stores/appMode.ts)), which drives the
navbar badge and its click action.

## The 7 states (`audioMode.kind`)

| kind | when | audio | badge (tone) | click does |
|---|---|---|---|---|
| `no-project` | nothing open | — | "Studio"/"Collab" (info) | desktop-app page |
| `studio-hd` | disk project · sidecar up · audio loaded | **local HD** | "HD · local" (ok) | — |
| `studio-relink` | disk project · sidecar up · local file missing | none | "HD · relink" (warn) | — (relink banner in editor) |
| `offline-disk` | disk project · **sidecar down** | none (can't read disk) | "Offline" (warn) | desktop-app page |
| `collab` | browser-cloud · **no local copy** of it here | cloud | "Cloud audio" (info) | project hub (open from disk) |
| `collab-switchable` | browser-cloud · sidecar up · **a local HD copy exists here** | cloud (but HD available!) | "Cloud → HD" (warn, red pulse) | **switch to the local copy → HD** |
| `collab-no-audio` | browser-cloud · cloud audio couldn't load | none | "Cloud · no audio" (error) | project hub (open from disk) |

Every state carries a plain-language `detail` string (the tooltip) explaining the
"why", so the badge is self-explanatory.

## How the app knows a local copy exists (`collab-switchable`)

A project can live BOTH in the cloud and on disk here. The map
`cloudProjectId → local folder` lives in
[`src/lib/stores/cloudDiskPaths.ts`](../src/lib/stores/cloudDiskPaths.ts)
(reactive + persisted). It's populated two ways:
1. Opening a cloud-linked project from disk (`rememberCloudProjectDiskPath`).
2. The startup **recents scan** (`indexRecentCloudProjects`, run from
   `+layout.svelte` when the sidecar is up) — reads each recent project's manifest
   and records its cloud id → folder. This is what lets the badge proactively say
   "you have a local HD copy — switch" the moment you launch, without you having
   to open it from disk first.

## Mode selection on reload (un-stranding)

`chooseRestoreMode` ([`src/lib/project/restoreMode.ts`](../src/lib/project/restoreMode.ts))
**prefers disk** whenever the sidecar is up and a local copy exists — so a project
opened once in browser mode doesn't stay stranded on compressed cloud audio after
the sidecar comes back. The recents scan (above) runs before the arbiter, so it
knows about the disk copy on the first reload.

## The fidelity failsafe (never play lossy when HD is available)

`resolveAudioSource` refuses the cloud copy ONLY for a **disk project**
(`localProjectPresent`) with the sidecar up — a browser-cloud song has no local
master to protect, so its cloud copy is allowed even while the sidecar runs.
(This is the deadlock that used to leave browser-cloud + sidecar-on with no
audio; see `resolveAudioSource.test.ts`.)

## Tests

`appMode.test.ts` (every `audioMode` state), `restoreMode.test.ts` (arbiter),
`resolveAudioSource.test.ts` (failsafe matrix), `loadCloudSongIntoEditor.test.ts`
+ `loadProjectSongIntoEditor.test.ts` (the two song-open loaders). **Gap:** no
integration test with a real sidecar + disk folder yet (live mode transitions).
