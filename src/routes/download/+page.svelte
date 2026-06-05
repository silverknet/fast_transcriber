<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { detectDesktopArtifactKey } from '$lib/client/detectDesktopArtifactKey'
  import {
    DESKTOP_ARTIFACT_KEYS,
    type DesktopArtifactKey,
    type DesktopDownloadsManifest,
  } from '$lib/desktop/downloadsManifest'
  import {
    probeDesktopCompanion,
    probeDesktopPythonHealth,
    probeDesktopSetupStatus,
  } from '$lib/client/desktopBeacon'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { classifySidecarVersion } from '$lib/desktop/minSidecarVersion'
  import { ArrowRight, Check, RefreshCw, AlertTriangle, Loader2, Download } from '@lucide/svelte'

  // Live status — drives five hero states:
  //  - sidecar unreachable             → "isn't running"
  //  - reachable + installing          → "setting up audio engine…"
  //  - reachable + outdated            → "needs an update" + steps
  //  - reachable + python broken       → "is broken (deps missing)"
  //  - reachable + python ok           → "is running" + continue CTA
  const reachable = $derived($desktopCompanionStatus.reachable)
  const version = $derived($desktopCompanionStatus.version)
  const versionStatus = $derived($desktopCompanionStatus.versionStatus)
  const pythonHealth = $derived($desktopCompanionStatus.pythonHealth)
  const brokenChecks = $derived($desktopCompanionStatus.brokenChecks)
  const setup = $derived($desktopCompanionStatus.setup)

  let { data } = $props<{
    data: {
      manifest: DesktopDownloadsManifest | null
      manifestSource: 'remote' | 'static' | null
      manifestError: string | null
    }
  }>()

  let detectedKey = $state<DesktopArtifactKey | null>(null)
  let checking = $state(false)
  let isSafari = $state(false)

  onMount(() => {
    void detectDesktopArtifactKey().then((k) => {
      detectedKey = k
    })
    // Safari blocks cross-origin fetch from HTTPS to http://127.0.0.1
    // as mixed content. Chrome and Firefox special-case loopback as
    // "potentially trustworthy" so they allow it; Safari doesn't.
    // No server-side header (PNA included) fixes this — the only
    // real solution is serving the sidecar over HTTPS. Until that
    // ships, Safari users see "isn't running" forever; the banner
    // below redirects them to Chrome/Firefox. See desktop/README.md
    // "Browser support" for the long-term plan.
    const ua = navigator.userAgent
    isSafari =
      !/Chrome|Chromium|Edg|OPR/i.test(ua) &&
      /Safari/i.test(ua) &&
      navigator.vendor === 'Apple Computer, Inc.'
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
      let pythonHealth: 'unknown' | 'installing' | 'ok' | 'broken' = 'unknown'
      let brokenChecks: { name: string; ok: boolean; error?: string }[] = []
      let setup: import('$lib/stores/desktopCompanionStatus').DesktopCompanionStatus['setup'] = null
      if (r.ok) {
        const health = await probeDesktopPythonHealth()
        if (health) {
          if (health.installing) {
            pythonHealth = 'installing'
          } else {
            pythonHealth = health.ok ? 'ok' : 'broken'
            brokenChecks = health.checks.filter((c) => !c.ok)
          }
        }
        const s = await probeDesktopSetupStatus()
        if (s) {
          setup = {
            running: s.running,
            overall: s.overall,
            stages: s.stages,
            lastError: s.lastError,
          }
        }
      }
      desktopCompanionStatus.set({
        reachable: r.ok,
        version: r.version,
        versionStatus: classifySidecarVersion(r.version),
        lastCheckedAt: new Date().toISOString(),
        lastError: r.error,
        pythonHealth,
        brokenChecks,
        setup,
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
  {#if isSafari}
    <!--
      Safari blocks every fetch to the loopback sidecar as mixed
      content, so the rest of /download (every other hero state +
      the install/download CTAs themselves still work, but probing
      "is it running?" never succeeds). Highest-priority hero — if
      we render this we don't want to confuse the user with the
      misleading "isn't running" message underneath.
    -->
    <h1 class="mb-3 flex items-center gap-3 text-3xl font-black tracking-tight sm:text-4xl">
      <AlertTriangle class="text-amber-600 dark:text-amber-400 size-8 shrink-0" aria-hidden="true" />
      Safari isn't supported yet.
    </h1>
    <p class="text-muted-foreground mb-6 text-base">
      Open BarBro in <span class="font-semibold">Chrome</span> or
      <span class="font-semibold">Firefox</span> instead. We're working on Safari support.
    </p>
    <ol class="border-foreground/30 mb-8 list-decimal border-2 pl-8 pr-4 py-4 text-sm marker:font-bold">
      <li class="py-1">Open Chrome or Firefox.</li>
      <li class="py-1">Go to the BarBro web app there.</li>
      <li class="py-1">If you haven't installed BarBro Desktop yet, the download is below — works the same in any browser.</li>
    </ol>
  {:else if reachable && pythonHealth === 'installing'}
    <!--
      Auto-setup is in flight. Shown on first launch (or after a sidecar
      update that bumped the requirements hash). We surface the per-stage
      progress from /native/setup/status so the user sees what's happening
      instead of staring at a generic spinner for 60+ seconds.
    -->
    <h1 class="mb-6 flex items-center gap-3 text-3xl font-black tracking-tight sm:text-4xl">
      <Loader2 class="size-8 shrink-0 animate-spin" aria-hidden="true" />
      Getting things ready.
    </h1>

    {#if setup}
      <div class="border-foreground/30 mb-6 border-2 p-4">
        <div class="mb-3 flex items-center justify-between gap-2">
          <span class="text-xs font-bold uppercase tracking-wider">Overall</span>
          <span class="font-mono text-xs tabular-nums">{setup.overall}%</span>
        </div>
        <div class="border-foreground/30 bg-background relative h-3 w-full border">
          <div
            class="bg-foreground absolute inset-y-0 left-0 transition-[width] duration-300"
            style="width: {setup.overall}%"
          ></div>
        </div>

        <ul class="mt-4 space-y-2 text-xs">
          {#each setup.stages as s (s.name)}
            <li class="flex items-center justify-between gap-2">
              <span class="font-mono uppercase tracking-wider">{s.name}</span>
              <span class="text-muted-foreground min-w-0 flex-1 truncate text-right text-[11px]">
                {#if s.status === 'done'}
                  ✓ ready
                {:else if s.status === 'error'}
                  ⛔ {s.error ?? 'failed'}
                {:else if s.status === 'skipped'}
                  skipped (heavy — install on demand)
                {:else if s.status === 'running'}
                  {s.label ?? 'working…'} ({s.progress ?? 0}%)
                {:else}
                  waiting…
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <button
      type="button"
      onclick={() => void checkAgain()}
      disabled={checking}
      class="border-foreground bg-background text-foreground inline-flex items-center justify-center gap-2 border-2 px-4 py-2 text-sm font-bold no-underline hover:bg-foreground/5 disabled:opacity-50"
    >
      <RefreshCw class="size-3.5 {checking ? 'animate-spin' : ''}" aria-hidden="true" />
      Refresh status
    </button>
  {:else if reachable && versionStatus === 'outdated'}
    <!--
      Sidecar is up but reports a version below MIN_SIDECAR_VERSION.
      User must replace their installed copy with the latest build.
      Same DMG flow as a fresh install — macOS asks to "Replace" when
      they drag the new .app over the old one.
    -->
    <h1 class="mb-3 flex items-center gap-3 text-3xl font-black tracking-tight sm:text-4xl">
      <Download class="size-8 shrink-0" aria-hidden="true" />
      BarBro Desktop needs an update.
    </h1>
    <p class="text-muted-foreground mb-6 text-base">
      Update to keep using BarBro.
    </p>

    <!-- Three-step list. Numbered, no developer-speak. The order is
         deliberate: quit first (so the new app can bind the port),
         download, then drag-replace. -->
    <ol class="border-foreground/30 mb-8 list-decimal border-2 pl-8 pr-4 py-4 text-sm marker:font-bold">
      <li class="py-1">Quit BarBro Desktop. Right-click its icon in the Dock, then choose <span class="font-semibold">Quit</span>.</li>
      <li class="py-1">Download the new version below and open the file.</li>
      <li class="py-1">Drag BarBro Desktop into <span class="font-semibold">Applications</span>. When asked, click <span class="font-semibold">Replace</span>.</li>
      <li class="py-1">Open the new BarBro Desktop from Applications, then come back here.</li>
    </ol>

    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      {#if data.manifest && recommended && recommended.url}
        <a
          href={recommended.url}
          class="border-foreground brutalist-shadow bg-foreground text-background inline-flex items-center justify-center gap-2 border-2 px-6 py-3 text-base font-bold no-underline hover:opacity-90"
        >
          <Download class="size-4" aria-hidden="true" />
          Download for {recommended.label}
        </a>
      {/if}
      <button
        type="button"
        onclick={() => void checkAgain()}
        disabled={checking}
        class="border-foreground bg-background text-foreground inline-flex items-center justify-center gap-2 border-2 px-4 py-3 text-sm font-bold no-underline hover:bg-foreground/5 disabled:opacity-50"
      >
        <RefreshCw class="size-3.5 {checking ? 'animate-spin' : ''}" aria-hidden="true" />
        {checking ? 'Checking…' : "I've updated — check again"}
      </button>
    </div>
  {:else if reachable && pythonHealth === 'broken'}
    <!--
      Sidecar is up but its Python deps are missing/broken (typical
      case: numpy not installed in the beats/sections/stems interpreter).
      The user can't fix this themselves — the install should happen
      automatically when the desktop app is built. Surface a clear
      "something is broken in the desktop client" message and a
      re-check button; the real fix is a sidecar update.
    -->
    <h1 class="mb-3 flex items-center gap-3 text-3xl font-black tracking-tight sm:text-4xl">
      <AlertTriangle class="text-amber-600 dark:text-amber-400 size-8 shrink-0" aria-hidden="true" />
      BarBro Desktop is broken.
    </h1>
    <p class="text-muted-foreground mb-6 text-base">
      The desktop client is running but its analysis engine is missing
      Python dependencies. Reinstall the latest BarBro Desktop build to fix.
    </p>

    {#if brokenChecks.length > 0}
      <ul class="border-foreground/30 mb-8 border-2 divide-foreground/15 divide-y text-xs">
        {#each brokenChecks as c (c.name)}
          <li class="px-3 py-2">
            <p class="font-mono font-semibold uppercase tracking-wider">{c.name}</p>
            <p class="text-muted-foreground mt-0.5 break-all font-mono text-[11px]">
              {c.error ?? 'unknown error'}
            </p>
          </li>
        {/each}
      </ul>
    {/if}

    <button
      type="button"
      onclick={() => void checkAgain()}
      disabled={checking}
      class="border-foreground brutalist-shadow bg-foreground text-background inline-flex items-center justify-center gap-2 border-2 px-6 py-3 text-base font-bold no-underline hover:opacity-90 disabled:opacity-50"
    >
      <RefreshCw class="size-4 {checking ? 'animate-spin' : ''}" aria-hidden="true" />
      {checking ? 'Checking…' : 'Check again'}
    </button>
  {:else if reachable}
    <h1 class="mb-3 flex items-center gap-3 text-3xl font-black tracking-tight sm:text-4xl">
      <Check class="text-emerald-600 dark:text-emerald-400 size-8 shrink-0" aria-hidden="true" />
      BarBro Desktop is running.
    </h1>
    <p class="text-muted-foreground mb-10 text-base">
      Connected{version ? ` (v${version})` : ''}. You're good to go.
    </p>
    <button
      type="button"
      onclick={() => void goto('/')}
      class="border-foreground brutalist-shadow bg-foreground text-background inline-flex items-center justify-center gap-2 border-2 px-6 py-3 text-base font-bold no-underline hover:opacity-90"
    >
      Continue to BarBro
      <ArrowRight class="size-4" aria-hidden="true" />
    </button>
  {:else}
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
  {/if}

  <!-- Secondary: install it if they don't have it yet. Hidden in the
       outdated state because the outdated hero already shows the same
       download CTA — duplicating it under "Don't have it yet?" would
       suggest they're missing the app when they just need to update it. -->
  {#if !(reachable && versionStatus === 'outdated')}
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

    <!-- BarBro Desktop isn't signed with an Apple Developer ID yet, so
         Gatekeeper blocks it on first launch with either "can't be
         opened" or "is damaged" copy depending on the macOS version.
         The recovery flow (Privacy & Security → Open Anyway) is the
         same for both. Only show this for macOS downloaders. -->
    {#if recommended?.key?.startsWith('darwin')}
      <div class="border-foreground/30 mt-6 border-2 p-4 text-sm">
        <p class="mb-3 text-xs font-bold uppercase tracking-wider">
          First time opening on macOS?
        </p>
        <ol class="list-decimal space-y-1.5 pl-5">
          <li>Open BarBro Desktop. macOS will block it — close the warning.</li>
          <li>Open <span class="font-semibold">System Settings → Privacy &amp; Security</span>.</li>
          <li>Scroll down. Click <span class="font-semibold">Open Anyway</span> next to BarBro Desktop.</li>
          <li>Confirm by clicking <span class="font-semibold">Open Anyway</span> again.</li>
        </ol>
      </div>
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
  {/if}
</main>
