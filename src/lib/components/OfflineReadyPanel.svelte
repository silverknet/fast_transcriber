<script lang="ts">
  /**
   * "Prepare for offline" — can this set be played at a venue with no internet?
   *
   * Answers it by checking the actual files on disk, one song at a time, and
   * naming what is missing. The question people currently answer by hoping.
   *
   * The bar is deliberately **playable**, not perfect: clicks, cue speech and
   * the generated band are rendered locally, so their absence is a note rather
   * than a blocker. What cannot be conjured is audio — and a song with none is
   * silent on stage, which is the failure this exists to prevent.
   *
   * ## The second half: opening the session
   *
   * Once the set checks out, this writes `offline-session.json` recording the
   * cloud revision each song sits at right now. That is what lets the browser
   * say "3 songs changed offline" when you get home, and what tells a later
   * push which revision the laptop's copy was actually based on.
   *
   * There is no sign-in step any more, and deliberately so: the offline build
   * has no cloud to sign in to. What it needs from you is the files, which is
   * exactly what this checks.
   */
  import { CircleAlert, CircleCheck, HardDriveDownload, Loader } from '@lucide/svelte'
  import { project as projectStore } from '$lib/stores/project'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { checkSetForOffline, type SetCheckProgress } from '$lib/client/offlineSetCheck'
  import { readOfflineSession, writeOfflineSession } from '$lib/client/offlineSessionIo'
  import { mergeOfflineSessions, newOfflineSession } from '$lib/project/offlineSession'
  import type { SetReadiness } from '$lib/project/offlineReadiness'

  let running = $state(false)
  let progress = $state<SetCheckProgress | null>(null)
  let result = $state<SetReadiness | null>(null)
  let error = $state('')
  let sessionOpened = $state(false)

  const osPath = $derived($projectStore.osPath)
  const songs = $derived($projectStore.data?.songs ?? [])
  /** Browser mode has no local folder, so there is nothing on disk to check. */
  const canCheck = $derived(Boolean(osPath) && $desktopCompanionStatus.reachable)

  /**
   * Record where every song stands with the cloud right now.
   *
   * Merged with any marker already on disk rather than replacing it: two gigs
   * without a reconcile in between would otherwise erase the first night's
   * touched songs, and those edits would never be offered for review.
   */
  async function openOfflineSession(path: string) {
    const baseRevisions: Record<string, number> = {}
    const projectRevision = $projectStore.data?.cloud?.lastSyncedRevision ?? 0
    for (const s of songs) {
      baseRevisions[s.id] = s.lastSyncedRevision ?? projectRevision
    }
    const existing = await readOfflineSession(path)
    const merged = mergeOfflineSessions(
      existing,
      newOfflineSession(new Date().toISOString(), baseRevisions),
    )
    sessionOpened = await writeOfflineSession(path, merged)
  }

  async function run() {
    if (!osPath) return
    running = true
    error = ''
    result = null
    sessionOpened = false
    progress = { done: 0, total: songs.length, song: '' }
    try {
      const r = await checkSetForOffline(
        osPath,
        songs.map((s) => ({ id: s.id, folder: s.folder })),
        (p) => (progress = p),
      )
      result = r
      // Only when the set can actually be played. Opening a session for a set
      // with a silent song would put a tick next to something that fails on
      // stage, which is worse than no tick at all.
      if (r.ready) await openOfflineSession(osPath)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      running = false
      progress = null
    }
  }
</script>

<section class="border-foreground/25 rounded-[var(--radius)] border-2 p-3">
  <header class="mb-2 flex items-center gap-2">
    <HardDriveDownload class="size-4 shrink-0" />
    <h3 class="grow text-sm font-bold">Prepare for offline</h3>
    <button
      type="button"
      class="border-foreground inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] border-2 px-2.5 text-xs font-bold disabled:opacity-40"
      onclick={run}
      disabled={!canCheck || running || songs.length === 0}
    >
      {#if running}<Loader class="size-3.5 animate-spin" /> Checking…{:else}Check the set{/if}
    </button>
  </header>

  <p class="text-muted-foreground mb-2 text-[11px]">
    Checks every song's audio is on this machine, so the set plays with no network at the venue.
    Run it before you leave — not when you get there.
  </p>

  {#if !$desktopCompanionStatus.reachable}
    <p class="border-foreground/30 rounded-[var(--radius)] border-2 border-dashed p-2 text-[11px] font-bold">
      BarBro desktop isn't running, so the local files can't be checked.
    </p>
  {:else if !osPath}
    <p class="border-foreground/30 rounded-[var(--radius)] border-2 border-dashed p-2 text-[11px] font-bold">
      This project has no local folder — it lives in the cloud, so it needs a network to play.
    </p>
  {/if}

  {#if progress}
    <p class="text-[11px] font-bold">
      {progress.done} / {progress.total} · {progress.song}
    </p>
  {/if}

  {#if error}
    <p class="text-[11px] font-bold">Couldn't finish the check: {error}</p>
  {/if}

  {#if result}
    {@const r = result}
    <div
      class="mb-2 flex items-center gap-2 rounded-[var(--radius)] border-2 p-2 {r.ready
        ? 'border-foreground'
        : 'border-foreground/40 border-dashed'}"
    >
      {#if r.ready}<CircleCheck class="size-4 shrink-0" />{:else}<CircleAlert class="size-4 shrink-0" />{/if}
      <p class="text-xs font-bold">{r.summary}</p>
    </div>

    {#if sessionOpened}
      <p class="text-muted-foreground mb-2 text-[11px]">
        Ready. Anything you change at the venue is saved on this machine, and BarBro will offer to
        sync it when you're back online.
      </p>
    {/if}

    <!-- Blockers first: the list you act on before leaving. -->
    <ol class="space-y-1.5">
      {#each [...r.blockers, ...r.songs.filter((s) => s.playable)] as song (song.songId)}
        <li class="border-foreground/15 rounded-[var(--radius)] border p-2">
          <div class="flex items-start gap-2">
            <span class="mt-0.5 shrink-0">
              {#if song.playable && song.complete}<CircleCheck class="size-3.5" />
              {:else if song.playable}<CircleCheck class="size-3.5 opacity-50" />
              {:else}<CircleAlert class="size-3.5" />{/if}
            </span>
            <div class="grow">
              <p class="text-xs font-bold">{song.title}</p>
              <p class="text-muted-foreground text-[11px]">{song.summary}</p>
              {#if !song.playable}
                {@const missing = song.assets.filter((a) => !a.present && a.required)}
                {#if missing.length > 0}
                  <p class="mt-1 font-mono text-[10px]">
                    missing: {missing.map((m) => m.subpath).join(', ')}
                  </p>
                {/if}
              {/if}
            </div>
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</section>
