<script lang="ts">
  import { browser } from '$app/environment'
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import { get } from 'svelte/store'
  import WaveformPlayer from '$lib/components/WaveformPlayer.svelte'
  import { Button } from '$lib/components/ui/button'
  import { MAX_AUDIO_DURATION_SEC } from '$lib/constants'
  import { sha256HexOfBlob } from '$lib/songmap/persist'
  import { createEmptySongMap, createSongMapFromAudioSession } from '$lib/songmap/factory'
  import { analyzingState } from '$lib/stores/analyzingState'
  import { audioSession } from '$lib/stores/audioSession'
  import { setSongMap, patchSongMap, songMap } from '$lib/stores/songMap'
  import { Music, Upload, ArrowRight, ArrowLeft } from '@lucide/svelte'
  import {
    project,
    markEditingStandalone,
  } from '$lib/stores/project'
  import { tryRestoreLastProject } from '$lib/project/commit'

  const accept = 'audio/mpeg,audio/wav,audio/x-wav,audio/wave,audio/flac,.mp3,.wav,.flac'

  let fileInput = $state<HTMLInputElement>()

  /** Original HQ file — kept in memory for analysis. Never stored in .smap. */
  let originalFile = $state<File | null>(null)

  /** True iff the page mounted with `?project=1` AND a project is actually active. */
  let inProjectMode = $state(false)

  onMount(() => {
    // Ensure a SongMap exists from the moment the user opens the import page.
    // Any interaction (typing a name, uploading) syncs to it immediately.
    if (!get(songMap)) {
      const map = createEmptySongMap()
      setSongMap(map)
    } else {
      // Restore name input from existing session (e.g. loaded from autosave)
      const existing = get(songMap)
      if (existing && existing.metadata.title && existing.metadata.title !== 'Untitled') {
        projectName = existing.metadata.title
      }
    }

    void resolveProjectMode()
  })

  /**
   * `?project=1` means the new song should be added to the active project.
   * If no project is in memory, try to restore via the desktop sidecar. If
   * that also fails, drop the param and stay in standalone mode.
   */
  async function resolveProjectMode() {
    if (!browser) return
    const wantsProject = get(page).url.searchParams.has('project')
    if (!wantsProject) {
      inProjectMode = false
      return
    }
    if (get(project).data) {
      inProjectMode = true
      return
    }
    try {
      const data = await tryRestoreLastProject()
      if (data) {
        inProjectMode = true
        return
      }
    } catch {}
    // Stale ?project=1 — drop it and continue in standalone mode.
    inProjectMode = false
    useError = 'No active project found — switching to single-song mode.'
    void goto('/', { replaceState: true })
  }

  function cancelToProject() {
    void goto('/project')
  }

  let rangeStart = $state(0)
  let rangeEnd = $state(0)
  let waveformReady = $state(false)

  let encoding = $state(false)
  let referenceFile = $state<File | null>(null)
  let useError = $state('')

  /** Whether the user has manually edited the project name. */
  let nameEdited = $state(false)
  let projectName = $state('')

  function openPicker() {
    fileInput?.click()
  }

  async function onFileSelected(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    originalFile = file
    referenceFile = null
    encoding = false
    useError = ''
    waveformReady = false
    rangeStart = 0
    rangeEnd = 0

    // Auto-fill project name from filename if user hasn't typed their own
    if (!nameEdited) {
      projectName = file.name.replace(/\.[^.]+$/, '') || 'Untitled'
    }

    // Create the initial SongMap shell immediately
    const now = new Date().toISOString()
    const initialMap = createSongMapFromAudioSession(
      { file: null, name: file.name, startSec: 0, endSec: 0 },
      { title: projectName || 'Untitled', now: () => now },
    )
    initialMap.metadata.analyzed = false
    setSongMap(initialMap)

    // No re-encoding: the browser decodes the original file directly (any
    // format Web Audio supports — MP3, WAV, FLAC, etc.). The audio is NOT
    // embedded in the `.smap`; the desktop sidecar's `<song>/audio/` is the
    // canonical location.
    encoding = true
    try {
      referenceFile = new File([file], file.name, { type: file.type })
      const origSha = await sha256HexOfBlob(file).catch(() => null)

      audioSession.set({
        file: referenceFile,
        name: file.name,
        startSec: rangeStart,
        endSec: rangeEnd || 0,
      })

      patchSongMap((m) => ({
        ...m,
        metadata: { ...m.metadata, title: projectName || 'Untitled' },
        audio: {
          fileName: file.name,
          mimeType: referenceFile!.type,
          durationSec: m.audio?.durationSec,
          trim: { startSec: rangeStart, endSec: rangeEnd || 0 },
          source: 'upload',
          originalSha256: origSha ?? undefined,
        },
      }))
    } catch (e) {
      useError = e instanceof Error ? e.message : 'Could not load audio. Please try again.'
    } finally {
      encoding = false
    }
  }

  function onNameInput(e: Event) {
    const val = (e.currentTarget as HTMLInputElement).value
    projectName = val
    nameEdited = true
    // SongMap always exists (created in onMount) — sync title immediately
    songMap.update((m) => {
      if (!m) return m
      return { ...m, metadata: { ...m.metadata, title: val.trim() || 'Untitled', updatedAt: new Date().toISOString() } }
    })
  }

  /** Called by WaveformPlayer when trim handles change. Keeps SongMap + audioSession in sync. */
  $effect(() => {
    if (!waveformReady || !originalFile) return
    // Update SongMap trim + durationSec (rangeEnd = full duration when just loaded)
    patchSongMap((m) => ({
      ...m,
      audio: m.audio
        ? {
            ...m.audio,
            durationSec: rangeEnd,
            trim: { startSec: rangeStart, endSec: rangeEnd },
          }
        : m.audio,
    }))
    // Keep audioSession trim in sync
    audioSession.update((s) => ({ ...s, startSec: rangeStart, endSec: rangeEnd }))
  })

  async function analyze() {
    if (!originalFile || encoding || !referenceFile) return
    useError = ''

    if (!inProjectMode) {
      // Plain (standalone) song flow — clear any stale project-song context.
      markEditingStandalone()
    }

    // Force-write the trim AT click time. The reactive $effect above
    // should keep `sm.audio.trim` in sync with `rangeStart/rangeEnd`,
    // but if it hasn't run yet (or the WaveformPlayer ↔ $state bind
    // hasn't propagated by the time the user clicks Analyze) we'd
    // ship {0, 0} to the sidecar and madmom returns no beats. The
    // canAnalyze gate already proved rangeEnd > rangeStart — just
    // commit those values directly so the analyzer can't miss them.
    patchSongMap((m) => ({
      ...m,
      audio: m.audio
        ? {
            ...m.audio,
            durationSec: rangeEnd,
            trim: { startSec: rangeStart, endSec: rangeEnd },
          }
        : m.audio,
    }))
    audioSession.update((s) => ({ ...s, startSec: rangeStart, endSec: rangeEnd }))

    analyzingState.set({ hqFile: originalFile })
    await goto(inProjectMode ? '/analyzing?project=1' : '/analyzing')
  }

  const canAnalyze = $derived(
    !!originalFile && !encoding && !!referenceFile && waveformReady && rangeEnd > rangeStart,
  )
</script>

<main
  class="relative z-10 mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-10 px-6 py-16"
>
  {#if inProjectMode}
    <div class="absolute left-4 top-16 sm:left-6">
      <Button variant="outline" size="sm" class="gap-1" onclick={cancelToProject}>
        <ArrowLeft class="size-4" aria-hidden="true" />
        Back to project
      </Button>
    </div>
  {/if}

  <div class="flex flex-col items-center gap-3 text-center">
    <div
      class="brutalist-shadow-sm border-foreground bg-muted text-foreground inline-flex size-16 items-center justify-center border-2"
      aria-hidden="true"
    >
      <Music class="size-9" strokeWidth={1.75} />
    </div>
    <h1 class="font-display text-4xl font-black tracking-tight md:text-5xl">BarBro</h1>
    <p class="text-muted-foreground max-w-md text-pretty text-sm leading-relaxed">
      {#if inProjectMode}
        New song for project <span class="font-semibold">{$project.data?.name ?? ''}</span>.
        Import audio, set your region, then analyze.
      {:else}
        Import audio, set your region, and open in the editor with beats detected.
      {/if}
    </p>
  </div>

  <input bind:this={fileInput} type="file" class="sr-only" {accept} onchange={onFileSelected} />

  <div class="brutalist-shadow border-foreground bg-background w-full max-w-xl border-2 p-6 md:p-8">
    <div class="flex flex-col items-stretch gap-6">

      <!-- Project name -->
      <div class="flex flex-col gap-1.5">
        <label for="project-name" class="text-xs font-semibold uppercase tracking-wide">
          Project name
        </label>
        <input
          id="project-name"
          type="text"
          class="border-foreground bg-background text-foreground w-full border-2 px-3 py-2 text-sm focus:outline-none"
          placeholder="Untitled"
          value={projectName}
          oninput={onNameInput}
        />
      </div>

      <!-- Upload button -->
      <Button
        type="button"
        variant="secondary"
        size="lg"
        class="w-full gap-2 sm:w-auto sm:self-center"
        onclick={openPicker}
      >
        <Upload class="size-4" aria-hidden="true" />
        {originalFile ? 'Replace audio' : 'Upload audio'}
      </Button>
      <p class="text-muted-foreground text-center text-xs">
        MP3 or WAV · max length {Math.floor(MAX_AUDIO_DURATION_SEC / 60)} minutes
      </p>

      {#if useError}
        <p class="text-destructive text-center text-xs" role="alert">{useError}</p>
      {/if}

      {#if originalFile && browser}
        <div class="flex flex-col gap-4">
          <p class="text-foreground/90 truncate text-center text-sm font-medium">
            {originalFile.name}
          </p>

          {#if encoding}
            <div class="text-muted-foreground flex items-center justify-center gap-2 text-xs">
              <div
                class="border-muted-foreground/30 border-t-foreground/80 size-4 animate-spin rounded-full border-2"
              ></div>
              Preparing audio…
            </div>
          {/if}

          <!-- Waveform + trim (always shown once file is selected, uses HQ original) -->
          <WaveformPlayer
            file={originalFile}
            bind:rangeStart
            bind:rangeEnd
            bind:ready={waveformReady}
          />

          <Button
            type="button"
            class="w-full gap-2 sm:self-end"
            disabled={!canAnalyze}
            onclick={analyze}
          >
            {encoding ? 'Preparing…' : 'Analyze'}
            <ArrowRight class="size-4" aria-hidden="true" />
          </Button>
        </div>
      {/if}

    </div>
  </div>
</main>
