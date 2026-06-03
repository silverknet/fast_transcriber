<script lang="ts">
  /**
   * `/account` — simple signed-in shell.
   *
   * Today: shows who you are + sign-out. Tomorrow (Phase 4+): lists shared
   * cloud projects + outgoing/incoming invites + member management. Built
   * as a single page so the future collab sections drop in as new
   * <section>s without route restructuring.
   *
   * Signed-out users never see this — `+page.server.ts` redirects them to
   * `/login?next=/account`.
   */
  import { Button } from '$lib/components/ui/button'
  import { LogOut, Users, FolderGit2 } from '@lucide/svelte'

  let { data } = $props<{
    data: {
      accountUser: {
        id: string
        email: string | null
        name: string | null
        avatarUrl: string | null
        createdAt: string
        provider: string
      }
      cloudProjects: Array<{
        id: string
        name: string
        revision: number
        updatedAt: string
        isOwner: boolean
      }>
    }
  }>()

  const u = $derived(data.accountUser)
  const initial = $derived(
    (u.name?.[0] ?? u.email?.[0] ?? '?').toUpperCase(),
  )
</script>

<svelte:head>
  <title>Account · BarBro</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6">
  <header class="border-foreground border-b-2 pb-4">
    <h1 class="text-3xl font-black tracking-tight">Account</h1>
  </header>

  <!-- Profile -->
  <section class="border-foreground border-2 p-4 space-y-4">
    <div class="flex items-center gap-4">
      {#if u.avatarUrl}
        <img
          src={u.avatarUrl}
          alt=""
          class="border-foreground size-12 shrink-0 border-2 object-cover"
          referrerpolicy="no-referrer"
        />
      {:else}
        <div
          class="border-foreground bg-muted text-foreground flex size-12 shrink-0 items-center justify-center border-2 text-lg font-black"
          aria-hidden="true"
        >
          {initial}
        </div>
      {/if}
      <div class="min-w-0 flex-1">
        <p class="truncate font-semibold">{u.name ?? u.email ?? 'Signed in'}</p>
        {#if u.email && u.name}
          <p class="text-muted-foreground truncate text-xs">{u.email}</p>
        {/if}
      </div>
    </div>

    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
      <dt class="text-muted-foreground">Signed in via</dt>
      <dd class="font-mono">{u.provider}</dd>
      <dt class="text-muted-foreground">Account created</dt>
      <dd class="font-mono">{new Date(u.createdAt).toLocaleString()}</dd>
      <dt class="text-muted-foreground">User ID</dt>
      <dd class="text-foreground/60 truncate font-mono">{u.id}</dd>
    </dl>

    <form method="POST" action="/logout">
      <Button type="submit" variant="outline" size="sm" class="gap-2">
        <LogOut class="size-4" aria-hidden="true" />
        Sign out
      </Button>
    </form>
  </section>

  <!--
    Collaboration placeholders. Empty for now — Phase 2 lights up the
    cloud-projects list, Phase 4 adds "Create cloud project" / "Join",
    and a later phase adds member management.
  -->
  <section class="border-foreground border-2 p-4 space-y-3">
    <h2 class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
      <FolderGit2 class="size-4" aria-hidden="true" />
      Shared projects ({data.cloudProjects.length})
    </h2>
    {#if data.cloudProjects.length === 0}
      <p class="text-muted-foreground text-sm">
        You haven't enabled collaboration on any project yet. Open a project and click
        <span class="font-semibold">Enable Collaboration</span> to start syncing.
      </p>
    {:else}
      <ul class="border-foreground/20 border divide-foreground/10 divide-y">
        {#each data.cloudProjects as p (p.id)}
          <li class="flex items-center justify-between gap-3 px-3 py-2">
            <div class="min-w-0 flex-1">
              <p class="truncate font-semibold text-sm">{p.name}</p>
              <p class="text-muted-foreground text-[11px] font-mono">
                rev {p.revision} · updated {new Date(p.updatedAt).toLocaleString()}
              </p>
            </div>
            <span
              class="text-[10px] font-bold uppercase tracking-wider {p.isOwner
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-muted-foreground'}"
            >
              {p.isOwner ? 'owner' : 'editor'}
            </span>
          </li>
        {/each}
      </ul>
      <p class="text-muted-foreground text-[11px]">
        To open a shared project, use File → Open Project from a machine with its folder
        on disk. (Phase 6 will add an "Open from cloud" flow that creates a fresh local
        folder and pulls metadata down.)
      </p>
    {/if}
  </section>

  <section class="border-foreground/40 border-2 border-dashed p-4 space-y-2">
    <h2 class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
      <Users class="size-4" aria-hidden="true" />
      Collaborators
    </h2>
    <p class="text-muted-foreground text-sm">
      You aren't collaborating with anyone yet. Invites you receive will appear here.
    </p>
  </section>
</main>
