<script lang="ts">
  import { browser } from '$app/environment'
  import { onDestroy } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    connectXAirMixer,
    disconnectXAirMixer,
    getHardwareStatus,
    setXAirChannelFader,
    setXAirChannelOn,
    type XAirStatus,
  } from '$lib/client/hardwareBridge'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import {
    buildXAirLaneWrites,
    diffXAirLaneWrites,
    ensureXAirRoutesForLanes,
    formatXAirChannelList,
    parseXAirChannelList,
    type XAirLaneRoute,
    type XAirLiveLane,
  } from '$lib/hardware/xairRouting'
  import { Cable, Power, RefreshCw } from '@lucide/svelte'

  let {
    lanes = [],
    projectId = null,
    disabled = false,
  } = $props<{
    lanes?: XAirLiveLane[]
    projectId?: string | null
    disabled?: boolean
  }>()

  type StoredConfig = {
    host: string
    portText: string
    armed: boolean
    routes: XAirLaneRoute[]
  }

  let host = $state('192.168.1.1')
  let portText = $state('10024')
  let armed = $state(false)
  let routes = $state<XAirLaneRoute[]>([])
  let status = $state<XAirStatus | null>(null)
  let busy = $state(false)
  let syncing = $state(false)
  let error = $state('')
  let note = $state('')
  /** Last values actually sent, keyed `f:<ch>` / `o:<ch>` — the diff baseline. */
  let sentWriteState = new Map<string, string>()
  let syncTimer: number | null = null
  let loadedStorageKey = ''

  const connected = $derived(status?.connected === true)
  const hasReply = $derived(!!status?.lastMessageAt)
  const storageKey = $derived(`barbro:liveHardware:xair:${projectId ?? 'global'}`)
  const canUseHardware = $derived($desktopCompanionStatus.reachable && !disabled)
  const routeDrafts = $derived.by(() => {
    const byKey = new Map(routes.map((route) => [route.laneKey, route]))
    return lanes.map((lane) => {
      const route = byKey.get(lane.key) ?? {
        laneKey: lane.key,
        channels: [],
        followVolume: true,
        followMute: true,
      }
      return {
        ...route,
        lane,
        channelText: formatXAirChannelList(route.channels),
      }
    })
  })

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
    } catch {
      routes = ensureXAirRoutesForLanes([], lanes)
    }
  }

  function saveConfig() {
    if (!browser || !loadedStorageKey) return
    try {
      const cfg: StoredConfig = { host, portText, armed, routes }
      localStorage.setItem(loadedStorageKey, JSON.stringify(cfg))
    } catch {
      /* local storage is best-effort only */
    }
  }

  function routeSignature(value: readonly XAirLaneRoute[]): string {
    return JSON.stringify(
      value.map((route) => ({
        laneKey: route.laneKey,
        channels: route.channels,
        followVolume: route.followVolume,
        followMute: route.followMute,
      })),
    )
  }

  $effect(() => {
    const key = storageKey
    if (!browser || loadedStorageKey === key) return
    loadConfig(key)
  })

  $effect(() => {
    const next = ensureXAirRoutesForLanes(routes, lanes)
    if (routeSignature(next) !== routeSignature(routes)) routes = next
  })

  $effect(() => {
    host
    portText
    armed
    routes
    saveConfig()
  })

  $effect(() => {
    if (!browser || !$desktopCompanionStatus.reachable) {
      status = null
      return
    }
    let stopped = false
    const poll = async () => {
      const next = await getHardwareStatus()
      if (stopped) return
      if (next?.xair) status = next.xair
    }
    void poll()
    const id = window.setInterval(poll, 3500)
    return () => {
      stopped = true
      window.clearInterval(id)
    }
  })

  function patchRoute(laneKey: string, patch: Partial<XAirLaneRoute>) {
    routes = routes.map((route) => (route.laneKey === laneKey ? { ...route, ...patch } : route))
  }

  function updateRouteChannels(laneKey: string, text: string) {
    try {
      patchRoute(laneKey, { channels: parseXAirChannelList(text) })
      error = ''
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

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
    note = r.xair.lastMessageAt
      ? 'XR18 replied.'
      : 'Control socket ready. Waiting for the XR18 to reply.'
  }

  async function disconnect() {
    if (busy) return
    armed = false
    sentWriteState = new Map() // reconnect must force-push everything
    busy = true
    const r = await disconnectXAirMixer()
    busy = false
    if (r.xair) status = r.xair
    if (!r.ok) error = r.error
  }

  function setArmed(next: boolean) {
    armed = next
    error = ''
    if (next) {
      void syncNow(true)
    } else {
      note = 'Live follow off.'
    }
  }

  async function sendWrite(write: ReturnType<typeof buildXAirLaneWrites>[number]) {
    if (write.kind === 'channel-fader') return await setXAirChannelFader(write.channel, write.value)
    return await setXAirChannelOn(write.channel, write.on)
  }

  async function syncNow(force = false) {
    if (!connected) {
      error = 'Connect to the XR18 before syncing.'
      return
    }
    const writes = buildXAirLaneWrites(lanes, routes)
    if (writes.length === 0) {
      note = 'No XR18 channels mapped.'
      sentWriteState = new Map()
      return
    }
    // Only send what CHANGED since the last successful send — a knob move
    // must not re-write every mapped channel. Force (arm / manual Sync)
    // pushes the full state.
    const { changed, nextState } = diffXAirLaneWrites(
      writes,
      force ? new Map() : sentWriteState,
    )
    if (changed.length === 0) {
      sentWriteState = nextState
      return
    }
    syncing = true
    error = ''
    for (const write of changed) {
      const r = await sendWrite(write)
      if (r.xair) status = r.xair
      if (!r.ok) {
        // Drop this write from the assumed-sent state so the retry resends it.
        error = r.error
        syncing = false
        return
      }
      const key = write.kind === 'channel-fader' ? `f:${write.channel}` : `o:${write.channel}`
      sentWriteState.set(
        key,
        write.kind === 'channel-fader' ? write.value.toFixed(4) : write.on ? '1' : '0',
      )
    }
    syncing = false
    note = `Synced ${changed.length} XR18 write${changed.length === 1 ? '' : 's'}.`
  }

  function scheduleSync() {
    if (syncTimer) window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => {
      syncTimer = null
      void syncNow(false)
    }, 90)
  }

  $effect(() => {
    if (!browser || !armed || !connected) return
    lanes
    routes
    scheduleSync()
  })

  $effect(() => {
    if (!canUseHardware && armed) armed = false
  })

  onDestroy(() => {
    if (syncTimer) window.clearTimeout(syncTimer)
  })
</script>

<section class="live-hardware rounded-[var(--radius)] border border-foreground/15 bg-muted/35 px-2 py-2">
  <div class="flex flex-wrap items-center gap-2">
    <span
      class="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wide"
      title={connected
        ? hasReply
          ? 'XR18 control is connected and receiving replies.'
          : 'XR18 UDP control socket is open, but no reply has arrived yet.'
        : 'XR18 is disconnected.'}
    >
      <span
        class="size-2.5 rounded-full {connected
          ? hasReply
            ? 'bg-emerald-500'
            : 'bg-amber-500'
          : 'bg-foreground/25'}"
        aria-hidden="true"
      ></span>
      <Cable class="size-3.5" aria-hidden="true" />
      XR18
    </span>

    <input
      class="h-7 w-32 rounded-[var(--radius)] border border-foreground/25 bg-background px-2 font-mono text-xs disabled:opacity-50"
      bind:value={host}
      placeholder="XR18 IP"
      disabled={!canUseHardware || busy || connected}
      aria-label="XR18 host"
    />
    <input
      class="h-7 w-16 rounded-[var(--radius)] border border-foreground/25 bg-background px-2 font-mono text-xs disabled:opacity-50"
      bind:value={portText}
      placeholder="10024"
      disabled={!canUseHardware || busy || connected}
      aria-label="XR18 OSC port"
    />

    {#if connected}
      <Button variant="outline" size="sm" class="h-7" onclick={disconnect} disabled={busy}>
        Disconnect
      </Button>
    {:else}
      <Button variant="outline" size="sm" class="h-7" onclick={connect} disabled={!canUseHardware || busy || !host.trim()}>
        <Power class="size-3.5" aria-hidden="true" />
        Connect
      </Button>
    {/if}

    <label
      class="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius)] px-1.5 text-xs font-bold {armed
        ? 'bg-primary text-primary-foreground'
        : 'bg-background text-foreground ring-1 ring-foreground/20'} {connected && canUseHardware
        ? 'cursor-pointer'
        : 'opacity-50'}"
      title="When enabled, BarBro mixer lane faders and mutes are mirrored to mapped XR18 channels."
    >
      <input
        type="checkbox"
        class="accent-foreground size-3.5"
        checked={armed}
        disabled={!connected || !canUseHardware}
        onchange={(e) => setArmed((e.currentTarget as HTMLInputElement).checked)}
      />
      Follow mixer
    </label>

    <Button
      variant="ghost"
      size="sm"
      class="h-7"
      onclick={() => void syncNow(true)}
      disabled={!connected || !canUseHardware || syncing}
      title="Push current BarBro mixer faders and mutes to the mapped XR18 channels now"
    >
      <RefreshCw class="size-3.5 {syncing ? 'animate-spin' : ''}" aria-hidden="true" />
      Sync
    </Button>

    <details class="relative">
      <summary class="cursor-pointer list-none text-xs font-bold underline-offset-2 hover:underline marker:content-none [&::-webkit-details-marker]:hidden">
        Routes
      </summary>
      <div class="absolute right-0 z-30 mt-2 w-[min(36rem,calc(100vw-2rem))] rounded-[var(--radius)] border border-foreground/20 bg-popover p-2 text-popover-foreground shadow-lg">
        <div class="grid grid-cols-[minmax(7rem,1fr)_5rem_4rem_4rem] items-center gap-1 px-1 pb-1 text-[10px] font-black uppercase text-muted-foreground">
          <span>Lane</span>
          <span>XR18 ch</span>
          <span>Level</span>
          <span>Mute</span>
        </div>
        {#each routeDrafts as route (route.laneKey)}
          <div class="grid grid-cols-[minmax(7rem,1fr)_5rem_4rem_4rem] items-center gap-1 rounded-[var(--radius)] px-1 py-1 text-xs hover:bg-muted/50">
            <span class="min-w-0 truncate font-semibold" title={route.lane?.label ?? route.laneKey}>
              {route.lane?.label ?? route.laneKey}
            </span>
            <input
              class="h-6 rounded-[var(--radius)] border border-foreground/20 bg-background px-1 font-mono text-[11px]"
              value={route.channelText}
              placeholder="17,18"
              oninput={(e) => updateRouteChannels(route.laneKey, (e.currentTarget as HTMLInputElement).value)}
              aria-label={`XR18 channel mapping for ${route.lane?.label ?? route.laneKey}`}
            />
            <input
              type="checkbox"
              class="accent-foreground size-3.5 justify-self-center"
              checked={route.followVolume}
              onchange={(e) => patchRoute(route.laneKey, { followVolume: (e.currentTarget as HTMLInputElement).checked })}
              aria-label={`Follow ${route.lane?.label ?? route.laneKey} volume`}
            />
            <input
              type="checkbox"
              class="accent-foreground size-3.5 justify-self-center"
              checked={route.followMute}
              onchange={(e) => patchRoute(route.laneKey, { followMute: (e.currentTarget as HTMLInputElement).checked })}
              aria-label={`Follow ${route.lane?.label ?? route.laneKey} mute`}
            />
          </div>
        {/each}
      </div>
    </details>

    {#if !$desktopCompanionStatus.reachable}
      <span class="text-muted-foreground text-xs">Desktop app needed.</span>
    {:else if error}
      <span class="text-destructive min-w-0 flex-1 truncate text-xs" title={error}>{error}</span>
    {:else if note}
      <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={note}>{note}</span>
    {:else if connected && !hasReply}
      <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs">Waiting for XR18 reply.</span>
    {/if}
  </div>
</section>
