/**
 * EVIDENCE OF PERSISTENCE — did the edits actually land anywhere?
 *
 * Born from a real loss: half an hour of chord corrections in browser-collab
 * mode, edits visible on screen, ten cloud revisions during the session — and
 * none of them carried the chords. Every failure path in the autosave layer
 * was a silent `catch {}`; the editor smiled while losing work.
 *
 * This store holds nothing but FACTS the save paths report: the last disk
 * write that succeeded or failed, the last cloud push that succeeded (with
 * the revision the server minted) or failed, and when the first unsaved edit
 * happened. The badge derives one verdict from them; nothing here guesses.
 */
import { writable } from 'svelte/store'

export type PersistEvidence = {
  /** Last sidecar disk write: when it finished and how. Null = none yet. */
  disk: { at: number; ok: boolean; error?: string } | null
  /** Last cloud push: when, how, and the server revision when it succeeded. */
  cloud: { at: number; ok: boolean; revision?: number; error?: string } | null
  /** When the oldest UNSAVED edit happened. Null = everything landed. */
  dirtySince: number | null
}

export const persistStatus = writable<PersistEvidence>({ disk: null, cloud: null, dirtySince: null })

/** An edit happened — the clock on "is it landing anywhere?" starts. */
export function reportEditPending(now = Date.now()): void {
  persistStatus.update((s) => (s.dirtySince === null ? { ...s, dirtySince: now } : s))
}

export function reportDiskSave(ok: boolean, error?: string, now = Date.now()): void {
  persistStatus.update((s) => ({
    ...s,
    disk: { at: now, ok, ...(error ? { error } : {}) },
    dirtySince: ok ? null : s.dirtySince,
  }))
}

export function reportCloudPush(ok: boolean, revision?: number, error?: string, now = Date.now()): void {
  persistStatus.update((s) => ({
    ...s,
    cloud: { at: now, ok, ...(revision !== undefined ? { revision } : {}), ...(error ? { error } : {}) },
    dirtySince: ok ? null : s.dirtySince,
  }))
}

export function resetPersistStatus(): void {
  persistStatus.set({ disk: null, cloud: null, dirtySince: null })
}

/**
 * The one verdict, derived from evidence:
 *  - 'saved'  — nothing pending, and the last attempt (if any) succeeded
 *  - 'saving' — edits pending but within the debounce grace window
 *  - 'danger' — edits have been pending longer than any healthy debounce
 *               (disk 1.5 s, cloud 7 s → 20 s covers both with margin), OR the
 *               last save attempt FAILED. This is the "stop editing" red.
 */
export const PERSIST_GRACE_MS = 20_000

export function persistVerdict(
  s: PersistEvidence,
  now = Date.now(),
): 'saved' | 'saving' | 'danger' {
  const lastFailed = (s.disk !== null && !s.disk.ok) || (s.cloud !== null && !s.cloud.ok)
  if (lastFailed) return 'danger'
  if (s.dirtySince === null) return 'saved'
  return now - s.dirtySince > PERSIST_GRACE_MS ? 'danger' : 'saving'
}
