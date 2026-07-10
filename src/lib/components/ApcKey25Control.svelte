<script lang="ts">
  import { browser } from '$app/environment'
  import { onDestroy } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    APC_CLIP_PAD_COUNT,
    APC_PLAY_NOTE,
    APC_RECORD_NOTE,
    apcClipPadLedMessage,
    type ApcClipPadLedColor,
    apcSceneLaunchLedMessage,
    apcSingleLedMessage,
    apcTrackButtonLedMessage,
    createApcKnobEngine,
    isLikelyApcKey25Mk2Name,
    midiBytesHex,
    parseApcKey25Message,
    type ApcKey25Action,
  } from '$lib/hardware/apcKey25'
  import { KeyboardMusic, RefreshCw } from '@lucide/svelte'

  type MidiDevice = {
    id: string
    name: string
    manufacturer: string
    state: string
  }

  type ApcLane = {
    key: string
    label: string
    volume: number
    muted: boolean
    soloed: boolean
  }

  let {
    lanes = [],
    isPlaying = false,
    onPlayPause = undefined,
    onStop = undefined,
    onRestartSong = undefined,
    onReplaySectionOnce = undefined,
    onLaneVolumeChange = undefined,
    onToggleLaneMuted = undefined,
    canRestartSong = false,
    canReplaySectionOnce = false,
    sectionReplayOnceArmed = false,
    canGoPreviousSong = false,
    canGoNextSong = false,
    onPreviousSong = undefined,
    onNextSong = undefined,
  } = $props<{
    lanes?: ApcLane[]
    isPlaying?: boolean
    onPlayPause?: () => void
    onStop?: () => void
    onRestartSong?: () => void
    onReplaySectionOnce?: () => void
    onLaneVolumeChange?: (key: string, value: number) => void
    onToggleLaneMuted?: (key: string) => void
    canRestartSong?: boolean
    canReplaySectionOnce?: boolean
    sectionReplayOnceArmed?: boolean
    canGoPreviousSong?: boolean
    canGoNextSong?: boolean
    onPreviousSong?: () => void
    onNextSong?: () => void
  }>()

  let midiAccess = $state<MIDIAccess | null>(null)
  let inputs = $state<MidiDevice[]>([])
  let outputs = $state<MidiDevice[]>([])
  let selectedInputId = $state('')
  let selectedOutputId = $state('')
  let connected = $state(false)
  let busy = $state(false)
  let error = $state('')
  let note = $state('')
  let lastMidiHex = $state('')
  let activeBank = $state(0)
  let shiftHeld = $state(false)
  let lastLedSig = ''
  /** Knob interpreter: auto-detects absolute vs relative, soft pickup. */
  const knobEngine = createApcKnobEngine()
  /**
   * Name of the input we were connected to — a kicked USB cable mid-show must
   * auto-reconnect when it comes back, not require touching a laptop.
   */
  let wantedInputName = ''
  let reconnectPending = false

  const supported = $derived(browser && 'requestMIDIAccess' in navigator)
  const maxBank = $derived(Math.max(0, Math.ceil(lanes.length / 8) - 1))
  const bankStart = $derived(Math.min(activeBank, maxBank) * 8)
  const bankLanes = $derived(lanes.slice(bankStart, bankStart + 8))
  const anySolo = $derived(lanes.some((lane) => lane.soloed))
  const selectedInput = $derived(midiAccess?.inputs.get(selectedInputId) ?? null)
  const selectedOutput = $derived(midiAccess?.outputs.get(selectedOutputId) ?? null)

  function collectDevices(access: MIDIAccess) {
    inputs = [...access.inputs.values()].map(portView)
    outputs = [...access.outputs.values()].map(portView)

    // Hot-unplug resilience: if the input we were using vanished, drop to a
    // "reconnecting" state instead of silently going deaf…
    if (connected && wantedInputName) {
      const stillThere = [...access.inputs.values()].some(
        (p) => p.name === wantedInputName && p.state === 'connected',
      )
      if (!stillThere) {
        connected = false
        reconnectPending = true
        lastLedSig = ''
        note = 'Controller unplugged — reconnecting when it returns.'
      }
    }

    if (!selectedInputId || !access.inputs.has(selectedInputId)) {
      selectedInputId = pickApcPort(access.inputs)?.id ?? inputs[0]?.id ?? ''
    }
    if (!selectedOutputId || !access.outputs.has(selectedOutputId)) {
      selectedOutputId = pickApcPort(access.outputs)?.id ?? outputs[0]?.id ?? ''
    }

    // …and the moment a port with the same name is back, reconnect + relight.
    if (reconnectPending && wantedInputName) {
      const back = [...access.inputs.values()].find(
        (p) => p.name === wantedInputName && p.state === 'connected',
      )
      if (back) {
        reconnectPending = false
        selectedInputId = back.id
        const out = pickApcPort(access.outputs)
        if (out) selectedOutputId = out.id
        void connect()
      }
    }
  }

  function portView(port: MIDIPort): MidiDevice {
    return {
      id: port.id,
      name: port.name ?? 'Unnamed MIDI device',
      manufacturer: port.manufacturer ?? '',
      state: port.state,
    }
  }

  function pickApcPort<T extends MIDIPort>(ports: { values(): IterableIterator<T> }): T | null {
    for (const port of ports.values()) {
      if (isLikelyApcKey25Mk2Name(port.name)) return port
    }
    return null
  }

  async function requestMidi() {
    if (!supported) {
      error = 'Web MIDI is unavailable in this browser.'
      return
    }
    busy = true
    error = ''
    note = ''
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false })
      midiAccess = access
      collectDevices(access)
      access.onstatechange = () => collectDevices(access)
      note = inputs.length > 0 ? 'MIDI ready.' : 'No MIDI input found.'
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  async function connect() {
    if (!midiAccess) await requestMidi()
    if (!midiAccess) return
    const input = midiAccess.inputs.get(selectedInputId)
    const output = selectedOutputId ? midiAccess.outputs.get(selectedOutputId) : undefined
    if (!input) {
      error = 'Select an APC MIDI input.'
      return
    }
    busy = true
    error = ''
    try {
      await input.open()
      if (output) await output.open()
      input.onmidimessage = handleMidiMessage
      connected = true
      wantedInputName = input.name ?? ''
      reconnectPending = false
      knobEngine.dropPickup()
      note = `Connected to ${input.name ?? 'MIDI input'}.`
      sendLedState(true)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  function disconnect() {
    const input = selectedInput
    if (input) input.onmidimessage = null
    connected = false
    shiftHeld = false
    lastLedSig = ''
    wantedInputName = ''
    reconnectPending = false
    knobEngine.dropPickup()
    note = 'APC disconnected.'
    sendAllLedsOff()
  }

  function laneForIndex(index: number): ApcLane | null {
    return bankLanes[index] ?? null
  }

  function laneForPad(index: number): ApcLane | null {
    return lanes[index] ?? null
  }

  function laneIsAudible(lane: ApcLane): boolean {
    if (lane.muted) return false
    if (anySolo && !lane.soloed) return false
    return true
  }

  function padColorForLane(lane: ApcLane | null): ApcClipPadLedColor {
    if (!lane) return 'off'
    if (lane.soloed) return 'yellow'
    if (!laneIsAudible(lane)) return lane.muted ? 'red' : 'dim'
    return 'green'
  }

  function handleMidiMessage(event: MIDIMessageEvent) {
    const data = event.data
    if (!data) return
    lastMidiHex = midiBytesHex(data)
    const action = parseApcKey25Message(data)
    if (!action) return
    handleApcAction(action)
  }

  function handleApcAction(action: ApcKey25Action) {
    if (action.type === 'shift') {
      shiftHeld = action.pressed
      return
    }
    if (action.type === 'knob') {
      const lane = laneForIndex(action.index)
      if (!lane) return
      // The engine self-detects absolute/relative knobs and applies soft
      // pickup — a knob never yanks a lane to wherever it physically sits.
      const next = knobEngine.next(action.index, action.rawValue, lane.volume)
      if (next !== null) onLaneVolumeChange?.(lane.key, next)
      return
    }
    if (!action.pressed) return

    if (action.type === 'play') {
      if (shiftHeld) {
        if (canRestartSong) onRestartSong?.()
        return
      }
      onPlayPause?.()
      return
    }
    if (action.type === 'stop-all-clips') {
      if (shiftHeld) {
        if (canRestartSong) onRestartSong?.()
        return
      }
      onStop?.()
      return
    }
    if (action.type === 'record') {
      if (canReplaySectionOnce) onReplaySectionOnce?.()
      return
    }
    if (action.type === 'track-button') {
      const lane = laneForIndex(action.index)
      if (lane) onToggleLaneMuted?.(lane.key)
      return
    }
    if (action.type === 'clip-pad') {
      const lane = laneForPad(action.index)
      if (!lane) return
      activeBank = Math.min(action.row, maxBank)
      onToggleLaneMuted?.(lane.key)
      return
    }
    if (action.type === 'scene-launch') {
      if (action.index === 0) {
        if (canGoPreviousSong) onPreviousSong?.()
        return
      }
      if (action.index === 1) {
        if (canGoNextSong) onNextSong?.()
        return
      }
      activeBank = Math.min(Math.max(0, action.index - 2), maxBank)
    }
  }

  function sendAllLedsOff() {
    const output = selectedOutput
    if (!output) return
    output.send(apcSingleLedMessage(APC_PLAY_NOTE, 'off'))
    output.send(apcSingleLedMessage(APC_RECORD_NOTE, 'off'))
    for (let i = 0; i < 8; i++) output.send(apcTrackButtonLedMessage(i, 'off'))
    for (let i = 0; i < 5; i++) output.send(apcSceneLaunchLedMessage(i, 'off'))
    for (let i = 0; i < APC_CLIP_PAD_COUNT; i++) output.send(apcClipPadLedMessage(i, 'off'))
  }

  function sendLedState(force = false) {
    const output = selectedOutput
    if (!connected || !output) return
    const sig = JSON.stringify({
      isPlaying,
      bankStart,
      canRestartSong,
      canReplaySectionOnce,
      sectionReplayOnceArmed,
      canGoPreviousSong,
      canGoNextSong,
      lanes: lanes.map((lane) => ({ key: lane.key, muted: lane.muted, soloed: lane.soloed })),
    })
    if (!force && sig === lastLedSig) return
    lastLedSig = sig
    output.send(apcSingleLedMessage(APC_PLAY_NOTE, isPlaying ? 'on' : 'off'))
    output.send(apcSingleLedMessage(APC_RECORD_NOTE, sectionReplayOnceArmed ? 'blink' : canReplaySectionOnce ? 'on' : 'off'))
    for (let i = 0; i < 8; i++) {
      const lane = bankLanes[i]
      output.send(apcTrackButtonLedMessage(i, lane && !laneIsAudible(lane) ? 'on' : 'off'))
    }
    output.send(apcSceneLaunchLedMessage(0, canGoPreviousSong ? 'on' : 'off'))
    output.send(apcSceneLaunchLedMessage(1, canGoNextSong ? 'on' : 'off'))
    for (let i = 2; i < 5; i++) {
      const bankForScene = i - 2
      const hasBank = bankForScene <= maxBank
      output.send(apcSceneLaunchLedMessage(i, hasBank && bankForScene === activeBank ? 'blink' : hasBank ? 'on' : 'off'))
    }
    for (let i = 0; i < APC_CLIP_PAD_COUNT; i++) {
      output.send(apcClipPadLedMessage(i, padColorForLane(laneForPad(i))))
    }
  }

  $effect(() => {
    if (activeBank > maxBank) activeBank = maxBank
  })

  // Bank switch = different lanes under the same physical knobs → require a
  // fresh soft pickup so the old knob positions can't move the new lanes.
  $effect(() => {
    bankStart
    knobEngine.dropPickup()
  })

  $effect(() => {
    isPlaying
    bankStart
    lanes
    canRestartSong
    canReplaySectionOnce
    sectionReplayOnceArmed
    canGoPreviousSong
    canGoNextSong
    sendLedState(false)
  })

  onDestroy(() => {
    disconnect()
    if (midiAccess) midiAccess.onstatechange = null
  })
</script>

<section class="rounded-[var(--radius)] border border-foreground/15 bg-muted/35 px-2 py-2">
  <div class="flex flex-wrap items-center gap-2">
    <span class="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wide">
      <span
        class="size-2.5 rounded-full {connected ? 'bg-emerald-500' : supported ? 'bg-foreground/25' : 'bg-amber-500'}"
        aria-hidden="true"
      ></span>
      <KeyboardMusic class="size-3.5" aria-hidden="true" />
      APC Key 25
    </span>

    {#if !midiAccess}
      <Button variant="outline" size="sm" class="h-7" onclick={requestMidi} disabled={!supported || busy}>
        <RefreshCw class="size-3.5 {busy ? 'animate-spin' : ''}" aria-hidden="true" />
        MIDI
      </Button>
    {/if}

    {#if midiAccess && !connected}
      <select
        class="h-7 max-w-44 rounded-[var(--radius)] border border-foreground/25 bg-background px-2 text-xs"
        bind:value={selectedInputId}
        aria-label="APC MIDI input"
      >
        {#each inputs as input (input.id)}
          <option value={input.id}>{input.name}</option>
        {/each}
      </select>
      <select
        class="h-7 max-w-44 rounded-[var(--radius)] border border-foreground/25 bg-background px-2 text-xs"
        bind:value={selectedOutputId}
        aria-label="APC MIDI output"
      >
        <option value="">No LED output</option>
        {#each outputs as output (output.id)}
          <option value={output.id}>{output.name}</option>
        {/each}
      </select>
      <Button
        variant="outline"
        size="sm"
        class="h-7"
        onclick={connect}
        disabled={busy || !selectedInputId}
        title="Connect APC Key 25 input. Pads toggle lanes, knobs control lane volume, Play/Stop control transport, Shift+Play restarts, Record replays the current section once, Scene 1/2 move between project songs."
      >
        Connect
      </Button>
    {:else if connected}
      <Button variant="outline" size="sm" class="h-7" onclick={disconnect}>Disconnect</Button>
      {#if maxBank > 0}
        <span class="rounded-[var(--radius)] bg-background px-1.5 py-1 text-xs font-bold ring-1 ring-foreground/15">
          Bank {activeBank + 1}/{maxBank + 1}
        </span>
      {/if}
    {/if}

    {#if error}
      <span class="text-destructive min-w-0 flex-1 truncate text-xs" title={error}>{error}</span>
    {:else if !supported}
      <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs">
        Web MIDI unavailable.
      </span>
    {:else if note}
      <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={note}>{note}</span>
    {:else if lastMidiHex}
      <span class="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[10px]" title={lastMidiHex}>
        {lastMidiHex}
      </span>
    {/if}
  </div>
</section>
