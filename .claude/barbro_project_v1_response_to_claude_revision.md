# BarBro Project Format v1 — Response to Claude's Revision

This is a response to Claude's updated plan after reviewing the first round of suggestions.

## Overall reaction

This revised design looks much stronger. The main architectural concerns from the earlier review are addressed:

- `.smap` remains the single-song source of truth.
- The manifest is now clearly the source of truth for setlist order.
- Project and song entries have stable IDs.
- Songs live under `songs/`.
- The project manifest has a BarBro-specific filename.
- Autosave is guarded much more carefully.
- Song creation is no longer accidentally driven by generic autosave.
- Deletion/removal semantics are clearer and safer.

The current direction seems good enough to implement as v1, with a few final edge cases worth checking.

---

## 1. Consider using a longer folder ID suffix than 4 characters

The revised plan uses:

```ts
folder = `${slug(title)}-${id.slice(0, 4)}`
```

This is probably fine for small sets, especially because the slug is also part of the folder name. But 4 hex characters is only 65,536 possible suffixes.

A collision is only likely to matter when the same slug appears multiple times, but duplicate names like these are plausible:

```txt
Intro
Intro
Interlude
Interlude
Encore
Encore
```

Suggested safer version:

```ts
folder = `${slug(title)}-${id.slice(0, 8)}`
```

or:

```ts
folder = `${slug(title)}-${shortId}`
```

where `shortId` is 8–10 characters.

Also worth adding a defensive retry/check anyway:

```ts
if folder already exists:
  generate a new id / suffix and try again
```

Even if the probability is tiny, the File System Access API can still encounter existing folders from previous failed runs or manual user edits.

Recommendation: use at least 8 chars and still check existence.

---

## 2. `?project=1` as pending signal is okay, but guard stale URL cases

Using `?project=1` as the pending signal is a good simplification for v1.

But the code should explicitly handle cases where the URL says project mode but the project context is missing or stale.

Examples:

- User opens `/?project=1` directly in a fresh browser session.
- User reloads during the import/analyze flow.
- Active project folder permission was lost.
- `barbro.project.json` is missing or invalid.
- The remembered `barbro::activeProject` handle points to a folder that no longer exists.
- User has a project open in memory, but then switches/open another project before the analyze flow completes.

Suggested rule:

```txt
?project=1 is only valid if there is exactly one active, permission-granted project context.
```

If not, show a clear error or route back to `/project` / `/`.

This avoids the URL param becoming an implicit global mode with insufficient context.

---

## 3. Commit point after analysis is good, but define cancellation semantics

Claude's updated flow says:

> The commit point is the `/analyzing` → `/edit` transition: after analysis succeeds, `commitNewSongToProject()` runs atomically.

This is much better than autosave committing the song.

One behavioral question remains:

What if the user analyzes a song, the project entry is created, then the user immediately decides they do not want the song?

That is probably fine — they can remove it from the project. But it means the song becomes part of the project before the user has reviewed or edited it.

Possible v1 behavior:

```txt
Analyze succeeds → song is committed to project → user lands in /edit.
If they regret it, they use Remove from project.
```

That is acceptable. Just make sure this is intentional.

Alternative, probably not necessary for v1:

```txt
Analyze succeeds → user lands in /edit as pending → first explicit Save/Add commits.
```

But that adds more state complexity. The current commit-after-analysis design is probably the better v1 tradeoff, as long as the UX makes it easy to remove the newly added song.

---

## 4. "Atomic" commit should be defined as best-effort with rollback/repair

This sequence is described as atomic:

1. Generate id.
2. Compute folder.
3. Create directory handle.
4. Write `song.smap`.
5. Append to manifest.
6. Set `activeSongFolder` + `editingMode`.

On the local filesystem, this is not truly atomic. Failures can happen mid-sequence.

Potential partial states:

- Folder created but `.smap` write fails.
- `.smap` written but manifest update fails.
- Manifest updated but store state update fails.
- Manifest write succeeds but metadata cache update fails.
- Permission is lost between folder creation and write.

This does not need a huge transaction system, but it should have a simple failure strategy.

Suggested order:

```txt
1. Create folder.
2. Write song.smap.
3. Read/validate written song.smap if cheap.
4. Write manifest with new entry.
5. Only then update in-memory project state.
```

If failure occurs before manifest write:

```txt
Do not add to manifest.
Optionally best-effort delete the created folder.
Show error.
```

If failure occurs after manifest write:

```txt
Treat the song as added.
Reload project from disk or repair in-memory state from manifest.
```

The important thing is to avoid a manifest entry pointing to a missing/invalid `.smap`.

---

## 5. Fixed filenames `song.smap` and `song.als` are good

This is a good improvement.

Using fixed filenames inside each song folder avoids a lot of downstream pain:

```txt
songs/opener-7f3a/song.smap
songs/opener-7f3a/song.als
```

Benefits:

- Title changes do not affect filenames.
- Folder names can be repaired/renamed later.
- Existing `.als` references are less likely to break.
- All project songs have predictable internal paths.

I strongly prefer this over title-derived `.smap` filenames.

---

## 6. Manifest stores full relative path: good, but normalize path format

Storing:

```json
"folder": "songs/opener-7f3a"
```

is better than storing only:

```json
"folder": "opener-7f3a"
```

One thing to enforce:

```txt
Always use forward slashes in manifest paths, even on Windows.
```

And reject suspicious paths:

```txt
../outside
/something-absolute
songs/../../escape
```

Suggested validation:

- Must be a relative path.
- Must not contain `..`.
- Must not start with `/`.
- Must use normalized `/` separators.
- For v1, maybe require it to start with `songs/`.

This matters because manifest paths eventually drive filesystem writes.

---

## 7. Autosave guard sounds good; add one more invariant if possible

The revised autosave guards are strong:

- project is open
- `activeSongFolder !== null`
- `editingMode === 'project-song'`
- current route is `/edit`
- fresh `queryPermission` returns `granted`

That probably solves the dangerous cross-write case.

One extra invariant worth considering:

```txt
The loaded songMap should correspond to the active project song.
```

This could be done by storing the active project song ID somewhere in the loaded edit session:

```ts
activeSongId: string | null
```

Then autosave writes only if:

```ts
editingMode === "project-song"
activeSongId === project.activeSongId
activeSongFolder === entry.folder for activeSongId
```

If `.smap` itself has no project song ID, that is okay. This can be session state only.

The goal is to avoid relying only on route + folder state if `songMap` is global.

---

## 8. Manifest `updatedAt` definition is acceptable

Claude's clarification is good:

> `updatedAt` tracks manifest-level changes only.

That is fine for v1.

The only suggestion is to document that explicitly in the type comment:

```ts
/**
 * Last time the project manifest changed:
 * project rename, add/remove song, hide/unhide, reorder.
 * Does not update when individual song.smap files are edited.
 */
updatedAt: string
```

This avoids future confusion.

---

## 9. Remove behavior with checkbox is good

This revised behavior is better than the original:

```txt
Remove from project
[ ] Also delete files from disk
```

Default OFF is the safer choice.

This gives users a non-destructive action by default, while still allowing cleanup.

One wording suggestion:

```txt
Remove from project
This removes the song from the setlist. The song files will stay on disk unless you choose to delete them.
[ ] Also delete this song's files from disk
```

This makes the distinction clear.

---

## 10. `readSmapJsonOnly(file)` is a good addition

This is useful beyond the project list view.

Potential uses:

- Project list metadata.
- Import validation.
- Cloud-copy/import preview.
- Future batch operations.
- Detecting corrupt `.smap` files without loading audio.

Worth making it strict and well-tested, since it becomes a common fast-path parser.

Suggested behavior:

- Validate magic/header.
- Validate JSON length.
- Reject impossible/huge JSON length.
- Return parsed project/song JSON chunk only.
- Do not read audio bytes.

---

## 11. Suggested final v1 shape

The revised shape seems strong:

```txt
MyTour2026/
├── barbro.project.json
├── songs/
│   ├── opener-7f3a9c2d/
│   │   ├── song.smap
│   │   ├── song.als
│   │   ├── stems/
│   │   └── Ableton Project Info/
│   └── heavy-tune-91c2ab8f/
│       ├── song.smap
│       ├── song.als
│       ├── stems/
│       └── Ableton Project Info/
└── exports/
```

Suggested schema:

```ts
interface ProjectFile {
  formatVersion: 1
  id: string
  name: string
  createdAt: string
  /**
   * Manifest-level update time only.
   * Bumped on project rename, add/remove song, hide/unhide, reorder.
   * Not bumped when individual song.smap files are edited.
   */
  updatedAt: string
  songs: ProjectSongEntry[]
}

interface ProjectSongEntry {
  id: string
  /**
   * Normalized relative path from project root.
   * Example: "songs/opener-7f3a9c2d"
   */
  folder: string
  hidden?: boolean
}
```

---

## Final verdict

Claude's revision addresses the important architectural problems.

I would proceed with this design, with these final hardening changes:

1. Use a longer folder ID suffix than 4 characters, preferably 8+.
2. Validate stale `?project=1` cases.
3. Define commit failure/rollback behavior.
4. Normalize and validate manifest folder paths.
5. Optionally track `activeSongId` in edit session state in addition to `activeSongFolder`.
6. Document that `updatedAt` is manifest-only.
7. Keep Remove-from-project non-destructive by default.

No major objection remains. This is a good v1 foundation.
