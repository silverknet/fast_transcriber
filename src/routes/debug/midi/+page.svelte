<script lang="ts">
  /**
   * Bare-metal Web MIDI diagnostic — NO app logic, NO shared service. Opens its
   * own MIDIAccess, lists every port by name, and sends single raw messages to a
   * chosen port so we can see exactly what the hardware does with a clean
   * command. This is the ground-truth tool for the "APC pads stay green" bug.
   */
  import { onMount } from 'svelte'

  type PortRow = { id: string; name: string; state: string; connection: string; manufacturer: string }

  let supported = $state(false)
  let error = $state('')
  let access: MIDIAccess | null = $state(null)
  let inputs = $state<PortRow[]>([])
  let outputs = $state<PortRow[]>([])
  let selectedOutputId = $state<string>('__all__')
  let log = $state<string[]>([])

  function rowsFrom(map: MIDIInputMap | MIDIOutputMap): PortRow[] {
    return [...map.values()].map((p) => ({
      id: p.id,
      name: p.name ?? '(unnamed)',
      state: p.state,
      connection: p.connection,
      manufacturer: p.manufacturer ?? '',
    }))
  }

  function refresh() {
    if (!access) return
    inputs = rowsFrom(access.inputs)
    outputs = rowsFrom(access.outputs)
  }

  function addLog(s: string) {
    log = [`${new Date().toLocaleTimeString(undefined, { hour12: false })}  ${s}`, ...log].slice(0, 60)
  }

  async function connect() {
    error = ''
    try {
      const a = await navigator.requestMIDIAccess({ sysex: true }).catch(() => navigator.requestMIDIAccess({ sysex: false }))
      access = a
      a.onstatechange = (e) => {
        const p = (e as MIDIConnectionEvent).port
        if (p) addLog(`statechange: ${p.name} — ${p.type} ${p.state}/${p.connection}`)
        refresh()
      }
      refresh()
      // Attach input listeners so we can confirm the device is talking.
      for (const inp of a.inputs.values()) {
        inp.onmidimessage = (ev) => {
          const d = (ev as MIDIMessageEvent).data
          if (d) addLog(`IN  ${inp.name}:  ${[...d].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`)
        }
      }
      addLog(`Connected. ${outputs.length} output(s), ${inputs.length} input(s).`)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  function targets(): MIDIOutput[] {
    if (!access) return []
    if (selectedOutputId === '__all__') return [...access.outputs.values()]
    const o = access.outputs.get(selectedOutputId)
    return o ? [o] : []
  }

  async function send(bytes: number[]) {
    const outs = targets()
    if (outs.length === 0) {
      addLog(`OUT  (no output port to send to!)`)
      return
    }
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')
    for (const o of outs) {
      try {
        await o.open()
        o.send(bytes)
        addLog(`OUT ${o.name}:  ${hex}`)
      } catch (e) {
        addLog(`OUT ${o.name}:  FAILED ${e instanceof Error ? e.message : e}`)
      }
    }
  }

  function forAllPads(vel: number) {
    for (let i = 0; i < 40; i++) void send([0x96, i, vel])
  }

  let rawHex = $state('96 00 05')
  function sendRaw() {
    const bytes = rawHex
      .trim()
      .split(/[\s,]+/)
      .map((h) => parseInt(h, 16))
      .filter((n) => Number.isFinite(n))
    if (bytes.length) void send(bytes)
  }

  onMount(() => {
    supported = 'requestMIDIAccess' in navigator
    if (supported) void connect()
  })
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 p-4 font-mono text-sm">
  <h1 class="text-xl font-black">MIDI diagnostic</h1>

  {#if !supported}
    <p class="text-red-600">Web MIDI not supported in this browser (use Chrome/Edge desktop).</p>
  {/if}
  {#if error}<p class="text-red-600">Error: {error}</p>{/if}

  <button class="w-fit border-2 border-black px-3 py-1 font-bold" onclick={() => void connect()}>
    (Re)connect
  </button>

  <section>
    <h2 class="font-black">OUTPUT ports ({outputs.length})</h2>
    {#if outputs.length === 0}
      <p class="text-red-600 font-bold">⚠ NO OUTPUT PORTS — the controller can't receive LED commands. This is the bug.</p>
    {:else}
      <ul>
        {#each outputs as o (o.id)}
          <li>• <b>{o.name}</b> — {o.state}/{o.connection} {o.manufacturer ? `· ${o.manufacturer}` : ''} <span class="text-gray-500">[{o.id}]</span></li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <h2 class="font-black">INPUT ports ({inputs.length})</h2>
    <ul>
      {#each inputs as i (i.id)}
        <li>• {i.name} — {i.state}/{i.connection}</li>
      {/each}
    </ul>
  </section>

  <section class="flex flex-col gap-2">
    <label>
      Send to:
      <select bind:value={selectedOutputId} class="border-2 border-black px-1">
        <option value="__all__">ALL output ports</option>
        {#each outputs as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
      </select>
    </label>

    <div class="flex flex-wrap gap-2">
      <button class="border-2 border-black px-2 py-1" onclick={() => void send([0x96, 0, 0x05])}>Pad0 RED (96 00 05)</button>
      <button class="border-2 border-black px-2 py-1" onclick={() => void send([0x96, 0, 0x15])}>Pad0 GREEN (96 00 15)</button>
      <button class="border-2 border-black px-2 py-1" onclick={() => void send([0x96, 0, 0x2d])}>Pad0 BLUE (96 00 2d)</button>
      <button class="border-2 border-black px-2 py-1" onclick={() => void send([0x96, 0, 0x00])}>Pad0 OFF (96 00 00)</button>
    </div>
    <div class="flex flex-wrap gap-2">
      <button class="border-2 border-black px-2 py-1" onclick={() => forAllPads(0x05)}>ALL pads RED</button>
      <button class="border-2 border-black px-2 py-1" onclick={() => forAllPads(0x15)}>ALL pads GREEN</button>
      <button class="border-2 border-black px-2 py-1" onclick={() => forAllPads(0x00)}>ALL pads OFF</button>
    </div>
    <div class="flex flex-wrap gap-2">
      <button class="border-2 border-black px-2 py-1" onclick={() => void send([0x90, 0x40, 0x01])}>Track1 LED on (90 40 01)</button>
      <button class="border-2 border-black px-2 py-1" onclick={() => void send([0x90, 0x5b, 0x01])}>Play LED on (90 5b 01)</button>
      <button class="border-2 border-black px-2 py-1" onclick={() => void send([0x90, 0x40, 0x00])}>Track1 LED off</button>
    </div>
    <div class="flex gap-2">
      <input bind:value={rawHex} class="border-2 border-black px-2 py-1" placeholder="96 00 05" />
      <button class="border-2 border-black px-2 py-1 font-bold" onclick={sendRaw}>Send raw hex</button>
    </div>
  </section>

  <section>
    <h2 class="font-black">Log</h2>
    <div class="h-64 overflow-y-auto border-2 border-black p-2 text-xs">
      {#each log as line, i (i)}<div>{line}</div>{/each}
    </div>
  </section>
</div>
