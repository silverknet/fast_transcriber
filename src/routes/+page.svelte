<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import WaveformPlayer from '$lib/components/WaveformPlayer.svelte'
  import {
    applyReferenceClipToSongMap,
    encodeReferenceAudioFromWav,
    referenceEncodedFileOkForSession,
  } from '$lib/audio/encodeReferenceAudio'
  import { trimAudioFileToWav } from '$lib/audio/trimAudio'
  import { Button } from '$lib/components/ui/button'
  import { MAX_AUDIO_DURATION_SEC } from '$lib/constants'
  import type { AnalyzeResponse } from '$lib/server/analysis/contracts'
  import { hydrateRestorableSong } from '$lib/stores/restorableSong'
  import { setAnalyzingSpin } from '$lib/stores/uiAnimations'
  import { ArrowRight, Music, Upload } from '@lucide/svelte'

  const accept = 'audio/mpeg,audio/wav,audio/x-wav,audio/wave,.mp3,.wav'

  let fileInput = $state<HTMLInputElement>()
  let audioFile = $state<File | null>(null)

  let rangeStart = $state(0)
  let rangeEnd = $state(0)
  let waveformReady = $state(false)
  let trimming = $state(false)
  let analyzing = $state(false)
  /** MP3 reference encode after analysis (fast, but separate from server analyze). */
  let compressing = $state(false)
  let useError = $state('')

  function onFileSelected(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    audioFile = file ?? null
    input.value = ''
  }

  function openPicker() {
    fileInput?.click()
  }

  async function useSong() {
    if (!audioFile) return
    trimming = true
    analyzing = false
    useError = ''
    try {
      const { file: trimmedFile } = await trimAudioFileToWav(audioFile, rangeStart, rangeEnd)
      trimming = false
      analyzing = true
      compressing = false
      setAnalyzingSpin(true)

      const form = new FormData()
      form.set('file', trimmedFile, trimmedFile.name)

      const res = await fetch('/api/analyze', { method: 'POST', body: form })
      let data: AnalyzeResponse
      try {
        data = (await res.json()) as AnalyzeResponse
      } catch {
        useError = 'Invalid response from server'
        return
      }

      if (!res.ok || !data.ok) {
        useError = data.ok === false ? data.error : 'Analysis failed'
        return
      }

      analyzing = false
      compressing = true

      /**
       * Prefer a small MP3 for session + export, only if Web Audio decodes it with non-silent PCM
       * (same path as the editor). Otherwise keep the trimmed WAV.
       */
      let songMap = data.songMap
      let audioBlob: Blob = trimmedFile
      try {
        const refFile = await encodeReferenceAudioFromWav(trimmedFile)
        const mp3Ok = await referenceEncodedFileOkForSession(refFile)
        if (mp3Ok) {
          songMap = applyReferenceClipToSongMap(songMap, refFile)
          audioBlob = refFile
        } else {
          console.debug(
            '[reference-audio] MP3 encoded but decode probe failed or silent; session uses trimmed WAV.',
          )
        }
      } catch (e) {
        useError =
          e instanceof Error ? e.message : 'Could not compress audio for storage. Please try again.'
        return
      }

      hydrateRestorableSong({ songMap, audioBlob })
      await goto('/edit')
    } catch {
      useError = 'Failed to trim or analyze audio. Please try again.'
    } finally {
      trimming = false
      analyzing = false
      compressing = false
      setAnalyzingSpin(false)
    }
  }
</script>

<main
  class="relative z-10 mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-10 px-6 py-16"
>
  <div class="flex flex-col items-center gap-3 text-center">
    <div
      class="brutalist-shadow-sm border-foreground bg-muted text-foreground inline-flex size-16 items-center justify-center border-2"
      aria-hidden="true"
    >
      <Music class="size-9" strokeWidth={1.75} />
    </div>
    <h1 class="text-4xl font-black tracking-tight md:text-5xl">BarBro</h1>
    <p class="text-muted-foreground max-w-md text-pretty text-sm leading-relaxed">
      Import audio, set your region on the waveform, and open it in the editor with beats detected.
    </p>
  </div>

  <input
    bind:this={fileInput}
    type="file"
    class="sr-only"
    {accept}
    onchange={onFileSelected}
  />

  <div
    class="brutalist-shadow border-foreground bg-background w-full max-w-xl border-2 p-6 md:p-8"
  >
    <div class="flex flex-col items-stretch gap-6">
      <Button
        type="button"
        variant="secondary"
        size="lg"
        class="w-full gap-2 sm:w-auto sm:self-center"
        onclick={openPicker}
      >
        <Upload class="size-4" aria-hidden="true" />
        Upload audio
      </Button>
      <p class="text-muted-foreground text-center text-xs">
        MP3 or WAV · max length {Math.floor(MAX_AUDIO_DURATION_SEC / 60)} minutes
      </p>
      {#if useError}
        <p class="text-destructive text-center text-xs">{useError}</p>
      {/if}

      {#if audioFile && browser}
        <div class="flex flex-col gap-4">
          <p class="text-foreground/90 truncate text-center text-sm font-medium">
            {audioFile.name}
          </p>
          <WaveformPlayer
            file={audioFile}
            bind:rangeStart
            bind:rangeEnd
            bind:ready={waveformReady}
          />
          <Button
            type="button"
            class="w-full gap-2 sm:self-end"
            disabled={!waveformReady || trimming || analyzing || compressing}
            onclick={useSong}
          >
            {trimming
              ? 'Preparing clip...'
              : analyzing
                ? 'Analyzing audio...'
                : compressing
                  ? 'Preparing project...'
                  : 'Use song'}
            <ArrowRight class="size-4" aria-hidden="true" />
          </Button>
        </div>
      {/if}
    </div>
  </div>
</main>
