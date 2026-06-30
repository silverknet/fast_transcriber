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
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import { Cloud, Trash2, UserPlus, X } from '@lucide/svelte'
  import { page } from '$app/stores'
  import { project } from '$lib/stores/project'
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
  const cloud = $derived(proj?.cloud ?? null)
  const userId = $derived(($page.data?.user as { id?: string } | undefined)?.id ?? null)

  let busy = $state(false)
  let errorMsg = $state('')
  let infoMsg = $state('')
  let confirmDisable = $state(false)

  let members = $state<CloudMemberView[]>([])
  let pending = $state<CloudPendingInviteView[]>([])
  let inviteEmail = $state('')
  let inviteRole = $state<'editor' | 'owner'>('editor')

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
        collaborators — the project syncs to Supabase so changes show up on
        their machine.
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
              <li class="flex items-center justify-between gap-3 px-2 py-1.5">
                <span class="truncate font-mono">
                  {m.user_id === userId ? 'you' : `${m.user_id.slice(0, 8)}…`}
                </span>
                <span class="text-muted-foreground text-[10px] uppercase">{m.role}</span>
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
        You're the owner. Disabling deletes the cloud project for everyone —
        members lose access, sync history is gone. Local files on disk are untouched.
      </p>
    {:else}
      <p class="text-sm">
        Removes this project's cloud link on your machine. The cloud project
        stays — other members keep using it. Local files on disk are untouched.
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
