# Collaborative Sync Architecture

Target design for multi-user song editing. **This describes where we are going,
not where we are.** Phase 1 is the current work; everything from Phase 2 on is
unbuilt. Check the phase table before assuming a piece exists.

Companion docs: [`cloud-auth-sync.md`](cloud-auth-sync.md) (auth, invites, the
current sync engine) and [`../smap-format.md`](../smap-format.md) (the on-disk
container).

---

## 1. Why this exists

A song currently lives in three places with no owner:

| Copy | Written by |
|---|---|
| `songMap` store (memory) | the editor, `restorableSong`, `playbackController` |
| `song.smap` (disk) | **13 call sites** across `commit.ts`, `cloudSync.ts`, `projectAutosave.ts`, `keyBackfill.ts` |
| `cloud_songs.song_map` (cloud) | `projectAutosave.ts` |

No module knows about all three. Every collaboration bug found so far traces to
that single fact:

- A pull writes **disk but never memory**, so an open editor keeps a stale copy
  and its next autosave overwrites what was pulled.
- Realtime auto-pull is mounted only on `/project`. That accidental gap is the
  only thing preventing the lost update above — one bug is masking another.
- Two merge functions (`mergeLocalIntoCollab` for pull, `mergeForConflict` for a
  409) must agree but nothing checks that they do.
- Pushes need a `lastSyncedContentHash` self-echo guard, because a client cannot
  otherwise tell its own change from someone else's.
- Sync watermarks live in `barbro.project.json` while the data lives in
  `song.smap` — two files that must stay consistent.
- `projectAutosave` needs **seven guard clauses** because it cannot trust the
  situation it runs in.

## 2. Decision record

**Chosen: a CRDT (Yjs) as the single source of truth, phased in.**

The deciding input was usage, not elegance. Two people editing *different* songs
already works (per-song rows, no conflict). The question was how often two people
edit *the same song at the same time*: the answer is **often — co-editing live is
the normal workflow**, and conflict dialogs were explicitly rejected as a bad
answer to "we are both working on this".

Under last-write-wins, that combination guarantees a steady stream of merge
prompts exactly when people are collaborating. A CRDT removes the concept.

**Rejected: unify the existing LWW merge.** Cheaper and lower risk, and it would
have been the right call had co-editing been rare — the pain so far has been
plumbing, not merge semantics. It loses on the one axis that matters here:
simultaneous edits to one song still conflict.

**Rejected: server-authoritative.** BarBro must work with no network at a gig.

**Yjs over Automerge**, on undo. Undo is load-bearing (a 100-entry stack with
batch grouping) and in a shared session it must revert *your* edits and never a
collaborator's. Yjs ships an origin-scoped `UndoManager` that does exactly this.
Automerge documents are JSON-shaped and would port the existing pure transforms
more mechanically, but it has no undo manager — and hand-rolling undo from
inverse changes is the riskiest possible thing to hand-roll here.

## 3. Rules

1. **The document is the truth.** Disk and cloud are materializations of it, not
   competing copies.
2. **One owner writes the active song.** Nothing else touches its disk or cloud
   representation.
3. **Remote changes land in memory first, then flow to disk.** Never disk-only.
   The absence of this rule caused every staleness bug.
4. **Readers receive a derived plain `SongMap`, never a CRDT type.** This is what
   stops Yjs leaking into thirty modules.
5. **Load-time migration and repair happen before a song becomes active**, so
   they can never race the session.
6. **Derived caches are disposable and explicitly not authoritative.** Anything
   that can be rebuilt from the document is a cache, and must be rebuildable.

## 4. Containment: writers change, readers do not

```
        WRITERS (42 ops, 6 modules)        READERS (dozens of modules)
   harmonyEdit, sectionEdit, drafts,   playbackPlan, abletonSet, MixerView,
   cueTracks, timelineEdit, transpose  LeadSheet, musicxml, setlist, …
                  │                                    ▲
                  ▼                                    │
        ┌──────────────────────────────────────────────────────┐
        │   Y.Doc  ──── derive ────▶  plain SongMap (readonly)  │
        └──────────────────────────────────────────────────────┘
```

`songPlaybackPlan()`, the Ableton exporter, the mixer and the lead sheet keep
receiving the same plain object they do today. Architecture invariants in
[`../../CLAUDE.md`](../../CLAUDE.md) — `.smap` as root of truth, one timing
function, editor/Ableton lockstep — are preserved because the derived `SongMap`
remains the thing everything projects from.

## 5. Document shape

Collaborative state only. Local-only fields (`mixState`, `stemRefs`,
`chordHints`, `sectionBorderHints`, `projectFolder`) are **not in the shared
document** — they are per-device and are merged into the derived `SongMap` from
local storage. This replaces today's strip-on-push list with a structural
boundary.

```
ydoc
├─ meta        Y.Map    formatVersion, app, metadata, transpose,
│                       countInBeats, startBeatId
├─ audio       Y.Map    AudioReference incl. recording fingerprint
├─ timeline    Y.Map
│   ├─ bars    Y.Map<barId,   Y.Map>
│   └─ beats   Y.Map<beatId,  Y.Map>
├─ drafts      Y.Map<draftId, Y.Map>   ← every draft, uniformly
├─ active      Y.Map    activeDraftId
└─ cueTracks   Y.Map<trackId, Y.Map>   (events also id-keyed)
```

**Id-keyed `Y.Map`, not `Y.Array`.** Bars, beats, harmony, sections, drafts and
cue events all have stable ids and *derived* order (`bar.index`, `beat.timeSec`,
`harmony.startSec`, draft name). Positional arrays would let concurrent inserts
interleave for no benefit; an id-keyed map makes concurrent adds and deletes
conflict-free by construction. The derive step sorts.

**Opportunity — drop the active-draft special case.** Today the active draft's
content sits at the SongMap root and `drafts[]` holds only the inactive ones,
because ~28 consumers read `sections`/`harmony`/`lyrics` directly. With a derive
step, the document can store *all* drafts uniformly and the derive can project
the active one to the root. The special case disappears from storage while the
reader contract is unchanged. Do this in Phase 3, not before.

## 6. Undo

- All local edits run inside `ydoc.transact(fn, LOCAL_ORIGIN)`.
- Remote updates are applied with a different origin.
- `new Y.UndoManager(scopes, { trackedOrigins: new Set([LOCAL_ORIGIN]) })` then
  reverts only local edits — never a collaborator's.
- `beginPatchBatch` / `endPatchBatch` map onto transaction grouping and
  `UndoManager.stopCapturing()`.

Switching drafts is one transaction, so undo reverts it atomically.

## 7. Transport

Reuse Supabase; no new infrastructure.

- Append-only `cloud_song_updates(cloud_song_id, update bytea, actor, created_at)`.
- Clients push `Y.encodeStateAsUpdate` diffs, debounced.
- Clients subscribe via existing Realtime and `Y.applyUpdate` on insert.
- **Compaction is required**, not optional: without it the update log and the
  document's tombstones grow without bound. Periodically collapse to a snapshot
  and prune.
- Offline needs no watermark. Yjs merges idempotently and out of order, which is
  what lets `lastSyncedRevision`, `lastSyncedContentHash` and the echo guard all
  be deleted in Phase 6.

## 8. Migration hazard — seed determinism

**This is the subtlest risk in the whole plan. Read it before writing Phase 2.**

Seeding a `Y.Doc` from an existing JSON `SongMap` is not deterministic by
default: Yjs assigns a random `clientID`, so two devices seeding independently
from the *same* `.smap` produce two *different* documents. Merging them yields
duplicated bars, chords and sections rather than one song.

Mitigations, to be decided in Phase 2:

- Seed with a **fixed `clientID` and a canonical op order**, so every device
  produces byte-identical initial state; or
- migrate **once** and distribute the resulting document, with devices that have
  not migrated pulling it rather than seeding their own.

This is the same class of bug as the v5→v6 determinism requirement recorded in
[`draftsMigrate.ts`](../../src/lib/songmap/draftsMigrate.ts) and the legacy
cue-track fix in commit `174610c`, and it is worse here: LWW produced a phantom
conflict loop, this produces silent duplication.

## 9. `.smap` v7

The container holds:

- the Yjs document state (binary) — authoritative;
- local-only fields (JSON) — per-device, never shared;
- a derived metadata block (title, bpm, key, duration, flags) — a **cache** for
  `readSmapJsonOnly`, which powers the project list and the setlist
  orchestrator, and which must stay fast.

The metadata block is rebuildable from the document, so rule 6 holds and this is
not a second source of truth. It must never be written by anything other than
the derive step.

## 10. Phases

Each phase leaves the app working, with green tests.

| Phase | Work | Done when |
|---|---|---|
| **1** ✅ | Seam landed: [`songSession.ts`](../../src/lib/project/songSession.ts) owns applying remote changes to the active song; [`cloudAutoPull.ts`](../../src/lib/client/cloudAutoPull.ts) makes auto-pull route-independent. Debounced writes still live in `projectAutosave.ts` — moved in a later pass. | Pulls land in memory + disk together; remote edits reach an open editor. Still LWW. |
| **2** | Seed a shadow `Y.Doc` on load; derive a `SongMap`; assert it equals the parsed one. Resolve seed determinism. | No behaviour change. Round-trip equality holds for every song in a real project. |
| **3** | Migrate writers module by module (`harmonyEdit` → `sectionEdit` → `drafts` → `cueTracks` → `timelineEdit` → `transposition`). Drop the active-draft special case. | Each module ships independently with its tests green. |
| **4** | Updates table + realtime; document merge replaces LWW. | Conflict dialog deleted. Two editors converge without prompting. |
| **5** | Undo on CRDT primitives. | Undo reverts only local edits, verified with two simulated clients. |
| **6** | Delete `collabMerge.ts`, revisions, watermarks, echo guard. `.smap` v7. | No LWW code remains. |

Phase 1 is worth doing on its own merits and is the identical first step for any
model. Phases 3–5 are the hard ones.

### Phase 1, as built

Two things had to move together, and the order matters:

1. **`songSession.applyRemoteSongMap`** — the single entry point for remote
   content. When the song is open it merges against the **in-memory** map (which
   may hold edits from the last debounce window that disk does not have) and
   patches the store; otherwise it merges against the disk copy as before.
   Either way it returns the map the caller persists, so memory and disk can
   never disagree about what a pull produced.
2. **`cloudAutoPull`** — the Realtime subscription, moved out of
   `CloudStatusChip.svelte` (mounted on `/project` only) into a module started
   from the root layout.

Moving (2) without (1) would have *created* a lost update: a pull landing while
`/edit` was open would have written disk under a stale editor, whose next
autosave wrote the stale copy back. The `/project`-only mounting had been
accidentally preventing exactly that.

A third issue surfaced on review. Once pulls reach an open editor, the old
"cloud wins for shared fields" rule would silently delete whatever the user had
typed in the last few seconds. So the session compares the in-memory content
against `lastSyncedContentHash`:

- **clean** (matches) → adopt the remote copy, as before;
- **dirty** (unpushed edits) → `mergeForConflict` defaults, which keep every
  item unique to either side and prefer cloud only on genuine collisions —
  the same resolution the dialog would apply, without the dialog.

### The dialog is now the exception, not the rule

Until Phase 4 lands, LWW still runs — but it stopped interrupting people. The
409 handler settles any report with no `dangerous` conflict by itself, and only
prompts for the five things that change what the song *is*: whole-timeline
replacement, a wholesale chord-track swap, a divergent active draft, an
`metadata.analyzed` flip, and an audio-identity swap.

Two findings forced the shape of this, both worth keeping in mind for Phase 4:

1. **Version skew is a conflict source in its own right.** A song's local
   `.smap` and its `cloud_songs.song_map` can sit at different legacy
   `formatVersion`s (observed: `4` on disk, `2` in the cloud). Both migrate to
   v6 — locally through `parseSongMap`, on read through
   `normalizeCloudSongMap` — but from different starting points, so the two
   results genuinely differ and the merge honestly reports it. This fires on
   ordinary first-open, for the whole band at once when a build ships.
2. **"Cloud wins" is a deletion when the cloud side is empty.** Sync was
   push-only-on-open, so a cloud row can be months stale *and* predate whole
   fields — a v2 row has no `transpose` (v3) and no `lyrics` (v4). Auto-applying
   the plain default there would wipe local work that never reached the server.
   `autoResolvedMerge` corrects exactly that asymmetry and nothing else: where
   the cloud value is empty and the local one is not, local is kept. Two
   non-empty sides still resolve cloud-wins, and id-keyed items never qualify
   because a conflict there means both sides hold the item.

What version skew does *not* do, verified in
[`collabAutoResolve.test.ts`](../../src/lib/songmap/collabAutoResolve.test.ts):
it never trips `harmonyWholesale` (migration preserves chord ids) and never
trips the `activeDraft` conflict (every legacy version derives the same fixed
`MIGRATED_ACTIVE_DRAFT_ID`). Both classifications are therefore still correct
and were left alone.

## 11. Anti-patterns

- **Do not** let a `Y.Map` or `Y.Array` escape into a reader. If a module outside
  the six writers imports `yjs`, the containment boundary has been broken.
- **Do not** put local-only fields in the shared document.
- **Do not** seed a document non-deterministically (§8).
- **Do not** keep the derived metadata cache authoritative for anything.
- **Do not** collapse the phases. The current LWW path must keep working until
  Phase 4 replaces it.
