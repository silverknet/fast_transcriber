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
  import { onDestroy, onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { Button } from '$lib/components/ui/button'
  import {
    connectXAirMixer,
    disconnectXAirMixer,
    getHardwareStatus,
    queryXAirPaths,
    refreshXAirState,
    setXAirBusFader,
    setXAirBusSend,
    setXAirChannelFader,
    setXAirChannelMainAssign,
    setXAirChannelOn,
    setXAirOscInt,
    type XAirStatus,
  } from '$lib/client/hardwareBridge'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { project } from '$lib/stores/project'
  import { setProjectLiveRig } from '$lib/project/commit'
  import { clearRigStatus, reportRigStatus } from '$lib/stores/rigStatus'
  import { loadRigSetup, resolveProfileRequest, saveRigSetup } from '$lib/hardware/rigSetupStore'
  import { liveRigLayout, type RigLayout } from '$lib/hardware/liveRigPlan'
  import {
    buildSplitBusSends,
    buildSplitStripWrites,
    splitStrips,
    splitVerifyPlan,
  } from '$lib/hardware/splitRouting'
  import {
    BUS_LINK_PATHS,
    readBusTopology,
    type BusTopology,
  } from '$lib/hardware/deskTopology'
  import { patchList, performerInputProblems } from '$lib/project/performerInputs'
  import {
    DEFAULT_STAGE_SEND,
    MAX_MONITOR_SEND,
    buildStageInputSends,
    monitorBuses,
    stageInputRows,
    stageSendVerifyPlan,
  } from '$lib/hardware/stageInputSends'
  import type { LiveRigConfig } from '$lib/project/types'
  import { setProjectPerformers } from '$lib/project/commit'
  import type { Performer } from '$lib/project/types'
  import {
    XAIR_UNITY_FADER,
    buildXAirBusSends,
    buildXAirLaneWrites,
    diffXAirBusWrites,
    diffXAirLaneWrites,
    ensureXAirRoutesForLanes,
    formatXAirChannelList,
    isMonitorOnlyLane,
    parseXAirChannelList,
    verifyFohSafe,
    xairFaderFromLinearGain,
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
  let fohState = $state<ReturnType<typeof verifyFohSafe> | null>(null)
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
  // Feed the navbar indicator from the ONE place that talks to the desk. Only
  // facts the console actually confirmed — see `rigHealth.ts`.
  $effect(() => {
    reportRigStatus({
      deskIdentified: connected && hasReply,
      deskLabel: status?.info ? `${status.info.model ?? 'Desk'} · fw ${status.info.firmware ?? '?'}` : null,
      monitorsConfigured: performers.filter(
        (p) => typeof p.monitorBus === 'number' && p.monitorBus >= 1 && p.monitorBus <= 6,
      ).length,
    })
  })

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

  /**
   * The stored shape has OPTIONAL follow flags; the routing engine requires
   * them. Absent means "follow", which is what an operator means when they
   * assign a lane to a channel and say nothing more — the desk should track the
   * lane's volume and mute rather than sit frozen.
   */
  function normalizeStoredRoutes(
    stored: NonNullable<LiveRigConfig['routes']> | undefined,
  ): XAirLaneRoute[] {
    return (stored ?? []).map((r) => ({
      laneKey: r.laneKey,
      channels: r.channels,
      followVolume: r.followVolume !== false,
      followMute: r.followMute !== false,
    }))
  }

  // ── Persistence ──────────────────────────────────────────────────────────
  //
  // Two homes, on purpose:
  //
  //   PROJECT (shared, synced): routes, monitor sends, bus masters. Which
  //   channel carries the click and how much of it the drummer wants is BAND
  //   setup. It used to live in localStorage, so exactly one laptop knew the
  //   monitor mixes — set them up, open the project anywhere else, gone.
  //
  //   DEVICE (localStorage): the desk's address, and whether this machine is
  //   armed to write to it. Those describe the room you are standing in, and
  //   arming is deliberately not inherited — a laptop that opens the project
  //   should not start moving a desk it was not pointed at.
  function loadConfig(key: string) {
    if (!browser) return
    loadedStorageKey = key
    try {
      const raw = localStorage.getItem(key)
      if (!raw) {
        const shared = $project.data?.liveRig
        routes = ensureXAirRoutesForLanes(normalizeStoredRoutes(shared?.routes), lanes)
        monitorSends = shared?.monitorSends ?? {}
        busMaster = shared?.busMaster ?? {}
        return
      }
      const parsed = JSON.parse(raw) as Partial<StoredConfig>
      host = typeof parsed.host === 'string' && parsed.host.trim() ? parsed.host.trim() : host
      portText = typeof parsed.portText === 'string' ? parsed.portText : portText
      armed = parsed.armed === true
      // The MUSICAL half now lives on the project. What is in localStorage is a
      // pre-migration leftover: adopt it once, then let the project own it, so
      // an existing rig is not silently thrown away by the move.
      const shared = $project.data?.liveRig
      routes = ensureXAirRoutesForLanes(
        shared?.routes ? normalizeStoredRoutes(shared.routes) : Array.isArray(parsed.routes) ? parsed.routes : [],
        lanes,
      )
      monitorSends =
        shared?.monitorSends ??
        (parsed.monitorSends && typeof parsed.monitorSends === 'object' ? parsed.monitorSends : {})
      busMaster =
        shared?.busMaster ??
        (parsed.busMaster && typeof parsed.busMaster === 'object' ? parsed.busMaster : {})
    } catch {
      routes = ensureXAirRoutesForLanes([], lanes)
    }
  }
  function saveConfig() {
    if (!browser || !loadedStorageKey) return
    try {
      // Device half only. `routes`/`monitorSends`/`busMaster` are still written
      // here so a downgrade or an offline machine keeps working, but the project
      // is the source of truth and wins on load.
      const cfg: StoredConfig = { host, portText, armed, routes, monitorSends, busMaster }
      localStorage.setItem(loadedStorageKey, JSON.stringify(cfg))
    } catch {
      /* best-effort */
    }
  }

  /**
   * Persist the BAND half to the project file.
   *
   * Debounced: dragging a monitor send fires continuously, and each write is a
   * manifest rewrite plus a cloud push. The desk still follows every movement
   * live — this only decides how often it is written down.
   */
  let sharedSaveTimer: ReturnType<typeof setTimeout> | null = null
  function saveSharedRig() {
    if (!browser || !$project.osPath || !$project.data) return
    if (sharedSaveTimer) clearTimeout(sharedSaveTimer)
    sharedSaveTimer = setTimeout(() => {
      sharedSaveTimer = null
      void setProjectLiveRig({ routes, monitorSends, busMaster }).catch(() => {
        // A failed manifest write must not interrupt a show. The desk is already
        // following; this is only the written record.
      })
    }, 800)
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
  // The shared half, separately: it must not be rewritten when only the desk
  // address or the armed flag changed.
  $effect(() => {
    void [routes, monitorSends, busMaster]
    saveSharedRig()
  })

  // Poll desk status.
  $effect(() => {
    if (!browser || !$desktopCompanionStatus.reachable) {
      status = null
      return
    }
    let stopped = false
    let verifiedOnOpen = false
    const poll = async () => {
      const next = await getHardwareStatus()
      if (!stopped && next?.xair) status = next.xair
      // ALREADY-connected when the panel opens (the strip auto-connects long
      // before this dialog exists): the safety banner must not sit on
      // "unverified" waiting for a button — read the desk back by itself.
      if (!stopped && !verifiedOnOpen && next?.xair?.connected === true) {
        verifiedOnOpen = true
        void verifyFoh()
        void readTopology()
      }
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
    setTimeout(() => void readTopology(), 600)
    // Claimed strips re-apply THEMSELVES on every connect — the one-time
    // confirmation was the human step; everything after it is automatic.
    if (loadRigSetup().splitStripsClaimed) setTimeout(() => void applySplitRouting(), 800)
  }
  async function disconnect() {
    if (busy) return
    armed = false
    sentLaneState = new Map()
    sentBusState = new Map()
    fohState = null
    // The desk is going away — forget EVERYTHING rather than leave a green light
    // describing a console that is no longer there.
    clearRigStatus()
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
  /**
   * The routes the FOH safety check judges. When the SPLIT layout is active,
   * click and cue live on the LAYOUT's strips — judging the legacy 15/16
   * claims made the banner scream about strips that no longer carry them
   * while saying nothing about the ones that do.
   */
  const fohRoutes = $derived.by<XAirLaneRoute[]>(() => {
    const layout = splitLayout
    if (!layout) return routes
    const strips = splitStrips(layout)
    const click = strips.find((s) => s.role === 'click' || s.role === 'monitor')
    const cue = strips.find((s) => s.role === 'cue') ?? click
    return [
      ...routes.filter((r) => !isMonitorOnlyLane(r.laneKey)),
      ...(click ? [{ laneKey: 'click', channels: [click.channel], followVolume: false, followMute: false }] : []),
      ...(cue ? [{ laneKey: 'cue', channels: [cue.channel], followVolume: false, followMute: false }] : []),
    ]
  })

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
    fohState = verifyFohSafe(fohRoutes, mainAssign)
    // The check that matters most. `null` while unproven — the indicator shows
    // amber rather than green, because "not checked" must never look like safe.
    reportRigStatus({ fohSafe: fohState.safe, unsafeChannels: fohState.unsafeChannels })
    note = fohState.safe ? 'Read back the desk — the house is safe.' : ''
  }
  async function fixFoh() {
    if (!connected) return
    fohBusy = true
    error = ''
    for (const w of xairFohSafetyPlan(fohRoutes)) {
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
  /**
   * A usable starting mix for a performer who has just been given a bus.
   *
   * Every send defaulted to ZERO, so assigning a bus produced a pack that was
   * completely silent until each slider had been dragged — indistinguishable
   * from broken, and discovered at a soundcheck. These are the levels a band
   * actually starts from: click loud enough to play to, cues clearly audible,
   * and the song slightly back so the click cuts through it.
   */
  const DEFAULT_MONITOR_MIX: Record<string, number> = { click: 1, cue: 1, original: 0.8 }

  async function assignBus(performerId: string, bus: number | null) {
    const next = performers.map((p) =>
      p.id === performerId ? { ...p, ...(bus ? { monitorBus: bus } : { monitorBus: undefined }) } : p,
    )
    // Seed the mix BEFORE the roster write, so the moment the card appears it
    // already has sensible levels rather than a row of zeroes.
    if (bus && !monitorSends[bus]) {
      const seeded: Record<string, number> = {}
      for (const lane of lanes) {
        const d = DEFAULT_MONITOR_MIX[lane.key]
        if (d !== undefined) seeded[lane.key] = d
      }
      // Anything not named above (stems, machines) starts at the song level:
      // audible, and easy to pull down, rather than absent and easy to miss.
      for (const lane of lanes) {
        if (seeded[lane.key] === undefined) seeded[lane.key] = DEFAULT_MONITOR_MIX.original!
      }
      monitorSends = { ...monitorSends, [bus]: seeded }
      if (busMaster[bus] === undefined) busMaster = { ...busMaster, [bus]: 0.75 }
    }
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
    // UNITS. `busMaster` holds a LINEAR gain; the desk wants a FADER POSITION,
    // and the two are not the same number — 0.75 linear is about −2.5 dB, while
    // fader 0.75 IS unity. This restored a linear value straight into a fader
    // and left the performer's pack at the wrong level after every test, which
    // `syncMonitors` would then not correct because its diff saw no change.
    const restore = xairFaderFromLinearGain(busMaster[bus] ?? 0.75)
    // NEVER unity: fader 0.75 is full line level straight into someone's
    // in-ears. Lift modestly above the current setting instead — a test must
    // be audible, not punishing.
    const lift = Math.min(XAIR_UNITY_FADER - 0.15, Math.max(restore + 0.1, 0.5))
    note = `Lifting bus ${bus} for 1.5s. A song must be PLAYING for anything to be heard — silence means nothing is feeding this bus yet.`
    await setXAirBusFader(bus, lift)
    setTimeout(() => void setXAirBusFader(bus, restore), 1500)
  }

  const usedBuses = $derived(new Set(monitorMixes.map((m) => m.bus)))
  const routedLanes = $derived(lanes.filter((l) => (routes.find((r) => r.laneKey === l.key)?.channels.length ?? 0) > 0))

  onDestroy(() => {
    if (syncTimer) window.clearTimeout(syncTimer)
  })

  // ── The split's desk routing: claim once, automatic ever after ────────────
  let splitBusy = $state(false)
  let splitReport = $state('')
  let splitReady = $state(false)
  const splitClaimed = $derived.by(() => {
    void splitReport // re-read after every apply (claiming writes the store)
    return loadRigSetup().splitStripsClaimed
  })
  /** The layout this machine derives — the same derivation MixerView uses. */
  const splitLayout = $derived.by<RigLayout | null>(() => {
    if (outputChannels === null || derivedProfile !== 'multichannel') return null
    return liveRigLayout({
      profileRequest: derivedProfile,
      deviceChannels: outputChannels,
      firstDeskChannel: loadRigSetup().leftCh,
    })
  })

  /**
   * Write the strip config + starting monitor sends, then READ IT BACK and
   * report what the desk actually says — "the command was sent" is not
   * evidence on a desk that silently ignores unknown addresses.
   */
  async function applySplitRouting() {
    const layout = splitLayout
    if (!layout || !connected || splitBusy) return
    splitBusy = true
    splitReport = ''
    try {
      // Does the desk ANSWER at all? The osc-int endpoint reads each address
      // back after writing; a null read-back on every write means the network
      // is dead (USB still carries audio) — a different problem than refusal,
      // and the report must say which one it is.
      let deskAnswered = false
      // Each USB write is verified by ITS OWN read-back (the sidecar reads the
      // address after writing). A separate bulk query straight after the write
      // burst missed replies and reported failure while the desk was in fact
      // configured — never again: the write's own evidence is primary.
      const wrongWrites: string[] = []
      for (const w of buildSplitStripWrites(layout)) {
        if (w.address.endsWith('/preamp/rtnsw') || w.address.endsWith('/config/rtnsrc')) {
          const r = await setXAirOscInt(w.address, w.value)
          if (!r.ok) throw new Error(`${w.address}: ${r.error}`)
          if (r.after !== null) {
            deskAnswered = true
            const got = r.after[0]?.value
            if (typeof got !== 'number' || Math.round(got) !== w.value) wrongWrites.push(w.address)
          }
        } else if (w.address.endsWith('/mix/lr')) {
          const ch = Number(w.address.split('/')[2])
          await setXAirChannelMainAssign(ch, w.value === 1)
        } else if (w.address.endsWith('/mix/on')) {
          const ch = Number(w.address.split('/')[2])
          await setXAirChannelOn(ch, w.value === 1)
        }
      }
      for (const s of buildSplitBusSends(
        layout,
        performers.map((p) => ({ name: p.name, monitorBus: p.monitorBus ?? null })),
      )) {
        await setXAirBusSend(s.channel, s.bus, s.value)
      }
      // House-off proof via the same state refresh the FOH banner trusts —
      // patient, retried once, instead of one hasty bulk query.
      let lrWrong: number[] = []
      let lrProven = false
      for (let attempt = 0; attempt < 2 && !lrProven; attempt++) {
        const st = await refreshXAirState()
        if (!st.ok) continue
        const strips = splitStrips(layout)
        lrWrong = strips.filter((s) => st.channels[s.channel]?.lr !== 0).map((s) => s.channel)
        lrProven = strips.every((s) => st.channels[s.channel]?.lr !== undefined)
      }
      if (!deskAnswered) {
        splitReady = false
        splitReport =
          'The desk is not answering over the NETWORK (USB audio still works — routing commands travel over Wi-Fi). Put this computer on the desk’s own Wi-Fi, wait for the dot next to “XR18” to turn green, then press Apply again.'
      } else if (wrongWrites.length > 0 || (lrProven && lrWrong.length > 0)) {
        splitReady = false
        const parts = [
          ...wrongWrites,
          ...(lrProven ? lrWrong.map((c) => `strip ${c} still on the house`) : []),
        ]
        splitReport = `The desk did not accept: ${parts.join(', ')}. Nothing is assumed — fix and press again.`
      } else {
        splitReady = true
        const strips = splitStrips(layout).map((s) => `${s.role}→strip ${s.channel}`).join(', ')
        splitReport = `Verified from the desk: ${strips}, off the house, feeding the monitor buses.${lrProven ? '' : ' (House-off read-back pending — press Verify above to double-check.)'}`
        // The routing just changed what the safety banner is ABOUT — re-judge
        // it now rather than leaving a stale verdict above a green report.
        void verifyFoh()
      }
      // The live stage's verdict chip reads this — evidence, not inference.
      reportRigStatus({ usbInputOk: splitReady })
    } catch (e) {
      splitReady = false
      splitReport = e instanceof Error ? e.message : String(e)
    } finally {
      splitBusy = false
    }
  }

  // ── Stage inputs → in-ear mixes ──────────────────────────────────────────
  let stageBusy = $state(false)
  let stageReport = $state('')
  let stageOk = $state(false)
  let stageLevel = $state(DEFAULT_STAGE_SEND)
  const stageRows = $derived(stageInputRows(performers))
  const stageBuses = $derived(monitorBuses(performers))

  /**
   * Raise every stage input into every in-ear mix, then READ IT BACK.
   *
   * The band plugged in and heard only the click, because BarBro's channels
   * had sends and theirs did not. This is that fix as one press — and it
   * reports what the desk actually says afterwards, because "21 commands sent"
   * is not evidence on a desk that ignores addresses it does not have.
   */
  async function wireStageInputs() {
    if (stageBusy || !connected) return
    stageBusy = true
    stageReport = ''
    stageOk = false
    try {
      const writes = buildStageInputSends(performers, stageLevel)
      if (writes.length === 0) {
        stageReport =
          'No inputs to wire yet — add each performer’s desk inputs in Project settings, and give everyone a monitor bus.'
        return
      }
      for (const w of writes) {
        const r = await setXAirBusSend(w.channel, w.bus, w.value)
        if (!r.ok) throw new Error(`ch ${w.channel} → bus ${w.bus}: ${r.error}`)
      }
      const plan = stageSendVerifyPlan(writes)
      const q = await queryXAirPaths(plan.map((p) => p.address), 1200)
      if (!q.ok) {
        stageReport = `Sent ${writes.length} sends, but the desk did not answer the read-back — check before trusting it.`
        return
      }
      const wrong = plan.filter((p) => {
        const got = q.replies[p.address]?.[0]
        return typeof got !== 'number' || Math.abs(got - p.expect) > 0.02
      })
      if (wrong.length > 0) {
        stageReport = `The desk did not accept ${wrong.length} of ${plan.length} sends (${wrong
          .slice(0, 3)
          .map((w) => w.address)
          .join(', ')}…).`
        return
      }
      stageOk = true
      stageReport = `Verified from the desk: ${stageRows.length} input${
        stageRows.length === 1 ? '' : 's'
      } feeding ${stageBuses.length} in-ear mix${stageBuses.length === 1 ? '' : 'es'} — ${
        writes.length
      } sends. Raise each person by ear from here.`
    } catch (e) {
      stageReport = e instanceof Error ? e.message : String(e)
    } finally {
      stageBusy = false
    }
  }

  /** The ONE first-time confirmation, then it is automatic on every connect. */
  async function claimSplitStrips() {
    saveRigSetup({ ...loadRigSetup(), splitStripsClaimed: true })
    await applySplitRouting()
  }

  // ── Bus links: six mono mixes is an ASSUMPTION until the desk confirms ────
  let busTopology = $state<BusTopology | null>(null)
  async function readTopology() {
    const q = await queryXAirPaths([...BUS_LINK_PATHS], 900)
    if (q.ok) busTopology = readBusTopology(q.replies)
  }
  /** For pair "1-2", bus 2 is swallowed — it mirrors bus 1, not its own mix. */
  const swallowedBuses = $derived(
    new Set((busTopology?.linkedPairs ?? []).map((p) => Number(p.split('-')[1]))),
  )

  /** The band's patch plan, read straight off the roster (declared after
   *  `splitLayout` — problems need to know BarBro's reserved strips). */
  const patchRows = $derived(patchList(performers))
  const inputProblems = $derived(performerInputProblems(performers, splitLayout))

  /**
   * THE MULTICHANNEL GATE, answered without a sound: how many output channels
   * does this machine's CURRENT sound device offer? 2 means the desk can only
   * ever receive the exact stereo the house hears — click-in-monitors-only is
   * physically impossible on that connection, and no routing in this panel
   * can change it. ≥4 means click/cue can leave on their own channels.
   * Read from a DISPOSABLE context (never the shared one — a probe must not
   * be able to hurt live playback) and closed immediately.
   */
  let outputChannels = $state<number | null>(null)
  /** The CONCRETE profile the 'auto' rule derives for this machine right now. */
  let derivedProfile = $state<'stereo-passthrough' | 'stereo-sum' | 'multichannel' | null>(null)
  onMount(() => {
    try {
      const probe = new AudioContext()
      outputChannels = probe.destination.maxChannelCount
      void probe.close()
    } catch {
      outputChannels = null
    }
    if (outputChannels !== null) {
      derivedProfile = resolveProfileRequest(loadRigSetup(), outputChannels)
    }
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
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" class="" onclick={() => void verifyFoh()} disabled={!connected || fohBusy}>
          <RefreshCw class="size-3.5 {fohBusy ? 'animate-spin' : ''}" aria-hidden="true" /> Verify
        </Button>
        <Button size="sm" class="" onclick={() => void fixFoh()} disabled={!connected || fohBusy}>
          Take click/cue off FOH
        </Button>
      </div>
    </div>
  </div>

  <!-- ── The multichannel verdict (no sound is played to read this) ───────── -->
  <div class="border-foreground/15 rounded-[var(--radius)] border p-2.5 text-xs">
    {#if outputChannels === null}
      <p class="text-muted-foreground">Couldn’t read this computer’s sound output device.</p>
    {:else if outputChannels >= 4}
      <p>
        <span class="font-black uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          {outputChannels} output channels
        </span>
        — this computer’s sound device can carry click and cue on their own desk channels,
        separate from the house. Monitor-only click is possible here.
      </p>
      <p class="mt-1.5">
        {#if derivedProfile === 'multichannel'}
          <span class="font-bold">Separation is ON automatically</span>
          <span class="text-muted-foreground">
            — this machine has a desk address saved and enough channels, so the song leaves on
            channels 1–2, the click on 3 and cues on 4, from the next time live mode opens.
            Nothing to switch.
          </span>
        {:else}
          <span class="text-muted-foreground">
            Separation switches on by itself once a desk address is saved on this machine
            (connect below) — no setting to remember.
          </span>
        {/if}
      </p>
      {#if derivedProfile === 'multichannel' && splitLayout}
        {@const strips = splitStrips(splitLayout)}
        {#if !splitClaimed}
          <div class="border-foreground/15 mt-2 flex flex-wrap items-center gap-2 rounded-[var(--radius)] border p-2">
            <p class="min-w-0 flex-1 text-muted-foreground">
              One-time step, done AT the desk: strips
              {strips.map((s) => s.channel).join(' & ')} become the click and cue inputs.
              Anything plugged into their analog jacks goes silent — make sure those jacks are
              free before pressing. After this, the routing applies itself on every connect.
            </p>
            <Button
              size="sm"
              class=""
              onclick={() => void claimSplitStrips()}
              disabled={!connected || splitBusy}
              title={!connected ? 'Connect to the desk first.' : 'Configures the strips and proves it from the desk.'}
            >
              {splitBusy ? 'Setting up…' : `Use strips ${strips.map((s) => s.channel).join(' & ')}`}
            </Button>
          </div>
        {/if}
        {#if splitClaimed && !splitReady}
          <div class="mt-1.5 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              class=""
              onclick={() => void applySplitRouting()}
              disabled={!connected || splitBusy}
              title="Re-writes the strip routing and reads it back from the desk."
            >
              {splitBusy ? 'Applying…' : 'Apply strip routing again'}
            </Button>
            <span class="text-muted-foreground text-xs">Also runs by itself on every connect.</span>
          </div>
        {/if}
        {#if splitReport}
          <p class="mt-1.5 text-xs {splitReady ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}">
            {splitReport}
          </p>
        {/if}
      {/if}
    {:else}
      <p>
        <span class="text-destructive font-black uppercase tracking-wide">
          Stereo output only ({outputChannels} channels)
        </span>
        — on this connection the desk receives the exact same mix as the house, so click in the
        monitors ONLY is not possible, whatever is routed below. Set the Mac’s sound output to the
        XR18 (18 channels over USB), then reopen this dialog.
      </p>
    {/if}
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
  <!-- Per-lane desk channels only MEAN something once the sound device offers
       more than a stereo pair — today everything leaves mixed on one pair, so
       showing this table on a stereo device is a lie ("drum machine → 9,10"
       while the audio ignores it). Hidden until the gate is real. -->
  {#if outputChannels !== null && outputChannels >= 4}
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
  {:else}
  <p class="text-muted-foreground text-xs">
    Everything currently leaves this computer as ONE stereo mix into the desk — there is no
    per-channel routing to configure until the sound device above offers more than two channels.
  </p>
  {/if}

  <!-- ── The patch list: where the band plugs in ──────────────────────────── -->
  {#if performers.length > 0}
    <div>
      <p class="mb-1.5 text-xs font-black uppercase tracking-wide">Plug in</p>
      {#each inputProblems as problem (problem)}
        <p class="mb-1 text-xs font-bold text-amber-600 dark:text-amber-400">{problem}</p>
      {/each}
      {#if patchRows.length === 0}
        <p class="text-muted-foreground text-xs">
          Nothing listed yet. Add what each person plugs in under Project settings → their name →
          “+ desk input” (e.g. Mic → 1, Keys → 5 and 6, Guitar → 7 and 8), then come back here and
          press “Wire up monitors”.
        </p>
      {:else}
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {#each patchRows as row (row.performer + row.label)}
            <span>
              <span class="font-bold">{row.performer}</span>
              {row.label} →
              <span class="font-mono">{row.channels.join('/')}</span>
            </span>
          {/each}
        </div>
      {/if}
      <p class="text-muted-foreground mt-1 text-[11px]">
        Set each performer’s inputs in Project settings. Channels carrying BarBro’s own audio are
        never offered there.
      </p>

      <!-- The fix for "we plugged in and hear only the click": a desk channel
           reaches nobody's ears until its send is raised. One press does all of
           them, then reads the desk back to prove it. -->
      <div class="border-foreground/15 mt-2 flex flex-wrap items-center gap-2 rounded-[var(--radius)] border p-2">
        <div class="min-w-0 flex-1">
          <p class="text-xs font-bold">Send these into everyone’s in-ears</p>
          <p class="text-muted-foreground text-[11px]">
            {stageRows.length} input{stageRows.length === 1 ? '' : 's'} → {stageBuses.length} mix{stageBuses.length ===
            1
              ? ''
              : 'es'}. Starts modest on purpose — raise each person by ear afterwards.
          </p>
        </div>
        <label class="text-muted-foreground inline-flex items-center gap-1 text-[11px] font-bold">
          Level
          <input
            type="range"
            min="0"
            max={MAX_MONITOR_SEND}
            step="0.05"
            bind:value={stageLevel}
            class="accent-[var(--studio-orange)] w-24"
          />
          <span class="w-8 text-right font-mono">{Math.round(stageLevel * 100)}</span>
        </label>
        <Button
          size="sm"
          class=""
          onclick={() => void wireStageInputs()}
          disabled={!connected || stageBusy || stageRows.length === 0 || stageBuses.length === 0}
          title={!connected
            ? 'Connect to the desk first.'
            : 'Raise every stage input into every in-ear mix, then read the desk back.'}
        >
          {stageBusy ? 'Wiring…' : 'Wire up monitors'}
        </Button>
      </div>
      {#if stageReport}
        <p class="mt-1 text-xs {stageOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}">
          {stageReport}
        </p>
      {/if}
    </div>
  {/if}

  <!-- ── Monitor mixes (one per performer) ────────────────────────────────── -->
  <div>
    <p class="mb-1.5 text-xs font-black uppercase tracking-wide">In-ear monitor mixes</p>
    {#if busTopology && busTopology.linkedPairs.length > 0}
      <p class="mb-1.5 text-xs font-bold text-amber-600 dark:text-amber-400">{busTopology.reason}</p>
    {/if}
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
                    <option value={b} disabled={(usedBuses.has(b) && b !== bus) || swallowedBuses.has(b)}>
                      {b}{swallowedBuses.has(b) ? ' (linked)' : ''}
                    </option>
                  {/each}
                </select>
              </label>
              {#if bus}
                <Button
                  variant="outline"
                  size="sm"
                  class=""
                  onclick={() => void testMonitor(bus)}
                  disabled={!connected}
                  title="Briefly lifts this bus. Play a song first — with nothing playing (or nothing routed to this bus) it is silent by design."
                >
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
