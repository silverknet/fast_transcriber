<script lang="ts">
  import { onMount } from 'svelte'
  import { detectDesktopArtifactKey } from '$lib/client/detectDesktopArtifactKey'
  import {
    DESKTOP_ARTIFACT_KEYS,
    type DesktopArtifactKey,
    type DesktopDownloadsManifest,
  } from '$lib/desktop/downloadsManifest'
  import { probeDesktopCompanion } from '$lib/client/desktopBeacon'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { RefreshCw } from '@lucide/svelte'

  let { data } = $props<{
    data: {
      manifest: DesktopDownloadsManifest | null
      manifestSource: 'remote' | 'static' | null
      manifestError: string | null
    }
  }>()

  let detectedKey = $state<DesktopArtifactKey | null>(null)
  let checking = $state(false)

  onMount(() => {
    void detectDesktopArtifactKey().then((k) => {
      detectedKey = k
    })
  })

  let recommended = $derived.by(() => {
    const m = data.manifest
    if (!m || !detectedKey) return null
    const row = m.artifacts[detectedKey]
    if (!row) return null
    return { key: detectedKey, ...row }
  })

  function rows(m: DesktopDownloadsManifest | null) {
    if (!m) return []
    return DESKTOP_ARTIFACT_KEYS.map((key) => {
      const row = m.artifacts[key]
      return {
        key,
        label: row?.label ?? key,
        url: row?.url?.trim() ?? '',
        recommended: detectedKey === key,
      }
    })
  }

  async function checkAgain() {
    if (checking) return
    checking = true
    try {
      const r = await probeDesktopCompanion()
      desktopCompanionStatus.set({
        reachable: r.ok,
        version: r.version,
        lastCheckedAt: new Date().toISOString(),
        lastError: r.error,
      })
    } finally {
      checking = false
    }
  }
</script>

<svelte:head>
  <title>Start BarBro Desktop</title>
</svelte:head>

<main class="mx-auto max-w-2xl px-4 py-16 sm:px-6">
  <h1 class="mb-3 text-3xl font-black tracking-tight sm:text-4xl">
    BarBro Desktop isn't running.
  </h1>
  <p class="text-muted-foreground mb-10 text-base">
    Launch it from your Applications folder, then come back here.
  </p>

  <!-- Primary action: re-check. Most people landing here already have the app
       installed and just need to start it; checking is the path they want. -->
  <button
    type="button"
    onclick={() => void checkAgain()}
    disabled={checking}
    class="border-foreground brutalist-shadow bg-foreground text-background inline-flex items-center justify-center gap-2 border-2 px-6 py-3 text-base font-bold no-underline hover:opacity-90 disabled:opacity-50"
  >
    <RefreshCw class="size-4 {checking ? 'animate-spin' : ''}" aria-hidden="true" />
    {checking ? 'Checking…' : "I've started it — check again"}
  </button>

  <!-- Secondary: install it if they don't have it yet. -->
  <div class="border-foreground/30 mt-12 border-t pt-8">
    <h2 class="mb-2 text-sm font-bold tracking-wide uppercase">Don't have it yet?</h2>
    {#if data.manifest && recommended && recommended.url}
      <p class="text-muted-foreground mb-3 text-sm">
        Download the build for {recommended.label}, install, then come back here.
      </p>
      <a
        href={recommended.url}
        class="border-foreground inline-flex items-center justify-center border-2 px-4 py-2 text-sm font-bold no-underline hover:bg-foreground/5"
      >
        Download for {recommended.label}
      </a>
    {:else if data.manifest && recommended && !recommended.url}
      <p class="text-muted-foreground text-sm">
        No installer published yet for {recommended.label}. See the other-platforms list below.
      </p>
    {:else if data.manifest && detectedKey === null}
      <p class="text-muted-foreground text-sm">
        Couldn't detect your platform automatically. Pick from the list below.
      </p>
    {:else if data.manifestError}
      <p class="text-destructive text-sm" role="alert">
        Couldn't load the download list: {data.manifestError}
      </p>
    {/if}

    {#if data.manifest}
      <details class="mt-4">
        <summary class="text-muted-foreground hover:text-foreground cursor-pointer text-xs uppercase tracking-wider select-none">
          Other platforms
        </summary>
        <ul class="border-foreground mt-3 border-2 divide-foreground/20 divide-y-2">
          {#each rows(data.manifest) as row (row.key)}
            <li class="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span class="font-medium text-sm">{row.label}</span>
                {#if row.recommended}
                  <span class="text-muted-foreground ml-2 text-xs">(your machine)</span>
                {/if}
              </div>
              {#if row.url}
                <a
                  href={row.url}
                  class="border-foreground text-foreground shrink-0 self-start border-2 px-3 py-1 text-xs font-semibold no-underline hover:bg-foreground/5 sm:self-center"
                >
                  Download
                </a>
              {:else}
                <span class="text-muted-foreground text-xs">Coming soon</span>
              {/if}
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </div>
</main>
