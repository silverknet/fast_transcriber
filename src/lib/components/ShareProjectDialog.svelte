<script lang="ts">
  /**
   * Project sharing dialog — the prominent "Share" entrypoint on the
   * project page header. Combines what was scattered before:
   *
   *   - Enable cloud sync (if not already enabled)
   *   - Members list with role pills
   *   - Invite form (email + role) with friendly "pending" feedback
   *   - Pending invites with revoke
   *   - Disable cloud sync (destructive footer)
   *
   * Pending invites bridge the "invitee hasn't signed up yet" gap: the
   * `POST /members` endpoint quietly creates a `cloud_pending_invites`
   * row when it can't find the email's auth user, and the
   * access-gate hook auto-promotes those rows to memberships on the
   * invitee's first sign-in.
   */
  import { Button } from '$lib/components/ui/button'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import { Cloud, Download, Trash2, Upload, UserPlus, X } from '@lucide/svelte'
  import { browser } from '$app/environment'
  import { page } from '$app/stores'
  import { project } from '$lib/stores/project'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { refreshProjectInfo } from '$lib/project/commit'
  import {
    pickSaveFileViaDesktop,
    pickOpenFileViaDesktop,
    exportHydrationPackViaDesktop,
    importHydrationPackViaDesktop,
    type HydrationImportResult,
  } from '$lib/client/desktopBridge'
  import {
    createCloudProject,
    disableCloudProject,
    getCloudProjectManifest,
    listPendingInvites,
    revokePendingInvite,
    type CloudMemberView,
    type CloudPendingInviteView,
  } from '$lib/client/cloudSync'

  let { open = $bindable(false) }: { open?: boolean } = $props()

  const proj = $derived($project.data)
  const osPath = $derived($project.osPath)
  const cloud = $derived(proj?.cloud ?? null)
  interface PageUser {
    id?: string
    email?: string | null
    name?: string | null
  }

  const pageUser = $derived(($page.data?.user as PageUser | null | undefined) ?? null)
  const userId = $derived(pageUser?.id ?? null)

  let busy = $state(false)
  let errorMsg = $state('')
  let infoMsg = $state('')
  let confirmDisable = $state(false)

  let members = $state<CloudMemberView[]>([])
  let pending = $state<CloudPendingInviteView[]>([])
  let inviteEmail = $state('')
  let inviteRole = $state<'editor' | 'owner'>('editor')

  function cleanMemberValue(value: string | null | undefined): string | null {
    const trimmed = value?.trim()
    return trimmed ? trimmed : null
  }

  function memberPrimary(member: CloudMemberView): string {
    if (member.user_id === userId) return 'you'
    return (
      cleanMemberValue(member.display_name) ??
      cleanMemberValue(member.email) ??
      'Unknown member'
    )
  }

  function memberSecondary(member: CloudMemberView): string {
    const email = cleanMemberValue(member.email)
    const name = cleanMemberValue(member.display_name)
    if (member.user_id === userId) return cleanMemberValue(pageUser?.email) ?? email ?? ''
    if (name && email && name.toLowerCase() !== email.toLowerCase()) return email
    return ''
  }

  function memberInitial(member: CloudMemberView): string {
    const label =
      member.user_id === userId
        ? (cleanMemberValue(pageUser?.name) ?? cleanMemberValue(pageUser?.email))
        : (cleanMemberValue(member.display_name) ?? cleanMemberValue(member.email))
    return (label ?? '?').slice(0, 1).toUpperCase()
  }

  function memberRoleLabel(member: CloudMemberView): string {
    return member.role === 'owner' ? 'Owner' : 'Editor'
  }

  // ── Audio package (hydration) ────────────────────────────────────────────
  // Cloud sync carries the grid/chords/sections, NOT the audio (too big to
  // upload). Collaborators fill in the sound by importing an audio package the
  // owner exports. Lives here because it's part of getting a shared project
  // playable on someone else's machine.
  let hydrationBusy = $state(false)
  let hydrationError = $state('')
  let hydrationStatus = $state('')
  let hydrationImportOpen = $state(false)
  let hydrationImport = $state<Extract<HydrationImportResult, { ok: true }> | null>(null)

  function projectFileBaseName(): string {
    const name = proj?.name ?? 'project'
    return name.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
  }

  async function onExportAudioPackage() {
    hydrationError = ''
    hydrationStatus = ''
    if (!browser || !osPath || !proj) {
      hydrationError = 'Open a project first.'
      return
    }
    if (!$desktopCompanionStatus.reachable) {
      hydrationError = 'Desktop client unreachable — start BarBro desktop and try again.'
      return
    }
    hydrationBusy = true
    try {
      const pick = await pickSaveFileViaDesktop({
        title: 'Export audio package',
        defaultPath: `${projectFileBaseName()}-audio.zip`,
        filters: [{ name: 'BarBro audio package', extensions: ['zip'] }],
      })
      if (!pick.ok) {
        if (!('cancelled' in pick)) hydrationError = pick.error ?? 'Could not open save dialog'
        return
      }
      const result = await exportHydrationPackViaDesktop({ projectPath: osPath, outPath: pick.path })
      if (!result.ok) {
        hydrationError = result.error || 'Export failed.'
        return
      }
      const mb = (result.packSize / 1_048_576).toFixed(1)
      const songWord = result.songCount === 1 ? 'song' : 'songs'
      hydrationStatus = `Exported ${result.songCount} ${songWord} (${mb} MB) — send this file to your collaborators.`
    } finally {
      hydrationBusy = false
    }
  }

  // ── Cloud audio (browser-only members) ───────────────────────────────────
  // Uploads a compressed AAC copy (mix + stems) so members WITHOUT the desktop
  // app can play in the browser. The HD WAV master stays on the creator's disk.
  let cloudAudioBusy = $state(false)
  let cloudAudioError = $state('')
  let cloudAudioStatus = $state('')

  async function onPrepareCloudAudio(limit?: number) {
    cloudAudioError = ''
    cloudAudioStatus = ''
    if (!browser || !osPath || !proj) {
      cloudAudioError = 'Open a project first.'
      return
    }
    if (!cloud) {
      cloudAudioError = 'Enable cloud sync for this project first.'
      return
    }
    if (!$desktopCompanionStatus.reachable) {
      cloudAudioError = 'Desktop client unreachable — start BarBro desktop and try again.'
      return
    }
    cloudAudioBusy = true
    try {
      const { uploadProjectCloudAudio } = await import('$lib/client/cloudAudioSync')
      const results = await uploadProjectCloudAudio({
        limit,
        onProgress: (m) => {
          cloudAudioStatus = m
        },
      })
      const ok = results.filter((r) => r.ok).length
      const failed = results.filter((r) => !r.ok)
      cloudAudioStatus = `Prepared ${ok}/${results.length} song(s) for browser members.`
      if (failed.length) cloudAudioError = failed.map((f) => `${f.title}: ${f.error}`).join(' · ')
    } catch (e) {
      cloudAudioError = e instanceof Error ? e.message : String(e)
    } finally {
      cloudAudioBusy = false
    }
  }

  async function onImportAudioPackage() {
    hydrationError = ''
    hydrationStatus = ''
    if (!browser || !osPath || !proj) {
      hydrationError = 'Open a project first.'
      return
    }
    if (!$desktopCompanionStatus.reachable) {
      hydrationError = 'Desktop client unreachable — start BarBro desktop and try again.'
      return
    }
    hydrationBusy = true
    try {
      const pick = await pickOpenFileViaDesktop({
        title: 'Import audio package',
        filters: [{ name: 'BarBro audio package', extensions: ['zip'] }],
      })
      if (!pick.ok) {
        if (!('cancelled' in pick)) hydrationError = pick.error ?? 'Could not open file picker'
        return
      }
      const result = await importHydrationPackViaDesktop({ projectPath: osPath, packPath: pick.path })
      if (!result.ok) {
        hydrationError = result.error || 'Import failed.'
        return
      }
      // Refresh so the freshly-imported audio + stems light up on the cards.
      try {
        await refreshProjectInfo()
      } catch (e) {
        console.warn('refreshProjectInfo after audio-package import failed:', e)
      }
      hydrationImport = result
      hydrationImportOpen = true
    } finally {
      hydrationBusy = false
    }
  }

  /** Accepted (access-granted) BarBro users — admin only — for invite autocomplete. */
  let grantedEmails = $state<string[]>([])
  const isAdmin = $derived(($page.data?.isAdmin as boolean | undefined) ?? false)
  /** Suggest accepted users not already invited/pending on this project. */
  const suggestEmails = $derived(
    grantedEmails.filter((e) => !pending.some((p) => p.invited_email.toLowerCase() === e)),
  )

  async function loadGrantedEmails() {
    if (!isAdmin) return
    try {
      const res = await fetch('/api/admin/granted-emails')
      if (!res.ok) return
      const out = (await res.json()) as { ok?: boolean; emails?: string[] }
      grantedEmails = Array.isArray(out.emails) ? out.emails : []
    } catch {
      /* autocomplete is a nicety — fail silently, manual typing still works */
    }
  }

  const isOwner = $derived.by(() => {
    if (!cloud || !userId) return false
    return members.some((m) => m.user_id === userId && m.role === 'owner')
  })

  async function refresh() {
    if (!cloud) {
      members = []
      pending = []
      return
    }
    const [m, p] = await Promise.all([
      getCloudProjectManifest(cloud.projectId),
      listPendingInvites(cloud.projectId),
    ])
    members = m?.members ?? []
    pending = p
  }

  $effect(() => {
    if (open) {
      errorMsg = ''
      infoMsg = ''
      void refresh()
      void loadGrantedEmails()
    }
  })

  async function onEnable() {
    busy = true
    errorMsg = ''
    infoMsg = ''
    const r = await createCloudProject()
    busy = false
    if (!r.ok) errorMsg = r.error
    else void refresh()
  }

  async function onInvite() {
    if (!cloud) return
    const email = inviteEmail.trim()
    if (!email) return
    busy = true
    errorMsg = ''
    infoMsg = ''
    const res = await fetch(`/api/cloud/projects/${cloud.projectId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role: inviteRole }),
    })
    busy = false
    if (!res.ok) {
      errorMsg = (await res.text().catch(() => '')) || `HTTP ${res.status}`
      return
    }
    const out = (await res.json().catch(() => null)) as
      | { ok: boolean; pending?: boolean }
      | null
    if (out?.pending) {
      infoMsg = `Invite queued — ${email} will see it when they sign in.`
    } else {
      infoMsg = `${email} added as ${inviteRole}.`
    }
    inviteEmail = ''
    void refresh()
  }

  async function onRevoke(id: string) {
    if (!cloud) return
    busy = true
    const r = await revokePendingInvite(cloud.projectId, id)
    busy = false
    if (!r.ok) errorMsg = r.error
    else void refresh()
  }

  async function onDisable() {
    confirmDisable = false
    busy = true
    errorMsg = ''
    const r = await disableCloudProject({ deleteRemote: isOwner })
    busy = false
    if (!r.ok) errorMsg = r.error
    else open = false
  }
</script>

<Dialog bind:open>
  <DialogContent class="max-w-lg">
    <DialogHeader class="">
      <DialogTitle>Share project</DialogTitle>
    </DialogHeader>

    {#if !cloud}
      <p class="text-sm text-muted-foreground">
        Cloud sync isn't enabled for this project yet. Enable it to invite
        collaborators and keep changes up to date on their machine.
      </p>
      <DialogFooter class="">
        <Button class="" variant="outline" onclick={() => (open = false)}>Cancel</Button>
        <Button class="gap-2" onclick={() => void onEnable()} disabled={busy}>
          <Cloud class="size-4" aria-hidden="true" />
          {busy ? 'Enabling…' : 'Enable cloud sync'}
        </Button>
      </DialogFooter>
    {:else}
      <div class="space-y-4">
        <!-- Members -->
        <div class="space-y-2">
          <h3 class="text-muted-foreground text-xs font-bold uppercase tracking-wider">
            Members ({members.length})
          </h3>
          <ul class="border-foreground/20 divide-foreground/10 divide-y border text-xs">
            {#each members as m (m.user_id)}
              <li class="flex items-center justify-between gap-3 px-2 py-2">
                <span class="flex min-w-0 items-center gap-2">
                  <span
                    class="border-foreground/25 bg-muted grid size-7 shrink-0 place-items-center rounded-md border text-[11px] font-bold"
                    aria-hidden="true"
                  >
                    {memberInitial(m)}
                  </span>
                  <span class="min-w-0">
                    <span class="block truncate font-semibold">{memberPrimary(m)}</span>
                    {#if memberSecondary(m)}
                      <span class="text-muted-foreground block truncate text-[11px]">
                        {memberSecondary(m)}
                      </span>
                    {/if}
                  </span>
                </span>
                <span class="text-muted-foreground shrink-0 text-[10px] uppercase">
                  {memberRoleLabel(m)}
                </span>
              </li>
            {/each}
          </ul>
        </div>

        <!-- Invite form (owners only) -->
        {#if isOwner}
          <form
            class="space-y-2"
            onsubmit={(e) => {
              e.preventDefault()
              void onInvite()
            }}
          >
            <h3 class="text-muted-foreground text-xs font-bold uppercase tracking-wider">
              Invite by email
            </h3>
            <div class="flex flex-wrap items-end gap-2">
              <input
                type="email"
                bind:value={inviteEmail}
                placeholder="collaborator@example.com"
                list={suggestEmails.length > 0 ? 'barbro-accepted-emails' : undefined}
                autocomplete="off"
                class="border-foreground/30 bg-background min-w-0 flex-1 border-2 px-2 py-1 text-sm focus:border-foreground focus:outline-none"
              />
              {#if suggestEmails.length > 0}
                <datalist id="barbro-accepted-emails">
                  {#each suggestEmails as e (e)}
                    <option value={e}></option>
                  {/each}
                </datalist>
              {/if}
              <select
                bind:value={inviteRole}
                class="border-foreground/30 bg-background border-2 px-2 py-1 text-sm focus:border-foreground focus:outline-none"
              >
                <option value="editor">editor</option>
                <option value="owner">owner</option>
              </select>
              <Button type="submit" size="sm" class="h-9 gap-1" disabled={busy || !inviteEmail.trim()}>
                <UserPlus class="size-3.5" aria-hidden="true" />
                Invite
              </Button>
            </div>
            <p class="text-muted-foreground text-[11px]">
              If they don't have an account yet, the invite waits and shows up when they first sign in.
            </p>
          </form>
        {/if}

        <!-- Pending invites (owners only) -->
        {#if isOwner && pending.length > 0}
          <div class="space-y-2">
            <h3 class="text-muted-foreground text-xs font-bold uppercase tracking-wider">
              Pending invites ({pending.length})
            </h3>
            <ul class="border-foreground/20 divide-foreground/10 divide-y border text-xs">
              {#each pending as inv (inv.id)}
                <li class="flex items-center justify-between gap-3 px-2 py-1.5">
                  <span class="truncate">{inv.invited_email}</span>
                  <span class="text-muted-foreground text-[10px] uppercase">{inv.role}</span>
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-destructive"
                    title="Revoke invite"
                    onclick={() => void onRevoke(inv.id)}
                    disabled={busy}
                    aria-label="Revoke invite"
                  >
                    <X class="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- Audio package -->
        <div class="border-foreground/15 space-y-2 border-t pt-3">
          <h3 class="text-muted-foreground text-xs font-bold uppercase tracking-wider">
            Audio files
          </h3>
          <p class="text-muted-foreground text-[11px]">
            Edits sync automatically. The audio itself doesn't — send collaborators an
            audio package so their copy has the sound and stems. They import it here too.
          </p>
          <div class="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              class="gap-1"
              disabled={hydrationBusy || !$desktopCompanionStatus.reachable}
              onclick={() => void onExportAudioPackage()}
            >
              <Download class="size-3.5" aria-hidden="true" />
              Export audio package…
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="gap-1"
              disabled={hydrationBusy || !$desktopCompanionStatus.reachable}
              onclick={() => void onImportAudioPackage()}
            >
              <Upload class="size-3.5" aria-hidden="true" />
              Import audio package…
            </Button>
          </div>
          {#if hydrationError}
            <p class="text-destructive text-xs" role="status">{hydrationError}</p>
          {/if}
          {#if hydrationStatus}
            <p class="text-emerald-600 dark:text-emerald-400 text-xs" role="status">{hydrationStatus}</p>
          {/if}
        </div>

        <!-- Cloud audio for browser-only members -->
        <div class="border-foreground/15 space-y-2 border-t pt-3">
          <h3 class="text-muted-foreground text-xs font-bold uppercase tracking-wider">
            Browser audio (no desktop app needed)
          </h3>
          <p class="text-muted-foreground text-[11px]">
            Upload a compressed copy (mix + stems) so members without the desktop app can play and
            collaborate in the browser. Your local HD audio stays the master — the compressed copy
            is only ever used in browser mode.
          </p>
          <div class="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              class="gap-1"
              disabled={cloudAudioBusy || !cloud || !$desktopCompanionStatus.reachable}
              onclick={() => void onPrepareCloudAudio(1)}
              title="Prepare just the first song — a cheap way to confirm it works before the whole setlist."
            >
              <Upload class="size-3.5" aria-hidden="true" />
              {cloudAudioBusy ? 'Preparing…' : 'Test (1 song)'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="gap-1"
              disabled={cloudAudioBusy || !cloud || !$desktopCompanionStatus.reachable}
              onclick={() => void onPrepareCloudAudio()}
            >
              <Upload class="size-3.5" aria-hidden="true" />
              {cloudAudioBusy ? 'Preparing…' : 'Prepare all songs'}
            </Button>
          </div>
          {#if cloudAudioError}
            <p class="text-destructive text-xs" role="status">{cloudAudioError}</p>
          {/if}
          {#if cloudAudioStatus}
            <p class="text-emerald-600 dark:text-emerald-400 text-xs" role="status">{cloudAudioStatus}</p>
          {/if}
        </div>
      </div>

      {#if errorMsg}
        <p class="text-destructive text-xs" role="status">{errorMsg}</p>
      {/if}
      {#if infoMsg}
        <p class="text-emerald-600 dark:text-emerald-400 text-xs" role="status">{infoMsg}</p>
      {/if}

      <DialogFooter class="flex-wrap gap-2">
        <Button
          variant="outline"
          class="text-destructive hover:text-destructive mr-auto gap-1"
          onclick={() => (confirmDisable = true)}
          disabled={busy}
        >
          <Trash2 class="size-3.5" aria-hidden="true" />
          Disable cloud sync
        </Button>
        <Button class="" variant="outline" onclick={() => (open = false)}>Close</Button>
      </DialogFooter>
    {/if}
  </DialogContent>
</Dialog>

<Dialog bind:open={confirmDisable}>
  <DialogContent class="max-w-md">
    <DialogHeader class="">
      <DialogTitle>Disable collaboration?</DialogTitle>
    </DialogHeader>
    {#if isOwner}
      <p class="text-sm">
        You're the owner. Disabling removes the shared project for everyone.
        Members lose access. Local files on disk are untouched.
      </p>
    {:else}
      <p class="text-sm">
        Stops syncing this project on your machine. Other members keep using
        the shared project. Local files on disk are untouched.
      </p>
    {/if}
    <DialogFooter class="">
      <Button class="" variant="outline" onclick={() => (confirmDisable = false)}>Cancel</Button>
      <Button class="text-destructive" variant="outline" onclick={() => void onDisable()}>
        Disable
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

<Dialog bind:open={hydrationImportOpen}>
  <DialogContent
    class="flex max-h-[85vh] w-full max-w-[min(40rem,calc(100%-2rem))] flex-col gap-3 p-4 sm:max-w-[min(40rem,calc(100%-2rem))]"
    showCloseButton={true}
  >
    <DialogHeader class="">
      <DialogTitle>Audio package imported</DialogTitle>
      <DialogDescription>
        {#if hydrationImport}
          {@const s = hydrationImport.summary}
          Matched {s.matchedCount} of {s.packSongCount} songs.
          Wrote {s.audioImported} audio file{s.audioImported === 1 ? '' : 's'}
          and {s.stemsImported} stem file{s.stemsImported === 1 ? '' : 's'}.
          Existing files were left untouched.
        {/if}
      </DialogDescription>
    </DialogHeader>
    {#if hydrationImport && hydrationImport.results.length > 0}
      <ul class="border-foreground/20 divide-foreground/10 max-h-[min(60vh,32rem)] overflow-auto divide-y border-2 text-sm">
        {#each hydrationImport.results as r (r.songId)}
          <li class="px-3 py-2">
            <div class="flex items-center justify-between gap-2">
              <span class="truncate font-medium">{r.title || r.songId}</span>
              <span
                class="shrink-0 text-xs font-semibold uppercase tracking-wider {r.matched
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-muted-foreground'}"
              >
                {r.matched ? 'matched' : 'skipped'}
              </span>
            </div>
            <div class="text-muted-foreground mt-0.5 text-[11px]">
              {#if r.matched}
                {#if r.audioImported}+ audio{:else if r.audioSkipped}audio: kept yours{/if}
                {#if r.audioImported && r.stemsImported > 0} · {/if}
                {#if r.stemsImported > 0}+ {r.stemsImported} stem{r.stemsImported === 1 ? '' : 's'}{/if}
                {#if r.stemsSkipped > 0} · {r.stemsSkipped} stem{r.stemsSkipped === 1 ? '' : 's'} kept{/if}
                {#if !r.audioImported && r.stemsImported === 0 && !r.audioSkipped && r.stemsSkipped === 0}
                  no new files
                {/if}
              {:else}
                {r.notes ?? 'no matching song in this project'}
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </DialogContent>
</Dialog>
