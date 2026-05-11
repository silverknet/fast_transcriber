<script lang="ts">
  import { onMount } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import { detectDesktopArtifactKey } from '$lib/client/detectDesktopArtifactKey'
  import {
    DESKTOP_ARTIFACT_KEYS,
    type DesktopArtifactKey,
    type DesktopDownloadsManifest,
  } from '$lib/desktop/downloadsManifest'

  let { data } = $props<{
    data: {
      manifest: DesktopDownloadsManifest | null
      manifestSource: 'remote' | 'static' | null
      manifestError: string | null
    }
  }>()

  let detectedKey = $state<DesktopArtifactKey | null>(null)

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
</script>

<svelte:head>
  <title>Download BarBro Desktop</title>
</svelte:head>

<main class="mx-auto max-w-2xl px-4 py-10 sm:px-6">
  <h1 class="mb-2 text-2xl font-black tracking-tight">BarBro Desktop</h1>
  <p class="text-muted-foreground mb-8 text-sm leading-relaxed">
    Install the companion app for local beat detection and filesystem workflows. Pick the build that matches your
    machine — we detect macOS vs Windows and Apple silicon vs Intel when possible.
  </p>

  {#if data.manifestError}
    <div
      class="border-destructive text-destructive mb-6 border-2 bg-rose-50 px-4 py-3 text-sm dark:bg-rose-950/40"
      role="alert"
    >
      Could not load download manifest: {data.manifestError}
    </div>
  {:else if data.manifest}
    <p class="text-muted-foreground mb-4 text-xs uppercase tracking-wider">
      Manifest v{data.manifest.version}
      {#if data.manifestSource === 'remote'}
        · remote
      {:else if data.manifestSource === 'static'}
        · bundled list
      {/if}
    </p>

    {#if recommended}
      <section
        class="border-foreground brutalist-shadow bg-background mb-8 border-2 p-4 sm:p-5"
        aria-labelledby="rec-heading"
      >
        <h2 id="rec-heading" class="mb-2 text-xs font-bold tracking-wide uppercase">Recommended for this device</h2>
        <p class="mb-3 font-semibold">{recommended.label}</p>
        {#if recommended.url}
          <a
            href={recommended.url}
            class="border-foreground bg-foreground text-background inline-flex items-center justify-center border-2 px-4 py-2 text-sm font-bold no-underline hover:opacity-90"
          >
            Download
          </a>
        {:else}
          <p class="text-muted-foreground text-sm">No installer URL configured yet for this platform.</p>
        {/if}
      </section>
    {:else if detectedKey === null}
      <p class="text-muted-foreground mb-6 text-sm">Could not detect your OS/arch — use the list below.</p>
    {/if}

    <section class="border-foreground border-2" aria-labelledby="all-heading">
      <h2 id="all-heading" class="border-foreground border-b-2 px-4 py-2 text-xs font-bold tracking-wide uppercase">
        All platforms
      </h2>
      <ul class="divide-foreground/20 divide-y-2">
        {#each rows(data.manifest) as row (row.key)}
          <li class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span class="font-medium">{row.label}</span>
              {#if row.recommended}
                <span class="text-muted-foreground ml-2 text-xs">(detected)</span>
              {/if}
              <div class="text-muted-foreground font-mono text-[11px]">{row.key}</div>
            </div>
            {#if row.url}
              <a
                href={row.url}
                class="border-foreground text-foreground shrink-0 self-start border-2 px-3 py-1.5 text-xs font-semibold no-underline hover:bg-foreground/5 sm:self-center"
              >
                Download
              </a>
            {:else}
              <span class="text-muted-foreground text-xs">Coming soon</span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {:else}
    <p class="text-muted-foreground text-sm">No manifest available.</p>
  {/if}

  <div class="mt-10 border-foreground/30 border-t pt-6">
    <p class="text-muted-foreground mb-3 text-xs leading-relaxed">
      <strong class="text-foreground">Deploy:</strong> set <code class="bg-muted px-1">PUBLIC_DESKTOP_MANIFEST_URL</code>
      to an HTTPS JSON file with the same shape as
      <code class="bg-muted px-1">/desktop-downloads.json</code>. CI can publish installers anywhere (GitHub Releases, R2,
      etc.) and point that URL at the latest manifest.
    </p>
    <Button variant="outline" size="sm" class="h-8" href="/">Back to BarBro</Button>
  </div>
</main>
