<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import {
    cancelJob,
    enqueueYoutubeImport,
    fetchYoutubeImportArtifact,
    getYoutubeImportSetupStatus,
    setupYoutubeImportDeps,
    subscribeToJobEvents,
    type YoutubeImportEvent,
    type YoutubeImportOutput,
  } from '$lib/client/desktopBridge'
  import { prepareImportedAudio, type ImportedAudioArtifact } from '$lib/audio/importedAudio'
  import { Link, Upload, X } from '@lucide/svelte'

  let {
    open = $bindable(false),
    accept = 'audio/*',
    youtubeOutput = { kind: 'temp' } as YoutubeImportOutput,
    desktopReachable = true,
    onFile,
    onImported,
  } = $props<{
    open?: boolean
    accept?: string
    youtubeOutput?: YoutubeImportOutput
    desktopReachable?: boolean
    onFile: (file: File) => void | Promise<void>
    onImported: (artifact: ImportedAudioArtifact) => void | Promise<void>
  }>()

  let fileInput = $state<HTMLInputElement | undefined>()
  let mode = $state<'file' | 'youtube'>('file')
  let url = $state('')
  let busy = $state(false)
  let setupRunning = $state(false)
  let error = $state('')
  let progressLabel = $state('')
  let progressPct = $state(0)
  let activeJobId = $state<string | null>(null)
  let unsubscribe: (() => void) | null = null

  $effect(() => {
    if (open) {
      mode = 'file'
      url = ''
      error = ''
      progressLabel = ''
      progressPct = 0
    }
  })

  function openFilePicker() {
    if (busy) return
    fileInput?.click()
  }

  async function onFilePicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    busy = true
    error = ''
    try {
      await onFile(file)
      open = false
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not load audio.'
    } finally {
      busy = false
    }
  }

  function cleanupSubscription() {
    try {
      unsubscribe?.()
    } catch {
      /* ignore */
    }
    unsubscribe = null
  }

  async function ensureYoutubeToolsReady(): Promise<boolean> {
    const status = await getYoutubeImportSetupStatus()
    if (status?.ready) return true
    setupRunning = true
    progressLabel = 'Preparing audio import'
    progressPct = 5
    const r = await setupYoutubeImportDeps((ev) => {
      if (ev.type === 'progress') {
        progressLabel = ev.label
        progressPct = Math.max(0, Math.min(100, ev.overall))
      } else if (ev.type === 'error') {
        error = ev.msg
      }
    })
    setupRunning = false
    if (!r.ok) {
      error = r.error
      return false
    }
    return true
  }

  function waitForYoutubeJob(jobId: string): Promise<ImportedAudioArtifact> {
    return new Promise((resolve, reject) => {
      let settled = false
      const fail = (err: Error) => {
        if (settled) return
        settled = true
        reject(err)
      }
      const finish = (artifact: ImportedAudioArtifact) => {
        if (settled) return
        settled = true
        resolve(artifact)
      }
      unsubscribe = subscribeToJobEvents<YoutubeImportEvent>(
        jobId,
        (ev) => {
          if (ev.type === 'progress') {
            progressLabel = ev.label
            progressPct = Math.max(0, Math.min(100, ev.overall))
          } else if (ev.type === 'error') {
            error = ev.msg
          } else if (ev.type === 'done') {
            void (async () => {
              let artifact: ImportedAudioArtifact
              if (ev.artifact.tempArtifactUrl) {
                const fetched = await fetchYoutubeImportArtifact(ev.artifact)
                if (!fetched.ok) throw new Error(fetched.error)
                artifact = await prepareImportedAudio(fetched.file, {
                  source: 'import',
                  fileName: ev.artifact.fileName,
                  mimeType: ev.artifact.mimeType,
                  fileSize: ev.artifact.fileSize,
                  sha256: ev.artifact.sha256,
                  originalSha256: ev.artifact.originalSha256,
                  titleHint: ev.artifact.titleHint,
                })
              } else {
                artifact = {
                  fileName: ev.artifact.fileName,
                  mimeType: ev.artifact.mimeType,
                  durationSec: ev.artifact.durationSec,
                  sampleRate: ev.artifact.sampleRate,
                  channels: ev.artifact.channels,
                  fileSize: ev.artifact.fileSize,
                  sha256: ev.artifact.sha256,
                  originalSha256: ev.artifact.originalSha256,
                  source: ev.artifact.source,
                  alreadyWrittenSubpath: ev.artifact.projectSubpath,
                  titleHint: ev.artifact.titleHint,
                }
              }
              finish(artifact)
            })().catch((err) => {
              fail(err instanceof Error ? err : new Error(String(err)))
            })
          } else if (ev.type === 'state') {
            if (ev.state === 'cancelled') {
              fail(new Error('Audio import cancelled.'))
            } else if (ev.state === 'error') {
              fail(new Error(error || 'Audio import failed.'))
            }
          }
        },
        (err) => fail(err),
      )
    })
  }

  async function importYoutube() {
    const trimmed = url.trim()
    if (!trimmed) {
      error = 'Enter a YouTube URL.'
      return
    }
    if (!desktopReachable) {
      error = 'Start BarBro Desktop to import from YouTube.'
      return
    }
    busy = true
    error = ''
    progressLabel = ''
    progressPct = 0
    try {
      const ready = await ensureYoutubeToolsReady()
      if (!ready) return
      progressLabel = 'Starting audio import'
      const enq = await enqueueYoutubeImport({ url: trimmed, output: youtubeOutput })
      if (!enq.ok) throw new Error(enq.error)
      activeJobId = enq.jobId
      const artifact = await waitForYoutubeJob(enq.jobId)
      await onImported(artifact)
      open = false
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not import audio.'
    } finally {
      cleanupSubscription()
      activeJobId = null
      busy = false
      setupRunning = false
    }
  }

  async function cancelImport() {
    const id = activeJobId
    if (id) await cancelJob(id)
    cleanupSubscription()
    activeJobId = null
    busy = false
    setupRunning = false
  }
</script>

<Dialog bind:open>
  <DialogContent class="max-w-md">
    <DialogHeader>
      <DialogTitle>Add audio</DialogTitle>
    </DialogHeader>

    <input
      bind:this={fileInput}
      type="file"
      class="sr-only"
      {accept}
      onchange={onFilePicked}
    />

    <div class="flex flex-col gap-4">
      <div class="border-foreground grid grid-cols-2 border-2">
        <button
          type="button"
          class="flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold {mode === 'file' ? 'bg-foreground text-background' : 'bg-background text-foreground'}"
          onclick={() => (mode = 'file')}
          disabled={busy}
        >
          <Upload class="size-3.5" aria-hidden="true" />
          Upload file
        </button>
        <button
          type="button"
          class="border-foreground flex items-center justify-center gap-2 border-l-2 px-3 py-2 text-xs font-semibold {mode === 'youtube' ? 'bg-foreground text-background' : 'bg-background text-foreground'}"
          onclick={() => (mode = 'youtube')}
          disabled={busy}
        >
          <Link class="size-3.5" aria-hidden="true" />
          YouTube URL
        </button>
      </div>

      {#if mode === 'file'}
        <Button type="button" class="w-full gap-2" onclick={openFilePicker} disabled={busy}>
          <Upload class="size-4" aria-hidden="true" />
          Choose audio file
        </Button>
      {:else}
        <form
          class="flex flex-col gap-3"
          onsubmit={(e) => {
            e.preventDefault()
            void importYoutube()
          }}
        >
          <label class="flex flex-col gap-1.5 text-xs">
            <span class="text-muted-foreground uppercase tracking-wider">YouTube URL</span>
            <input
              type="url"
              bind:value={url}
              class="border-foreground/30 bg-background w-full border-2 px-3 py-2 text-sm focus:border-foreground focus:outline-none"
              placeholder="https://www.youtube.com/watch?v=..."
              disabled={busy}
            />
          </label>

          {#if busy || setupRunning}
            <div class="flex flex-col gap-1">
              <div class="bg-muted h-2 overflow-hidden">
                <div
                  class="bg-foreground h-full"
                  style={`width: ${Math.max(0, Math.min(100, progressPct))}%`}
                ></div>
              </div>
              <p class="text-muted-foreground text-xs">{progressLabel || 'Preparing audio'}</p>
            </div>
          {/if}

          <div class="flex justify-end gap-2">
            {#if activeJobId}
              <Button type="button" variant="outline" class="gap-1" onclick={() => void cancelImport()}>
                <X class="size-3.5" aria-hidden="true" />
                Cancel
              </Button>
            {/if}
            <Button type="submit" class="" disabled={busy || !url.trim()}>
              {busy ? 'Importing...' : 'Import'}
            </Button>
          </div>
        </form>
      {/if}

      {#if error}
        <p class="text-destructive text-xs" role="alert">{error}</p>
      {/if}
    </div>
  </DialogContent>
</Dialog>
