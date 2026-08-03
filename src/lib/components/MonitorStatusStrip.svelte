<script lang="ts">
  /**
   * WHOSE IN-EARS ARE ALIVE — one line, always visible on the live stage.
   *
   * Every level comes from the XR18's own meters, which is the one thing in the
   * chain that cannot be wrong about what it is sending. So "audio is leaving
   * aux 3" stops being a hope.
   *
   * ## Why it looks like this
   *
   * It is ONE LINE. A first version gave each performer a row and a meter bar,
   * and on stage it ate half the screen answering a question that is a glance:
   * is anyone's monitor dead? A name and a dot answers that. The detail belongs
   * in the Rig dialog, which is one tap away from here.
   *
   * It also never hides itself. A second version disappeared when the desk was
   * unreachable, which from the stage is indistinguishable from the feature
   * being gone — and it removed the one place that could explain WHY there is
   * no information. So a missing desk is a state this line shows, not a reason
   * for it to vanish.
   *
   * It is honest about where its knowledge stops. A moving meter proves the desk
   * is SENDING; it cannot prove the cable is in, the pack is on, or that anyone
   * can hear. Nothing here ever says "working".
   */
  import { Cable } from '@lucide/svelte'
  import { connectXAirMixer, queryXAirPaths, readXAirMeters } from '$lib/client/hardwareBridge'
  import { loadRigSetup } from '$lib/hardware/rigSetupStore'
  import { liveRigLayout } from '$lib/hardware/liveRigPlan'
  import { splitVerifyPlan } from '$lib/hardware/splitRouting'
  import { reportRigStatus, rigStatus } from '$lib/stores/rigStatus'
  import {
    SIGNAL_FLOOR_DB,
    channelLevelDb,
    duplicateBuses,
    monitorStatuses,
    type MonitorPerformer,
    type MonitorStatus,
  } from '$lib/hardware/monitorStatus'

  let {
    performers = [],
    songChannels = [9, 10],
    clickChannel = 11,
    outputSplit = false,
    onOpenRig,
  }: {
    performers?: MonitorPerformer[]
    songChannels?: number[]
    clickChannel?: number | null
    /** Is the ENGINE actually sending click/cue on their own channels? */
    outputSplit?: boolean
    onOpenRig?: () => void
  } = $props()

  /**
   * The one-glance show verdict: engine splitting (its own graph says so) AND
   * the desk proved, by read-back, that the click strips take USB and stay off
   * the house. Anything less is amber — never green by assumption. This chip
   * is the on-stage version of everything verified by hand the night the rig
   * first worked; the point is that nobody should ever verify it by hand again.
   */
  const splitVerdict = $derived.by<'ok' | 'unverified' | 'drifted' | null>(() => {
    if (!outputSplit) return null
    // PROVEN wrong beats not-yet-proven: a strip back on the house is a live
    // hazard (click may be in the PA), and it gets red words with a number.
    if ($rigStatus.fohSafe === false) return 'drifted'
    return $rigStatus.fohSafe === true && $rigStatus.usbInputOk === true ? 'ok' : 'unverified'
  })

  /**
   * WATCHDOG, not a one-shot: the desk is a physical object with a sound
   * engineer's fingers on it — strip 11 can be put back on the house MID-SET
   * and a verdict from twenty minutes ago would smile through it. Re-proven
   * every minute while the desk answers; a drop resets to "immediately".
   */
  const SPLIT_REVERIFY_MS = 60_000
  let lastSplitVerifyMs = 0
  /**
   * READ-ONLY read of the split's desk routing: the click/cue strips take the
   * right USB returns (usbInputOk) and sit off the house (fohSafe). No answer
   * from the desk = verdict left UNKNOWN — never guessed in either direction.
   */
  async function verifySplitFromDesk() {
    const setup = loadRigSetup()
    const layout = liveRigLayout({
      profileRequest: 'multichannel',
      deviceChannels: 4,
      firstDeskChannel: setup.leftCh,
    })
    const plan = splitVerifyPlan(layout)
    const q = await queryXAirPaths(plan.map((p) => p.address), 900)
    if (!q.ok) return
    const answered = plan.filter((p) => q.replies[p.address] !== undefined)
    if (answered.length === 0) return
    const right = (pred: (a: string) => boolean) =>
      plan
        .filter((p) => pred(p.address))
        .every((p) => {
          const got = q.replies[p.address]?.[0]
          return typeof got === 'number' && Math.round(got) === p.expect
        })
    const lrWrong = plan
      .filter((p) => p.address.endsWith('/mix/lr'))
      .filter((p) => {
        const got = q.replies[p.address]?.[0]
        return typeof got === 'number' && Math.round(got) !== p.expect
      })
      .map((p) => Number(p.address.split('/')[2]))
    reportRigStatus({
      usbInputOk: right((a) => a.includes('/preamp/') || a.includes('/config/')),
      fohSafe: right((a) => a.endsWith('/mix/lr')),
      // Drift caught mid-set names the strip instead of a mute amber.
      unsafeChannels: lrWrong,
    })
  }

  let levels = $state<number[] | null>(null)
  let ageMs = $state<number | null>(null)
  let deskDown = $state(false)
  /** Why the desk is down, in words a person can act on. */
  let deskDownReason = $state('')
  /** One auto-connect attempt per backoff cycle — retrying inside a cycle
   *  would just double the UDP timeouts. */
  let connectTried = false

  /** Any programme on the source channels right now? Decides idle vs broken. */
  const sourceActive = $derived.by(() => {
    if (levels === null) return false
    const chans = [...songChannels, ...(clickChannel === null ? [] : [clickChannel])]
    return chans.some((c) => (channelLevelDb(levels, c) ?? -128) > SIGNAL_FLOOR_DB)
  })
  const rows = $derived<MonitorStatus[]>(monitorStatuses({ performers, levels, ageMs, sourceActive }))
  const dupes = $derived(duplicateBuses(performers))
  /** Is BarBro's audio even reaching the desk? Separates "nothing is playing"
   *  from "this monitor is broken" — different faults, different fixes, and
   *  without it a gap between songs reads as a fault. */
  const songDb = $derived(
    levels === null ? null : Math.max(...songChannels.map((c) => channelLevelDb(levels, c) ?? -128)),
  )
  const clickDb = $derived(clickChannel === null ? null : channelLevelDb(levels, clickChannel))
  const problems = $derived(rows.filter((r) => r.state === 'silent').length + dupes.length)

  // A polling timer is a non-reactive sink — the case `$effect` is for.
  $effect(() => {
    if (performers.length === 0) return
    let alive = true
    let busy = false
    // TWO speeds: 2 Hz while the desk answers, one attempt per 8 s while it
    // does not — a disconnected desk is the common state and polling it hard
    // just fills the console with red.
    let timer: ReturnType<typeof setTimeout> | null = null
    const OK_MS = 500
    const DOWN_MS = 8000
    const tick = async () => {
      if (!alive || busy) return
      busy = true
      let r = await readXAirMeters()
      // AUTO-CONNECT. Live mode used to show "desk not connected" and stop
      // there — but the desk's address is saved, and standing on a stage is
      // the wrong moment to be sent to a settings page to press Connect. One
      // attempt per down-cycle; the handshake makes no sound.
      if (!r.ok && /not connected/i.test(r.error) && !connectTried) {
        connectTried = true
        const saved = loadRigSetup()
        if (saved.host) {
          const c = await connectXAirMixer({ host: saved.host, port: saved.port })
          if (c.ok) {
            // The connect proved identity (/xinfo) — feed the shared evidence
            // store so the rig chip agrees with what just happened.
            reportRigStatus({ deskIdentified: true })
            r = await readXAirMeters()
          } else {
            deskDownReason = c.error
          }
        } else {
          deskDownReason = 'No desk saved yet — set it up on the Rig page.'
        }
      }
      busy = false
      if (!alive) return
      if (r.ok) {
        levels = r.levels
        ageMs = r.ageMs
        deskDown = false
        deskDownReason = ''
        connectTried = false // a future drop gets a fresh attempt
        // The show verdict must not depend on anyone opening a dialog: verify
        // the split's desk routing HERE, read-only, re-proven every minute.
        if (outputSplit && Date.now() - lastSplitVerifyMs > SPLIT_REVERIFY_MS) {
          lastSplitVerifyMs = Date.now()
          void verifySplitFromDesk()
        }
      } else {
        lastSplitVerifyMs = 0
        deskDown = true
        if (!deskDownReason) deskDownReason = r.error
        // Do NOT clear `levels` — staleness is decided from `ageMs`, and
        // blanking here would turn one dropped request into six dead monitors.
        ageMs = null
      }
      if (alive) timer = setTimeout(() => void tick(), r.ok ? OK_MS : DOWN_MS)
    }
    void tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  })

  function dotClass(s: MonitorStatus['state']): string {
    if (s === 'sending') return 'bg-emerald-500'
    if (s === 'silent') return 'bg-red-600'
    // Idle is NEUTRAL — an idle desk is not a fault, and red dots at rest
    // train people to ignore red.
    if (s === 'idle') return 'bg-foreground/30'
    if (s === 'unassigned') return 'bg-foreground/20'
    return 'bg-amber-500'
  }
  const dB = (v: number | null) => (v === null || v <= SIGNAL_FLOOR_DB ? '—' : `${v.toFixed(0)}`)
</script>

<div
  class="text-foreground/60 flex shrink-0 items-center gap-x-3 overflow-hidden text-[10px] font-bold whitespace-nowrap"
>
  <span class="shrink-0 tracking-wide uppercase">In-ears</span>

  {#if performers.length === 0}
    <span class="truncate">Add performers in Project settings to see their monitors.</span>
  {:else if deskDown}
    <!-- Named, not hidden: "no desk" is a different fault from "no sound",
         and the WORDS matter — "the USB cable carries audio only" is the
         difference between checking a cable and changing Wi-Fi. -->
    <span class="truncate" title={deskDownReason}>
      {deskDownReason || 'Desk not connected — no monitor levels.'}
    </span>
  {:else}
    <span class="flex min-w-0 items-center gap-x-3 overflow-hidden">
      {#each rows as r (r.performerId)}
        <span class="flex shrink-0 items-center gap-1" title="{r.name} — {r.detail}">
          <span class="size-1.5 rounded-full {dotClass(r.state)}"></span>
          <span class="text-foreground/80">{r.name}</span>
        </span>
      {/each}
    </span>
    <span class="text-foreground/45 shrink-0 tabular-nums">
      song {dB(songDb)} · click {dB(clickDb)}
    </span>
  {/if}

  {#if splitVerdict === 'ok'}
    <span
      class="shrink-0 font-black text-emerald-600 dark:text-emerald-400"
      title="The engine sends click/cue on their own channels, and the desk confirmed by read-back that those strips take USB and are off the house."
    >
      click→ears ✓
    </span>
  {:else if splitVerdict === 'drifted'}
    <span
      class="shrink-0 font-black text-red-600 dark:text-red-400"
      title="A click/cue strip has been put back on the house mix — the room may hear the click. Take it off FOH in the Rig dialog."
    >
      strip {($rigStatus.unsafeChannels ?? []).join('/') || '?'} ON HOUSE
    </span>
  {:else if splitVerdict === 'unverified'}
    <span
      class="shrink-0 font-black text-amber-600 dark:text-amber-400"
      title="The engine is splitting click/cue, but the desk has not confirmed its routing this session. Open Rig — verification runs on connect."
    >
      rig unverified
    </span>
  {/if}

  {#if problems > 0}
    <span class="shrink-0 font-black text-red-600 dark:text-red-400">
      {dupes.length > 0 ? `aux ${dupes.join('/')} shared` : `${problems} silent`}
    </span>
  {/if}

  <!--
    The way to DO something about a red dot, immediately beside it. This is
    where the Rig button lives now — it was in the transport row, the same size
    as Play's neighbours, competing for attention during a song when it is a
    setup control you reach for once.
  -->
  {#if onOpenRig}
    <button
      type="button"
      class="border-foreground/30 text-foreground/70 hover:border-foreground hover:text-foreground ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold transition-colors"
      onclick={onOpenRig}
      title="XR18 live rig — routing, in-ear monitor mixes, house-safety"
    >
      <Cable class="size-3" aria-hidden="true" />
      Rig
    </button>
  {/if}
</div>
