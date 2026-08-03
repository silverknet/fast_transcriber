<script lang="ts">
  /**
   * RIG SETUP — wire the desk up and prove each link works.
   *
   * Written for the floor before a show, not for a desk in an office: one
   * question at a time, in dependency order, with the fix for each failure
   * written next to it.
   *
   * Two principles shape the whole page.
   *
   * **The desk is not yours.** Every write is announced and reversible, and the
   * page never touches a channel you have not named. `Revert` puts back exactly
   * what was read before the test started.
   *
   * **Prove it, do not assume it.** OSC is fire-and-forget UDP: a send that
   * vanishes looks identical to one that landed. Anything this page claims about
   * desk state is read back before it is claimed.
   */
  import { onDestroy } from 'svelte'
  import { browser } from '$app/environment'
  import { CircleAlert, CircleCheck, Circle, Play, Square, Volume2 } from '@lucide/svelte'
  import { audioDevice, resumeAudioDevice } from '$lib/audio/audioDevice'
  import {
    DEFAULT_TEST_LEVEL_DB,
    MAX_TEST_LEVEL_DB,
    MIN_TEST_LEVEL_DB,
    startRigTestSignal,
    type RigTestSignal,
    type TestSide,
  } from '$lib/audio/rigTestSignal'
  import {
    connectXAirMixer,
    disconnectXAirMixer,
    queryXAirPaths,
    readXAirMeters,
    refreshXAirState,
    setXAirBusFader,
    setXAirBusSend,
    setXAirChannelFader,
    setXAirChannelMainAssign,
    setXAirChannelOn,
    setXAirMainFader,
    setXAirOscInt,
    discoverXAirMixers,
    type XAirConsole,
  } from '$lib/client/hardwareBridge'
  import {
    USB_LEFT_SOURCE,
    USB_RIGHT_SOURCE,
    barbroPairReady,
    readChannelInput,
    usbQueryPaths,
    usbSourcePath,
    usbSwitchPath,
    usbWritesFor,
    type ChannelInput,
  } from '$lib/hardware/xairUsbInput'
  import {
    busSendQueryPaths,
    restoreAllWrites,
    withBusSends,
    withUsbInput,
    type DeskChannelSnapshot,
  } from '$lib/hardware/deskSnapshot'
  import { BUS_LINK_PATHS, readBusTopology, type BusTopology } from '$lib/hardware/deskTopology'
  import { channelLevelDb } from '$lib/hardware/monitorStatus'
  import { readOutputDevice, type OutputDeviceInfo } from '$lib/audio/outputDevice'
  import {
    PROBE_CHANNELS,
    probeVerdict,
    startMultichannelProbe,
    type ProbeVerdict,
  } from '$lib/audio/multichannelProbe'
  import {
    verifyFohSafe,
    xairFaderFromLinearGain,
    xairFohSafetyPlan,
    type XAirLaneRoute,
  } from '$lib/hardware/xairRouting'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { clearRigStatus, reportRigStatus } from '$lib/stores/rigStatus'
  import OfflineReadyPanel from '$lib/components/OfflineReadyPanel.svelte'
  import {
    loadRigSetup,
    parseMonitorChannels,
    rigSetupProblems,
    saveRigSetup,
  } from '$lib/hardware/rigSetupStore'
  import {
    RIG_CHECKS,
    checkState,
    nextActionable,
    rigReady,
    type CheckId,
    type CheckState,
  } from '$lib/hardware/rigSetupPlan'

  // ── Check results ────────────────────────────────────────────────────────
  let results = $state<Partial<Record<CheckId, CheckState>>>({})
  const stateOf = (id: CheckId): CheckState => checkState(id, results)
  const nextId = $derived(nextActionable(results))
  const ready = $derived(rigReady(results))
  function mark(id: CheckId, state: CheckState) {
    results = { ...results, [id]: state }
  }

  // ── Test signal ──────────────────────────────────────────────────────────
  // $state, not a plain `let`: the effect below pushes live level/side
  // changes into a playing tone, and an untracked variable made it inert —
  // moving the slider while the tone played did nothing at all.
  let signal = $state<RigTestSignal | null>(null)
  let toneOn = $state(false)
  let side = $state<TestSide>('both')
  let levelDb = $state(DEFAULT_TEST_LEVEL_DB)
  let pulsed = $state(true)

  // ── Output meter ─────────────────────────────────────────────────────────
  //
  // "I hear absolutely nothing and I don't even know if the tone works" is two
  // different faults wearing one symptom, and without a meter there is no way to
  // tell them apart:
  //
  //   meter moving, silence  -> BarBro IS making sound; the OS output device or
  //                             the desk's USB routing is swallowing it
  //   meter still,  silence  -> the sound never left BarBro
  //
  // It measures the signal on its way OUT, so it is honest about its own limits:
  // it proves what BarBro sent, never what the desk received.
  let meterL = $state(0)
  let meterR = $state(0)
  let meterRaf: number | null = null

  function stopMeter() {
    if (meterRaf !== null) cancelAnimationFrame(meterRaf)
    meterRaf = null
    meterL = 0
    meterR = 0
  }

  function startMeter(ctx: AudioContext, tap: AudioNode) {
    stopMeter()
    const splitter = ctx.createChannelSplitter(2)
    const aL = ctx.createAnalyser()
    const aR = ctx.createAnalyser()
    aL.fftSize = 2048
    aR.fftSize = 2048
    tap.connect(splitter)
    splitter.connect(aL, 0)
    splitter.connect(aR, 1)
    const bufL = new Float32Array(aL.fftSize)
    const bufR = new Float32Array(aR.fftSize)
    const peak = (b: Float32Array) => {
      let m = 0
      for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i]!))
      return m
    }
    const tick = () => {
      aL.getFloatTimeDomainData(bufL)
      aR.getFloatTimeDomainData(bufR)
      // Fall FAST but not instantly: a pulsed tone should read as pulses rather
      // than a bar that looks broken between beeps.
      meterL = Math.max(peak(bufL), meterL * 0.82)
      meterR = Math.max(peak(bufR), meterR * 0.82)
      meterRaf = requestAnimationFrame(tick)
    }
    meterRaf = requestAnimationFrame(tick)
  }

  async function startTone() {
    await resumeAudioDevice()
    const ctx = audioDevice()
    signal?.stop()
    // The tone lands on `tap` rather than straight on the destination, so the
    // meter can watch the identical signal that reaches the speakers.
    const tap = ctx.createGain()
    tap.connect(ctx.destination)
    signal = startRigTestSignal(ctx, tap, { side, levelDb, pulsed })
    startMeter(ctx, tap)
    toneOn = true
  }
  function stopTone() {
    signal?.stop()
    signal = null
    stopMeter()
    toneOn = false
  }
  // Live tweaks go to the running signal — restarting would click.
  $effect(() => {
    signal?.update({ side, levelDb, pulsed })
  })
  onDestroy(() => {
    stopTone()
    stopMeter()
    void restoreDesk()
  })

  // ── Desk connection ──────────────────────────────────────────────────────
  // Remembered between sessions: the desk does not move between soundcheck and
  // the show, and retyping its address at load-in is a chance to get it wrong.
  // Check RESULTS are deliberately not remembered — see `rigSetupStore.ts`.
  const saved = loadRigSetup()
  let host = $state(saved.host)
  let port = $state(saved.port)
  let connected = $state(false)
  /** What the desk said about itself. Null until something actually answers. */
  let deskInfo = $state<{ model: string | null; name: string | null; firmware: string | null } | null>(null)
  let deskNote = $state('')
  let busy = $state(false)

  // ── Finding the desk ─────────────────────────────────────────────────────
  //
  // The XR18 has no screen. Its address is otherwise unknowable without the
  // router's admin page, and a hand-typed one that is wrong looks EXACTLY like a
  // desk that is switched off — UDP reports neither. So: ask the network.
  let scanning = $state(false)
  let foundConsoles = $state<XAirConsole[]>([])
  let scanNote = $state('')

  /**
   * RECONNECT WITHOUT BEING ASKED.
   *
   * The desk does not move between soundcheck and the show, so making someone
   * re-enter an address every time they open the page is pure friction — and at
   * load-in, friction is where mistakes come from.
   *
   * Two steps, because the saved address can go stale on its own: a router
   * reboot hands out a different IP and the desk is suddenly somewhere else
   * through no fault of the user. So the remembered address is tried first, and
   * if it does not answer the network is asked directly. Between them, the
   * address should never need typing again.
   *
   * Connecting is READ-ONLY — `/xinfo` and `/xremote` — so nothing is changed
   * and nothing can make a sound.
   */
  let autoConnectTried = false

  async function autoConnect(): Promise<void> {
    if (connected || busy || scanning) return
    if (host.trim()) {
      busy = true
      const r = await connectXAirMixer({ host: host.trim(), port })
      busy = false
      if (r.ok) {
        applyConnectResult(r)
        return
      }
    }
    // The remembered address did not answer — most likely the desk changed IP.
    // Ask the network rather than making the user work it out.
    await findDesk()
  }

  $effect(() => {
    if (!browser || autoConnectTried) return
    // The sidecar carries the OSC traffic, so there is no point trying before
    // it is up.
    if (!$desktopCompanionStatus.reachable) return
    autoConnectTried = true
    void autoConnect()
  })

  async function findDesk(): Promise<void> {
    scanning = true
    scanNote = ''
    foundConsoles = []
    const r = await discoverXAirMixers()
    scanning = false
    if (!r.ok) {
      scanNote = r.error
      return
    }
    foundConsoles = r.consoles
    if (r.consoles.length === 0) {
      scanNote = 'No mixer answered. Is it powered up and on the same network as this Mac?'
      return
    }
    // Exactly one is the overwhelmingly common case — just use it.
    if (r.consoles.length === 1) {
      host = r.consoles[0]!.ip
      await connect()
    }
  }

  /** Shared by the button and by the automatic reconnect. */
  function applyConnectResult(r: Awaited<ReturnType<typeof connectXAirMixer>>) {
    connected = r.ok
    deskInfo = r.ok ? (r.xair?.info ?? null) : null
    // The desk's own words, not our optimism. "Connected." used to appear for
    // any address you could type, because opening a UDP socket contacts nothing
    // — you found out at the venue when a fader did nothing. Now the sidecar
    // waits for the console's `/xinfo` reply, so this line can only appear if
    // something answered AND identified itself as an X-Air desk.
    deskNote = r.ok
      ? deskInfo
        ? `${deskInfo.model ?? 'Desk'} · ${deskInfo.name ?? 'unnamed'} · firmware ${deskInfo.firmware ?? '?'}`
        : 'Connected.'
      : r.error || 'Could not reach the desk.'
    mark('desk-connect', r.ok ? 'passed' : 'failed')
    if (!r.ok) mark('desk-readback', 'blocked')
    // Show where the desk actually is straight away. A blank Levels panel is
    // how a main fader sits at zero unnoticed while everything else looks right.
    if (r.ok) {
      void readLevels()
      void readUsbInput()
    }
    // Feed the navbar indicator. `/rig` is where most people connect, yet only
    // the mixer's XR18 panel reported anything — so the chip stayed dark with a
    // desk plainly connected on this very page.
    reportRigStatus({
      deskIdentified: r.ok,
      deskLabel: deskInfo ? `${deskInfo.model ?? 'Desk'} · fw ${deskInfo.firmware ?? '?'}` : null,
    })
  }

  async function connect() {
    busy = true
    deskNote = ''
    const r = await connectXAirMixer({ host: host.trim(), port })
    busy = false
    applyConnectResult(r)
  }
  async function disconnect() {
    await restoreDesk()
    await disconnectXAirMixer()
    connected = false
    deskInfo = null
    // Forget everything rather than leave a green light describing a desk that
    // is no longer there.
    clearRigStatus()
    deskNote = 'Disconnected.'
    mark('desk-connect', 'ready')
  }

  /** Channel state as the desk reports it — the "prove it" half. */
  let readback = $state<Record<number, { lr?: number; on?: number; fader?: number }>>({})
  async function readDesk(): Promise<boolean> {
    busy = true
    const r = await refreshXAirState()
    busy = false
    if (!r.ok) {
      deskNote = r.error
      mark('desk-readback', 'failed')
      return false
    }
    readback = r.channels
    const any = Object.keys(r.channels).length > 0
    deskNote = any ? `Read ${Object.keys(r.channels).length} channels back.` : 'Desk returned nothing.'
    mark('desk-readback', any ? 'passed' : 'failed')
    return any
  }

  // ── The channels under test ──────────────────────────────────────────────
  let leftCh = $state(saved.leftCh)
  let rightCh = $state(saved.rightCh)
  /** Channels the page has written to, with what they were before. */
  let touched = $state<Record<number, DeskChannelSnapshot>>({})

  function remember(ch: number) {
    if (touched[ch]) return
    touched = { ...touched, [ch]: { ...(readback[ch] ?? {}) } }
  }

  /**
   * Capture a channel's SIX bus sends before anything zeroes them.
   *
   * `refreshChannelState` only reads fader/on/lr, so before this existed the
   * test buttons zeroed the in-ear sends with nothing to restore from. On a real
   * desk that left two of three performers in silence, with no record of what
   * their levels had been — indistinguishable from broken hardware.
   */
  async function rememberSends(ch: number) {
    remember(ch)
    if (touched[ch]?.sends) return
    const r = await queryXAirPaths(busSendQueryPaths(ch))
    if (!r.ok) return
    touched = { ...touched, [ch]: withBusSends(touched[ch] ?? {}, ch, r.replies) }
  }

  /** Same, for the USB input switch — which steals whatever was on the socket. */
  async function rememberUsbInput(ch: number) {
    remember(ch)
    if (touched[ch]?.usbSwitch !== undefined) return
    const r = await queryXAirPaths([usbSwitchPath(ch), usbSourcePath(ch)])
    if (!r.ok) return
    const before = readChannelInput(ch, r.replies)
    touched = {
      ...touched,
      [ch]: withUsbInput(
        touched[ch] ?? {},
        before.fromUsb === null ? undefined : before.fromUsb ? 1 : 0,
        before.usbChannel === null ? undefined : before.usbChannel - 1,
      ),
    }
  }

  /** Put back exactly what was there before this page touched it. */
  async function restoreDesk() {
    const writes = restoreAllWrites(touched)
    if (writes.length === 0) return
    for (const w of writes) {
      if (w.kind === 'fader') await setXAirChannelFader(w.channel, w.value)
      else if (w.kind === 'on') await setXAirChannelOn(w.channel, w.on)
      else if (w.kind === 'lr') await setXAirChannelMainAssign(w.channel, w.on)
      else if (w.kind === 'bus-send') await setXAirBusSend(w.channel, w.bus, w.value)
      else if (w.kind === 'usb-source') await setXAirOscInt(usbSourcePath(w.channel), w.value)
      else if (w.kind === 'usb-switch') await setXAirOscInt(usbSwitchPath(w.channel), w.value)
    }
    touched = {}
    deskNote = 'Desk restored to how it was.'
  }

  /** Open a channel at a modest level so a test tone is audible but never loud. */
  async function openChannel(ch: number) {
    remember(ch)
    await setXAirChannelOn(ch, true)
    await setXAirChannelFader(ch, xairFaderFromLinearGain(0.7))
  }

  async function testMainLr() {
    busy = true
    activeOut = 'main'
    for (const ch of [leftCh, rightCh]) {
      // READ the in-ear sends before zeroing them. Without this the levels are
      // gone for good — which is exactly what happened on a real desk: two of
      // three performers left with silent in-ears and no record of their mix.
      await rememberSends(ch)
      await openChannel(ch)
      await setXAirChannelMainAssign(ch, true)
      // Zero the aux sends this pair may still carry from an Aux test. Without
      // this, Main and Aux were not actually exclusive: you pressed Main and the
      // tone stayed in the in-ears, which reads as "Main does nothing".
      for (let b = 1; b <= 6; b++) await setXAirBusSend(ch, b, 0)
    }
    // The master decides whether ANY of this is audible, and it is not part of
    // the per-channel work above. Claiming "sent to the house" with the main
    // fader at zero is a confident lie — and it is exactly what happened.
    const main = await readMainFader()
    if (main !== null && main < 0.05) {
      // Raise it, but QUIETLY. A master at 0.75 through a PA is painful, and
      // there is no undo on a sound that has already happened.
      await setXAirMainFader(SAFE_MAIN_LEVEL)
      mainLevel = SAFE_MAIN_LEVEL
      deskNote = `Tone on channels ${leftCh}/${rightCh} → the house. The main fader was at zero, so I raised it to ${Math.round(SAFE_MAIN_LEVEL * 100)}% — turn it up in Levels below.`
    } else {
      deskNote = `Tone on channels ${leftCh}/${rightCh}, sent to the main L/R (the house). Main fader is at ${Math.round((main ?? 0) * 100)}%.`
    }
    busy = false
    if (!toneOn) await startTone()
  }

  /**
   * A deliberately QUIET starting point for the master.
   *
   * Roughly −20 dB on the X-Air fader law. Loud enough to hear in a room, far
   * short of what 0.75 does through a PA — which frightened a child in this
   * house and is the reason this constant exists rather than a convenient 0.75.
   */
  const SAFE_MAIN_LEVEL = 0.35

  async function readMainFader(): Promise<number | null> {
    const r = await queryXAirPaths(['/lr/mix/fader'], 350)
    if (!r.ok) return null
    const v = r.replies['/lr/mix/fader']?.[0]
    return v && typeof v.value === 'number' ? v.value : null
  }

  /** Send the tone to ONE aux, muted on the others, so a pack can be identified. */
  /** Which output is currently soloed for the test: 'main' or an aux bus. */
  let activeOut = $state<'main' | number | null>(null)
  async function testAux(bus: number) {
    busy = true
    activeOut = bus
    for (const ch of [leftCh, rightCh]) {
      // Soloing one aux means silencing the other five, so their levels must be
      // read FIRST or they cannot be given back. See `deskSnapshot.ts`.
      await rememberSends(ch)
      await openChannel(ch)
      for (let b = 1; b <= 6; b++) {
        await setXAirBusSend(ch, b, b === bus ? xairFaderFromLinearGain(0.7) : 0)
      }
    }
    busy = false
    deskNote = `Tone on channels ${leftCh}/${rightCh}, sent to aux ${bus} only. Revert puts the other monitor mixes back.`
    if (!toneOn) await startTone()
  }

  // ── Getting BarBro's audio into the desk, over USB ──────────────────────
  //
  // Two settings per channel, both verified on a real XR18V2 (fw 1.19):
  //   /ch/NN/preamp/rtnsw   0 = socket, 1 = USB
  //   /ch/NN/config/rtnsrc  which USB channel, zero-based
  // macOS sends stereo on USB 1/2, so the pair needs sources 0 and 1 — NOT the
  // desk's 1:1 default, which would have ch 9/10 listening to USB 9/10 where
  // nothing is playing. See `xairUsbInput.ts`.
  let usbLeft = $state<ChannelInput | null>(null)
  let usbRight = $state<ChannelInput | null>(null)
  let usbNote = $state('')
  let usbBusy = $state(false)
  /** Did a known-good address answer? Separates "desk absent" from "desk refused". */
  let deskAnswered = $state(true)

  const usbReady = $derived(
    usbLeft && usbRight ? barbroPairReady(usbLeft, usbRight) : null,
  )

  async function readUsbInput(): Promise<void> {
    usbBusy = true
    usbNote = ''
    const r = await queryXAirPaths(['/xinfo', ...usbQueryPaths(leftCh, rightCh)], 400)
    usbBusy = false
    if (!r.ok) {
      usbLeft = usbRight = null
      deskAnswered = false
      usbNote = r.error
      return
    }
    deskAnswered = Boolean(r.replies['/xinfo'])
    usbLeft = readChannelInput(leftCh, r.replies)
    usbRight = readChannelInput(rightCh, r.replies)
    // null while unchecked — the indicator shows amber, never green.
    reportRigStatus({
      usbInputOk: usbLeft && usbRight ? barbroPairReady(usbLeft, usbRight).ok : null,
    })
  }

  /**
   * Point the pair at USB 1/2 and switch them to USB.
   *
   * Deliberately does NOT touch faders, mutes or the main bus. Nothing here can
   * make a sound on its own — the levels are yours to raise, below.
   */
  async function useUsbForBarbro(): Promise<void> {
    usbBusy = true
    usbNote = ''
    // Pointing a strip at USB takes over whatever was plugged into its socket.
    // Capture the old setting first so Revert can genuinely give it back —
    // until now this was a one-way door.
    for (const ch of [leftCh, rightCh]) await rememberUsbInput(ch)
    const writes = [
      ...usbWritesFor(leftCh, USB_LEFT_SOURCE),
      ...usbWritesFor(rightCh, USB_RIGHT_SOURCE),
    ]
    for (const w of writes) {
      const r = await setXAirOscInt(w.address, w.value)
      if (!r.ok) {
        usbBusy = false
        usbNote = r.error
        return
      }
    }
    usbBusy = false
    await readUsbInput()
    usbNote = usbReady?.ok
      ? 'Done — the desk confirmed it.'
      : 'The desk did not confirm the change. Treat it as NOT applied.'
  }

  // ── Can this machine send separate channels? ─────────────────────────────
  //
  // The gate everything else depends on. Measured against the desk's own
  // meters, because a write is never evidence and a meter on BarBro's own
  // output only proves what was sent.
  let probeBusy = $state(false)
  let probeNote = $state('')
  let probeVerdictResult = $state<ProbeVerdict | null>(null)

  /**
   * Which sound card BarBro is playing to — checked before anything else.
   *
   * Re-read on every probe, because the answer changes the moment someone plugs
   * the USB cable in or picks a different output in System Settings, and a stale
   * "18 channels" would be worse than no answer.
   */
  let outputDevice = $state<OutputDeviceInfo | null>(null)
  $effect(() => {
    if (!browser) return
    void readOutputDevice().then((d) => (outputDevice = d))
  })

  /** Desk levels for the four probe channels, right now. */
  async function readProbeLevels(): Promise<Record<number, number | null>> {
    const r = await readXAirMeters()
    const out: Record<number, number | null> = {}
    for (let i = 0; i < PROBE_CHANNELS; i++) {
      const ch = leftCh + i
      out[ch] = r.ok ? channelLevelDb(r.levels, ch) : null
    }
    return out
  }

  async function proveSeparateChannels() {
    probeBusy = true
    probeNote = ''
    probeVerdictResult = null
    try {
      // The cable may have gone in since the page loaded.
      outputDevice = await readOutputDevice()
      // Resting level FIRST. Comparing against silence is what stops a channel
      // that already carries programme from faking an arrival.
      const resting = await readProbeLevels()

      const probe = startMultichannelProbe()
      if (!probe) {
        probeNote =
          'This output cannot open four channels at all, so the click has to travel mixed in with the song.'
        return
      }
      try {
        // Long enough for a meter frame to land and settle, short enough that
        // nobody has to listen to four tones.
        await new Promise((r) => setTimeout(r, 1800))
        const active = await readProbeLevels()
        probeVerdictResult = probeVerdict({ firstDeskChannel: leftCh, resting, active })
      } finally {
        // Always give the device back, however the measurement went.
        probe.run.stop()
      }
    } catch (e) {
      probeNote = e instanceof Error ? e.message : String(e)
    } finally {
      probeBusy = false
    }
  }

  // ── Levels: main out + the six monitor sends ─────────────────────────────
  //
  // Read from the desk, never defaulted. A fader that starts at a guess is a
  // fader that can be louder than the room expects the moment it is touched.
  let mainLevel = $state<number | null>(null)
  let monitorLevels = $state<number[]>([])
  let levelsBusy = $state(false)
  let levelsNote = $state('')

  const MONITOR_COUNT = 6

  /**
   * Are the six aux buses actually six independent mono mixes?
   *
   * Null until the desk has been asked. Never assumed — a linked pair means two
   * performers share a mix and one of them cannot be turned down, which is
   * indistinguishable from a broken cable from where they are standing.
   */
  let busTopology = $state<BusTopology | null>(null)

  async function readLevels(): Promise<void> {
    levelsBusy = true
    levelsNote = ''
    const paths = [
      '/lr/mix/fader',
      ...Array.from({ length: MONITOR_COUNT }, (_, i) => `/bus/${i + 1}/mix/fader`),
      // Whether the buses are LINKED decides whether six monitor mixes even
      // exist. Nothing checked this before, so a linked pair silently gave two
      // performers the same mix — and bus-master writes to the even bus of a
      // pair go nowhere at all, because the odd one owns the master.
      ...BUS_LINK_PATHS,
    ]
    const r = await queryXAirPaths(paths, 500)
    levelsBusy = false
    if (!r.ok) {
      levelsNote = r.error
      return
    }
    const num = (a: string): number | null => {
      const v = r.replies[a]?.[0]
      return v && typeof v.value === 'number' ? v.value : null
    }
    mainLevel = num('/lr/mix/fader')
    const mons: number[] = []
    for (let b = 1; b <= MONITOR_COUNT; b++) mons.push(num(`/bus/${b}/mix/fader`) ?? 0)
    monitorLevels = mons
    busTopology = readBusTopology(r.replies)
    // UDP on this link demonstrably drops packets, so a missing reply is normal
    // rather than alarming — but it must be SAID, not silently shown as 0.
    const missing = paths.filter((a) => !r.replies[a]).length
    levelsNote = missing > 0 ? `${missing} of ${paths.length} didn't answer — press Read levels again.` : ''
  }

  async function setMain(v: number): Promise<void> {
    mainLevel = v
    const r = await setXAirMainFader(v)
    if (!r.ok) levelsNote = r.error
  }

  async function setMonitor(bus: number, v: number): Promise<void> {
    monitorLevels = monitorLevels.map((x, i) => (i === bus - 1 ? v : x))
    const r = await setXAirBusFader(bus, v)
    if (!r.ok) levelsNote = r.error
  }

  // ── FOH safety ───────────────────────────────────────────────────────────
  let monitorOnly = $state(saved.monitorOnly)
  let fohNote = $state('')
  const monitorChannels = $derived(parseMonitorChannels(monitorOnly))

  /**
   * Setup mistakes worth refusing to test on. Shown as words, never as a
   * silently disabled button.
   */
  // `profileRequest` is owned by the Rig dialog's checkbox, not this page —
  // spread the stored record so a save here never stomps it (or any future
  // field this page does not edit).
  const problems = $derived(rigSetupProblems({ ...loadRigSetup(), host, port, leftCh, rightCh, monitorOnly }))

  // Persist whenever any of it changes — an $effect writing to a non-reactive
  // sink, which is what they are for.
  $effect(() => {
    saveRigSetup({ ...loadRigSetup(), host, port, leftCh, rightCh, monitorOnly })
  })

  /**
   * The monitor-only channels expressed as lane routes, so the SHIPPED safety
   * logic decides what is safe. Re-deriving "is this channel off the house"
   * here would be a second copy of the one rule nobody can afford to get wrong.
   */
  const fohRoutes = $derived<XAirLaneRoute[]>([
    { laneKey: 'click', channels: monitorChannels, followVolume: false, followMute: false },
  ])

  async function enforceFohSafety() {
    busy = true
    fohNote = ''
    for (const write of xairFohSafetyPlan(fohRoutes)) {
      remember(write.channel)
      await setXAirChannelMainAssign(write.channel, write.on)
    }
    const ok = await readDesk()
    busy = false
    if (!ok) {
      fohNote = 'Could not read the desk back, so this is UNVERIFIED. Do not rely on it.'
      mark('foh-safety', 'failed')
      return
    }
    // A channel MISSING from the read-back counts as unsafe, not as absent.
    const assigns = new Map<number, boolean>(
      Object.entries(readback).map(([ch, st]) => [Number(ch), (st.lr ?? 1) >= 0.5]),
    )
    const { safe, unsafeChannels } = verifyFohSafe(fohRoutes, assigns)
    reportRigStatus({ fohSafe: safe, unsafeChannels })
    if (!safe) {
      fohNote = `STILL ON THE HOUSE: channel ${unsafeChannels.join(', ')}. Fix before you go live.`
      mark('foh-safety', 'failed')
      return
    }
    fohNote = `Confirmed by read-back: channel ${monitorChannels.join(', ')} are off the main bus.`
    mark('foh-safety', 'passed')
  }

  // ── Sidecar presence ─────────────────────────────────────────────────────
  const sidecarUp = $derived($desktopCompanionStatus.reachable)

  const AUX = [1, 2, 3, 4, 5, 6]
  const PILL = 'rounded-[var(--radius)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider'
</script>

<svelte:head><title>Rig setup — BarBro</title></svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-6">
  <header class="mb-4">
    <h1 class="text-xl font-black">Rig setup</h1>
    <p class="text-muted-foreground mt-1 text-sm">
      Wire the desk up and prove each link before the show. Work top to bottom — each step
      assumes the one above it passed.
    </p>
    {#if !sidecarUp}
      <p class="border-foreground/30 mt-2 rounded-[var(--radius)] border-2 border-dashed p-2 text-xs font-bold">
        BarBro desktop isn't running, so the desk can't be reached. The tone tests below still work.
      </p>
    {/if}
  </header>

  <!-- The tone: every check below listens for this. -->
  <section class="border-foreground/25 mb-4 rounded-[var(--radius)] border-2 p-3">
    <div class="mb-2 flex items-center gap-2">
      <Volume2 class="size-4" />
      <h2 class="grow text-sm font-bold">Test tone</h2>
      <button
        type="button"
        class="border-foreground inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] border-2 px-2.5 text-xs font-bold {toneOn
          ? 'bg-foreground text-background'
          : ''}"
        onclick={() => (toneOn ? stopTone() : startTone())}
      >
        {#if toneOn}<Square class="size-3.5" /> Stop{:else}<Play class="size-3.5" /> Play{/if}
      </button>
    </div>
    <div class="flex flex-wrap items-center gap-3 text-xs font-bold">
      <span class="inline-flex items-center gap-1">
        {#each ['left', 'both', 'right'] as s (s)}
          <button
            type="button"
            class="border-foreground/40 rounded-[var(--radius)] border px-2 py-0.5 {side === s
              ? 'bg-foreground text-background'
              : ''}"
            onclick={() => (side = s as TestSide)}>{s}</button
          >
        {/each}
      </span>
      <label class="inline-flex items-center gap-1.5">
        <span class="text-muted-foreground text-[10px] uppercase tracking-wider">Level</span>
        <input
          type="range"
          min={MIN_TEST_LEVEL_DB}
          max={MAX_TEST_LEVEL_DB}
          step="1"
          bind:value={levelDb}
          class="accent-foreground w-28"
          aria-label="Test tone level"
        />
        <span class="w-12 font-mono tabular-nums">{levelDb} dB</span>
      </label>
      <label class="inline-flex items-center gap-1.5">
        <input type="checkbox" bind:checked={pulsed} class="accent-foreground size-3" /> Pulse
      </label>
    </div>
    <!-- The diagnostic. Bars moving + silence in your ears = the sound left
         BarBro and something downstream ate it. -->
    <div class="mt-3 flex items-center gap-2">
      <span class="text-muted-foreground w-24 shrink-0 text-[10px] font-bold tracking-wider uppercase">
        BarBro output
      </span>
      <div class="grow space-y-1">
        {#each [{ label: 'L', v: meterL }, { label: 'R', v: meterR }] as m (m.label)}
          <div class="flex items-center gap-1.5">
            <span class="w-3 font-mono text-[10px] font-bold">{m.label}</span>
            <div class="border-foreground/30 h-2.5 grow overflow-hidden rounded-full border">
              <div
                class="bg-foreground h-full transition-[width] duration-75"
                style="width: {Math.min(100, Math.round(m.v * 140))}%"
              ></div>
            </div>
          </div>
        {/each}
      </div>
      <span class="w-16 shrink-0 text-right font-mono text-[10px] tabular-nums">
        {meterL + meterR > 0.0005
          ? `${Math.round(20 * Math.log10(Math.max(meterL, meterR)))} dB`
          : 'silent'}
      </span>
    </div>
    <p class="text-muted-foreground mt-2 text-[11px]">
      Capped at {MAX_TEST_LEVEL_DB} dB — safe for in-ears. Start with the pack's own volume down.
      <br />These bars show what BarBro <em>sends</em>. If they move and you hear nothing, the sound
      is being lost after BarBro — check the two things below.
    </p>
    <!--
      The single most common reason this is silent, and the page never said it.
      The tone goes to `ctx.destination` — whatever macOS is currently playing
      through. If that is still the built-in speakers, the desk never receives a
      sample and no amount of channel work will help.
    -->
    <p
      class="border-foreground/30 mt-2 rounded-[var(--radius)] border-2 border-dashed p-2 text-[11px]"
    >
      <span class="font-bold">Hearing nothing?</span> These bars only prove the sound left BarBro.
      It then has to survive three more steps, and the sections below check each one:
      <br />1. macOS output set to <span class="font-bold">XR18</span> (System Settings → Sound).
      <br />2. Channels {leftCh}/{rightCh} listening to the computer — <span class="font-bold">Check</span>, below.
      <br />3. Their faders up, and the <span class="font-bold">main fader</span> up — a master at
      zero silences everything with every other setting perfect.
    </p>
  </section>

  <!--
    "Is the desk hearing BarBro?" — one question, one button, one sentence.

    Nothing in this section can make a sound. It chooses a SOURCE, never a
    level: no faders are touched, nothing is unmuted, nothing is put on the main
    bus. Levels are the next section, and they are yours to move.
  -->
  <section class="border-foreground/25 mb-4 rounded-[var(--radius)] border-2 p-3">
    <header class="mb-2 flex items-center gap-2">
      <h2 class="grow text-sm font-bold">Is the desk hearing BarBro?</h2>
      <button
        type="button"
        class="border-foreground h-8 rounded-[var(--radius)] border-2 px-2.5 text-xs font-bold disabled:opacity-40"
        onclick={readUsbInput}
        disabled={!connected || usbBusy}
      >
        {usbBusy ? 'Checking…' : 'Check'}
      </button>
    </header>

    {#if !connected}
      <p class="border-foreground/30 rounded-[var(--radius)] border-2 border-dashed p-2 text-[11px] font-bold">
        Connect the desk first.
      </p>
    {:else if !usbLeft || !usbRight}
      <p class="text-[11px]">
        Press <span class="font-bold">Check</span> — your audio travels down the USB cable, and each
        channel has to be told to listen to it instead of the socket on the front.
      </p>
      {#if !deskAnswered && usbNote}
        <p class="mt-2 text-[11px] font-bold">The desk isn't answering — is this Mac still on its network?</p>
      {/if}
    {:else}
      {@const v = usbReady}
      <div
        class="flex items-start gap-2 rounded-[var(--radius)] border-2 p-2 {v?.ok
          ? 'border-foreground'
          : 'border-foreground/40 border-dashed'}"
      >
        {#if v?.ok}<CircleCheck class="mt-0.5 size-4 shrink-0" />{:else}<CircleAlert class="mt-0.5 size-4 shrink-0" />{/if}
        <p class="grow text-xs font-bold">{v?.reason}</p>
        {#if !v?.ok}
          <button
            type="button"
            class="border-foreground h-8 shrink-0 rounded-[var(--radius)] border-2 px-2.5 text-xs font-bold disabled:opacity-40"
            onclick={useUsbForBarbro}
            disabled={usbBusy}
          >
            Fix it
          </button>
        {/if}
      </div>
      {#if usbNote}<p class="mt-2 text-[11px] font-bold">{usbNote}</p>{/if}
    {/if}
  </section>

  <!--
    THE ONE QUESTION THE WHOLE LIVE RIG STANDS ON.

    Keeping the click out of the house needs it on its own desk channel, which
    needs its own OUTPUT channel — and whether this machine can send more than
    two has never been established. The device can (a 4-channel WAV lit four
    desk strips) and the audio graph can (proven in an offline render), but
    switched on in the app playback went silent.

    So it is measured, against the desk's own meters, on a THROWAWAY audio
    context — never the shared one, where a failure would silence the app.
  -->
  <section class="border-foreground/25 mb-4 rounded-[var(--radius)] border-2 p-3">
    <header class="mb-2 flex items-center gap-2">
      <h2 class="grow text-sm font-bold">Can this machine send separate channels?</h2>
      <button
        type="button"
        class="border-foreground h-8 rounded-[var(--radius)] border-2 px-2.5 text-xs font-bold disabled:opacity-40"
        onclick={proveSeparateChannels}
        disabled={!connected || probeBusy}
      >
        {probeBusy ? 'Testing…' : 'Test it (plays tones)'}
      </button>
    </header>
    <!--
      WHICH SOUND CARD, FIRST.

      The most expensive failure in this rig is invisible: the computer is set to
      its own speakers while everyone is staring at the mixer. The desk answers
      OSC perfectly — that runs over the network, not the USB cable — so every
      status light stays green and no audio arrives. Measured on this machine:
      with the XR18 selected Chromium reports 18 channels; with the built-in
      speakers selected it reports 2 and refuses to open four.
    -->
    <p
      class="mb-2 rounded-[var(--radius)] border-2 p-2 text-[11px] font-bold {outputDevice === null
        ? 'border-foreground/30'
        : outputDevice.canSeparate
          ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
          : 'border-red-600 text-red-700 dark:text-red-400'}"
    >
      {outputDevice?.summary ?? 'Checking which sound output BarBro is playing to…'}
    </p>
    {#if !connected}
      <p class="text-foreground/60 text-[11px]">Connect to the desk first.</p>
    {:else}
      <p class="text-foreground/60 mb-2 text-[11px]">
        Plays four short tones, one per channel, and asks the desk which ones arrived.
        Channels {leftCh} and {leftCh + 1} are on the house, so turn the main fader down
        first if a PA is connected.
      </p>
      {#if probeVerdictResult}
        <p
          class="rounded-[var(--radius)] border-2 p-2 text-[11px] font-bold {probeVerdictResult.proven
            ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
            : 'border-red-600 text-red-700 dark:text-red-400'}"
        >
          {probeVerdictResult.reason}
        </p>
        <ul class="mt-2 flex flex-col gap-0.5">
          {#each probeVerdictResult.channels as c (c.outputChannel)}
            <li class="flex items-center gap-2 text-[11px] font-bold tabular-nums">
              <span class="w-2">{c.arrived ? '✓' : '×'}</span>
              <span class="w-16">{c.label}</span>
              <span class="text-foreground/60 w-16">desk {c.deskChannel}</span>
              <span class="text-foreground/60">
                {c.restingDb === null ? '?' : c.restingDb.toFixed(0)} →
                {c.activeDb === null ? '?' : c.activeDb.toFixed(0)} dB
              </span>
            </li>
          {/each}
        </ul>
      {:else if probeNote}
        <p class="text-[11px] font-bold">{probeNote}</p>
      {/if}
    {/if}
  </section>

  <!--
    LEVELS. Every fader here starts at whatever the desk is ALREADY set to, read
    on Check — never at a default. Nothing moves unless you move it.

    That rule is not fussiness: a test tone at 0.75 on a main fader is painfully
    loud through a PA, and there is no undo on a sound that has already happened.
  -->
  <section class="border-foreground/25 mb-4 rounded-[var(--radius)] border-2 p-3">
    <header class="mb-2 flex items-center gap-2">
      <h2 class="grow text-sm font-bold">Levels</h2>
      <button
        type="button"
        class="border-foreground h-8 rounded-[var(--radius)] border-2 px-2.5 text-xs font-bold disabled:opacity-40"
        onclick={readLevels}
        disabled={!connected || levelsBusy}
      >
        {levelsBusy ? 'Reading…' : 'Read levels'}
      </button>
    </header>

    {#if !connected}
      <p class="border-foreground/30 rounded-[var(--radius)] border-2 border-dashed p-2 text-[11px] font-bold">
        Connect the desk first.
      </p>
    {:else if mainLevel === null}
      <p class="text-[11px]">
        Press <span class="font-bold">Read levels</span> to see where the desk is set right now.
      </p>
    {:else}
      <div class="space-y-1.5">
        <div class="flex items-center gap-2">
          <span class="w-28 shrink-0 text-xs font-bold">Main (house)</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            class="accent-foreground grow"
            value={mainLevel}
            oninput={(e) => void setMain(Number(e.currentTarget.value))}
            aria-label="Main output level"
          />
          <span class="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums">
            {Math.round(mainLevel * 100)}
          </span>
        </div>
        {#each monitorLevels as lvl, i (i)}
          <div class="flex items-center gap-2">
            <span class="w-28 shrink-0 text-xs font-bold">Monitor {i + 1}</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              class="accent-foreground grow"
              value={lvl}
              oninput={(e) => void setMonitor(i + 1, Number(e.currentTarget.value))}
              aria-label="Monitor {i + 1} level"
            />
            <span class="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums">
              {Math.round(lvl * 100)}
            </span>
          </div>
        {/each}
      </div>
      <p class="text-muted-foreground mt-2 text-[11px]">
        Monitors 1–6 are the aux outputs your in-ear packs plug into — one per player. These are
        the desk's own faders; moving one changes the desk immediately.
      </p>
      {#if levelsNote}<p class="mt-2 text-[11px] font-bold">{levelsNote}</p>{/if}
      <!--
        Linked buses are not a detail. Each performer needs their own mono mix
        into their own pack; a linked pair gives two people the same mix, and
        writes to the even bus of the pair silently do nothing at all.
      -->
      {#if busTopology && !busTopology.mono}
        <p
          class="mt-2 rounded-[var(--radius)] border-2 p-2 text-[11px] font-bold {busTopology.unknown
            ? 'border-foreground/40'
            : 'border-red-600 text-red-700 dark:text-red-400'}"
        >
          {busTopology.reason}
        </p>
      {/if}
    {/if}
  </section>

  <!-- Desk connection -->
  <section class="border-foreground/25 mb-4 rounded-[var(--radius)] border-2 p-3">
    <h2 class="mb-2 text-sm font-bold">Desk</h2>
    <div class="flex flex-wrap items-center gap-2 text-xs font-bold">
      <input
        class="border-foreground/30 bg-background h-8 w-40 rounded-[var(--radius)] border-2 px-2"
        placeholder="XR18 IP"
        bind:value={host}
        aria-label="XR18 host"
      />
      <input
        class="border-foreground/30 bg-background h-8 w-20 rounded-[var(--radius)] border-2 px-2"
        type="number"
        bind:value={port}
        aria-label="XR18 OSC port"
      />
      <button
        type="button"
        class="border-foreground h-8 rounded-[var(--radius)] border-2 px-2.5 font-bold disabled:opacity-40"
        onclick={findDesk}
        disabled={scanning || busy}
        title="Ask the network which mixers are out there — no address needed"
      >
        {scanning ? 'Searching…' : 'Find my desk'}
      </button>
      <button
        type="button"
        class="border-foreground h-8 rounded-[var(--radius)] border-2 px-2.5"
        onclick={() => (connected ? disconnect() : connect())}
        disabled={busy || (!connected && host.trim() === '')}
      >
        {connected ? 'Disconnect' : 'Connect'}
      </button>
      <button
        type="button"
        class="border-foreground/40 h-8 rounded-[var(--radius)] border-2 px-2.5"
        onclick={readDesk}
        disabled={!connected || busy}
      >
        Read desk
      </button>
      {#if foundConsoles.length > 1}
        <div class="mt-2 w-full space-y-1">
          <p class="text-muted-foreground text-[11px] font-bold">More than one mixer answered — pick yours:</p>
          {#each foundConsoles as c (c.ip)}
            <button
              type="button"
              class="border-foreground/40 flex w-full items-center gap-2 rounded-[var(--radius)] border px-2 py-1 text-left text-[11px]"
              onclick={() => { host = c.ip; void connect() }}
            >
              <span class="font-mono font-bold">{c.ip}</span>
              <span class="grow">{c.name || 'unnamed'}</span>
              <span class="text-muted-foreground">{c.model ?? ''} {c.firmware ? `fw ${c.firmware}` : ''}</span>
            </button>
          {/each}
        </div>
      {/if}
      {#if scanNote}
        <p class="mt-2 w-full text-[11px] font-bold">{scanNote}</p>
      {/if}
      {#if Object.keys(touched).length > 0}
        <button
          type="button"
          class="border-foreground/40 h-8 rounded-[var(--radius)] border-2 px-2.5"
          onclick={restoreDesk}
          disabled={busy}
        >
          Revert my changes
        </button>
      {/if}
    </div>
    {#if deskNote}<p class="mt-2 text-[11px] font-bold">{deskNote}</p>{/if}
  </section>

  <!-- Which channels carry BarBro -->
  <section class="border-foreground/25 mb-4 rounded-[var(--radius)] border-2 p-3">
    <h2 class="mb-1 text-sm font-bold">Channels carrying BarBro</h2>
    <p class="text-muted-foreground mb-2 text-[11px]">
      Play the tone left-only, then right-only, and note which channels light up. BarBro sends
      plain stereo, so it lands on the first two USB returns.
    </p>
    <div class="flex items-center gap-3 text-xs font-bold">
      <label class="inline-flex items-center gap-1.5">
        Left ch
        <input
          type="number" min="1" max="16" bind:value={leftCh}
          class="border-foreground/30 bg-background h-8 w-16 rounded-[var(--radius)] border-2 px-2"
          aria-label="Left channel"
        />
      </label>
      <label class="inline-flex items-center gap-1.5">
        Right ch
        <input
          type="number" min="1" max="16" bind:value={rightCh}
          class="border-foreground/30 bg-background h-8 w-16 rounded-[var(--radius)] border-2 px-2"
          aria-label="Right channel"
        />
      </label>
    </div>
  </section>

  {#if problems.length > 0}
    <div class="border-foreground mb-4 rounded-[var(--radius)] border-2 border-dashed p-3">
      <p class="mb-1 text-xs font-bold">Fix this before testing outputs</p>
      <ul class="space-y-1">
        {#each problems as p (p)}
          <li class="text-[11px] font-bold">{p}</li>
        {/each}
      </ul>
    </div>
  {/if}

  <!-- Outputs -->
  <section class="border-foreground/25 mb-4 rounded-[var(--radius)] border-2 p-3">
    <h2 class="mb-2 text-sm font-bold">Outputs</h2>
    <div class="flex flex-wrap gap-2 text-xs font-bold">
      <!--
        `disabled:opacity-40` on ALL of these, and an active highlight on Main —
        it had neither. With the desk disconnected every button looked armed and
        every one was inert; and because only Aux lit up, a previously clicked
        Aux stayed highlighted after pressing Main, which read as "Main is the
        broken one".
      -->
      <button
        type="button"
        class="border-foreground/40 h-8 rounded-[var(--radius)] border-2 px-2.5 disabled:opacity-40 {activeOut ===
        'main'
          ? 'bg-foreground text-background'
          : ''}"
        onclick={testMainLr}
        disabled={!connected || busy || problems.length > 0}
      >
        Test main L/R
      </button>
      {#each AUX as bus (bus)}
        <button
          type="button"
          class="border-foreground/40 h-8 rounded-[var(--radius)] border-2 px-2.5 disabled:opacity-40 {activeOut ===
          bus
            ? 'bg-foreground text-background'
            : ''}"
          onclick={() => testAux(bus)}
          disabled={!connected || busy || problems.length > 0}
        >
          Aux {bus}
        </button>
      {/each}
    </div>
    {#if !connected}
      <p class="mt-2 text-[11px] font-bold">Connect the desk first — these need it.</p>
    {/if}
    <p class="text-muted-foreground mt-2 text-[11px]">
      Aux sends one at a time, so you can tell which pack is which. Aux sends are mono on the
      XR18 — one aux per player. The highlighted button is where the tone is going right now.
    </p>
  </section>

  <!-- FOH safety -->
  <section class="border-foreground/25 mb-4 rounded-[var(--radius)] border-2 p-3">
    <h2 class="mb-1 text-sm font-bold">Keep click and cues out of the house</h2>
    <p class="text-muted-foreground mb-2 text-[11px]">
      Takes these channels off the main bus, then reads the desk back to prove it. A click in the
      house ends the show, so this is verified rather than assumed.
    </p>
    <div class="flex flex-wrap items-center gap-2 text-xs font-bold">
      <input
        class="border-foreground/30 bg-background h-8 w-32 rounded-[var(--radius)] border-2 px-2"
        bind:value={monitorOnly}
        aria-label="Monitor-only channels"
      />
      <button
        type="button"
        class="border-foreground h-8 rounded-[var(--radius)] border-2 px-2.5"
        onclick={enforceFohSafety}
        disabled={!connected || busy || monitorChannels.length === 0}
      >
        Take off the house + verify
      </button>
    </div>
    {#if fohNote}
      <p class="mt-2 text-[11px] font-bold">{fohNote}</p>
    {/if}
  </section>

  <!-- Offline readiness. On this page because it belongs to the same job: the
       things you verify BEFORE leaving, not at the venue. -->
  <div class="mb-4">
    <OfflineReadyPanel />
  </div>

  <!-- The checklist -->
  <section class="border-foreground/25 rounded-[var(--radius)] border-2 p-3">
    <div class="mb-2 flex items-center gap-2">
      <h2 class="grow text-sm font-bold">Checklist</h2>
      <span class={PILL + (ready ? ' bg-foreground text-background' : ' border-foreground/40 border')}>
        {ready ? 'rig ready' : 'not ready'}
      </span>
    </div>
    <ol class="space-y-2">
      {#each RIG_CHECKS as check (check.id)}
        {@const state = stateOf(check.id)}
        <li
          class="rounded-[var(--radius)] border p-2 {check.id === nextId
            ? 'border-foreground'
            : 'border-foreground/15'}"
        >
          <div class="flex items-start gap-2">
            <span class="mt-0.5 shrink-0">
              {#if state === 'passed'}<CircleCheck class="size-4" />
              {:else if state === 'failed'}<CircleAlert class="size-4" />
              {:else}<Circle class="size-4 opacity-40" />{/if}
            </span>
            <div class="grow">
              <p class="text-xs font-bold">{check.title}</p>
              <p class="text-muted-foreground text-[11px]">{check.question}</p>
              {#if state === 'failed'}
                <p class="mt-1 text-[11px] font-bold">{check.remedy}</p>
              {:else if state === 'blocked'}
                <p class="text-muted-foreground mt-1 text-[11px] italic">
                  Finish the steps above first.
                </p>
              {/if}
            </div>
            {#if state !== 'blocked'}
              <span class="flex shrink-0 gap-1">
                <button
                  type="button"
                  class="border-foreground/40 rounded-[var(--radius)] border px-2 py-0.5 text-[11px] font-bold"
                  onclick={() => mark(check.id, 'passed')}>Yes</button
                >
                <button
                  type="button"
                  class="border-foreground/40 rounded-[var(--radius)] border px-2 py-0.5 text-[11px] font-bold"
                  onclick={() => mark(check.id, 'failed')}>No</button
                >
                <button
                  type="button"
                  class="text-muted-foreground px-1 py-0.5 text-[11px] font-bold"
                  onclick={() => mark(check.id, 'skipped')}>Skip</button
                >
              </span>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  </section>
</div>
