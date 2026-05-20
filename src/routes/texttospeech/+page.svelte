<script lang="ts">
  /**
   * Debug: Piper TTS via desktop sidecar (`GET /native/tts/hello-world`).
   * Requires `npm run dev` in `desktop/` and a one-time POST setup from this page.
   */
  import { browser } from '$app/environment'
  import { Button } from '$lib/components/ui/button'
  import {
    fetchDesktopTtsHelloWorldWav,
    getPiperTtsSetupStatus,
    setupPiperTtsDeps,
  } from '$lib/client/desktopBridge'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'

  let statusMsg = $state('')
  let setupLog = $state<string[]>([])
  let setupRunning = $state(false)
  let audioUrl = $state<string | null>(null)

  async function refreshStatus() {
    if (!browser || !$desktopCompanionStatus.reachable) {
      statusMsg = 'Desktop sidecar offline — run `cd desktop && npm run dev`.'
      return
    }
    const s = await getPiperTtsSetupStatus()
    if (!s) {
      statusMsg = 'Could not read Piper status from sidecar.'
      return
    }
    statusMsg = s.ready
      ? `Ready · voice ${s.voiceId}`
      : `Not ready · venv: ${s.venvPython ? 'yes' : 'no'} · model on disk: ${s.modelPresent ? 'yes' : 'no'}`
  }

  $effect(() => {
    if (browser && $desktopCompanionStatus.reachable) void refreshStatus()
  })

  async function runSetup() {
    if (setupRunning) return
    setupRunning = true
    setupLog = []
    const r = await setupPiperTtsDeps((ev) => {
      if (ev.type === 'log') setupLog = [...setupLog.slice(-120), ev.msg]
      else if (ev.type === 'progress') setupLog = [...setupLog.slice(-120), `${ev.label} (${ev.overall}%)`]
      else if (ev.type === 'error') setupLog = [...setupLog.slice(-120), `Error: ${ev.msg}`]
      else if (ev.type === 'done') setupLog = [...setupLog.slice(-120), `Done: ${ev.venvPython}`]
    })
    setupRunning = false
    if (!r.ok) setupLog = [...setupLog, r.error]
    await refreshStatus()
  }

  async function playHelloWorld() {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
      audioUrl = null
    }
    const r = await fetchDesktopTtsHelloWorldWav()
    if (!r.ok) {
      statusMsg = r.error
      return
    }
    audioUrl = URL.createObjectURL(r.blob)
    await refreshStatus()
  }
</script>

<svelte:head>
  <title>TTS debug — BarBro</title>
</svelte:head>

<main class="relative z-10 mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-6 px-4 py-16 sm:px-6">
  <header class="border-foreground border-b-2 pb-4">
    <h1 class="text-2xl font-bold tracking-tight">Text-to-speech (debug)</h1>
    <p class="text-muted-foreground mt-1 text-sm">
      Piper runs in the <strong class="text-foreground">desktop</strong> app only. This page calls loopback
      <code class="text-xs">/native/tts/hello-world</code> and plays the returned WAV.
    </p>
  </header>

  <section class="border-foreground space-y-3 border-2 p-4">
    <p class="text-sm" role="status">{statusMsg || '…'}</p>
    <div class="flex flex-wrap gap-2">
      <Button class="" disabled={!$desktopCompanionStatus.reachable || setupRunning} onclick={() => void runSetup()}>
        {setupRunning ? 'Installing…' : 'Install Piper (desktop)'}
      </Button>
      <Button
        class=""
        variant="outline"
        disabled={!$desktopCompanionStatus.reachable}
        onclick={() => void playHelloWorld()}
      >
        Play “Hello world”
      </Button>
      <Button class="" variant="outline" onclick={() => void refreshStatus()}>Refresh status</Button>
    </div>
  </section>

  {#if setupLog.length > 0}
    <details class="border-foreground/30 border" open>
      <summary class="text-muted-foreground cursor-pointer px-3 py-2 text-xs font-medium">Setup log</summary>
      <pre
        class="border-foreground/10 bg-muted/30 max-h-48 overflow-auto border-t p-3 font-mono text-[10px] leading-snug whitespace-pre-wrap"
      >{setupLog.join('\n')}</pre>
    </details>
  {/if}

  {#if audioUrl}
    <section class="border-foreground border-2 p-4">
      <p class="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">Playback</p>
      <audio class="w-full" controls src={audioUrl}></audio>
    </section>
  {/if}
</main>
