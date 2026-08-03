# Offline mode — running BarBro with no internet, and no login

**Status:** P1–P4 built, unit-tested, and verified against a real
`adapter-node` build. The dress rehearsal (P5) is outstanding — and it is the
only one that counts.

**Why:** BarBro is a server-rendered web app behind Supabase auth. At a venue
there is often no usable network, and a redirect to `/welcome` between songs is
a show-stopper.

---

## One app, two modes — read this first

**BarBro Desktop is a sidecar.** It is what people download from barbro.app so
the website can analyse, split stems and reach their local files. It **always
starts as one**, every launch, packaged or not.

Since the offline work it can also serve the app to itself. That is a **mode you
switch into**, from a small status window, and never something the app decides
for you:

```
┌──────────────────────────────────┐
│  BarBro Desktop            v0.1.7│
│                                  │
│  ● Sidecar ready                 │   always on, from launch
│    Listening on 127.0.0.1:47842  │
│                                  │
│  ○ Offline app          [ Open ] │   off until you click
│    Play a set with no internet.  │
└──────────────────────────────────┘
```

Two rules this rests on, both tested:

1. **Nothing infers the mode.** It once decided by "does a `build-node/` exist
   on disk", which is not a decision — it is an accident of the working tree.
   Building the bundle once for a gig silently turned every later `npm run dev
   --prefix desktop` into a windowed app. Now only `BARBRO_OFFLINE_UI=1` (set by
   `npm run offline:desktop`) auto-opens it; everything else is the click.
2. **The sidecar outlives its windows.** Electron quits when the last window
   closes; that default is handled and does nothing here. Closing the status
   window while someone is mid-session on barbro.app must not pull the endpoints
   out from under them. Quitting is explicit — Cmd+Q / dock menu on macOS, tray
   on Windows. macOS `activate` and the Windows tray both bring the window back.

The web bundle adds **~25 MB** to the download. It was 134 MB until
`prepare-offline-bundle.mjs` started pruning `client/releases` — SvelteKit
copies `static/` verbatim into every client build, and `static/releases` holds
the previous DMG, so the app was shipping a 109 MB copy of an older version of
itself (a 241 MB DMG). `UNSHIPPABLE_CLIENT_PATHS` is that list; `static/bass`
and `static/drums` are deliberately NOT on it, because the machines need them
to make sound at a venue.

---

## The one-paragraph version

The offline desktop build **has no login, because it has no cloud**. Auth exists
to protect cloud resources; a client that cannot reach the cloud has nothing to
protect, so requiring a sign-in there protects nothing while adding three ways
to fail at load-in. Edits made offline are saved to disk exactly as they are
online, a small marker file records that a session happened, and when you open
the project in the browser again BarBro offers those edits for sync.

---

## Why not a cached cloud session

An earlier design kept a *previously verified* session alive offline: a
credential written after a successful online check, an expiry, and a timeout
raced against the auth call. It worked. It also died on a constraint that cannot
be engineered away — **Google refuses OAuth inside an app window**, so the
desktop client can never sign in in the first place.

That design is gone: `src/lib/server/gigMode.ts`, `/api/gig-status`, the
credential file, the expiry and the timeouts. What was kept from that pass is
everything that was actually about running offline: the `adapter-node` build,
serving it from the sidecar, the route boundary, the bundler, the pre-flight and
the readiness check.

---

## Source of truth, precisely

**The cloud owns shared song content** — chords, sections, lyrics, timeline,
metadata: everything `collabContentFingerprint()` hashes
(`src/lib/songmap/collab.ts`). The local project is a **checkout at a known
revision**, never a fork.

**The local disk owns performance state** — `mixState`, `stemRefs`,
`sectionBorderHints`, `chordHints`, `renderExport.relativePath` (the
`LOCAL_ONLY_TOP_LEVEL` set), plus the personal transpose overlay in
localStorage. **None of it syncs, offline or online.**

That split answers "isn't the offline laptop its own source of truth?": for the
things you actually touch at a gig — faders, machines, transpose — it already
is, and always has been. Only shared musical content needs reconciling, and
**an offline laptop is just a collaborator that has not synced yet**. No new
concept, and no new conflict machinery.

---

## The guarantee is capability, not permission

The offline build ships **no `PUBLIC_SUPABASE_*` values at all**.

- `prepareOfflineEnv()` in `desktop/electron/offlineUi.mjs` **deletes** them
  from `process.env`, so a source checkout with a fully-configured `.env`
  behaves identically to a packaged app. One behaviour, not two.
- `scripts/prepare-offline-bundle.mjs` removes any stale `build-node/.env` and
  **refuses to stage** if a secret — or that Supabase pair — appears anywhere in
  the built output, matched **by value** so a renamed variable cannot slip past.
- `getSupabaseBrowserClient()` throws without them; the server takes its
  unconfigured branch.

There is no client to construct, so nothing can present a sign-in. Given that, a
synthetic local user is safe: the only resource reachable is the project folder
on your own machine, over loopback.

`hooks.server.ts` checks `isOfflineBuild()` **before** the env check, on
purpose — the offline client is defined by what it is, not by what it happened
to inherit from a shell.

Cloud-only routes (`/login`, `/welcome`, `/pending`, `/auth/*`, `/account`,
`/admin/*`) redirect to `/`; `/api/cloud/*` and `/api/admin/*` answer `503` with
a sentence. Both immediate — nothing waits on DNS.

---

## The user flow

**Before the gig — in the browser, online.** Open the project → **Prepare for
offline** on `/rig`. It walks every song, reads its `.smap` from disk, and asks
the sidecar whether each referenced file is really there. When the set checks
out it writes `offline-session.json` recording the cloud revision each song sits
at right now.

Three deliberate choices in the check:

- **The bar is PLAYABLE, not perfect.** A song plays from either the original
  file or stems. Clicks, cue speech and the generated band are rendered locally,
  so their absence is a note, not a blocker. What cannot be conjured is audio —
  a song with none is silent on stage.
- **A ranged read, not a download.** Each check asks for the FIRST BYTE only. A
  zero-length file fails, which is what we want: a truncated stem from an
  interrupted sync reads as present and plays as silence.
- **Blockers first**, with exact missing paths. A worklist, not a status display.

**At the gig — offline, desktop app.** Launch BarBro Desktop. The status window
says *Sidecar ready*; click **Open** next to *Offline app* and the full editor
comes up in its own window — no sign-in, no network. Edits save to disk on the
usual 1.5 s debounce, and each song is recorded in the marker the first time it
is saved. The sidecar keeps running the whole time, so the machines, stems and
file access all work exactly as they do online.

**After the gig — browser, online.** Opening the project runs
`checkForOfflineChanges()`. Songs the marker touched are re-read from disk and
hashed; only the ones that really differ are shown. You choose per song, then
they are pushed **one at a time** through the existing `pushCloudSong` →
409 → fast-forward / retry / dangerous-conflict path. The marker clears only
when every song has landed.

---

## Why the working copy, not a separate package

Considered and rejected:

1. **The sync watermarks live in the project manifest.** `lastSyncedRevision`
   and `lastSyncedContentHash` are per-song fields in `barbro.project.json`. A
   second package means a second set of watermarks for the same songs, and
   reconciling watermark bookkeeping is exactly where the last data-loss bug
   lived (migration 017).
2. **It creates a three-way problem.** Cloud ↔ working copy ↔ package. Edit the
   working copy while the package is out and both have diverged from cloud.
3. **The existing hydration pack cannot do it** — audio + stems only, no
   `.smap`, no manifest, and its import cannot create songs. New code either
   way, so "easier" does not hold.
4. **Disk.** A set with stems is many GB.

Clarity comes from the marker instead: the app *says* "3 songs changed offline",
which is more explicit than a folder in Finder.

---

## The marker

`offline-session.json`, at the project root:

```json
{
  "version": 1,
  "startedAt": "2026-08-01T18:00:00.000Z",
  "baseRevisions": { "<songId>": 4 },
  "touchedSongIds": ["<songId>"]
}
```

It is **not a queue and not a diff**. It records which songs were saved and what
revision they were at when the session began — enough to know where to look.
Whether a song actually differs is decided at reconcile time by hashing, because
a song can be touched and end up identical (open, play, undo), and a dialog that
cries wolf is a dialog people dismiss unread.

Rules are pure in `src/lib/project/offlineSession.ts`; disk I/O is
`src/lib/client/offlineSessionIo.ts`, over two sidecar endpoints added for it:
`GET /native/project/asset/read` and `POST /native/project/asset/remove` (the
root-level twins of the existing root write).

Merging matters: prepare twice without reconciling in between and touched songs
**accumulate**, while the **earlier** base revision is kept. The earlier one is
the last revision known to match the cloud; re-basing to a revision the cloud
never saw would make a genuine conflict look like a clean fast-forward.

---

## Reconcile

`src/lib/client/offlineReconcile.ts`.

- **Reads from DISK**, not the store — only one song is loaded at a time and the
  whole point is the ones you are not looking at.
- **Never synced counts as changed.** No hash means no evidence the cloud has
  the song at all.
- **Base revision** is the lower of the song's watermark and the session's
  recorded base. Overstating it claims to have seen a cloud edit the laptop
  never had, and the other side's work is silently replaced.
- **Sequential.** The project revision counter is shared across songs, so
  concurrent pushes guarantee a 409 for no gain. It also means an interrupted
  run leaves honest watermarks — songs that landed are marked synced, the rest
  stay listed.
- **A 409 whose remote content hashes the same is not a conflict** — the
  revision moved without the content moving. Adopt and move on.
- **Dangerous conflicts are handed to `ConflictResolutionDialog`**, unchanged.
  Reconciling a gig's worth of edits is the wrong moment to be clever.

This also fills a real gap: there is **no persistent offline queue** anywhere
else in the app. The `online` listener in `projectAutosave` re-pushes only the
*currently active* song, so anything edited and navigated away from was never
coming back on its own.

---

## Served from the desktop app

```bash
npm run dev --prefix desktop   # sidecar + status window. Offline mode is a click away.
npm run offline:desktop        # build the bundle and go straight into offline mode
```

The SvelteKit handler is mounted ON DEMAND, on the sidecar's EXISTING loopback
server, so the app and the API share one port:

| Request | Answered by |
|---|---|
| `/ping`, `/native/**` | the sidecar |
| everything else | the bundled app |

That boundary is `isSidecarRoute()` in `desktop/electron/offlineUi.mjs`, kept
narrow on purpose and tested in both directions — claiming a prefix the sidecar
does not serve would 404 part of the app and look like a SvelteKit routing bug.
A drift guard scrapes `main.mjs` for the routes it really answers and fails if
the summary falls behind.

**One origin is a feature, not tidiness.** The hardware endpoints check `Origin`
before touching the XR18, and Safari blocks a public HTTPS page from reaching
loopback as mixed content at all. Same-origin removes both problems.

**Degrades safely.** A build with no bundle disables the toggle and says so; a
failure to mount is caught, shown in the status window, and leaves the sidecar
running. Somebody may be mid-render on the website when they click.

**The status window talks over IPC, not HTTP.** `statusPreload.cjs` bridges it
with `contextIsolation` on. Deliberately not an endpoint on the loopback server:
that server is reachable by any page in any browser on the machine, and "open a
window" is not something a website should be able to make the sidecar do.

---

## Building for a show

```bash
npm run build:offline     # adapter-node build + stage (no env file, leak scan)
npm run offline:preflight # everything checkable without a venue
npm run offline:dist-mac  # build, then package the DMG
```

`build:offline` always re-stages, because a bare `vite build` regenerates
`build-node/` — the two steps are inseparable on purpose.

`electron-builder.yml` ships `build-node` via `extraResources` (not `files`) so
it lands beside the asar rather than inside it, which is where
`resolveOfflineBuildDir()` looks first, and excludes `.env` as belt and braces.

### What the pre-flight actually checks

Run against a real build with a **hostile** environment — an unroutable auth
host *and* a configured-looking `PUBLIC_SUPABASE_*` pair, i.e. the source-
checkout case:

- the build exists, and ships no env file;
- no secret or cloud-config **value** from the repo `.env` appears anywhere in
  it (6 values checked at time of writing);
- `/`, `/rig`, `/edit`, `/project`, `/project/playback` all load **with no
  cookie at all**, and none of them lands on a sign-in page;
- nothing takes more than 5 s (unbounded, an offline load once took 25 s);
- `/api/cloud/projects` returns `503` in ~1 ms with a readable sentence.

That last set discriminates: running the SAME bundle without `BARBRO_OFFLINE=1`
sends `/rig` and `/edit` to `/welcome`, which is the failure the flag removes.

---

## Guarantees, and where they are asserted

| Guarantee | Where |
|---|---|
| The flag is opt-in and needs exactly `"1"` — Netlify is untouched | `offlineMode.test.ts` |
| Cloud config is REMOVED from the environment, not merely ignored | `offlineUi.test.mjs` |
| No secret or Supabase value can ship inside the `.app` | `prepareOfflineBundle.test.mjs` |
| Cloud-only routes redirect; lookalike prefixes do not | `offlineMode.test.ts` |
| A corrupt marker degrades to "no session" rather than blocking the app | `offlineSession.test.ts` |
| Two gigs without a reconcile do not erase the first night | `offlineSession.test.ts` |
| Never-synced counts as changed | `offlineReconcile.test.ts` |
| The base revision cannot be overstated | `offlineReconcile.test.ts` |
| Nothing infers offline mode — not packaging, not a build on disk | `offlineUi.test.mjs` |
| Closing a window never quits the app (source-scraped, comments stripped) | `offlineUi.test.mjs` |
| The app never ships a copy of itself; sample assets survive the prune | `prepareOfflineBundle.test.mjs` |
| The sidecar/app route boundary matches the real dispatcher | `offlineUi.test.mjs` |

---

## XR18 origin gating

The hardware endpoints refuse cross-origin callers, so a random web page cannot
move the faders mid-show. The offline build serves the app from
`127.0.0.1:47842` — the sidecar's own origin — so it is allowed by the same rule
that blocks everyone else. `desktop/electron/hardwareOrigin.test.mjs` pins both
directions.

---

## Still required

None of the above proves a show will work:

1. In the browser, open the project and run **Prepare for offline**.
2. Clear every blocker it lists.
3. **Turn Wi-Fi off**, open the desktop app, and play the set end to end.
4. Reconnect, reopen the project in the browser, and reconcile.
