<script lang="ts">
  /**
   * Admin UI — list pending/granted/denied requests, plus a pre-invite
   * form to grant an email before that user has even signed up.
   *
   * Grouped by status with pending on top so unreviewed requests are
   * always in view. Each row has a one-click approve/deny.
   */
  import { enhance } from '$app/forms'
  import { Button } from '$lib/components/ui/button'
  import { Check, X, UserPlus } from '@lucide/svelte'

  let { data, form } = $props<{
    data: {
      rows: Array<{
        id: string
        email: string
        user_id: string | null
        status: 'pending' | 'granted' | 'denied'
        requested_at: string
        decided_at: string | null
        decided_by: string | null
        note: string | null
      }>
      error: string | null
    }
    form:
      | { ok?: boolean; action?: string; email?: string; id?: string; error?: string }
      | null
  }>()

  const grouped = $derived.by(() => {
    const pending = data.rows.filter((r) => r.status === 'pending')
    const granted = data.rows.filter((r) => r.status === 'granted')
    const denied = data.rows.filter((r) => r.status === 'denied')
    return { pending, granted, denied }
  })
</script>

<svelte:head>
  <title>Admin · Access · BarBro</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6">
  <header class="border-foreground border-b-2 pb-4">
    <h1 class="text-3xl font-black tracking-tight">Access requests</h1>
    <p class="text-muted-foreground mt-2 text-sm">
      Approve people who've requested access, or pre-invite by email before they sign up.
    </p>
  </header>

  {#if form?.error}
    <p class="text-destructive text-sm" role="status">{form.error}</p>
  {/if}
  {#if form?.ok}
    <p class="text-emerald-600 dark:text-emerald-400 text-sm" role="status">
      {#if form.action === 'invite'}Invited {form.email}.
      {:else if form.action === 'approve'}Approved.
      {:else if form.action === 'deny'}Denied.
      {/if}
    </p>
  {/if}

  <!-- Invite form -->
  <section class="border-foreground border-2 p-4 space-y-3">
    <h2 class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
      <UserPlus class="size-4" aria-hidden="true" />
      Pre-invite by email
    </h2>
    <form
      method="POST"
      action="?/invite"
      class="flex flex-wrap items-end gap-3"
      use:enhance
    >
      <label class="flex min-w-0 flex-1 flex-col gap-1 text-xs">
        <span class="text-muted-foreground">Email</span>
        <input
          name="email"
          type="email"
          required
          placeholder="user@example.com"
          class="border-foreground/30 bg-background w-full border-2 px-3 py-2 text-sm focus:border-foreground focus:outline-none"
        />
      </label>
      <label class="flex min-w-0 flex-1 flex-col gap-1 text-xs">
        <span class="text-muted-foreground">Note (optional)</span>
        <input
          name="note"
          type="text"
          placeholder="why / from where"
          class="border-foreground/30 bg-background w-full border-2 px-3 py-2 text-sm focus:border-foreground focus:outline-none"
        />
      </label>
      <Button type="submit" class="h-10 gap-2">
        <UserPlus class="size-4" aria-hidden="true" />
        Invite
      </Button>
    </form>
  </section>

  <!-- Status sections -->
  {#snippet group(title: string, rows: typeof data.rows, emptyHint: string)}
    <section class="space-y-3">
      <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {title} ({rows.length})
      </h2>
      {#if rows.length === 0}
        <p class="border-foreground/30 border-2 border-dashed p-3 text-xs text-muted-foreground">
          {emptyHint}
        </p>
      {:else}
        <ul class="flex flex-col gap-2">
          {#each rows as row (row.id)}
            <li class="border-foreground border-2 p-3">
              <div class="flex flex-wrap items-center gap-3">
                <div class="min-w-0 flex-1">
                  <p class="truncate font-mono text-sm">{row.email}</p>
                  <p class="text-muted-foreground mt-0.5 text-[11px] font-mono">
                    {row.user_id ? 'linked · ' : 'unlinked · '}
                    {new Date(row.requested_at).toLocaleString()}
                  </p>
                  {#if row.note}
                    <p class="text-muted-foreground mt-1 text-xs">"{row.note}"</p>
                  {/if}
                </div>

                <div class="flex shrink-0 gap-2">
                  {#if row.status !== 'granted'}
                    <form method="POST" action="?/approve" use:enhance>
                      <input type="hidden" name="id" value={row.id} />
                      <Button type="submit" size="sm" class="gap-1">
                        <Check class="size-3.5" aria-hidden="true" />
                        Approve
                      </Button>
                    </form>
                  {/if}
                  {#if row.status !== 'denied'}
                    <form method="POST" action="?/deny" use:enhance>
                      <input type="hidden" name="id" value={row.id} />
                      <Button type="submit" variant="outline" size="sm" class="gap-1">
                        <X class="size-3.5" aria-hidden="true" />
                        Deny
                      </Button>
                    </form>
                  {/if}
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/snippet}

  {@render group('Pending', grouped.pending, 'No pending requests. Pre-invite an email above to get someone started.')}
  {@render group('Granted', grouped.granted, 'No one has access yet.')}
  {@render group('Denied', grouped.denied, 'No denied requests.')}
</main>
