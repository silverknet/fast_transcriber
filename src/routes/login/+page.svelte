<script lang="ts">
  /**
   * `/login` page — Google OAuth primary, magic link fallback.
   *
   * The Google action returns the OAuth URL; we redirect via
   * `window.location` so popup-blocker rules don't fire and so the
   * Electron shell can intercept the navigation when running on desktop
   * (where it forwards to the system browser per the locked Phase 1
   * decision in the plan).
   */
  import { applyAction, enhance } from '$app/forms'
  import { Button } from '$lib/components/ui/button'
  import { Mail } from '@lucide/svelte'

  let { data, form } = $props<{
    data: { isSignedIn: boolean; next: string }
    form:
      | { error?: string; email?: string; magicSent?: boolean; googleUrl?: string }
      | null
  }>()

  let busy = $state(false)

  // After the Google action resolves, follow the URL it returned.
  $effect(() => {
    const url = (form && 'googleUrl' in form && form.googleUrl) || null
    if (url) window.location.href = url
  })
</script>

<svelte:head>
  <title>Sign in · BarBro</title>
</svelte:head>

<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
  <h1 class="text-3xl font-black tracking-tight">Sign in to BarBro</h1>

  {#if data.isSignedIn}
    <p class="text-sm">You're already signed in.</p>
    <a class="underline" href={data.next}>Continue</a>
  {:else}
    <!-- Google OAuth -->
    <form
      method="POST"
      action="?/google"
      use:enhance={() => {
        busy = true
        return async ({ result }) => {
          await applyAction(result)
          // Don't clear `busy` — the page is about to navigate away.
        }
      }}
    >
      <Button type="submit" class="w-full gap-2" disabled={busy}>
        <!-- Inline G-logo svg (no extra dep). -->
        <svg viewBox="0 0 48 48" aria-hidden="true" class="size-4">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-23.3-4 12 12 0 0 1 19.6-9.3l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.3-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44a20 20 0 0 0 13.5-5.2l-6.2-5.3A12 12 0 0 1 12.8 28l-6.5 5A20 20 0 0 0 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4 5.5l6.1 5.2c-.4.4 6.6-4.8 6.6-14.7 0-1.2-.1-2.3-.4-3.5z" />
        </svg>
        Continue with Google
      </Button>
    </form>

    <div class="text-muted-foreground flex items-center gap-3 text-xs">
      <div class="border-foreground/20 flex-1 border-t"></div>
      or
      <div class="border-foreground/20 flex-1 border-t"></div>
    </div>

    <!-- Magic link -->
    <form
      method="POST"
      action="?/magic"
      class="flex flex-col gap-3"
      use:enhance={() => {
        busy = true
        return async ({ result, update }) => {
          await applyAction(result)
          await update({ reset: false })
          busy = false
        }
      }}
    >
      <label class="flex flex-col gap-1.5 text-sm">
        <span class="text-muted-foreground text-xs">Email</span>
        <input
          name="email"
          type="email"
          required
          autocomplete="email"
          placeholder="you@example.com"
          value={form?.email ?? ''}
          class="border-foreground/30 bg-background w-full border-2 px-3 py-2 text-sm focus:border-foreground focus:outline-none"
          disabled={busy}
        />
      </label>
      <Button type="submit" variant="outline" class="gap-2" disabled={busy}>
        <Mail class="size-4" aria-hidden="true" />
        Email me a magic link
      </Button>
    </form>

    {#if form?.error}
      <p class="text-destructive text-sm" role="status">{form.error}</p>
    {/if}
    {#if form?.magicSent}
      <p class="text-emerald-600 dark:text-emerald-400 text-sm" role="status">
        Check your inbox at <span class="font-mono">{form.email}</span> for a sign-in link.
      </p>
    {/if}
  {/if}
</main>
