# BarBro Project Format v1 — Suggested Review Notes

This is a review of the proposed BarBro project/set layout. Claude has full project/codebase context, so treat these as architectural suggestions and questions rather than hard requirements.

## Overall verdict

The proposed direction looks sound:

- Keep `.smap` as the single-song source of truth.
- Add a set/project-level manifest for grouping songs.
- Keep the existing single-song flow working unchanged.
- Let the project file own setlist-level concerns such as order, hidden songs, project name, and future bulk export behavior.

The core split is good:

```txt
.smap = what the song is
project/set manifest = how songs are arranged and used together
```

I would still consider a few adjustments before implementation so the v1 design does not create awkward constraints later.

---

## 1. Avoid encoding setlist order into folder names

The current proposal uses folders like:

```txt
01-opener/
02-heavy-tune/
```

This is understandable and human-readable, but it may become confusing once reorder exists.

Example after reordering:

```txt
project.json order:
  1. 02-heavy-tune
  2. 01-opener

folders:
  01-opener/
  02-heavy-tune/
```

That is not technically broken, but it creates two competing representations of order.

Suggested principle:

> The canonical setlist order should live only in the project manifest.

Possible alternative folder layout:

```txt
MyTour2026/
├── barbro.project.json
├── songs/
│   ├── opener-a8f3/
│   │   └── song.smap
│   └── heavy-tune-91c2/
│       └── song.smap
└── exports/
```

The folder name can still be human-readable, but should not need to reflect set order.

If order prefixes are kept for v1, they should be treated as cosmetic only, not as source-of-truth ordering.

---

## 2. Add stable IDs to projects and project song entries

The current proposed entry is:

```ts
interface ProjectSongEntry {
  folder: string
  hidden?: boolean
}
```

This makes `folder` both the storage location and the identity of the song inside the set.

This works for v1, but a stable ID is likely safer:

```ts
interface ProjectFile {
  formatVersion: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
  songs: ProjectSongEntry[]
}

interface ProjectSongEntry {
  id: string
  folder: string
  hidden?: boolean
}
```

Reasons:

- Renaming or repairing folders becomes easier later.
- Future transitions/medleys can reference songs by ID instead of path.
- Cloud sync/backups become less ambiguous.
- Duplicate song titles become easier to handle.
- Internal state can distinguish identity from location.

Example future transition data:

```ts
transitions: [
  {
    fromSongId: "song_a8f3",
    toSongId: "song_91c2",
    type: "crossfade",
    bars: 4
  }
]
```

This is cleaner than referencing folder names.

---

## 3. Handle slug collisions explicitly

The proposal derives folder names from titles. This needs a clear collision policy.

Possible duplicate cases:

```txt
Intro
Intro
Valerie
Valerie
```

Suggested folder naming:

```txt
<slug>-<shortId>/
```

Examples:

```txt
intro-a8f3/
intro-b91c/
valerie-k7p9/
```

This keeps folders readable while making them unique.

Alternative:

```txt
valerie/
valerie-2/
valerie-3/
```

That also works, but unique IDs are more robust.

---

## 4. Consider putting songs under a `songs/` directory

Current proposal:

```txt
MyTour2026/
├── project.json
├── 01-opener/
└── 02-heavy-tune/
```

Suggested:

```txt
MyTour2026/
├── barbro.project.json
├── songs/
│   ├── opener-a8f3/
│   └── heavy-tune-91c2/
└── exports/
```

Benefits:

- Keeps the project root cleaner.
- Leaves room for future project-level files.
- Avoids mixing song folders with exports, backups, notes, or config.
- Makes it obvious which folders are managed song entities.

Possible future root:

```txt
MyTour2026/
├── barbro.project.json
├── songs/
├── exports/
├── backups/
├── set-notes/
└── assets/
```

---

## 5. Consider a more BarBro-specific manifest filename

`project.json` is fine technically, but generic. A BarBro-specific filename may be clearer and safer.

Possible names:

```txt
barbro.project.json
project.barbroset
MyTour2026.barbroset
```

`barbro.project.json` is probably the simplest if the file remains JSON.

Reasoning:

- Easier to identify as BarBro-owned.
- Reduces confusion if a user-selected folder already has some other `project.json`.
- Makes accidental folder selection easier to diagnose.

Not a blocker, just a product/design improvement.

---

## 6. Make pending project-song creation explicit

The proposal says:

> Create new → `goto('/?project=1')`. After analyze + first /edit save, the song is committed to the project.

This could be fragile because there is a temporary state where the user is in a project flow but the song is not yet in the project.

Potential failure cases:

- User analyzes a song then closes the browser before first save.
- User goes back to `/project`.
- User changes title before first save, affecting slug expectations.
- Autosave starts before the project entry exists.
- User opens another project/song during pending creation.
- Browser loses folder permissions mid-flow.

Suggestion: model this as an explicit pending state.

Example:

```ts
pendingSong: {
  mode: "create-new"
  tempId: string
  intendedPosition: number
}
```

Then have a dedicated commit function:

```ts
commitActiveSongToProject()
```

That function should handle the full transition:

1. Create song folder.
2. Write `.smap`.
3. Append entry to project manifest.
4. Set `activeSongFolder` / active song ID.
5. Clear pending state.

This seems safer than having generic autosave accidentally be responsible for first committing the song.

---

## 7. Guard project autosave carefully

The proposed autosave is:

> Subscribe to `songMap`; if `project.activeSongFolder` is non-null, debounce and write to disk.

This may be risky because `songMap` appears to be global. A stale `activeSongFolder` could cause the wrong currently loaded song to be saved into a project folder.

Potential dangerous case:

1. User opens a project song.
2. `activeSongFolder` is set.
3. User opens a standalone song.
4. `activeSongFolder` is not cleared correctly.
5. Standalone song autosaves into the previous project song folder.

Suggested lifecycle rules:

```ts
// Opening a standalone song
project.activeSongFolder = null

// Leaving project mode
project.activeSongFolder = null

// Opening a project song
project.activeSongFolder = folderOrId
songMap = loadedSmap
```

Autosave should possibly require more than:

```ts
activeSongFolder !== null
```

Maybe require something like:

```ts
project.mode === "editing-project-song"
```

or:

```ts
activeProject && activeSongFolder && currentRoute === "/edit"
```

Or use active song ID + route + folder handle verification.

This is one of the highest-risk parts because accidental disk writes are scary.

---

## 8. Clarify what `updatedAt` means

The proposal says:

> `project.json` is rewritten only on structural changes — not on every edit. `updatedAt` bumped at the same time.

This is fine if `updatedAt` means “manifest updated”.

But if the user expects “project updated” to include editing a song, then `updatedAt` should also change when a contained `.smap` changes.

Possible distinction:

```ts
interface ProjectFile {
  formatVersion: 1
  id: string
  name: string
  createdAt: string
  manifestUpdatedAt: string
  contentUpdatedAt: string
  songs: ProjectSongEntry[]
}
```

This may be overkill for v1, but the meaning of `updatedAt` should be explicit.

---

## 9. Deletion semantics should be named carefully

The proposal says:

> If folder removal fails, leave it on disk and show a warning; project.json entry still goes away.

That is acceptable, but it means the action may create orphan folders.

Maybe the UI action should be conceptually:

```txt
Remove from project
```

rather than:

```txt
Delete song
```

Then best-effort disk deletion can still happen, but the user-facing concept is less misleading.

Possible behavior:

- If folder deletion succeeds: remove manifest entry and delete files.
- If folder deletion fails: remove manifest entry, warn that files remain.
- Or ask: “Remove from project only?”

For v1, the proposed approach is probably okay, but naming matters.

---

## 10. Good parts worth keeping

These parts of the proposal seem especially good:

### Keep `.smap` as the metadata source of truth

Do not duplicate title, artist, key, or BPM into the project manifest unless there is a strong reason.

The proposed in-memory cache for list rendering is good. A persisted cache can always be added later if list loading becomes slow.

### Hidden songs remain in the project

This is a clean distinction:

```txt
hidden = part of project, excluded from export
deleted/removed = no longer part of project
```

The `getExportableSongs(project)` helper is a good idea. Future export loops should use that rather than manually filtering.

### Existing single-song flow remains unchanged

This is important. Project/set support should be added as a parallel flow, not by forcing every `.smap` into a project.

---

## Suggested adjusted v1 shape

Possible schema:

```ts
interface ProjectFile {
  formatVersion: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
  songs: ProjectSongEntry[]
}

interface ProjectSongEntry {
  id: string
  folder: string
  hidden?: boolean
}
```

Possible disk layout:

```txt
MyTour2026/
├── barbro.project.json
├── songs/
│   ├── opener-a8f3/
│   │   ├── song.smap
│   │   ├── song.als
│   │   ├── stems/
│   │   └── Ableton Project Info/
│   └── heavy-tune-91c2/
│       ├── song.smap
│       ├── song.als
│       ├── stems/
│       └── Ableton Project Info/
└── exports/
```

Possible manifest:

```json
{
  "formatVersion": 1,
  "id": "proj_abc123",
  "name": "My Tour 2026",
  "createdAt": "2026-05-10T13:00:00.000Z",
  "updatedAt": "2026-05-10T13:00:00.000Z",
  "songs": [
    {
      "id": "song_a8f3",
      "folder": "songs/opener-a8f3"
    },
    {
      "id": "song_91c2",
      "folder": "songs/heavy-tune-91c2",
      "hidden": true
    }
  ]
}
```

---

## Main suggested changes before implementation

The proposal is architecturally good. The main changes I would consider are:

1. Do not encode order into folder names, or treat it as cosmetic only.
2. Add stable `id`s for project and project song entries.
3. Put song folders under `songs/`.
4. Use a BarBro-specific manifest filename such as `barbro.project.json`.
5. Make pending project-song creation explicit.
6. Guard autosave so stale project state cannot overwrite the wrong `.smap`.
7. Define slug collision handling.
8. Clarify the meaning of `updatedAt`.
9. Consider “Remove from project” wording instead of “Delete song”.

None of these reject the proposal. They are mostly small design hardening changes to avoid pain later.

---

## Response (Claude)

Reviewed all nine points. Adopting most of them; pushing back on a couple of details. The plan file at `~/.claude/plans/ok-next-up-is-iridescent-hummingbird.md` has been rewritten to reflect the changes.

### Adopted as-is

**1. Drop order prefix from folder names.** The manifest is now the single source of truth for setlist order. Folder names are pure `slug-<idPrefix>`.

**2. Stable IDs on project and song entries.** Added `id: string` to both `ProjectFile` and `ProjectSongEntry`, generated via `crypto.randomUUID()` (no new deps). The folder rename argument and duplicate-title argument were enough on their own — I'm not relying on cloud-sync as a justification because no cloud-sync code exists yet.

**3. Slug collision handling.** Resolved by IDs: folder name = `<slug(title)>-<id.slice(0, 4)>`. Unique by construction; no `-2` / `-3` retry loop needed.

**4. `songs/` subdirectory.** Adopted. Project root stays clean and leaves room for `exports/`, `backups/`, etc. The manifest stores the full relative path (e.g. `"songs/opener-7f3a"`) so a future flat layout would still parse cleanly.

**5. `barbro.project.json` filename.** Adopted. Easy to detect, no risk of colliding with another tool's generic `project.json`.

**6. Explicit pending-song creation.** Adopted with one simplification: there is no persistent `pendingSong` record. The `?project=1` URL param is the only "pending" signal, and it lives only in URL state. The commit point is the `/analyzing` → `/edit` transition: after analysis succeeds, `commitNewSongToProject()` runs atomically (generate id → compute folder → create directory handle → write `song.smap` → append to manifest → set `activeSongFolder` + `editingMode`). If the user closes the browser before analysis finishes, nothing was written and there are no orphans to clean up. This avoids the autosave-accidentally-creates-the-song failure mode you flagged.

**7. Autosave guards.** Adopted, hardened. Autosave fires only when ALL of these hold: project is open, `activeSongFolder !== null`, `editingMode === 'project-song'`, current route is `/edit`, and a fresh `queryPermission` check on the project's folder handle returns `granted`. Plus explicit lifecycle rules: opening a standalone song clears `activeSongFolder` and sets `editingMode = 'standalone'`; "Cancel" from `?project=1` clears both; closing the project clears everything. The cross-write scenario you described (standalone song writing into the previous project song folder) is structurally impossible under these rules.

**8. `updatedAt` semantics.** Clarified in the plan: it tracks manifest-level changes only (add / delete / hide / reorder / rename project name). Song-content edits do NOT bump it — those are already timestamped inside each `.smap`'s own `metadata.updatedAt`, which is enough to compute "newest song edit" later if needed.

**9. "Remove from project" wording.** Adopted. The row action is labeled **Remove**. The confirm dialog has a checkbox "Also delete files from disk" (default OFF). Default behavior removes the manifest entry and leaves files alone; with the checkbox, a best-effort `removeEntry({recursive: true})` runs. Either way the manifest entry is gone, and the user-facing concept matches what's actually happening.

### Pushed back / scoped down

**Dual `manifestUpdatedAt` / `contentUpdatedAt` (point 8).** Overkill for v1. Kept a single `updatedAt` with the explicit definition above; per-song edit times already live in each `.smap`.

**Cloud-sync as motivation for IDs (point 2).** Accepted IDs, but on the strength of folder-rename + duplicate-title arguments alone. Cloud-sync may or may not use these IDs depending on what shape it eventually takes — not letting that drive v1 design.

### Other adjustments triggered by the review

- **Constant filename per song folder.** Each song folder contains `song.smap` and (eventually) `song.als` — fixed filenames, not derived from title. Folder rename and title rename both become trivial because no file references depend on the title.
- **Manifest stores full relative path from project root** (e.g. `"songs/opener-7f3a"`), not just the leaf name. More explicit, future-proof.
- **New helper `readSmapJsonOnly(file)`** in `smapFile.ts`. Reads only the header + JSON chunk so the project list view can load metadata for many songs without pulling audio bytes off disk. (Also useful as a building block for the cloud-import case.)

The plan file's verification section now includes explicit autosave-guard tests (wrong route, standalone song while project open) so the autosave-foot-gun concern is verified end-to-end, not just by inspection.

