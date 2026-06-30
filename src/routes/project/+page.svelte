<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { Button } from '$lib/components/ui/button'
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } from '$lib/components/ui/dropdown-menu'
  import ProjectSongCard from '$lib/components/ProjectSongCard.svelte'
  import RemoveSongDialog from '$lib/components/RemoveSongDialog.svelte'
  import ExportBackingTrackDialog from '$lib/components/ExportBackingTrackDialog.svelte'
  import SetlistExportDialog from '$lib/components/SetlistExportDialog.svelte'
  import StemsDialog from '$lib/components/StemsDialog.svelte'
  import ProjectSettingsDialog from '$lib/components/ProjectSettingsDialog.svelte'
  import AddAudioDialog from '$lib/components/AddAudioDialog.svelte'
  import CloudCollabSection from '$lib/components/CloudCollabSection.svelte'
  import ShareProjectDialog from '$lib/components/ShareProjectDialog.svelte'
  import NewProjectDialog from '$lib/components/NewProjectDialog.svelte'
  import NewSongDialog from '$lib/components/NewSongDialog.svelte'
  import RenameSongDialog from '$lib/components/RenameSongDialog.svelte'
  import JoinCloudProjectDialog from '$lib/components/JoinCloudProjectDialog.svelte'
  import { Cloud, FolderOpen, FolderPlus, ListPlus, MailOpen, Plus, RefreshCw, Music4, Settings, Share2 } from '@lucide/svelte'
  import {
    acceptPendingInvite,
    listCloudProjects,
    listMyPendingInvites,
    type CloudPendingInviteForMe,
    type CloudProjectMeta,
  } from '$lib/client/cloudSync'
  import {
    exportProjectSetAls,
    preflightProjectSetlist,
    type SetlistPreflightStatus,
  } from '$lib/export/setlist'
  import { safeExportBasename } from '$lib/songmap/persist'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import {
    attachImportedAudioToSong,
    attachAudioToSong,
    replaceAudioForSong,
    dropRecentProjectPath,
    importSmapToProject,
    loadProjectSongIntoEditor,
    metadataLiteFromSongMap,
    openProjectByPath,
    readRecentProjectPaths,
    refreshProjectInfo,
    removeSongFromProject,
    renameProject,
    setSongHidden,
    setSongOrder,
    tryRestoreLastProject,
  } from '$lib/project/commit'
  import { pickFolderViaDesktop, type YoutubeImportOutput } from '$lib/client/desktopBridge'
  import { dndzone } from 'svelte-dnd-action'
  import { STEM_TRACKS } from '$lib/export/abletonSet'
  import { syncStemJobsWithSidecar } from '$lib/stores/stemJobs'
  import { project } from '$lib/stores/project'
  import { audioSession } from '$lib/stores/audioSession'
  import { analyzingState } from '$lib/stores/analyzingState'
  import { readSmapJsonOnly } from '$lib/songmap/persist'
  import { songMap } from '$lib/stores/songMap'
  import type { ProjectSongEntry } from '$lib/project/types'
  import type { ImportedAudioArtifact } from '$lib/audio/importedAudio'

  let restoring = $state(true)
  let restoreError = $state('')
  let actionError = $state('')
  let renameInput = $state('')

  // ── Empty-state project home (no project open) ────────────────────────────
  let newProjectDialogOpen = $state(false)
  let recentEntries = $state<Array<{ path: string; label: string }>>([])
  let openingPath = $state<string | null>(null)
  let openError = $state('')
  let cloudProjects = $state<CloudProjectMeta[]>([])
  let cloudProjectsLoading = $state(false)
  let joinDialogOpen = $state(false)
  let joinTarget = $state<CloudProjectMeta | null>(null)

  // Pending invites visible to the signed-in user — surfaced as an
  // "Invited to" section on the no-project landing. Accept promotes the
  // invite to membership server-side, then opens JoinCloudProjectDialog
  // so the user picks a parent folder to materialize into.
  let myInvites = $state<CloudPendingInviteForMe[]>([])
  let myInvitesLoading = $state(false)
  let acceptingInviteId = $state<string | null>(null)
  let acceptError = $state('')

  // Share dialog (header button on the project-open view).
  let shareDialogOpen = $state(false)

  async function loadCloudProjects() {
    cloudProjectsLoading = true
    try {
      cloudProjects = await listCloudProjects()
    } finally {
      cloudProjectsLoading = false
    }
  }

  async function loadMyInvites() {
    myInvitesLoading = true
    try {
      myInvites = await listMyPendingInvites()
    } finally {
      myInvitesLoading = false
    }
  }

  async function onAcceptInvite(inv: CloudPendingInviteForMe) {
    acceptingInviteId = inv.id
    acceptError = ''
    const r = await acceptPendingInvite(inv.cloud_project_id)
    acceptingInviteId = null
    if (!r.ok) {
      acceptError = r.error
      return
    }
    // Refresh both lists — the invite is gone, and the project should
    // now appear under "Shared with me" so JoinCloudProjectDialog has
    // the full metadata to work with.
    await Promise.all([loadMyInvites(), loadCloudProjects()])
    const proj = cloudProjects.find((p) => p.id === inv.cloud_project_id)
    if (proj) startJoin(proj)
  }

  function startJoin(p: CloudProjectMeta) {
    joinTarget = p
    joinDialogOpen = true
  }

  function pathLabel(p: string): string {
    const ix = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
    return ix === -1 ? p : p.slice(ix + 1)
  }

  function refreshRecents() {
    if (!browser) return
    recentEntries = readRecentProjectPaths().map((p) => ({ path: p, label: pathLabel(p) }))
  }

  async function openRecent(entry: { path: string; label: string }) {
    if (openingPath) return
    openError = ''
    openingPath = entry.path
    try {
      await openProjectByPath(entry.path)
      refreshRecents()
    } catch (e) {
      dropRecentProjectPath(entry.path)
      refreshRecents()
      openError = e instanceof Error ? e.message : `Could not open "${entry.label}"`
    } finally {
      openingPath = null
    }
  }

  async function browseAndOpen() {
    openError = ''
    if (!$desktopCompanionStatus.reachable) {
      openError = 'Desktop client unreachable.'
      return
    }
    const pick = await pickFolderViaDesktop({ title: 'Open a BarBro project folder' })
    if (!pick.ok) {
      if ('cancelled' in pick) return
      openError = pick.error ?? 'Could not open picker'
      return
    }
    try {
      await openProjectByPath(pick.path)
      refreshRecents()
    } catch (e) {
      openError = e instanceof Error ? e.message : 'Could not open project'
    }
  }

  let removeDialogOpen = $state(false)
  let removeTarget = $state<{ id: string; title: string } | null>(null)

  let exportDialogOpen = $state(false)
  let exportTarget = $state<{ folder: string; title: string } | null>(null)

  let stemsDialogOpen = $state(false)
  let stemsTarget = $state<ProjectSongEntry | null>(null)

  let settingsDialogOpen = $state(false)

  let smapImportInput = $state<HTMLInputElement | undefined>()

  /** Refresh button state. */
  let refreshing = $state(false)
  let refreshMsg = $state('')
  let refreshMsgTitle = $state('')

  /** Setlist .als export state. */
  let setlistExportStatus = $state<'idle' | 'preflight' | 'generating' | 'done' | 'error'>('idle')
  let setlistExportMsg = $state('')
  let setlistPreflight = $state<SetlistPreflightStatus | null>(null)
  let setlistExportOpen = $state(false)

  function openSetlistExport() {
    const proj = $project.data
    if (!proj) return
    setlistExportMsg = ''
    setlistPreflight = preflightProjectSetlist(proj, $project.metadataByFolder)
    setlistExportStatus = 'preflight'
    setlistExportOpen = true
  }

  async function runSetlistExport() {
    const proj = $project.data
    const osPath = $project.osPath
    if (!proj || !osPath) {
      setlistExportStatus = 'error'
      setlistExportMsg = 'Project path unavailable.'
      return
    }
    setlistExportStatus = 'generating'
    setlistExportMsg = 'Building setlist .als…'
    const filename = `${safeExportBasename(proj.name)}.als`
    const res = await exportProjectSetAls({
      projectPath: osPath,
      project: proj,
      metadataByFolder: $project.metadataByFolder,
      filename,
    })
    if (res.ok) {
      setlistExportStatus = 'done'
      setlistExportMsg = `Wrote ${filename} (${(res.alsBytes / 1024).toFixed(1)} KB) to the project folder.`
    } else {
      setlistExportStatus = 'error'
      setlistExportMsg = res.error
    }
  }

  function closeSetlistExport() {
    if (setlistExportStatus === 'generating') return
    setlistExportOpen = false
  }

  async function onRefreshProject() {
    if (refreshing) return
    refreshing = true
    refreshMsg = ''
    refreshMsgTitle = ''
    try {
      const r = await refreshProjectInfo()
      if (r.errors.length > 0) {
        refreshMsg = `${r.updatedSongs} song(s) updated · ${r.errors.length} error(s)`
        refreshMsgTitle = r.errors.join('; ')
      } else if (r.updatedSongs === 0) {
        refreshMsg = 'Up to date'
        refreshMsgTitle = 'No new stem files detected in song folders.'
      } else {
        refreshMsg = `${r.updatedSongs} song(s) updated`
        refreshMsgTitle = `Re-scanned project folders for stems and metadata.`
      }
    } catch (e) {
      refreshMsg = 'Refresh failed'
      refreshMsgTitle = e instanceof Error ? e.message : 'Refresh failed'
    } finally {
      refreshing = false
    }
  }

  $effect(() => {
    if ($project.data) renameInput = $project.data.name
  })

  onMount(() => {
    if (!browser) return
    refreshRecents()
    void loadCloudProjects()
    void loadMyInvites()
    void (async () => {
      try {
        if (!$project.data || !$project.osPath) {
          const data = await tryRestoreLastProject()
          if (!data) {
            restoreError = ''
            return
          }
        } else {
          // Already loaded — pull fresh info so any stems that landed while
          // we were elsewhere appear right away.
          await refreshProjectInfo()
        }
        // Hydrate the in-flight sidecar jobs into the store so the active
        // job pill renders. We no longer need to "finalize" anything — the
        // sidecar wrote stems straight into the project folder, and
        // `refreshProjectInfo` above already mirrored those into the manifest.
        await hydrateSidecarJobs()
      } catch (e) {
        restoreError = e instanceof Error ? e.message : 'Failed to restore project.'
      } finally {
        restoring = false
      }
    })()

    // Background stem prep is driven by the sidecar daemon — poll its job
    // state while this page is open so the per-stem "in progress" dots reflect
    // work happening even when nothing in the UI kicked it off.
    const jobPoll = setInterval(() => {
      if ($desktopCompanionStatus.reachable) void syncStemJobsWithSidecar()
    }, 8000)
    return () => clearInterval(jobPoll)
  })

  async function hydrateSidecarJobs() {
    // Adds new jobs AND reaps web-side jobs the sidecar forgot (restart),
    // so a dead "running" entry can't linger on a card forever.
    await syncStemJobsWithSidecar()
  }

  function commitNameRename() {
    if (!$project.data) return
    const next = renameInput.trim()
    if (!next || next === $project.data.name) return
    void renameProject(next).catch((e) => {
      actionError = e instanceof Error ? e.message : 'Rename failed'
    })
  }

  async function onEditSong(songId: string) {
    actionError = ''
    try {
      await loadProjectSongIntoEditor(songId)
      // If audio was attached but never analyzed (e.g. via the row's "Add
      // audio" button), jump straight into the analyze flow instead of the
      // editor. Stub songs without audio still route to /edit; the editor
      // surfaces a "no audio" empty state for them.
      const sm = get(songMap)
      const file = get(audioSession).file
      // Only enter the analyze flow when there's actually a decoded file to
      // analyze. Routing to /analyzing without a file bounces straight back
      // out (no hqFile → /analyzing redirects to /, which the layout sends
      // to /project) — so a missing/unreadable audio file would look like a
      // dead "open" button. Fall through to /edit, which shows the relink
      // banner instead.
      const canAnalyze =
        !!sm?.audio &&
        sm.metadata.analyzed === false &&
        sm.timeline.bars.length === 0 &&
        !!file
      if (canAnalyze) analyzingState.set({ hqFile: file })
      await goto(canAnalyze ? '/analyzing?project=1' : '/edit')
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Could not open song'
    }
  }

  async function onOpenStems(entry: ProjectSongEntry) {
    actionError = ''
    try {
      // Load the song so $songMap (and therefore audio.originalPath) reflects
      // this entry by the time StemsDialog renders the splitter.
      if ($project.activeSongId !== entry.id) {
        await loadProjectSongIntoEditor(entry.id)
      }
      stemsTarget = entry
      stemsDialogOpen = true
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Could not load song'
    }
  }

  /**
   * Local mirror of the project store's `songs` list that drag-and-drop can
   * mutate during a drag (`consider`) and on drop (`finalize`). When the
   * underlying store changes (refresh, add, remove) we re-sync — but never
   * mid-drag, since svelte-dnd-action owns the array during the gesture.
   */
  let dragSongs = $state<ProjectSongEntry[]>([])
  let isDragging = $state(false)
  $effect(() => {
    const next = $project.data?.songs ?? []
    if (isDragging) return // owned by the drag in flight
    dragSongs = [...next]
  })

  function onDndConsider(e: CustomEvent<{ items: ProjectSongEntry[] }>) {
    isDragging = true
    dragSongs = e.detail.items
  }

  async function onDndFinalize(e: CustomEvent<{ items: ProjectSongEntry[] }>) {
    dragSongs = e.detail.items
    actionError = ''
    // Keep `isDragging` true until the manifest write resolves. Otherwise the
    // sync $effect re-mirrors the store before our commit lands, briefly
    // reverting the list to its pre-drop order (the visual "snap-back" bug).
    try {
      await setSongOrder(dragSongs.map((s) => s.id))
    } catch (err) {
      actionError = err instanceof Error ? err.message : 'Reorder failed'
    } finally {
      isDragging = false
    }
  }

  async function onToggleHidden(entry: ProjectSongEntry) {
    actionError = ''
    try {
      await setSongHidden(entry.id, !entry.hidden)
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Hide toggle failed'
    }
  }

  function askRemove(entry: ProjectSongEntry) {
    const title = $project.metadataByFolder[entry.folder]?.title ?? entry.folder
    removeTarget = { id: entry.id, title }
    removeDialogOpen = true
  }

  async function askExport(entry: ProjectSongEntry) {
    const title = $project.metadataByFolder[entry.folder]?.title ?? entry.folder
    // Load the song into the editor so its SongMap is available for
    // synthesising the click track on the fly. Cheap if it's already active.
    if ($project.activeSongId !== entry.id) {
      try {
        await loadProjectSongIntoEditor(entry.id)
      } catch (e) {
        actionError = e instanceof Error ? e.message : 'Could not load song for export'
        return
      }
    }
    exportTarget = { folder: entry.folder, title }
    exportDialogOpen = true
  }

  async function onRemoveConfirmed(deleteFiles: boolean) {
    if (!removeTarget) return
    const id = removeTarget.id
    removeTarget = null
    actionError = ''
    try {
      const r = await removeSongFromProject(id, { deleteFiles })
      if (deleteFiles && !r.filesRemoved) {
        actionError = 'Song removed from project, but files could not be deleted from disk.'
      }
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Remove failed'
    }
  }

  let newSongDialogOpen = $state(false)
  let renameSongDialogOpen = $state(false)
  let renameSongTarget = $state<{ id: string; title: string } | null>(null)

  function onAddCreateNew() {
    actionError = ''
    newSongDialogOpen = true
  }

  function askRenameSong(entry: ProjectSongEntry) {
    const meta = $project.metadataByFolder[entry.folder]
    renameSongTarget = {
      id: entry.id,
      title: meta?.title ?? entry.folder.replace(/^songs\//, ''),
    }
    renameSongDialogOpen = true
  }

  // ── Attach-audio flow ────────────────────────────────────────────────
  // One shared dialog handles both local files and YouTube URL imports.
  // The target song id is captured before the dialog opens so direct
  // project-audio YouTube jobs can write straight into that song folder.
  let attachAudioDialogOpen = $state(false)
  let attachAudioTargetId = $state<string | null>(null)
  let attachAudioBusyId = $state<string | null>(null)

  function onAttachAudio(entry: ProjectSongEntry) {
    actionError = ''
    attachAudioTargetId = entry.id
    attachAudioDialogOpen = true
  }

  const attachAudioYoutubeOutput = $derived.by<YoutubeImportOutput>(() => {
    const songId = attachAudioTargetId
    const entry = $project.data?.songs.find((s) => s.id === songId)
    if ($project.osPath && entry) {
      return { kind: 'project-audio', projectPath: $project.osPath, songFolder: entry.folder }
    }
    return { kind: 'temp' }
  })

  async function onAttachLocalAudio(file: File) {
    const songId = attachAudioTargetId
    if (!file || !songId) return
    attachAudioBusyId = songId
    actionError = ''
    try {
      await attachAudioToSong(songId, file)
      await refreshProjectInfo().catch(() => {})
    } catch (err) {
      actionError = err instanceof Error ? err.message : 'Could not attach audio'
    } finally {
      attachAudioBusyId = null
    }
  }

  async function onAttachImportedAudio(artifact: ImportedAudioArtifact) {
    const songId = attachAudioTargetId
    if (!songId) return
    attachAudioBusyId = songId
    actionError = ''
    try {
      await attachImportedAudioToSong(songId, artifact)
      await refreshProjectInfo().catch(() => {})
    } catch (err) {
      actionError = err instanceof Error ? err.message : 'Could not attach audio'
    } finally {
      attachAudioBusyId = null
    }
  }

  // ── Replace audio (hard reset of a song's derived data) ───────────────────
  let replaceAudioInput = $state<HTMLInputElement | undefined>()
  let replaceTargetId = $state<string | null>(null)

  function onReplaceAudio(entry: ProjectSongEntry) {
    const title = $project.metadataByFolder[entry.folder]?.title || 'this song'
    const ok = confirm(
      `Replace audio for "${title}"?\n\n` +
        `This clears the analyzed grid, chords, sections, and stems for this song. ` +
        `You'll re-analyze the new audio. (Other songs are unaffected.)`,
    )
    if (!ok) return
    replaceTargetId = entry.id
    replaceAudioInput?.click()
  }

  async function onReplaceAudioPicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // allow re-picking the same file later
    const songId = replaceTargetId
    replaceTargetId = null
    if (!file || !songId) return
    attachAudioBusyId = songId
    actionError = ''
    try {
      await replaceAudioForSong(songId, file)
      await refreshProjectInfo().catch(() => {})
    } catch (err) {
      actionError = err instanceof Error ? err.message : 'Could not replace audio'
    } finally {
      attachAudioBusyId = null
    }
  }

  $effect(() => {
    if (!attachAudioDialogOpen && !attachAudioBusyId) {
      attachAudioTargetId = null
    }
  })

  async function onSongAdded() {
    // After "Add empty" commits, refresh project info so the new card
    // shows its (empty) stem/click/cue badges right away. Navigation
    // doesn't happen here — user stays on the project page.
    await refreshProjectInfo().catch(() => {})
  }

  function onAddImportLocal() {
    smapImportInput?.click()
  }

  async function onSmapPicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    actionError = ''
    try {
      const sp = await readSmapJsonOnly(file)
      const meta = metadataLiteFromSongMap(sp.songMap)
      await importSmapToProject(file, meta)
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Import failed'
    }
  }

  let songs = $derived($project.data?.songs ?? [])
</script>

<main class="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-12 sm:px-6">
  {#if restoring}
    <p class="text-muted-foreground text-sm">Restoring project…</p>
  {:else if !$project.data}
    <header class="border-foreground border-b-2 pb-4">
      <h1 class="font-display text-3xl font-black tracking-tight">Projects</h1>
    </header>

    <div class="grid gap-3 sm:grid-cols-2">
      <button
        type="button"
        class="brutalist-shadow border-foreground bg-foreground text-background flex flex-col items-start gap-1.5 border-2 p-4 text-left"
        onclick={() => (newProjectDialogOpen = true)}
      >
        <FolderPlus class="size-5" aria-hidden="true" />
        <span class="text-base font-bold">New project</span>
        <span class="text-background/70 text-xs">Create a fresh project folder on disk.</span>
      </button>
      <button
        type="button"
        class="brutalist-shadow-sm border-foreground bg-background flex flex-col items-start gap-1.5 border-2 p-4 text-left hover:bg-foreground/5"
        onclick={() => void browseAndOpen()}
      >
        <FolderOpen class="size-5" aria-hidden="true" />
        <span class="text-base font-bold">Open project…</span>
        <span class="text-muted-foreground text-xs">Browse for an existing BarBro project folder.</span>
      </button>
    </div>

    {#if openError}
      <p class="text-destructive text-sm" role="status">{openError}</p>
    {/if}

    {#if recentEntries.length > 0}
      <section class="space-y-2">
        <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recent</h2>
        <ul class="border-foreground/20 border-2 divide-foreground/10 divide-y">
          {#each recentEntries as r (r.path)}
            <li>
              <button
                type="button"
                class="hover:bg-foreground/5 flex w-full items-center gap-3 px-3 py-2 text-left disabled:opacity-50"
                onclick={() => void openRecent(r)}
                disabled={openingPath !== null}
              >
                <FolderOpen class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold">{r.label}</p>
                  <p class="text-muted-foreground truncate font-mono text-[11px]">{r.path}</p>
                </div>
                {#if openingPath === r.path}
                  <span class="text-muted-foreground text-xs">Opening…</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!--
      Shared with me: cloud projects the signed-in user is a member of.
      Click "Join here" → opens JoinCloudProjectDialog which materializes a
      fresh local copy + pulls metadata. Audio doesn't sync (Phase 6's job)
      so each song lands with an "audio missing" badge until relinked.
    -->
    <!--
      Invited to: cloud projects whose owner sent an invite to this
      user's email BUT they haven't accepted yet. Accepting promotes
      the pending row to a membership server-side, then opens
      JoinCloudProjectDialog to materialize the local copy.
    -->
    {#if myInvites.length > 0 || myInvitesLoading}
      <section class="space-y-2">
        <h2 class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <MailOpen class="size-3.5" aria-hidden="true" />
          Invited to
          {#if myInvitesLoading}
            <span class="text-muted-foreground/60 normal-case">loading…</span>
          {/if}
        </h2>
        {#if myInvites.length > 0}
          <ul class="border-foreground/20 border-2 divide-foreground/10 divide-y">
            {#each myInvites as inv (inv.id)}
              <li class="flex items-center gap-3 px-3 py-2">
                <MailOpen class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold">{inv.project_name || 'Untitled project'}</p>
                  <p class="text-muted-foreground truncate font-mono text-[11px]">
                    invited as {inv.role}
                  </p>
                </div>
                <Button
                  class=""
                  size="sm"
                  onclick={() => void onAcceptInvite(inv)}
                  disabled={acceptingInviteId === inv.id}
                >
                  {acceptingInviteId === inv.id ? 'Accepting…' : 'Accept & join'}
                </Button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if acceptError}
          <p class="text-destructive text-xs" role="status">{acceptError}</p>
        {/if}
      </section>
    {/if}

    <section class="space-y-2">
      <h2 class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <Cloud class="size-3.5" aria-hidden="true" />
        Shared with me
        {#if cloudProjectsLoading}
          <span class="text-muted-foreground/60 normal-case">loading…</span>
        {/if}
      </h2>
      {#if cloudProjects.length === 0 && !cloudProjectsLoading}
        <p class="border-foreground/20 border-2 border-dashed p-3 text-xs text-muted-foreground">
          No shared projects yet. When someone invites you, it'll show up here.
        </p>
      {:else if cloudProjects.length > 0}
        <ul class="border-foreground/20 border-2 divide-foreground/10 divide-y">
          {#each cloudProjects as c (c.id)}
            <li class="flex items-center gap-3 px-3 py-2">
              <Cloud class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold">{c.name}</p>
                <p class="text-muted-foreground truncate font-mono text-[11px]">
                  rev {c.revision} · updated {new Date(c.updated_at).toLocaleDateString()}
                </p>
              </div>
              <Button class="" variant="outline" size="sm" onclick={() => startJoin(c)}>
                Join here
              </Button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if restoreError}
      <p class="text-destructive text-xs" role="status">{restoreError}</p>
    {/if}
  {:else}
    <header class="border-foreground border-b-2 pb-4">
      <input
        type="text"
        class="font-display border-foreground/0 bg-transparent w-full border-b-2 pb-1 text-3xl font-black tracking-tight focus:border-foreground focus:outline-none"
        placeholder="Untitled project"
        bind:value={renameInput}
        onblur={commitNameRename}
        onkeydown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
        }}
      />
      <div class="mt-2 flex flex-wrap items-center gap-3">
        <p class="text-muted-foreground text-xs">
          {songs.length} song{songs.length === 1 ? '' : 's'}
        </p>
        <Button
          variant="outline"
          size="sm"
          class="ml-auto gap-1"
          onclick={() => (settingsDialogOpen = true)}
          title="Project settings — automatic stem preparation"
        >
          <Settings class="size-3.5" aria-hidden="true" />
          Settings
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="gap-1"
          onclick={() => (shareDialogOpen = true)}
          title="Invite collaborators or manage cloud sync for this project"
        >
          <Share2 class="size-3.5" aria-hidden="true" />
          Share
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="gap-1"
          disabled={refreshing}
          onclick={() => void onRefreshProject()}
          title="Re-scan every song folder for stems and metadata changes"
        >
          <RefreshCw class="size-3.5 {refreshing ? 'animate-spin' : ''}" aria-hidden="true" />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {#if refreshMsg}
        <p class="text-muted-foreground mt-1 truncate text-xs" role="status" title={refreshMsgTitle || refreshMsg}>
          {refreshMsg}
        </p>
      {/if}
    </header>

    <CloudCollabSection />

    {#if actionError}
      <p class="text-destructive text-sm" role="status">{actionError}</p>
    {/if}

    {#if dragSongs.length === 0}
      <div class="border-foreground/40 border-2 border-dashed p-8 text-center">
        <p class="text-muted-foreground text-sm">No songs yet. Add the first one below.</p>
      </div>
    {:else}
      <div class="flex flex-col">
        <!--
          Sticky column header. Single-letter stem labels with full names in
          `title` for hover (the rows below are dots only, so the letter is
          enough to anchor the column visually).
        -->
        <div
          class="song-row-grid border-foreground bg-muted text-muted-foreground sticky top-0 z-10 h-8 items-center gap-2 rounded-none border-2 px-2 text-[10px] font-semibold uppercase tracking-wider"
          role="row"
        >
          <span aria-hidden="true"></span>
          <span class="truncate text-center" title="Setlist position">#</span>
          <span class="truncate">Song</span>
          <span class="truncate">Key</span>
          <span class="truncate text-right">BPM</span>
          <span class="flex items-center justify-center" title="Audio file present">
            <Music4 class="size-3" aria-hidden="true" />
          </span>
          {#each STEM_TRACKS as t (t.name)}
            <span class="truncate text-center" title={t.name === 'FX' ? 'Other' : t.name}>
              {t.name === 'FX' ? 'O' : t.name.charAt(0)}
            </span>
          {/each}
          <span class="truncate text-center" title="Cue track">C</span>
          <span aria-hidden="true"></span>
          <span aria-hidden="true"></span>
        </div>

        <!--
          Drag-and-drop reorderable list. svelte-dnd-action uses `id` on each
          item by default, which ProjectSongEntry already provides. We mirror
          the store into `dragSongs` so the action can mutate it during the
          gesture; the commit happens in `onDndFinalize`.
        -->
        <ul
          use:dndzone={{ items: dragSongs, flipDurationMs: 260, dropTargetStyle: {} }}
          onconsider={(e) => onDndConsider(e as CustomEvent<{ items: ProjectSongEntry[] }>)}
          onfinalize={(e) => onDndFinalize(e as CustomEvent<{ items: ProjectSongEntry[] }>)}
          class="border-foreground border-x-2 border-b-2 flex flex-col"
        >
          {#each dragSongs as entry, index (entry.id)}
            <ProjectSongCard
              {entry}
              position={index + 1}
              metadata={$project.metadataByFolder[entry.folder]}
              onEdit={() => void onEditSong(entry.id)}
              onOpenStems={() => void onOpenStems(entry)}
              onToggleHidden={() => void onToggleHidden(entry)}
              onRemove={() => askRemove(entry)}
              onRename={() => askRenameSong(entry)}
              onAttachAudio={() => onAttachAudio(entry)}
              onReplaceAudio={() => onReplaceAudio(entry)}
              onExport={() => void askExport(entry)}
            />
          {/each}
        </ul>
      </div>
    {/if}

    <div class="border-foreground border-2 p-4">
      <DropdownMenu>
        <DropdownMenuTrigger>
          {#snippet child({ props })}
            <Button class="w-full gap-2" {...props}>
              <Plus class="size-4" aria-hidden="true" />
              Add song
            </Button>
          {/snippet}
        </DropdownMenuTrigger>
        <DropdownMenuContent class="min-w-[14rem]">
          <DropdownMenuItem class="cursor-pointer" onclick={onAddCreateNew}>
            <ListPlus class="mr-2 size-4" aria-hidden="true" />
            Create new song
          </DropdownMenuItem>
          <DropdownMenuItem class="cursor-pointer" onclick={onAddImportLocal}>
            Import local .smap…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    {#if songs.length > 0}
      <div class="border-foreground/40 flex items-center gap-3 border-2 border-dashed px-4 py-3">
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold">Setlist · Ableton Live 12</p>
          <p class="text-muted-foreground text-[11px]">
            One .als with a scene per song. Click track is re-rendered fresh on every export.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="shrink-0 gap-1"
          disabled={!$desktopCompanionStatus.reachable}
          onclick={openSetlistExport}
          title={!$desktopCompanionStatus.reachable
            ? 'Setlist export needs the BarBro desktop client running.'
            : 'Open the export dialog'}
        >
          <Music4 class="size-3.5" aria-hidden="true" />
          Export .als
        </Button>
      </div>
    {/if}

    <input
      bind:this={smapImportInput}
      type="file"
      class="sr-only"
      accept=".smap"
      onchange={onSmapPicked}
    />

    <input
      bind:this={replaceAudioInput}
      type="file"
      class="sr-only"
      accept=".wav,.mp3,.m4a,.flac,.ogg,.aif,.aiff,audio/*"
      onchange={onReplaceAudioPicked}
    />

    <AddAudioDialog
      bind:open={attachAudioDialogOpen}
      accept=".wav,.mp3,.m4a,.flac,.ogg,.aif,.aiff,audio/*"
      youtubeOutput={attachAudioYoutubeOutput}
      desktopReachable={$desktopCompanionStatus.reachable}
      onFile={onAttachLocalAudio}
      onImported={onAttachImportedAudio}
    />

    <ProjectSettingsDialog bind:open={settingsDialogOpen} />
  {/if}
</main>

<RemoveSongDialog
  bind:open={removeDialogOpen}
  songTitle={removeTarget?.title ?? ''}
  onConfirm={onRemoveConfirmed}
/>

<ExportBackingTrackDialog
  bind:open={exportDialogOpen}
  projectPath={$project.osPath}
  songFolder={exportTarget?.folder ?? null}
  songTitle={exportTarget?.title ?? ''}
  metadata={exportTarget ? $project.metadataByFolder[exportTarget.folder] : undefined}
  songMap={$songMap}
/>

<StemsDialog bind:open={stemsDialogOpen} entry={stemsTarget} />

<NewProjectDialog bind:open={newProjectDialogOpen} onCreated={refreshRecents} />

<NewSongDialog bind:open={newSongDialogOpen} onCreated={onSongAdded} />

<RenameSongDialog
  bind:open={renameSongDialogOpen}
  songId={renameSongTarget?.id ?? null}
  currentTitle={renameSongTarget?.title ?? ''}
/>

<JoinCloudProjectDialog
  bind:open={joinDialogOpen}
  cloudProject={joinTarget}
  onJoined={refreshRecents}
/>

<ShareProjectDialog bind:open={shareDialogOpen} />

<SetlistExportDialog
  bind:open={setlistExportOpen}
  preflight={setlistPreflight}
  status={setlistExportStatus}
  message={setlistExportMsg}
  onConfirm={() => void runSetlistExport()}
  onClose={closeSetlistExport}
/>

<!--
  `:global` puts this class in the document's stylesheet so it stays in scope
  for the dragged-row shadow that `svelte-dnd-action` lifts out of the dndzone
  (the shadow's CSS-variable inheritance is lost when it's reparented under
  <body>). The header and every row share this template so columns line up
  even mid-drag.
    handle (24) | # (24) | title (1fr) | key (80) | bpm (40) | audio (28) |
    5× stem (28) | cue (28) | edit (32) | ⋮ (32)
-->
<style>
  :global(.song-row-grid) {
    display: grid;
    grid-template-columns:
      1.5rem
      1.5rem
      minmax(0, 1fr)
      5rem
      2.5rem
      1.75rem
      repeat(5, 1.75rem)
      1.75rem
      2rem
      2rem;
  }
</style>
