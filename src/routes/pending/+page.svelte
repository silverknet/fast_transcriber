<script lang="ts">
  /**
   * `/pending` — landing for signed-in users whose access is `pending`
   * or `denied`. Shows their current state and a sign-out fallback.
   * The access gate (decideRouteAccess) routes them here whenever they
   * try to reach a member-only route.
   */
  import { page } from '$app/stores'
  import { Button } from '$lib/components/ui/button'
  import { Mail, LogOut, Clock, Ban } from '@lucide/svelte'

  const status = $derived($page.data.accessStatus as 'pending' | 'denied' | 'none' | 'granted')
  const user = $derived($page.data.user)
</script>

<svelte:head>
  <title>Pending access · BarBro</title>
</svelte:head>

<main class="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6 py-12">
  <div class="space-y-3">
    {#if status === 'denied'}
      <Ban class="size-8 text-destructive" aria-hidden="true" />
      <h1 class="text-3xl font-black tracking-tight">Access denied</h1>
      <p class="text-muted-foreground">
        Your request for access to BarBro was reviewed and declined. If you think this is a
        mistake, reach out and we'll take another look.
      </p>
    {:else}
      <Clock class="size-8" aria-hidden="true" />
      <h1 class="text-3xl font-black tracking-tight">Waiting for approval</h1>
      <p class="text-muted-foreground">
        Thanks for signing in. BarBro is invite-only right now, and we've queued your account
        for review. You'll get access as soon as an admin approves it.
      </p>
    {/if}
  </div>

  <div class="border-foreground brutalist-shadow-sm border-2 p-4 space-y-3 text-sm">
    <div class="flex items-center gap-2">
      <Mail class="text-muted-foreground size-4" aria-hidden="true" />
      <span class="text-muted-foreground text-xs uppercase tracking-wider">Signed in as</span>
    </div>
    <p class="font-mono text-sm">{user?.email ?? '—'}</p>
  </div>

  <form method="POST" action="/logout">
    <Button type="submit" variant="outline" size="sm" class="gap-2">
      <LogOut class="size-4" aria-hidden="true" />
      Sign out
    </Button>
  </form>
</main>
