<script lang="ts">
  /**
   * Stem Splitter — web counterpart to the frequency_domain Tkinter app.
   *
   * In v3 (path-based) the sidecar reads the input from `inputPath` and
   * writes flat stem WAVs into `outputDir` directly — **no audio bytes ever
   * cross HTTP**. The web app's only job is to trigger, observe, and
   * (lightly) finalize the .smap stemRefs.
   *
   * The parent (`SongSetPanel`) hands us a `finalizeJob` callback that runs
   * when the job's state becomes `done`. The stems are already on disk by
   * then — the callback just refreshes the folder listing and updates the
   * song's `.smap` `stemRefs`.
   */
  import { Button } from '$lib/components/ui/button'
  import {
    enqueueStemSeparation,
    getStemsSetupStatus,
    setupStemsDeps,
    STEM_QUALITY_PRESETS,
    type StemName,
    type StemQualityPreset,
  } from '$lib/client/desktopBridge'
  import {
    activeJobForSong,
    registerStemJob,
    stemJobs,
    type StemJobEntry,
  } from '$lib/stores/stemJobs'
  import CircleHelp from '@lucide/svelte/icons/circle-help'
  import { Download, Play, X } from '@lucide/svelte'
  import { cancelStemJob } from '$lib/stores/stemJobs'

  const ALL_STEMS: StemName[] = ['vocals', 'drums', 'bass', 'other']

  const DEMUX_SETUP_HELP =
    'Demucs is not installed in the desktop sidecar yet. One-time setup creates a venv under the app data folder and pip-installs Demucs (~1 GB download, several minutes). Leave this tab open while installing.'

  let {
    songId,
    inputPath,
    outputDir,
    inputLabel,
    desktopReachable,
    finalizeJob,
  } = $props<{
    /** Stable identity used to associate jobs with this card. */
    songId: string
    /**
     * Absolute OS path the sidecar reads. Either an audio file or a
     * BarBro `.smap` (sidecar extracts the audio chunk).
     */
    inputPath: string | null
    /**
     * Absolute OS path where flat stem WAVs land (sidecar creates if missing).
     */
    outputDir: string | null
    /** Human-friendly label for the Audio File fieldset (filename, etc.). */
    inputLabel?: string | null
    desktopReachable: boolean
    /** Runs once when the job's state becomes `done`. Stems are already on disk. */
    finalizeJob: (entry: StemJobEntry) => void | Promise<void>
  }>()

  // ── Form state ─────────────────────────────────────────────────────────────

  const selected = $state<Record<StemName, boolean>>({ vocals: true, drums: true, bass: true, other: true })
  let presetIndex = $state(1) // default: "Balanced"

  const allSelected = $derived(ALL_STEMS.every((s) => selected[s]))
  const anySelected = $derived(ALL_STEMS.some((s) => selected[s]))
  const preset: StemQualityPreset = $derived(
    STEM_QUALITY_PRESETS[presetIndex] ?? STEM_QUALITY_PRESETS[1]!,
  )

  function toggleAll() {
    const next = !allSelected
    for (const s of ALL_STEMS) selected[s] = next
  }

  // ── Linked job (from the global store) ─────────────────────────────────────

  let enqueueError = $state('')

  /**
   * The job (if any) the UI should display state for. Derived from the
   * global store by `songId` so this survives card collapse/expand —
   * remounting the component picks up whatever the sidecar is currently
   * doing for this song. Prefers active (queued/running) jobs over
   * terminal ones; among same-state jobs, the most-recently-created wins.
   */
  const jobEntry = $derived.by<StemJobEntry | null>(() => {
    let active: StemJobEntry | null = null
    let recentTerminal: StemJobEntry | null = null
    for (const j of $stemJobs.values()) {
      if (j.songId !== songId) continue
      if (j.state === 'queued' || j.state === 'running') {
        if (!active || j.createdAt > active.createdAt) active = j
      } else {
        if (!recentTerminal || j.createdAt > recentTerminal.createdAt) recentTerminal = j
      }
    }
    return active ?? recentTerminal
  })

  /** Whether this song has any in-flight (queued/running) job — used to disable button. */
  const songIsBusy = $derived.by<boolean>(() => {
    // Touch $stemJobs to ensure reactivity.
    $stemJobs
    return activeJobForSong(songId) !== null
  })

  function canRun(): { ok: true } | { ok: false; reason: string } {
    if (!desktopReachable) return { ok: false, reason: 'Desktop companion not reachable' }
    if (!inputPath) return { ok: false, reason: 'No audio source resolved on disk yet' }
    if (!outputDir) return { ok: false, reason: 'Output directory not resolved yet' }
    if (!anySelected) return { ok: false, reason: 'Select at least one stem' }
    if (songIsBusy) return { ok: false, reason: 'Already queued/running for this song' }
    return { ok: true }
  }

  async function run() {
    const check = canRun()
    if (!check.ok) {
      enqueueError = check.reason
      return
    }
    enqueueError = ''
    const stems = ALL_STEMS.filter((s) => selected[s])
    // Per-preset subfolder write so a song can hold multiple renderings
    // side by side (e.g. a Preview render for iteration + a Best render
    // for export). The mixer auto-picks the highest quality available.
    const presetOutputDir = `${outputDir!}/${preset.slug}`
    const r = await enqueueStemSeparation({
      inputPath: inputPath!,
      outputDir: presetOutputDir,
      stems,
      preset,
      songId,
    })
    if (!r.ok) {
      enqueueError = r.error
      return
    }
    // No need to remember the jobId locally — `jobEntry` derives from the
    // global store keyed by songId, so the UI picks it up automatically.
    registerStemJob({ jobId: r.jobId, songId, onDone: finalizeJob })
  }

  async function cancelCurrent() {
    const id = jobEntry?.jobId
    if (!id) return
    await cancelStemJob(id)
  }

  // ── Python deps setup (one-time pip install of Demucs) ─────────────────────

  /** Whether the sidecar already has a working stems venv (probed on mount). */
  let depsReady = $state<boolean | null>(null)
  /** Live state while pip is running. */
  let setupRunning = $state(false)
  let setupLog = $state<string[]>([])
  let setupLabel = $state('')
  let setupOverallPct = $state(0)
  let setupError = $state('')
  let setupLogBox = $state<HTMLDivElement>()

  /** True iff the most-recent job for this song failed with the missing-demucs error. */
  const needsSetupAfterError = $derived.by<boolean>(() => {
    if (!jobEntry || jobEntry.state !== 'error' || !jobEntry.error) return false
    return /demucs not installed/i.test(jobEntry.error)
  })

  /** Show the setup affordance if deps are missing OR a job just failed for that reason. */
  const showSetupButton = $derived(depsReady === false || needsSetupAfterError)

  async function probeDepsStatus() {
    if (!desktopReachable) {
      depsReady = null
      return
    }
    const status = await getStemsSetupStatus()
    depsReady = status?.ready ?? null
  }

  // Re-probe whenever the desktop companion comes online.
  $effect(() => {
    void desktopReachable
    void probeDepsStatus()
  })

  function appendSetupLog(msg: string) {
    setupLog = [...setupLog.slice(-79), msg]
    queueMicrotask(() => {
      if (setupLogBox) setupLogBox.scrollTop = setupLogBox.scrollHeight
    })
  }

  async function runSetup() {
    if (setupRunning) return
    setupRunning = true
    setupError = ''
    setupLog = []
    setupLabel = 'Starting…'
    setupOverallPct = 0

    const result = await setupStemsDeps((ev) => {
      switch (ev.type) {
        case 'log':
          appendSetupLog(ev.msg)
          break
        case 'progress':
          setupLabel = ev.label
          setupOverallPct = Math.max(0, Math.min(100, ev.overall))
          break
        case 'error':
          setupError = ev.msg
          appendSetupLog(`⛔  ${ev.msg}`)
          break
        case 'done':
          appendSetupLog(`✓  Ready: ${ev.venvPython}`)
          break
      }
    })

    setupRunning = false
    if (result.ok) {
      depsReady = true
      setupLabel = 'Done'
      setupOverallPct = 100
    } else {
      setupError = result.error
      depsReady = false
    }
  }

  // ── UI helpers ─────────────────────────────────────────────────────────────

  function reasonHint(): string {
    if (!desktopReachable) return 'Desktop companion required'
    if (!inputPath) return 'Audio source on disk not resolved yet'
    if (!outputDir) return 'Output directory on disk not resolved yet'
    if (!anySelected) return 'Pick at least one stem'
    if (songIsBusy) return 'A job is already queued/running for this song'
    return ''
  }
  const hint = $derived(reasonHint())
  const splitButtonTitle = $derived(
    canRun().ok ? 'Run Demucs stem separation in the desktop app' : hint || 'Cannot split yet',
  )

  const phase = $derived<'idle' | 'queued' | 'running' | 'done' | 'error' | 'cancelled'>(
    jobEntry?.state ?? 'idle',
  )
  const stepLabel = $derived(jobEntry?.label ?? 'Idle')
  const currentPct = $derived(jobEntry?.currentPct ?? 0)
  const overallPct = $derived(jobEntry?.overallPct ?? 0)
  const logLines = $derived(jobEntry?.log ?? [])
  let logBox = $state<HTMLDivElement>()
  const progressDetailsOpen = $derived(phase !== 'idle')

  $effect(() => {
    // Autoscroll to bottom when log grows.
    if (logBox) logBox.scrollTop = logBox.scrollHeight
    // touch logLines length to trigger
    void logLines.length
  })
</script>

<section class="border-foreground border-2 p-4 space-y-4">
  <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Stem Splitter</h2>

  <!-- Audio source on disk -->
  <fieldset class="border-foreground/30 border space-y-1 px-3 py-2">
    <legend class="text-[10px] font-semibold uppercase tracking-wider px-1">Audio source</legend>
    {#if inputPath}
      <p class="font-mono text-sm truncate" title={inputPath}>
        {inputLabel ?? inputPath.split('/').pop() ?? inputPath}
      </p>
      <p class="text-muted-foreground font-mono text-[10px] truncate" title={inputPath}>{inputPath}</p>
    {:else}
      <p class="text-muted-foreground text-xs">Locate the project folder on disk to enable splitting.</p>
    {/if}
    {#if outputDir}
      <p class="text-muted-foreground mt-1 font-mono text-[10px] truncate" title="{outputDir}/{preset.slug}">
        Output → {outputDir}/{preset.slug}
      </p>
    {/if}
  </fieldset>

  <!-- Stems to Export -->
  <fieldset class="border-foreground/30 border space-y-2 px-3 py-2">
    <legend class="text-[10px] font-semibold uppercase tracking-wider px-1">Stems to Export</legend>
    <div class="flex flex-wrap gap-x-4 gap-y-2">
      {#each ALL_STEMS as s (s)}
        <label class="flex cursor-pointer items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            class="size-4"
            bind:checked={selected[s]}
            disabled={songIsBusy}
          />
          <span class="capitalize">{s}</span>
        </label>
      {/each}
    </div>
    <label class="text-muted-foreground flex cursor-pointer items-center gap-1.5 pt-1 text-xs">
      <input
        type="checkbox"
        class="size-3.5"
        checked={allSelected}
        onchange={toggleAll}
        disabled={songIsBusy}
      />
      <span>Select all</span>
    </label>
  </fieldset>

  <!-- Quality -->
  <fieldset class="border-foreground/30 border space-y-1 px-3 py-2">
    <legend class="text-[10px] font-semibold uppercase tracking-wider px-1">Quality</legend>
    <select
      class="border-foreground/30 bg-background text-foreground w-full border px-2 py-1 font-mono text-xs"
      bind:value={presetIndex}
      disabled={songIsBusy}
    >
      {#each STEM_QUALITY_PRESETS as p, i (i)}
        <option value={i}>{p.label}</option>
      {/each}
    </select>
  </fieldset>

  <!-- Run / Cancel -->
  <div class="flex flex-wrap items-center gap-3">
    <Button
      class="gap-2"
      title={splitButtonTitle}
      onclick={() => void run()}
      disabled={songIsBusy || !canRun().ok}
    >
      <Play class="size-4" aria-hidden="true" />
      Split Stems
    </Button>
    {#if jobEntry && (phase === 'queued' || phase === 'running')}
      <Button
        variant="outline"
        size="sm"
        class="gap-1"
        onclick={() => void cancelCurrent()}
        aria-label="Cancel this stem job"
      >
        <X class="size-3.5" aria-hidden="true" />
        Cancel
      </Button>
    {/if}
    {#if enqueueError}
      <p class="text-destructive text-xs" role="status">{enqueueError}</p>
    {/if}
  </div>

  <!-- Setup affordance: shown when the sidecar has no Demucs venv, or after a
       run fails with the "Demucs not installed" error. -->
  {#if desktopReachable && (showSetupButton || setupRunning || setupError)}
    <fieldset class="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20 border space-y-2 px-3 py-2">
      <legend class="text-[10px] font-semibold uppercase tracking-wider px-1 text-amber-700 dark:text-amber-200">
        Python deps
      </legend>
      <p class="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
        {#if depsReady === false || needsSetupAfterError}
          <span>One-time Demucs install (~1 GB).</span>
        {:else if setupRunning}
          <span>Installing — keep this tab open.</span>
        {:else}
          <span>Ready.</span>
        {/if}
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground inline-flex rounded p-0.5"
          title={DEMUX_SETUP_HELP}
          aria-label={DEMUX_SETUP_HELP}
        >
          <CircleHelp class="size-3.5 shrink-0 opacity-80" aria-hidden="true" />
        </button>
      </p>
      <div class="flex flex-wrap items-center gap-3">
        <Button
          class="gap-2"
          variant={setupRunning ? 'outline' : 'default'}
          size="sm"
          disabled={setupRunning}
          onclick={() => void runSetup()}
        >
          <Download class="size-3.5" aria-hidden="true" />
          {setupRunning ? 'Installing…' : depsReady ? 'Reinstall' : 'Set up dependencies'}
        </Button>
        {#if setupRunning}
          <span class="text-muted-foreground font-mono text-xs">{setupLabel}</span>
          <div class="border-foreground/30 bg-background relative h-2 w-32 border">
            <div class="bg-foreground absolute inset-y-0 left-0" style="width: {setupOverallPct}%"></div>
          </div>
          <span class="font-mono text-[10px] tabular-nums text-muted-foreground">{setupOverallPct}%</span>
        {/if}
        {#if setupError}
          <p class="text-destructive text-xs" role="status">{setupError}</p>
        {/if}
      </div>
      {#if setupLog.length > 0}
        <details class="group">
          <summary
            class="text-muted-foreground hover:text-foreground cursor-pointer list-none text-xs font-medium select-none marker:content-none [&::-webkit-details-marker]:hidden"
          >
            Install log ({setupLog.length} lines)
          </summary>
          <div
            bind:this={setupLogBox}
            class="border-foreground/10 bg-neutral-900 text-neutral-200 mt-2 max-h-32 min-h-12 overflow-y-auto border p-2 font-mono text-[10px] leading-tight whitespace-pre-wrap"
          >
            {#each setupLog as line, i (i)}
              <div>{line}</div>
            {/each}
          </div>
        </details>
      {/if}
    </fieldset>
  {/if}

  <!-- Progress (collapsed when idle so the card stays compact) -->
  <details class="border-foreground/30 border space-y-2 px-3 py-2" open={progressDetailsOpen}>
    <summary
      class="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-baseline justify-between gap-2 px-1 select-none marker:content-none [&::-webkit-details-marker]:hidden"
    >
      <span class="text-[10px] font-semibold uppercase tracking-wider">Progress</span>
      <span class="text-foreground max-w-[min(12rem,55%)] truncate text-right text-xs font-medium normal-case"
        >{stepLabel}</span
      >
    </summary>
    <div class="mt-2 space-y-2">
      <div class="flex items-center gap-2">
        <span class="text-muted-foreground w-24 shrink-0 text-xs">Current pass</span>
        <div class="border-foreground/30 bg-background relative h-3 flex-1 border">
          <div class="bg-foreground absolute inset-y-0 left-0" style="width: {currentPct}%"></div>
        </div>
        <span class="font-mono text-xs tabular-nums w-10 text-right">{currentPct}%</span>
      </div>

      <div class="flex items-center gap-2">
        <span class="text-muted-foreground w-24 shrink-0 text-xs">Overall</span>
        <div class="border-foreground/30 bg-background relative h-3 flex-1 border">
          <div class="bg-foreground absolute inset-y-0 left-0" style="width: {overallPct}%"></div>
        </div>
        <span class="font-mono text-xs tabular-nums w-10 text-right">{overallPct}%</span>
      </div>
    </div>
  </details>

  <!-- Log -->
  <details class="border-foreground/30 group border space-y-1 px-3 py-2">
    <summary
      class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer list-none select-none marker:content-none [&::-webkit-details-marker]:hidden"
    >
      Demucs log {#if logLines.length > 0}({logLines.length}){/if}
    </summary>
    <div
      bind:this={logBox}
      class="border-foreground/10 bg-neutral-900 text-neutral-200 mt-2 max-h-40 min-h-16 overflow-y-auto border p-2 font-mono text-[11px] leading-tight whitespace-pre-wrap"
    >
      {#each logLines as line, i (i)}
        <div>{line}</div>
      {/each}
      {#if logLines.length === 0}
        <div class="text-neutral-500">— idle —</div>
      {/if}
    </div>
  </details>
</section>
