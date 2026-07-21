/**
 * Phase 1 — remote changes must land in memory first, then disk.
 *
 * The bug this guards: a pull wrote `song.smap` and never touched the `songMap`
 * store, so an open editor kept a stale copy and its next autosave wrote that
 * stale copy back over the pull. These tests pin the two properties that stop
 * it — merging against the freshest local copy, and reporting that memory needs
 * updating.
 */
import { describe, expect, it } from 'vitest'
import { planRemoteApplication } from './songSession'
import { collabContentFingerprint } from '$lib/songmap/collab'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { HarmonyEvent, SongMap } from '$lib/songmap/types'

function chord(id: string, displayRaw: string): HarmonyEvent {
  return {
    id,
    barId: 'bar0',
    startSec: 0,
    endSec: 1,
    chord: { root: 'C', quality: 'maj', displayRaw },
  }
}

function songWith(harmony: HarmonyEvent[], extra: Partial<SongMap> = {}): SongMap {
  return {
    ...createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' }),
    harmony,
    ...extra,
  }
}

describe('planRemoteApplication', () => {
  it('merges against MEMORY when the song is open in the editor', () => {
    // The in-memory map holds an edit made inside the last debounce window that
    // has not reached disk. Merging against disk would silently discard it.
    const disk = songWith([chord('c1', 'C')])
    const memory = songWith([chord('c1', 'C')], { projectFolder: 'OnlyInMemory' })
    const incoming = songWith([chord('c1', 'C'), chord('c2', 'G')])

    const plan = planRemoteApplication({ incoming, memory, disk })
    expect(plan.localSource).toBe('memory')
    expect(plan.appliedToMemory).toBe(true)
    // The remote chord arrived...
    expect(plan.merged.harmony.map((h) => h.id)).toEqual(['c1', 'c2'])
    // ...and the local-only field that existed ONLY in memory survived.
    expect(plan.merged.projectFolder).toBe('OnlyInMemory')
  })

  it('merges against DISK when the song is not the active one', () => {
    const disk = songWith([chord('c1', 'C')], { projectFolder: 'FromDisk' })
    const incoming = songWith([chord('c1', 'C'), chord('c2', 'G')])

    const plan = planRemoteApplication({ incoming, memory: null, disk })
    expect(plan.localSource).toBe('disk')
    expect(plan.appliedToMemory).toBe(false)
    expect(plan.merged.projectFolder).toBe('FromDisk')
  })

  it('adopts remote content wholesale when the song is NOT open', () => {
    // "Cloud wins for shared fields" is the pull contract for a song nobody is
    // editing — there is no unsaved work to protect, so deletions propagate.
    const disk = songWith([chord('c1', 'C')])
    const incoming = songWith([chord('c9', 'Bm7b5')])
    const plan = planRemoteApplication({ incoming, memory: null, disk })
    expect(plan.merged.harmony.map((h) => h.id)).toEqual(['c9'])
  })

  it('protects the editor\'s content when the song IS open and unproven', () => {
    // Same inputs, but the song is open and there is no watermark proving it
    // synced. Cloud content still arrives; local content is not thrown away.
    const disk = songWith([chord('c1', 'C')])
    const incoming = songWith([chord('c9', 'Bm7b5')])
    const plan = planRemoteApplication({ incoming, memory: disk, disk })
    const ids = plan.merged.harmony.map((h) => h.id)
    expect(ids).toContain('c9')
    expect(ids).toContain('c1')
  })

  it('never mutates the maps it was given', () => {
    const disk = songWith([chord('c1', 'C')])
    const memory = songWith([chord('c1', 'C')])
    const incoming = songWith([chord('c2', 'G')])
    const diskBefore = JSON.stringify(disk)
    const memoryBefore = JSON.stringify(memory)
    const incomingBefore = JSON.stringify(incoming)

    planRemoteApplication({ incoming, memory, disk })

    expect(JSON.stringify(disk)).toBe(diskBefore)
    expect(JSON.stringify(memory)).toBe(memoryBefore)
    expect(JSON.stringify(incoming)).toBe(incomingBefore)
  })

  it('produces the SAME merged content whichever local copy it started from', () => {
    // When memory and disk agree, the seam must be a no-op — otherwise moving a
    // pull onto the memory path would change what gets written to disk.
    const same = songWith([chord('c1', 'C')], { projectFolder: 'Song' })
    const incoming = songWith([chord('c1', 'C'), chord('c2', 'G')])

    const viaMemory = planRemoteApplication({ incoming, memory: same, disk: same })
    const viaDisk = planRemoteApplication({ incoming, memory: null, disk: same })
    expect(JSON.stringify(viaMemory.merged)).toBe(JSON.stringify(viaDisk.merged))
  })

  it('carries drafts through from the remote copy', () => {
    // Drafts are collaborative; a pull must not strand the editor on a draft
    // the rest of the band has moved off.
    const disk = songWith([chord('c1', 'C')], {
      activeDraftId: 'd1',
      activeDraftName: 'Mine',
    })
    const incoming = songWith([chord('c2', 'G')], {
      activeDraftId: 'd2',
      activeDraftName: 'Sheet import',
      drafts: [{ id: 'd1', name: 'Mine', sections: [], harmony: [chord('c1', 'C')] }],
    })
    const plan = planRemoteApplication({ incoming, memory: disk, disk })
    expect(plan.merged.activeDraftId).toBe('d2')
    expect(plan.merged.drafts?.map((d) => d.id)).toEqual(['d1'])
  })
})

describe('an open editor with unpushed edits is not overwritten', () => {
  const synced = songWith([chord('c1', 'C')])
  const syncedHash = collabContentFingerprint(synced)

  it('adopts the remote copy when local matches the last sync', () => {
    const incoming = songWith([chord('c1', 'C'), chord('c2', 'G')])
    const plan = planRemoteApplication({
      incoming,
      memory: synced,
      disk: synced,
      lastSyncedContentHash: syncedHash,
    })
    expect(plan.localState).toBe('clean')
    expect(plan.merged.harmony.map((h) => h.id)).toEqual(['c1', 'c2'])
  })

  it('keeps a local edit that never reached the cloud', () => {
    // THE regression Phase 1 could have introduced: pulls now reach the open
    // editor, so a naive "cloud wins" would delete whatever was typed in the
    // last few seconds.
    const memory = songWith([chord('c1', 'C'), chord('mine', 'Am')])
    const incoming = songWith([chord('c1', 'C'), chord('theirs', 'G')])
    const plan = planRemoteApplication({
      incoming,
      memory,
      disk: synced,
      lastSyncedContentHash: syncedHash,
    })
    expect(plan.localState).toBe('dirty')
    const ids = plan.merged.harmony.map((h) => h.id)
    expect(ids).toContain('mine')
    expect(ids).toContain('theirs')
  })

  it('still lets the remote side win where the two genuinely collide', () => {
    const memory = songWith([chord('c1', 'Cmaj7')])
    const incoming = songWith([chord('c1', 'Cm7')])
    const plan = planRemoteApplication({
      incoming,
      memory,
      disk: synced,
      lastSyncedContentHash: syncedHash,
    })
    expect(plan.merged.harmony[0].chord.displayRaw).toBe('Cm7')
  })

  it('treats an UNKNOWN sync watermark as dirty, not clean', () => {
    // Regression, found live: chords vanished a second after being typed.
    // `lastSyncedContentHash` is only set by a successful push, so it is absent
    // for any song that has never pushed from this machine. The old code read
    // that absence as "clean" and adopted the cloud copy wholesale, deleting
    // the edit. Not knowing whether local work exists must mean PRESERVE it.
    const memory = songWith([chord('c1', 'C'), chord('mine', 'Am')])
    const incoming = songWith([chord('c1', 'C')])
    const plan = planRemoteApplication({ incoming, memory, disk: synced })
    expect(plan.localState).toBe('dirty')
    expect(plan.merged.harmony.map((h) => h.id)).toContain('mine')
  })

  it('a never-pushed song does not lose edits when a remote change lands', () => {
    // The exact live scenario: song has never synced from this machine, the
    // user types chords, a collaborator's change arrives moments later.
    const justTyped = songWith([chord('typed-1', 'Am'), chord('typed-2', 'F')])
    const fromCollaborator = songWith([chord('theirs', 'Bb')])
    const plan = planRemoteApplication({
      incoming: fromCollaborator,
      memory: justTyped,
      disk: songWith([]),
      lastSyncedContentHash: undefined,
    })
    const ids = plan.merged.harmony.map((h) => h.id)
    expect(ids).toContain('typed-1')
    expect(ids).toContain('typed-2')
    expect(ids).toContain('theirs')
  })

  it('folds the audio claim in before the map is installed', () => {
    // Setting expectedAudio after patching the store would mutate a
    // store-held object without notifying subscribers.
    const plan = planRemoteApplication({
      incoming: synced,
      memory: null,
      disk: synced,
      expectedAudio: { fileName: 'shared.wav', sha256: 'abc' },
    })
    expect(plan.merged.expectedAudio).toEqual({ fileName: 'shared.wav', sha256: 'abc' })
  })
})
