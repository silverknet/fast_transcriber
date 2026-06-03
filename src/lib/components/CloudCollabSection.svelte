<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import { Cloud, CloudOff, RefreshCw, Trash2, UserPlus, Users } from '@lucide/svelte'
  import { page } from '$app/stores'
  import { project } from '$lib/stores/project'
  import {
    createCloudProject,
    disableCloudProject,
    getCloudProjectManifest,
    pullCloudChanges,
    type CloudMemberView,
  } from '$lib/client/cloudSync'

  const proj = $derived($project.data)
  const cloud = $derived(proj?.cloud ?? null)
  const userId = $derived(($page.data?.user as { id?: string } | undefined)?.id ?? null)

  let busy = $state(false)
  let errorMsg = $state('')
  let infoMsg = $state('')
  let confirmOpen = $state(false)

  let members = $state<CloudMemberView[]>([])
  let inviteEmail = $state('')
  let inviteRole = $state<'editor' | 'owner'>('editor')

  const isOwner = $derived.by(() => {
    if (!cloud || !userId) return false
    return members.some((m) => m.user_id === userId && m.role === 'owner')
  })

  $effect(() => {
    if (!cloud) {
      members = []
      return
    }
    void getCloudProjectManifest(cloud.projectId).then((r) => {
      members = r?.members ?? []
    })
  })

  async function onEnable() {
    busy = true
    errorMsg = ''
    infoMsg = ''
    const r = await createCloudProject()
    busy = false
    if (!r.ok) errorMsg = r.error
  }

  async function onPull() {
    if (!cloud) return
    busy = true
    errorMsg = ''
    infoMsg = ''
    const r = await pullCloudChanges()
    busy = false
    if (!r.ok) {
      errorMsg = r.error
      return
    }
    if (cloud) {
      const m = await getCloudProjectManifest(cloud.projectId)
      members = m?.members ?? []
    }
  }

  async function onDisable() {
    confirmOpen = false
    busy = true
    errorMsg = ''
    infoMsg = ''
    const r = await disableCloudProject({ deleteRemote: isOwner })
    busy = false
    if (!r.ok) errorMsg = r.error
  }

  async function onInvite() {
    if (!cloud) return
    const email = inviteEmail.trim()
    if (!email) return
    busy = true
    errorMsg = ''
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
    inviteEmail = ''
    const m = await getCloudProjectManifest(cloud.projectId)
    members = m?.members ?? []
  }
</script>

{#if proj}
  <section class="border-foreground border-2 p-4 space-y-3">
    {#if !cloud}
      <header class="flex items-center justify-between gap-3">
        <h2 class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <CloudOff class="size-4" aria-hidden="true" />
          Collaboration
        </h2>
        <Button onclick={() => void onEnable()} disabled={busy} size="sm" class="gap-2">
          <Cloud class="size-4" aria-hidden="true" />
          {busy ? 'Enabling…' : 'Enable'}
        </Button>
      </header>
    {:else}
      <header class="flex flex-wrap items-center gap-3">
        <h2 class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Cloud class="size-4" aria-hidden="true" />
          Collaboration
        </h2>
        <span class="text-muted-foreground ml-auto text-[11px] font-mono">
          rev {cloud.lastSyncedRevision}
          {#if cloud.pendingChanges && cloud.pendingChanges > 0}
            · {cloud.pendingChanges} pending
          {/if}
        </span>
        <Button
          variant="outline"
          size="sm"
          class="gap-1"
          onclick={() => void onPull()}
          disabled={busy}
        >
          <RefreshCw class="size-3.5 {busy ? 'animate-spin' : ''}" aria-hidden="true" />
          Pull
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="text-destructive hover:text-destructive gap-1"
          onclick={() => (confirmOpen = true)}
          disabled={busy}
        >
          <Trash2 class="size-3.5" aria-hidden="true" />
          Disable
        </Button>
      </header>

      <div class="space-y-2">
        <p class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Users class="size-3.5" aria-hidden="true" />
          Members ({members.length})
        </p>
        <ul class="border-foreground/20 border text-xs divide-foreground/10 divide-y">
          {#each members as m (m.user_id)}
            <li class="flex items-center justify-between gap-3 px-2 py-1.5">
              <span class="font-mono truncate">{m.user_id.slice(0, 8)}…</span>
              <span class="text-muted-foreground uppercase text-[10px]">{m.role}</span>
            </li>
          {/each}
        </ul>

        {#if isOwner}
          <form
            class="flex flex-wrap items-end gap-2 pt-1"
            onsubmit={(e) => {
              e.preventDefault()
              void onInvite()
            }}
          >
            <input
              type="email"
              bind:value={inviteEmail}
              placeholder="email"
              class="border-foreground/30 bg-background min-w-0 flex-1 border-2 px-2 py-1 text-sm focus:border-foreground focus:outline-none"
            />
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
          </form>
        {/if}
      </div>
    {/if}

    {#if errorMsg}
      <p class="text-destructive text-xs" role="status">{errorMsg}</p>
    {/if}
    {#if infoMsg}
      <p class="text-emerald-600 dark:text-emerald-400 text-xs" role="status">{infoMsg}</p>
    {/if}
  </section>

  <Dialog bind:open={confirmOpen}>
    <DialogContent class="max-w-md">
      <DialogHeader class="">
        <DialogTitle>Disable collaboration?</DialogTitle>
      </DialogHeader>
      {#if isOwner}
        <p class="text-sm">
          You're the owner. Disabling deletes the cloud project for everyone — members lose
          access, sync history is gone. Local files on disk are untouched.
        </p>
      {:else}
        <p class="text-sm">
          Removes this project's cloud link on your machine. The cloud project stays — other
          members keep using it. Local files on disk are untouched.
        </p>
      {/if}
      <DialogFooter class="">
        <Button class="" variant="outline" onclick={() => (confirmOpen = false)}>Cancel</Button>
        <Button class="text-destructive" variant="outline" onclick={() => void onDisable()}>
          Disable
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
{/if}
