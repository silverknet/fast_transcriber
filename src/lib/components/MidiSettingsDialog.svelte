<script lang="ts">
  /**
   * MIDI controller settings — connection status (from the app-wide MIDI
   * service, so it stays connected across opens), a live signal monitor to
   * confirm the controller is talking, a "Test lights" button, and the fixed
   * live mapping. v1.0 auto-maps the Akai APC Key 25 Mk2; no configuration.
   */
  import { Button } from '$lib/components/ui/button'
  import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog'
  import { get } from 'svelte/store'
  import { parseApcKey25Message } from '$lib/hardware/apcKey25'
  import {
    resolveLiveCommand,
    describeApcKey25Action,
    controlId,
    controlLabel,
    LIVE_ACTIONS,
    type LiveAction,
  } from '$lib/hardware/liveMidiMap'
  import { liveMapping, bindLiveAction, resetLiveMapping } from '$lib/hardware/liveMidiStore'
  import { midiStatus, ensureMidi, onMidiInput, testLights } from '$lib/hardware/midiService'
  import ApcKey25Guide from '$lib/components/ApcKey25Guide.svelte'

  let { open = $bindable(false) } = $props<{ open?: boolean }>()

  type LogRow = { t: string; bytes: string; label: string; mapped: string }

  let log = $state<LogRow[]>([])
  let error = $state('')
  let busy = $state(false)
  /** The action currently being MIDI-learned (waiting for a button press). */
  let learning = $state<LiveAction | null>(null)

  function handleMidi(ev: MIDIMessageEvent) {
    const data = ev.data
    if (!data) return
    const action = parseApcKey25Message(data)

    // MIDI-learn: capture the next real control press for the learning action.
    if (learning && action && controlId(action) && !('pressed' in action && !action.pressed)) {
      bindLiveAction(learning, controlId(action)!)
      learning = null
      return
    }

    const bytes = [...data].map((b) => b.toString(16).padStart(2, '0')).join(' ')
    const cmd = action ? resolveLiveCommand(action, get(liveMapping)) : null
    const mapped = cmd
      ? cmd.type === 'toggle-stem'
        ? `stem ${cmd.index + 1}`
        : cmd.type === 'jump-section'
          ? `section ${cmd.index + 1}`
          : cmd.type
      : ''
    log = [
      {
        t: new Date().toLocaleTimeString(undefined, { hour12: false }),
        bytes,
        label: action ? describeApcKey25Action(action) : '—',
        mapped,
      },
      ...log,
    ].slice(0, 24)
  }

  async function connect() {
    busy = true
    error = ''
    try {
      await ensureMidi()
      if (!$midiStatus.connected) error = 'No MIDI input detected. Is the controller plugged in and powered?'
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  // Monitor incoming messages only while the dialog is open. The connection
  // itself is global and persists after close.
  $effect(() => {
    if (!open) return
    const unsub = onMidiInput(handleMidi)
    return () => unsub()
  })
</script>

<Dialog bind:open>
  <DialogContent class="flex max-h-[88vh] max-w-xl flex-col">
    <DialogHeader class="shrink-0">
      <DialogTitle>MIDI controller</DialogTitle>
    </DialogHeader>

    <div class="-mr-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2 text-sm">
      <!-- Status -->
      <section class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <span
            class="size-2.5 rounded-full {$midiStatus.apc
              ? 'bg-green-500'
              : $midiStatus.connected
                ? 'bg-amber-500'
                : 'bg-muted-foreground/40'}"
          ></span>
          <span class="font-bold">
            {#if $midiStatus.apc}
              APC Key 25 connected{$midiStatus.deviceName ? ` — ${$midiStatus.deviceName}` : ''}
            {:else if $midiStatus.connected}
              MIDI connected (not an APC Key 25){$midiStatus.deviceName ? ` — ${$midiStatus.deviceName}` : ''}
            {:else}
              Not connected
            {/if}
          </span>
          {#if $midiStatus.connected}
            <Button size="sm" variant="outline" class="ml-auto h-7" onclick={() => testLights()}>
              Test lights
            </Button>
          {/if}
        </div>

        {#if $midiStatus.connected}
          <p class="text-muted-foreground font-mono text-[11px]">
            LED output:
            {#if $midiStatus.outputs === 0}
              <span class="text-destructive">none found — the controller can’t receive lights</span>
            {:else}
              {$midiStatus.outputName || '(unnamed)'} · {$midiStatus.outputs} output port{$midiStatus.outputs === 1 ? '' : 's'}
            {/if}
          </p>
        {/if}

        {#if !$midiStatus.supported}
          <p class="text-destructive text-xs">
            Web MIDI isn’t available here — use Chrome or Edge on desktop.
          </p>
        {:else if !$midiStatus.connected}
          <Button size="sm" class="w-fit" onclick={connect} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect MIDI'}
          </Button>
          <p class="text-muted-foreground text-xs">
            Connect once — BarBro then reconnects and relights the controller automatically every time it opens.
          </p>
        {/if}
        {#if error}
          <p class="text-destructive text-xs">{error}</p>
        {/if}
      </section>

      <!-- Live monitor -->
      {#if $midiStatus.connected}
        <section class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <h3 class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">Signal monitor</h3>
            <button type="button" class="text-muted-foreground hover:text-foreground text-xs underline" onclick={() => (log = [])}>
              Clear
            </button>
          </div>
          <p class="text-muted-foreground text-xs">Press a pad or button — it should appear here.</p>
          <div class="border-foreground/15 h-40 overflow-y-auto border font-mono text-[11px]">
            {#if log.length === 0}
              <p class="text-muted-foreground p-2">Waiting for MIDI…</p>
            {:else}
              <table class="w-full">
                <tbody>
                  {#each log as row, i (i)}
                    <tr class="border-foreground/5 border-b">
                      <td class="text-muted-foreground px-2 py-0.5 tabular-nums">{row.t}</td>
                      <td class="px-2 py-0.5">{row.label}</td>
                      <td class="px-2 py-0.5">
                        {#if row.mapped}<span class="bg-foreground text-background rounded px-1 text-[10px] font-black">{row.mapped}</span>{/if}
                      </td>
                      <td class="text-muted-foreground px-2 py-0.5 tabular-nums">{row.bytes}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>
        </section>
      {/if}

      <!-- MIDI-learn button mapping -->
      <section class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <h3 class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">Button mapping</h3>
          <button type="button" class="text-muted-foreground hover:text-foreground text-xs underline" onclick={resetLiveMapping}>
            Reset to defaults
          </button>
        </div>
        <p class="text-muted-foreground text-xs">
          Click <b>Learn</b>, then press the button on the controller you want for that action.
          {#if !$midiStatus.connected}<span class="text-amber-600"> (connect the controller first)</span>{/if}
        </p>
        <table class="w-full text-sm">
          <tbody>
            {#each LIVE_ACTIONS as action (action.id)}
              <tr class="border-foreground/10 border-b">
                <td class="py-1.5 pr-3 font-bold">{action.label}</td>
                <td class="text-muted-foreground py-1.5 font-mono text-xs">
                  {#if learning === action.id}
                    <span class="text-amber-600 animate-pulse font-bold">Press a button…</span>
                  {:else}
                    {controlLabel($liveMapping[action.id])}
                  {/if}
                </td>
                <td class="py-1.5 text-right">
                  {#if learning === action.id}
                    <button type="button" class="border-foreground/40 rounded border px-2 py-0.5 text-xs" onclick={() => (learning = null)}>
                      Cancel
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="border-foreground bg-foreground text-background rounded border px-2 py-0.5 text-xs font-bold disabled:opacity-40"
                      onclick={() => (learning = action.id)}
                      disabled={!$midiStatus.connected}
                    >
                      Learn
                    </button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="text-muted-foreground text-xs">
          Pads are fixed: bottom row = slots 1–8, row 4 pads 1–2 = Custom 1–2, and the remaining pads launch sections.
        </p>
      </section>

      <!-- Visual cheat-sheet -->
      <section class="flex flex-col gap-2">
        <ApcKey25Guide />
      </section>
    </div>
  </DialogContent>
</Dialog>
