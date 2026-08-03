<script lang="ts">
  /**
   * THE METER-FRAME MEASUREMENT PAGE — run this at a rehearsal.
   *
   * Purpose: settle, from evidence, where the XR18's meter frame keeps its
   * BUS levels (the current map's 22-27 is contradicted by live behaviour).
   * Ritual: connect, play a song so a bus carries signal, watch which indices
   * light up, press "Copy report", paste it to whoever fixes METER_INDEX.
   * Read-only: this page never writes to the desk.
   */
  import { onMount } from 'svelte'
  import { connectXAirMixer, readXAirMeters } from '$lib/client/hardwareBridge'
  import { loadRigSetup } from '$lib/hardware/rigSetupStore'
  import {
    activityReport,
    emptyActivity,
    foldFrame,
    type MeterActivity,
  } from '$lib/hardware/meterFrameCapture'

  let activity = $state<MeterActivity[]>(emptyActivity())
  let status = $state('Connecting…')
  let copied = $state(false)

  function reset() {
    activity = emptyActivity()
    copied = false
  }

  async function copyReport() {
    await navigator.clipboard.writeText(activityReport(activity))
    copied = true
  }

  onMount(() => {
    let alive = true
    const tick = async () => {
      if (!alive) return
      let r = await readXAirMeters()
      if (!r.ok && /not connected/i.test(r.error)) {
        const saved = loadRigSetup()
        if (saved.host) {
          await connectXAirMixer({ host: saved.host, port: saved.port })
          r = await readXAirMeters()
        } else {
          status = 'No desk saved — set the address on the Rig page first.'
        }
      }
      if (r.ok && r.levels) {
        activity = foldFrame([...activity], r.levels)
        status = `Live — ${r.levels.length} meter points, reading ${r.ageMs ?? '?'} ms old.`
      } else if (!r.ok) {
        status = r.error
      }
      if (alive) setTimeout(() => void tick(), 250)
    }
    void tick()
    return () => {
      alive = false
    }
  })

  const barPct = (db: number) => Math.max(0, Math.min(100, ((db + 90) / 90) * 100))
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
  <h1 class="text-lg font-black">Desk meter map — measurement</h1>
  <p class="text-muted-foreground text-sm">
    Play a song so sound reaches a monitor bus, then read which indices move. Channels 1–16
    (indices 0–15) are proven; everything else is what this page exists to settle. Nothing here
    writes to the desk.
  </p>
  <p class="text-sm font-semibold">{status}</p>
  <div class="flex gap-2">
    <button class="border-foreground/30 rounded border-2 px-3 py-1 text-sm font-bold" onclick={reset}>
      Reset capture
    </button>
    <button class="border-foreground/30 rounded border-2 px-3 py-1 text-sm font-bold" onclick={() => void copyReport()}>
      {copied ? 'Copied ✓' : 'Copy report'}
    </button>
  </div>
  <div class="flex flex-col gap-0.5 font-mono text-[11px]">
    {#each activity as a (a.index)}
      <div class="flex items-center gap-2 {a.moved ? '' : 'opacity-40'}">
        <span class="w-12 text-right tabular-nums">{a.index}</span>
        <span class="w-40 truncate">
          {a.index <= 15
            ? `ch ${a.index + 1}`
            : a.index >= 22 && a.index <= 27
              ? `bus ${a.index - 21}? (unverified)`
              : a.index >= 28 && a.index <= 29
                ? `main ${a.index === 28 ? 'L' : 'R'}? (unverified)`
                : 'unmapped'}
        </span>
        <div class="bg-foreground/10 relative h-3 flex-1 overflow-hidden rounded">
          <div class="absolute inset-y-0 left-0 bg-emerald-500/80" style="width: {barPct(a.nowDb)}%"></div>
          <div class="bg-foreground/60 absolute inset-y-0 w-px" style="left: {barPct(a.peakDb)}%"></div>
        </div>
        <span class="w-16 text-right tabular-nums">{a.nowDb <= -128 ? '—' : a.nowDb.toFixed(1)}</span>
      </div>
    {/each}
  </div>
</div>
