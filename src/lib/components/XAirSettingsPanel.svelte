<script lang="ts">
  /**
   * The XR18 "Live Rig" settings page: connect, route BarBro's outputs to desk
   * channels, build a per-performer in-ear monitor mix on each aux bus, and — the
   * centerpiece — PROVE the house is safe (click + cue OFF the main/LR bus) by
   * reading the console's real state back, not send-and-hope.
   *
   * Desk control only (OSC). Discrete per-stem audio channels are a separate,
   * deferred job — until then click/cue safety is enforced at the desk (LR-assign).
   */
  import { browser } from '$app/environment'
  import { onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import { Button } from '$lib/components/ui/button'
  import {
    connectXAirMixer,
    disconnectXAirMixer,
    getHardwareStatus,
    refreshXAirState,
    setXAirBusFader,
    setXAirBusSend,
    setXAirChannelFader,
    setXAirChannelMainAssign,
    setXAirChannelOn,
    type XAirStatus,
  } from '$lib/client/hardwareBridge'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { project } from '$lib/stores/project'
  import { setProjectPerformers } from '$lib/project/commit'
  import type { Performer } from '$lib/project/types'
  import {
    buildXAirBusSends,
    buildXAirLaneWrites,
    diffXAirBusWrites,
    diffXAirLaneWrites,
    ensureXAirRoutesForLanes,
    formatXAirChannelList,
    isMonitorOnlyLane,
    parseXAirChannelList,
    verifyFohSafe,
    xairFohSafetyPlan,
    type XAirBusWrite,
    type XAirLaneRoute,
    type XAirLaneWrite,
    type XAirLiveLane,
    type XAirMonitorMix,
  } from '$lib/hardware/xairRouting'
  import { Cable, Power, RefreshCw, ShieldCheck, ShieldAlert } from '@lucide/svelte'

  let { lanes = [], projectId = null, disabled = false } = $props<{
    lanes?: XAirLiveLane[]
    projectId?: string | null
    disabled?: boolean
  }>()

  type StoredConfig = {
    host: string
    portText: string
    armed: boolean
    routes: XAirLaneRoute[]
    /** bus (1-6) → laneKey → send level; and bus → master level. Per-device. */
    monitorSends: Record<number, Record<string, number>>
    busMaster: Record<number, number>
  }

  let host = $state('192.168.1.1')
  let portText = $state('10024')
  let armed = $state(false)
  let routes = $state<XAirLaneRoute[]>([])
  let monitorSends = $state<Record<number, Record<string, number>>>({})
  let busMaster = $state<Record<number, number>>({})
  let status = $state<XAirStatus | null>(null)
  let busy = $state(false)
  let error = $state('')
  let note = $state('')
  let fohState = $state<{ safe: boolean; unsafeChannels: number[] } | null>(null)
  let fohBusy = $state(false)

  let sentLaneState = new Map<string, string>()
  let sentBusState = new Map<string, string>()
  let syncTimer: number | null = null
  let loadedStorageKey = ''

  const connected = $derived(status?.connected === true)
  const hasReply = $derived(!!status?.lastMessageAt)
  const storageKey = $derived(`barbro:liveHardware:xair:${projectId ?? 'global'}`)
  const canUseHardware = $derived($desktopCompanionStatus.reachable && !disabled)
  const performers = $derived<Performer[]>($project.data?.performers ?? [])

  const routeDrafts = $derived.by(() => {
    const byKey = new Map(routes.map((r) => [r.laneKey, r]))
    return lanes.map((lane) => {
      const route = byKey.get(lane.key) ?? { laneKey: lane.key, channels: [], followVolume: true, followMute: true }
      return { ...route, lane, channelText: formatXAirChannelList(route.channels) }
    })
  })

  /** The performers who have a bus + their mix, in bus order — the monitor cards. */
  const monitorMixes = $derived.by<(XAirMonitorMix & { performer: Performer })[]>(() =>
    performers
      .filter((p) => typeof p.monitorBus === 'number' && p.monitorBus >= 1 && p.monitorBus <= 6)
      .map((p) => ({
        performer: p,
        performerId: p.id,
        bus: p.monitorBus!,
        sends: monitorSends[p.monitorBus!] ?? {},
        master: busMaster[p.monitorBus!] ?? 0.75,
      }))
      .sort((a, b) => a.bus - b.bus),
  )

  // ── Persistence (localStorage, per project/device) ──
  function loadConfig(key: string) {
    if (!browser) return
    loadedStorageKey = key
    try {
      const raw = localStorage.getItem(key)
      if (!raw) {
        routes = ensureXAirRoutesForLanes([], lanes)
        return
      }
      const parsed = JSON.parse(raw) as Partial<StoredConfig>
      host = typeof parsed.host === 'string' && parsed.host.trim() ? parsed.host.trim() : host
      portText = typeof parsed.portText === 'string' ? parsed.portText : portText
      armed = parsed.armed === true
      routes = ensureXAirRoutesForLanes(Array.isArray(parsed.routes) ? parsed.routes : [], lanes)
      monitorSends = parsed.monitorSends && typeof parsed.monitorSends === 'object' ? parsed.monitorSends : {}
      busMaster = parsed.busMaster && typeof parsed.busMaster === 'object' ? parsed.busMaster : {}
    } catch {
      routes = ensureXAirRoutesForLanes([], lanes)
    }
  }
  function saveConfig() {
    if (!browser || !loadedStorageKey) return
    try {
      const cfg: StoredConfig = { host, portText, armed, routes, monitorSends, busMaster }
      localStorage.setItem(loadedStorageKey, JSON.stringify(cfg))
    } catch {
      /* best-effort */
    }
  }

  $effect(() => {
    const key = storageKey
    if (!browser || loadedStorageKey === key) return
    loadConfig(key)
  })
  $effect(() => {
    const next = ensureXAirRoutesForLanes(routes, lanes)
    if (JSON.stringify(next) !== JSON.stringify(routes)) routes = next
  })
  $effect(() => {
    void [host, portText, armed, routes, monitorSends, busMaster]
    saveConfig()
  })

  // Poll desk status.
  $effect(() => {
    if (!browser || !$desktopCompanionStatus.reachable) {
      status = null
      return
    }
    let stopped = false
    const poll = async () => {
      const next = await getHardwareStatus()
      if (!stopped && next?.xair) status = next.xair
    }
    void poll()
    const id = window.setInterval(poll, 3500)
    return () => {
      stopped = true
      window.clearInterval(id)
    }
  })

  // ── Routing edits ──
  function patchRoute(laneKey: string, patch: Partial<XAirLaneRoute>) {
    routes = routes.map((r) => (r.laneKey === laneKey ? { ...r, ...patch } : r))
  }
  function updateRouteChannels(laneKey: string, text: string) {
    try {
      patchRoute(laneKey, { channels: parseXAirChannelList(text) })
      error = ''
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  // ── Connect / arm ──
  async function connect() {
    if (busy) return
    error = ''
    note = ''
    const rawPort = portText.trim()
    let port: number | undefined
    if (rawPort) {
      port = Number.parseInt(rawPort, 10)
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        error = 'XR18 port must be 1..65535.'
        return
      }
    }
    busy = true
    const r = await connectXAirMixer({ host: host.trim(), ...(port ? { port } : {}) })
    busy = false
    if (!r.ok) {
      error = r.error
      if (r.xair) status = r.xair
      return
    }
    status = r.xair
    note = 'Connected. Verify the house is safe before you go live.'
    setTimeout(() => void verifyFoh(), 400) // give the desk a beat to reply
  }
  async function disconnect() {
    if (busy) return
    armed = false
    sentLaneState = new Map()
    sentBusState = new Map()
    fohState = null
    busy = true
    const r = await disconnectXAirMixer()
    busy = false
    if (r.xair) status = r.xair
    if (!r.ok) error = r.error
  }
  async function setArmed(next: boolean) {
    armed = next
    error = ''
    if (next) {
      await fixFoh() // protect the house FIRST, always
      await syncNow(true)
      await syncMonitors(true)
    } else {
      note = 'Live follow off.'
    }
  }

  // ── FOH safety (the centerpiece) ──
  async function verifyFoh() {
    if (!connected) return
    fohBusy = true
    const r = await refreshXAirState()
    fohBusy = false
    if (!r.ok) {
      error = r.error
      fohState = null
      return
    }
    const mainAssign = new Map<number, boolean>()
    for (const [ch, st] of Object.entries(r.channels)) {
      if (st?.lr != null) mainAssign.set(Number(ch), st.lr === 1)
    }
    fohState = verifyFohSafe(routes, mainAssign)
    note = fohState.safe ? 'Read back the desk — the house is safe.' : ''
  }
  async function fixFoh() {
    if (!connected) return
    fohBusy = true
    error = ''
    for (const w of xairFohSafetyPlan(routes)) {
      const r = await setXAirChannelMainAssign(w.channel, w.on)
      if (r.xair) status = r.xair
      if (!r.ok) {
        error = r.error
        fohBusy = false
        return
      }
    }
    fohBusy = false
    await verifyFoh()
  }

  // ── Sync lane faders/mutes + monitor sends ──
  async function sendLaneWrite(w: XAirLaneWrite) {
    if (w.kind === 'channel-fader') return await setXAirChannelFader(w.channel, w.value)
    return await setXAirChannelOn(w.channel, w.on)
  }
  async function sendBusWrite(w: XAirBusWrite) {
    if (w.kind === 'bus-send') return await setXAirBusSend(w.channel, w.bus, w.value)
    return await setXAirBusFader(w.bus, w.value)
  }
  async function syncNow(force = false) {
    if (!connected) {
      error = 'Connect to the XR18 before syncing.'
      return
    }
    const { changed, nextState } = diffXAirLaneWrites(
      buildXAirLaneWrites(lanes, routes),
      force ? new Map() : sentLaneState,
    )
    sentLaneState = nextState
    for (const w of changed) {
      const r = await sendLaneWrite(w)
      if (r.xair) status = r.xair
      if (!r.ok) {
        error = r.error
        return
      }
    }
  }
  async function syncMonitors(force = false) {
    if (!connected) return
    const { changed, nextState } = diffXAirBusWrites(
      buildXAirBusSends(routes, monitorMixes),
      force ? new Map() : sentBusState,
    )
    sentBusState = nextState
    for (const w of changed) {
      const r = await sendBusWrite(w)
      if (r.xair) status = r.xair
      if (!r.ok) {
        error = r.error
        return
      }
    }
  }
  function scheduleSync() {
    if (syncTimer) window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => {
      syncTimer = null
      void syncNow(false)
      void syncMonitors(false)
    }, 90)
  }
  $effect(() => {
    if (!browser || !armed || !connected) return
    void [lanes, routes, monitorSends, busMaster]
    scheduleSync()
  })
  $effect(() => {
    if (!canUseHardware && armed) armed = false
  })

  // ── Monitor-mix edits ──
  async function assignBus(performerId: string, bus: number | null) {
    const next = performers.map((p) =>
      p.id === performerId ? { ...p, ...(bus ? { monitorBus: bus } : { monitorBus: undefined }) } : p,
    )
    try {
      await setProjectPerformers(next)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }
  function setSend(bus: number, laneKey: string, level: number) {
    monitorSends = { ...monitorSends, [bus]: { ...(monitorSends[bus] ?? {}), [laneKey]: level } }
  }
  function setMaster(bus: number, level: number) {
    busMaster = { ...busMaster, [bus]: level }
  }
  async function testMonitor(bus: number) {
    if (!connected) return
    const restore = busMaster[bus] ?? 0.75
    note = `Testing monitor bus ${bus} — the performer should hear their mix.`
    await setXAirBusFader(bus, 0.75)
    setTimeout(() => void setXAirBusFader(bus, restore), 1500)
  }

  const usedBuses = $derived(new Set(monitorMixes.map((m) => m.bus)))
  const routedLanes = $derived(lanes.filter((l) => (routes.find((r) => r.laneKey === l.key)?.channels.length ?? 0) > 0))

  onDestroy(() => {
    if (syncTimer) window.clearTimeout(syncTimer)
  })
</script>

<section class="flex flex-col gap-4 text-sm">
  <!-- ── FOH-safety banner (the centerpiece) ─────────────────────────────── -->
  <div
    class="rounded-[var(--radius)] border-2 p-3 {fohState?.safe
      ? 'border-emerald-500 bg-emerald-500/10'
      : 'border-destructive bg-destructive/10'}"
  >
    <div class="flex flex-wrap items-center gap-3">
      {#if fohState?.safe}
        <ShieldCheck class="size-6 shrink-0 text-emerald-500" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="font-black uppercase tracking-wide text-emerald-600 dark:text-emerald-400">House safe</p>
          <p class="text-muted-foreground text-xs">Click &amp; cue are OFF the main mix — verified from the desk.</p>
        </div>
      {:else}
        <ShieldAlert class="size-6 shrink-0 text-destructive" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="font-black uppercase tracking-wide text-destructive">
            {fohState ? 'Not house-safe' : 'House safety unverified'}
          </p>
          <p class="text-muted-foreground text-xs">
            {#if fohState && fohState.unsafeChannels.length > 0}
              Channel{fohState.unsafeChannels.length > 1 ? 's' : ''}
              {fohState.unsafeChannels.join(', ')} may still send click/cue to the house. Take them off FOH.
            {:else}
              Read the desk back and take click/cue off the main mix before you go live.
            {/if}
          </p>
        </div>
      {/if}
      <div class="flex shrink-0 gap-2">
        <Button variant="outline" size="sm" class="" onclick={() => void verifyFoh()} disabled={!connected || fohBusy}>
          <RefreshCw class="size-3.5 {fohBusy ? 'animate-spin' : ''}" aria-hidden="true" /> Verify
        </Button>
        <Button size="sm" class="" onclick={() => void fixFoh()} disabled={!connected || fohBusy}>
          Take click/cue off FOH
        </Button>
      </div>
    </div>
  </div>

  <!-- ── Connect ──────────────────────────────────────────────────────────── -->
  <div class="flex flex-wrap items-center gap-2">
    <span class="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wide">
      <span
        class="size-2.5 rounded-full {connected ? (hasReply ? 'bg-emerald-500' : 'bg-amber-500') : 'bg-foreground/25'}"
        aria-hidden="true"
      ></span>
      <Cable class="size-3.5" aria-hidden="true" /> XR18
    </span>
    <input
      class="border-foreground/25 bg-background h-8 w-36 rounded-[var(--radius)] border px-2 font-mono text-xs disabled:opacity-50"
      bind:value={host}
      placeholder="XR18 IP"
      disabled={!canUseHardware || busy || connected}
      aria-label="XR18 host"
    />
    <input
      class="border-foreground/25 bg-background h-8 w-16 rounded-[var(--radius)] border px-2 font-mono text-xs disabled:opacity-50"
      bind:value={portText}
      placeholder="10024"
      disabled={!canUseHardware || busy || connected}
      aria-label="XR18 OSC port"
    />
    {#if connected}
      <Button variant="outline" size="sm" class="" onclick={disconnect} disabled={busy}>Disconnect</Button>
    {:else}
      <Button variant="outline" size="sm" class="" onclick={connect} disabled={!canUseHardware || busy || !host.trim()}>
        <Power class="size-3.5" aria-hidden="true" /> Connect
      </Button>
    {/if}
    <label
      class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--radius)] px-2 text-xs font-bold {armed
        ? 'bg-primary text-primary-foreground'
        : 'bg-background ring-foreground/20 ring-1'} {connected && canUseHardware ? '' : 'opacity-50'}"
      title="Mirror BarBro lane faders/mutes + monitor sends to the desk (applies FOH safety first)."
    >
      <input
        type="checkbox"
        class="accent-foreground size-3.5"
        checked={armed}
        disabled={!connected || !canUseHardware}
        onchange={(e) => void setArmed((e.currentTarget as HTMLInputElement).checked)}
      />
      Follow mixer
    </label>
    {#if !$desktopCompanionStatus.reachable}
      <span class="text-muted-foreground text-xs">Desktop app needed to reach the XR18.</span>
    {:else if error}
      <span class="text-destructive min-w-0 flex-1 truncate text-xs" title={error}>{error}</span>
    {:else if note}
      <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={note}>{note}</span>
    {/if}
  </div>

  <!-- ── Output routing ───────────────────────────────────────────────────── -->
  <div>
    <p class="mb-1.5 text-xs font-black uppercase tracking-wide">Output routing</p>
    <div class="border-foreground/15 overflow-hidden rounded-[var(--radius)] border">
      <div class="text-muted-foreground grid grid-cols-[minmax(7rem,1fr)_6rem_4rem_4rem] items-center gap-1 border-b border-foreground/10 px-2 py-1 text-[10px] font-black uppercase">
        <span>BarBro output</span><span>XR18 ch</span><span>Level</span><span>Mute</span>
      </div>
      {#each routeDrafts as route (route.laneKey)}
        <div class="grid grid-cols-[minmax(7rem,1fr)_6rem_4rem_4rem] items-center gap-1 px-2 py-1 hover:bg-muted/40">
          <span class="flex min-w-0 items-center gap-1.5 truncate font-semibold" title={route.lane?.label ?? route.laneKey}>
            {route.lane?.label ?? route.laneKey}
            {#if isMonitorOnlyLane(route.laneKey)}
              <span class="rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-black uppercase text-amber-600 dark:text-amber-400">monitor only</span>
            {/if}
          </span>
          <input
            class="border-foreground/20 bg-background h-7 rounded-[var(--radius)] border px-1 font-mono text-[11px]"
            value={route.channelText}
            placeholder="9,10"
            oninput={(e) => updateRouteChannels(route.laneKey, (e.currentTarget as HTMLInputElement).value)}
            aria-label={`XR18 channels for ${route.lane?.label ?? route.laneKey}`}
          />
          <input
            type="checkbox"
            class="accent-foreground size-3.5 justify-self-center"
            checked={route.followVolume}
            onchange={(e) => patchRoute(route.laneKey, { followVolume: (e.currentTarget as HTMLInputElement).checked })}
            aria-label={`Follow ${route.laneKey} level`}
          />
          <input
            type="checkbox"
            class="accent-foreground size-3.5 justify-self-center"
            checked={route.followMute}
            onchange={(e) => patchRoute(route.laneKey, { followMute: (e.currentTarget as HTMLInputElement).checked })}
            aria-label={`Follow ${route.laneKey} mute`}
          />
        </div>
      {/each}
    </div>
  </div>

  <!-- ── Monitor mixes (one per performer) ────────────────────────────────── -->
  <div>
    <p class="mb-1.5 text-xs font-black uppercase tracking-wide">In-ear monitor mixes</p>
    {#if performers.length === 0}
      <p class="text-muted-foreground text-xs">
        Add band members in Project settings — each performer gets their own monitor mix here.
      </p>
    {:else}
      <div class="flex flex-col gap-2">
        {#each performers as performer (performer.id)}
          {@const bus = performer.monitorBus}
          <div class="border-foreground/15 rounded-[var(--radius)] border p-2">
            <div class="mb-2 flex flex-wrap items-center gap-2">
              <span class="font-bold">{performer.name}</span>
              {#if performer.role}<span class="text-muted-foreground text-xs">{performer.role}</span>{/if}
              <label class="text-muted-foreground ml-auto inline-flex items-center gap-1.5 text-xs font-bold">
                Bus
                <select
                  class="border-foreground/25 bg-background rounded-[var(--radius)] border px-1.5 py-0.5 text-xs font-bold"
                  value={bus ?? ''}
                  onchange={(e) => {
                    const v = (e.currentTarget as HTMLSelectElement).value
                    void assignBus(performer.id, v ? Number(v) : null)
                  }}
                >
                  <option value="">—</option>
                  {#each [1, 2, 3, 4, 5, 6] as b (b)}
                    <option value={b} disabled={usedBuses.has(b) && b !== bus}>{b}</option>
                  {/each}
                </select>
              </label>
              {#if bus}
                <Button variant="outline" size="sm" class="" onclick={() => void testMonitor(bus)} disabled={!connected}>
                  Test
                </Button>
              {/if}
            </div>
            {#if bus}
              <div class="flex flex-col gap-1.5">
                {#each routedLanes as lane (lane.key)}
                  <label class="grid grid-cols-[minmax(6rem,10rem)_1fr_2.5rem] items-center gap-2 text-xs">
                    <span class="truncate font-semibold" title={lane.label}>{lane.label}</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={monitorSends[bus]?.[lane.key] ?? 0}
                      oninput={(e) => setSend(bus, lane.key, Number((e.currentTarget as HTMLInputElement).value))}
                      class="accent-[var(--studio-orange)]"
                      aria-label={`${lane.label} send to ${performer.name}`}
                    />
                    <span class="text-muted-foreground text-right font-mono text-[10px]">
                      {Math.round((monitorSends[bus]?.[lane.key] ?? 0) * 100)}
                    </span>
                  </label>
                {/each}
                <label class="grid grid-cols-[minmax(6rem,10rem)_1fr_2.5rem] items-center gap-2 border-t border-foreground/10 pt-1.5 text-xs">
                  <span class="font-black uppercase tracking-wide">Bus master</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={busMaster[bus] ?? 0.75}
                    oninput={(e) => setMaster(bus, Number((e.currentTarget as HTMLInputElement).value))}
                    class="accent-[var(--studio-orange)]"
                    aria-label={`${performer.name} monitor master`}
                  />
                  <span class="text-muted-foreground text-right font-mono text-[10px]">
                    {Math.round((busMaster[bus] ?? 0.75) * 100)}
                  </span>
                </label>
              </div>
            {:else}
              <p class="text-muted-foreground text-xs">Assign a bus to build this performer's in-ear mix.</p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>
