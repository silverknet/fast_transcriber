<script lang="ts">
  /**
   * "A newer BarBro Desktop is available" banner. Detection is pure web (works
   * with any installed sidecar); the Update button asks the sidecar to
   * download + open the DMG one-click when it's new enough, otherwise falls
   * back to the /download page. Dismissible per version.
   */
  import { goto } from '$app/navigation'
  import { browser } from '$app/environment'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import {
    fetchLatestDesktopVersion,
    isDesktopUpdateAvailable,
    installDesktopUpdate,
  } from '$lib/client/desktopUpdate'
  import { Download, X } from '@lucide/svelte'

  let latest = $state<string | null>(null)
  let checkedFor = $state<string | null>(null)
  let dismissedVersion = $state<string | null>(null)
  let installing = $state(false)
  let installMsg = $state('')
  let installErr = $state('')

  const running = $derived($desktopCompanionStatus.version)

  // Check once per running-version, only when the desktop is actually reachable.
  $effect(() => {
    if (!browser || !$desktopCompanionStatus.reachable || !running) return
    if (checkedFor === running) return
    checkedFor = running
    void (async () => {
      latest = await fetchLatestDesktopVersion()
    })()
  })

  const dismissKey = $derived(latest ? `barbro::update-dismissed::${latest}` : '')
  $effect(() => {
    if (!browser || !dismissKey) return
    try {
      dismissedVersion = sessionStorage.getItem(dismissKey)
    } catch {
      dismissedVersion = null
    }
  })

  const show = $derived(
    $desktopCompanionStatus.reachable &&
      isDesktopUpdateAvailable(running, latest) &&
      dismissedVersion !== latest &&
      !installMsg,
  )

  function dismiss() {
    if (!dismissKey) return
    try {
      sessionStorage.setItem(dismissKey, latest ?? '1')
    } catch {
      /* ignore */
    }
    dismissedVersion = latest
  }

  async function onUpdate() {
    installing = true
    installErr = ''
    const r = await installDesktopUpdate()
    installing = false
    if (r.ok) {
      installMsg = 'Installer opened — drag BarBro Desktop into Applications, then reopen it.'
      return
    }
    // Old sidecar (no install endpoint) or a failure → hand off to /download.
    if (r.unsupported) {
      void goto('/download')
      return
    }
    installErr = r.error
  }
</script>

{#if show}
  <div
    class="desktop-update-banner border-foreground flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 text-sm"
    role="status"
    aria-label="Desktop update available"
  >
    <Download class="size-4 shrink-0" aria-hidden="true" />
    <span class="min-w-0 flex-1">
      BarBro Desktop <strong>{latest}</strong> is available
      {#if running}<span class="opacity-70">(you have {running})</span>{/if}.
      {#if installErr}<span class="font-semibold">— {installErr}</span>{/if}
    </span>
    <button
      type="button"
      class="border-foreground hover:bg-foreground/10 shrink-0 border-2 px-2 py-0.5 text-xs font-bold uppercase disabled:opacity-50"
      onclick={() => void onUpdate()}
      disabled={installing}
    >
      {installing ? 'Downloading…' : 'Update'}
    </button>
    <button
      type="button"
      class="hover:bg-amber-950/10 shrink-0 p-1"
      onclick={dismiss}
      aria-label="Dismiss update notice"
      title="Dismiss"
    >
      <X class="size-4" aria-hidden="true" />
    </button>
  </div>
{/if}

{#if installMsg}
  <div class="border-foreground flex items-center gap-3 border-b-2 bg-emerald-600 px-3 py-2 text-sm text-white" role="status">
    <Download class="size-4 shrink-0" aria-hidden="true" />
    <span class="min-w-0 flex-1">{installMsg}</span>
  </div>
{/if}

<style>
  .desktop-update-banner {
    background: var(--studio-orange);
    color: var(--foreground);
  }
</style>
