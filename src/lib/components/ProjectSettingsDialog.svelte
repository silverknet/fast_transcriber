<script lang="ts">
  /**
   * Project settings — currently houses the auto stem-separation policy.
   *
   * When enabled, BarBro prepares the chosen stems for every (non-hidden)
   * song with audio in the background, at the chosen quality. The actual
   * work is driven by the scheduler in `$lib/client/autoStems.ts`; this
   * dialog only edits the manifest policy via `setProjectAutoStems`.
   */
  import { Button } from '$lib/components/ui/button'
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import { get } from 'svelte/store'
  import { project as projectStore } from '$lib/stores/project'
  import {
    setProjectAutoStems,
    setProjectDefaults,
    setProjectMastering,
    setProjectPerformers,
    applyDefaultsToAllSongs,
    generateCueTracksForAllSongs,
  } from '$lib/project/commit'
  import { userStore } from '$lib/stores/user'
  import {
    watchProjectForAutoStems,
    unwatchProjectForAutoStems,
    isProjectAutoStemsWatched,
    readProjectSong,
  } from '$lib/client/desktopProjectFs'
  import { runProjectHealthCheck, type ProjectHealthReport } from '$lib/project/projectHealth'
  import { availableInputChannels } from '$lib/project/performerInputs'
  import { liveRigLayout } from '$lib/hardware/liveRigPlan'
  import { loadRigSetup } from '$lib/hardware/rigSetupStore'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { LEGACY_LIVE_STEMS } from '$lib/audio/liveStemDefaults'
  import { audibleSlotSet } from '$lib/hardware/liveSlotDefaults'
  import { LIVE_SLOT_LABELS } from '$lib/hardware/liveSlotLinks'
  import { LIVE_SLOT_NAMES, type LiveSlotName } from '$lib/project/types'
  import {
    AUTO_STEM_NAMES,
    type AutoStemName,
    type AutoStemQuality,
    type MasteringIntensity,
    type Performer,
    type PreCountInCueMode,
  } from '$lib/project/types'
  import { Mic, Music4, Plus, Trash2, User } from '@lucide/svelte'

  let {
    open = $bindable(false),
    onOpenSetlistExport,
    onReanalyseLyrics,
    reanalyseBusy = false,
    reanalyseMsg = '',
  } = $props<{
    open?: boolean
    onOpenSetlistExport?: () => void
    onReanalyseLyrics?: () => void
    reanalyseBusy?: boolean
    reanalyseMsg?: string
  }>()

  /** Friendly labels — never expose model names / internals here. */
  const STEM_LABELS: Record<AutoStemName, string> = {
    vocals: 'Vocals',
    drums: 'Drums',
    bass: 'Bass',
    other: 'Other (guitars / keys)',
  }
  const QUALITY_OPTIONS: { value: AutoStemQuality; label: string; hint: string }[] = [
    { value: 'preview', label: 'Fast', hint: 'Quickest, roughest separation' },
    { value: 'balanced', label: 'Balanced', hint: 'Good quality, reasonable time' },
    { value: 'best', label: 'Best', hint: 'Highest quality, slowest' },
  ]

  let enabled = $state(false)
  let selected = $state<Record<AutoStemName, boolean>>({
    vocals: false,
    drums: false,
    bass: false,
    other: false,
  })
  let quality = $state<AutoStemQuality>('balanced')
  /** Which LIVE BUTTONS start switched on (checked = on; the rest start off). */
  let liveSlotSelected = $state<Record<LiveSlotName, boolean>>(
    Object.fromEntries(LIVE_SLOT_NAMES.map((n) => [n, false])) as Record<LiveSlotName, boolean>,
  )
  let countInBeats = $state(0)
  let cueMode = $state<PreCountInCueMode>('off')
  let performers = $state<Performer[]>([])

  /**
   * Two performers cannot share one Aux Out — it is a single physical socket
   * feeding a single pack, so offering a taken number would silently overwrite
   * somebody else's mix.
   */
  function monitorTaken(bus: number, exceptId: string): boolean {
    return performers.some((p) => p.id !== exceptId && p.monitorBus === bus)
  }

  function setMonitorBus(id: string, raw: string) {
    const bus = raw ? Number(raw) : undefined
    performers = performers.map((p) =>
      p.id === id ? { ...p, monitorBus: bus && bus >= 1 && bus <= 6 ? bus : undefined } : p,
    )
  }

  function addPerformer() {
    performers = [...performers, { id: crypto.randomUUID(), name: '', role: '' }]
  }
  function removePerformer(id: string) {
    performers = performers.filter((p) => p.id !== id)
  }
  function toggleLinkToMe(id: string) {
    const me = get(userStore)?.id
    if (!me) return
    performers = performers.map((p) =>
      p.id === id ? { ...p, userId: p.userId === me ? undefined : me } : p,
    )
  }
  // Project sound (mastering)
  type StemSoundForm = { intensity: MasteringIntensity; trimDb: number; tone: boolean }
  // Defaults aim "live ready" out of the box: rich bass, punchy clear drums.
  const DEFAULT_STEM_SOUND: Record<AutoStemName, StemSoundForm> = {
    vocals: { intensity: 'off', trimDb: 0, tone: false },
    drums: { intensity: 'light', trimDb: 0, tone: true },
    bass: { intensity: 'light', trimDb: 0, tone: true },
    other: { intensity: 'off', trimDb: 0, tone: false },
  }
  /** Stem-appropriate tone-shaping label (what 'shaped' means for each). */
  const TONE_LABELS: Record<AutoStemName, string> = {
    vocals: 'Clear',
    drums: 'Punchy & clear',
    bass: 'Rich',
    other: 'Clear',
  }
  let soundEnabled = $state(false)
  let soundMatchLoudness = $state(true)
  let soundMasterGlue = $state(true)
  /** Drums only: how hard the kick in the drums stem hits (0…1, 0 = untouched). */
  let soundKickPunch = $state(0)
  let soundStems = $state<Record<AutoStemName, StemSoundForm>>(structuredClone(DEFAULT_STEM_SOUND))
  /** THIS machine: auto-prepare stems locally (per-machine, not shared). */
  let localPrepare = $state(false)
  let busy = $state(false)
  let error = $state('')
  let applyMsg = $state('')

  // Seed the form ONCE each time the dialog opens. The store is read via
  // `get()` (non-reactive) on purpose: autosave / cloud-status ticks mutate
  // `$projectStore` constantly, and a reactive read here re-ran the effect on
  // every tick — wiping the user's in-progress selections (e.g. picking a
  // pre-count-in radio snapped straight back to the saved value).
  let seeded = false
  $effect(() => {
    if (!open) {
      seeded = false
      return
    }
    if (seeded) return
    seeded = true
    const snap = get(projectStore)
    const cfg = snap.data?.autoStems
    enabled = cfg?.enabled ?? false
    quality = cfg?.quality ?? 'balanced'
    const set = new Set(cfg?.stems ?? [])
    selected = {
      vocals: set.has('vocals'),
      drums: set.has('drums'),
      bass: set.has('bass'),
      other: set.has('other'),
    }
    // Live default stems: seed from the saved config, or the legacy default
    // (all stems except vocals) so the checkboxes show today's behavior.
    // Seeded through the SAME resolver live uses, so the boxes show what will
    // actually happen — including for a project that has only the older
    // stem-based setting, which migrates in place the first time this is saved.
    const onNow = audibleSlotSet(snap.data?.defaults?.liveSlots, snap.data?.defaults?.liveStems)
    liveSlotSelected = Object.fromEntries(
      LIVE_SLOT_NAMES.map((n) => [n, onNow.has(n)]),
    ) as Record<LiveSlotName, boolean>
    countInBeats = snap.data?.defaults?.countInBeats ?? 0
    const pc = snap.data?.defaults?.preCountInCue
    cueMode = pc?.mode ?? 'off'
    performers = (snap.data?.performers ?? []).map((p) => ({ ...p }))
    const ms = snap.data?.mastering
    soundEnabled = ms?.enabled ?? false
    soundMatchLoudness = ms?.matchLoudness ?? true
    soundMasterGlue = ms?.masterGlue ?? true
    soundKickPunch = Math.max(0, Math.min(1, ms?.kickPunch ?? 0))
    const stemForm = structuredClone(DEFAULT_STEM_SOUND)
    for (const name of AUTO_STEM_NAMES) {
      const s = ms?.stems?.[name]
      if (!s) continue
      stemForm[name] = {
        intensity: s.intensity ?? 'off',
        trimDb: Math.max(-9, Math.min(9, Math.round(s.trimDb ?? 0))),
        tone: s.tone === 'shaped',
      }
    }
    soundStems = stemForm
    error = ''
    applyMsg = ''
    busy = false
    // This machine's opt-in — read from the sidecar's per-machine watch list.
    const osPath = snap.osPath
    if (osPath) void isProjectAutoStemsWatched(osPath).then((w) => (localPrepare = w))
  })

  const chosenStems = $derived(AUTO_STEM_NAMES.filter((n) => selected[n]))
  const chosenLiveSlots = $derived(LIVE_SLOT_NAMES.filter((n) => liveSlotSelected[n]))
  const noStemsButEnabled = $derived(enabled && chosenStems.length === 0)
  const songCount = $derived($projectStore.data?.songs.length ?? 0)
  const canExportSetlist = $derived(
    songCount > 0 && $desktopCompanionStatus.reachable && typeof onOpenSetlistExport === 'function',
  )
  const preCountInCue = $derived({ mode: cueMode })

  function requestSetlistExport() {
    if (!canExportSetlist) return
    open = false
    onOpenSetlistExport?.()
  }

  async function save() {
    if (busy) return
    busy = true
    error = ''
    try {
      // Shared project config (source of truth).
      await setProjectAutoStems({ enabled, stems: chosenStems, quality })
      await setProjectDefaults({
        countInBeats: countInBeats > 0 ? countInBeats : 0,
        preCountInCue,
        liveSlots: chosenLiveSlots,
      })
      await setProjectPerformers(
        performers
          .map((p) => ({ ...p, name: p.name.trim(), role: p.role?.trim() || undefined }))
          .filter((p) => p.name.length > 0),
      )
      {
        const stems: NonNullable<Parameters<typeof setProjectMastering>[0]['stems']> = {}
        for (const name of AUTO_STEM_NAMES) {
          const f = soundStems[name]
          stems[name] = {
            intensity: f.intensity,
            ...(f.trimDb !== 0 ? { trimDb: f.trimDb } : {}),
            ...(f.tone ? { tone: 'shaped' as const } : {}),
          }
        }
        await setProjectMastering({
          enabled: soundEnabled,
          matchLoudness: soundMatchLoudness,
          masterGlue: soundMasterGlue,
          stems,
          ...(soundKickPunch > 0 ? { kickPunch: soundKickPunch } : {}),
        })
      }
      // This machine (local): opt in/out of auto-preparing stems here.
      const osPath = $projectStore.osPath
      if (osPath) {
        if (localPrepare) await watchProjectForAutoStems(osPath)
        else await unwatchProjectForAutoStems(osPath)
      }
      open = false
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save project settings.'
    } finally {
      busy = false
    }
  }

  // ── Performer desk inputs (the patch plan) ────────────────────────────────
  /**
   * BarBro's own strips (song/click/cue USB returns — 9-12 on the current
   * rig) are RESERVED: offering them to a performer would silence the backing
   * or the click the moment they plugged in. The reservation derives from the
   * same layout the engine uses.
   */
  const inputReserveLayout = liveRigLayout({
    profileRequest: 'multichannel',
    deviceChannels: 18,
    firstDeskChannel: loadRigSetup().leftCh,
  })
  function inputChoicesFor(inputId: string): number[] {
    return availableInputChannels(performers, inputReserveLayout, inputId)
  }
  function addPerformerInput(p: Performer) {
    const free = availableInputChannels(performers, inputReserveLayout)
    if (free.length === 0) return
    p.inputs = [
      ...(p.inputs ?? []),
      { id: crypto.randomUUID(), label: '', channels: [free[0]!] },
    ]
  }
  function removePerformerInput(p: Performer, inputId: string) {
    p.inputs = (p.inputs ?? []).filter((i) => i.id !== inputId)
  }
  function setInputChannel(input: { channels: number[] }, slot: 0 | 1, raw: string) {
    const ch = raw === '' ? null : Number(raw)
    const next = [...input.channels]
    if (ch === null) {
      // Clearing the second slot makes it mono; the first slot cannot clear.
      if (slot === 1) next.splice(1, 1)
    } else {
      next[slot] = ch
    }
    input.channels = next
  }

  let cueGenMsg = $state('')
  /**
   * One cue track per performer, in EVERY song, spoken introduction per the
   * project's announcement setting. The heavy lifting is the pure
   * `applyProjectCueDefaults`, shared with the Cue tab — this button is the
   * bulk pass over the song files (the open song is patched in memory).
   */
  async function generateCuesForAll() {
    if (busy) return
    busy = true
    error = ''
    cueGenMsg = ''
    try {
      // Persist the roster + announcement mode first so the pass uses what is
      // on screen, not the last save. Inlined (not via `save()`): that
      // function is busy-guarded against re-entry and also closes the dialog.
      await setProjectPerformers(
        performers
          .map((p) => ({ ...p, name: p.name.trim(), role: p.role?.trim() || undefined }))
          .filter((p) => p.name.length > 0),
      )
      await setProjectDefaults({ preCountInCue })
      const r = await generateCueTracksForAllSongs()
      cueGenMsg =
        r.errors > 0
          ? `Cue tracks: ${r.updated} song(s) updated, ${r.skipped} already set, ${r.errors} error(s).`
          : `Cue tracks ready in ${r.updated} song(s); ${r.skipped} already set.`
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not generate cue tracks.'
    } finally {
      busy = false
    }
  }

  // ── Project health ────────────────────────────────────────────────────────
  let healthBusy = $state(false)
  let healthReport = $state<ProjectHealthReport | null>(null)
  let healthError = $state('')
  /**
   * Read-only sweep over every song file: does any song carry damage a load
   * would hide (data the app would silently drop, broken bar references, an
   * analysed song that derives no playback timing, cue tracks pointing at
   * removed performers)? Nothing is written — repair stays a deliberate act.
   */
  async function checkProjectHealth() {
    if (healthBusy) return
    healthBusy = true
    healthError = ''
    healthReport = null
    try {
      const snap = get(projectStore)
      const osPath = snap.osPath
      const data = snap.data
      if (!osPath || !data) {
        throw new Error('Checking song files needs the desktop app and an open local project.')
      }
      healthReport = await runProjectHealthCheck({
        songs: data.songs.map((s) => ({ folder: s.folder, hidden: s.hidden })),
        performers: data.performers ?? [],
        readSong: (folder) => readProjectSong(osPath, folder),
      })
    } catch (e) {
      healthError = e instanceof Error ? e.message : 'Could not check the project.'
    } finally {
      healthBusy = false
    }
  }

  async function applyCountInToAll() {
    if (busy) return
    busy = true
    error = ''
    applyMsg = ''
    try {
      // Persist the default first so "apply" writes the current value.
      await setProjectDefaults({ countInBeats: countInBeats > 0 ? countInBeats : 0, preCountInCue })
      const r = await applyDefaultsToAllSongs()
      applyMsg =
        r.errors > 0
          ? `Updated ${r.updated} song${r.updated === 1 ? '' : 's'} · ${r.errors} error(s)`
          : `Applied to ${r.updated} song${r.updated === 1 ? '' : 's'}.`
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not apply to all songs.'
    } finally {
      busy = false
    }
  }
</script>

<Dialog bind:open>
  <DialogContent class="max-w-lg">
    <DialogHeader>
      <DialogTitle>Project settings</DialogTitle>
    </DialogHeader>

    <div class="flex max-h-[75vh] flex-col gap-5 overflow-y-auto pt-1">
      <!-- ── Project config — the shared source of truth ─────────────────── -->
      <section class="flex flex-col gap-3">
        <h3 class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
          Project · shared with collaborators
        </h3>

        <label class="flex items-start gap-3">
          <input type="checkbox" bind:checked={enabled} class="accent-foreground mt-0.5 size-4" />
          <span class="flex flex-col">
            <span class="text-sm font-semibold">Use prepared stems</span>
            <span class="text-muted-foreground text-xs">
              The set of stems this project targets. Whether they're generated on
              <em>your</em> machine is a separate choice below.
            </span>
          </span>
        </label>

        <fieldset
          class="flex flex-col gap-2 pl-7 transition-opacity"
          class:opacity-40={!enabled}
          disabled={!enabled}
        >
          <legend class="text-muted-foreground mb-1 text-[11px] font-semibold uppercase tracking-wider">
            Stems
          </legend>
          <div class="grid grid-cols-2 gap-1.5">
            {#each AUTO_STEM_NAMES as name (name)}
              <label class="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" bind:checked={selected[name]} class="accent-foreground size-3.5" />
                {STEM_LABELS[name]}
              </label>
            {/each}
          </div>

          <legend class="text-muted-foreground mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wider">
            Quality
          </legend>
          <div class="flex flex-col gap-1.5">
            {#each QUALITY_OPTIONS as opt (opt.value)}
              <label class="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="auto-stem-quality"
                  value={opt.value}
                  checked={quality === opt.value}
                  onchange={() => (quality = opt.value)}
                  class="accent-foreground size-3.5"
                />
                <span class="font-medium">{opt.label}</span>
                <span class="text-muted-foreground text-xs">— {opt.hint}</span>
              </label>
            {/each}
          </div>
        </fieldset>

        <!-- Count-in default -->
        <div class="border-foreground/10 flex flex-col gap-1.5 border-t pt-3">
          <label class="flex flex-wrap items-center gap-2 text-sm">
            <span class="font-semibold">Count-in</span>
            <input
              type="number"
              min="0"
              max="16"
              bind:value={countInBeats}
              class="border-foreground/30 bg-background w-16 border-2 px-2 py-1 text-sm tabular-nums focus:border-foreground focus:outline-none"
            />
            <span class="text-muted-foreground text-xs">clicks before each song (0 = none)</span>
          </label>
          <div class="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-7 text-xs"
              onclick={applyCountInToAll}
              disabled={busy}
            >
              Apply to all songs
            </Button>
            {#if applyMsg}<span class="text-muted-foreground text-xs">{applyMsg}</span>{/if}
          </div>
          <span class="text-muted-foreground text-[11px]">
            Saving sets the default for new songs; “Apply to all” also writes it to every existing
            song. You can still override the count-in per song in the editor.
          </span>
        </div>

        <!-- Live default stems (project-wide) -->
        <div class="border-foreground/10 flex flex-col gap-1.5 border-t pt-3">
          <span class="text-sm font-semibold">What starts switched on</span>
          <span class="text-muted-foreground text-xs">
            The live buttons that are already on when a song starts. Every song opens the same way,
            whatever mix it was last edited with — you still change anything you like while
            performing. Link each mixer channel to a button in the mixer.
          </span>
          <div class="mt-1 grid grid-cols-2 gap-1.5">
            {#each LIVE_SLOT_NAMES as name (name)}
              <label class="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  bind:checked={liveSlotSelected[name]}
                  class="accent-foreground size-3.5"
                />
                {LIVE_SLOT_LABELS[name]}
              </label>
            {/each}
          </div>
          <span class="text-muted-foreground text-[11px]">
            A song with none of these buttons carrying anything falls back to its full mix, so it is
            never silent on stage.
          </span>
        </div>

        <!-- Song announcement (project-wide) -->
        <div class="border-foreground/10 flex flex-col gap-1.5 border-t pt-3">
          <span class="text-sm font-semibold">Song announcement</span>
          <span class="text-muted-foreground text-xs">
            A voice that says the song’s name. Applies to every song in the project — all or none.
            Each song announces its own title (override the words per song in the Cue section).
          </span>
          <div class="mt-1 flex flex-col gap-1.5">
            {#each [{ value: 'auto', label: 'Auto', hint: 'Speaks the name on play, before the count-in' }, { value: 'triggered', label: 'Triggered', hint: 'Speaks the name when you fire it from the controller' }, { value: 'off', label: 'Off', hint: 'No announcement' }] as opt (opt.value)}
              <label class="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="song-announcement"
                  value={opt.value}
                  checked={cueMode === opt.value}
                  onchange={() => (cueMode = opt.value as PreCountInCueMode)}
                  class="accent-foreground size-3.5"
                />
                <span class="font-medium">{opt.label}</span>
                <span class="text-muted-foreground text-xs">— {opt.hint}</span>
              </label>
            {/each}
          </div>
        </div>

        <!-- Performers -->
        <div class="border-foreground/10 flex flex-col gap-2 border-t pt-3">
          <div class="flex items-center justify-between">
            <span class="text-sm font-semibold">Performers</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-7 gap-1 text-xs"
              onclick={addPerformer}
            >
              <Plus class="size-3.5" aria-hidden="true" /> Add
            </Button>
          </div>
          <span class="text-muted-foreground text-xs">
            Who’s in the band. Give each person the monitor output their in-ear pack is plugged
            into, and they get their own mix of the song, the click and the cues.
          </span>
          <div class="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-7 text-xs"
              onclick={generateCuesForAll}
              disabled={busy || performers.filter((p) => p.name.trim()).length === 0}
              title="Create each performer's cue track in every song (section names, counts, and the spoken introduction if it's on). Safe to press again — songs already set up are left alone."
            >
              Generate cue tracks for all songs
            </Button>
            {#if cueGenMsg}<span class="text-muted-foreground text-xs">{cueGenMsg}</span>{/if}
          </div>
          {#if performers.length === 0}
            <span class="text-muted-foreground text-xs italic">No performers yet — add your band.</span>
          {/if}
          <div class="flex flex-col gap-1.5">
            {#each performers as p (p.id)}
              <div class="flex items-center gap-1.5">
                <input
                  type="text"
                  bind:value={p.name}
                  placeholder="Name"
                  maxlength="40"
                  class="border-foreground/30 bg-background min-w-0 flex-1 border-2 px-2 py-1 text-sm focus:border-foreground focus:outline-none"
                />
                <input
                  type="text"
                  bind:value={p.role}
                  placeholder="Role (e.g. Keyboards)"
                  maxlength="40"
                  class="border-foreground/30 bg-background min-w-0 flex-1 border-2 px-2 py-1 text-sm focus:border-foreground focus:outline-none"
                />
                <!--
                  MONITOR OUTPUT. This lives here, with the band roster, because
                  it is project configuration — who hears what — rather than a
                  property of the desk in front of you. The rig page stays about
                  hardware: connecting, levels, keeping click out of the house.

                  The number is the physical Aux Out socket the performer's pack
                  is plugged into, so it is worded that way rather than as "bus".
                -->
                <label class="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs font-bold">
                  Monitor
                  <select
                    class="border-foreground/30 bg-background rounded border-2 px-1 py-1 text-xs font-bold"
                    value={p.monitorBus ?? ''}
                    onchange={(e) => setMonitorBus(p.id, (e.currentTarget as HTMLSelectElement).value)}
                    title="Which Aux Out on the desk feeds this performer's in-ears"
                  >
                    <option value="">—</option>
                    {#each [1, 2, 3, 4, 5, 6] as b (b)}
                      <option value={b} disabled={monitorTaken(b, p.id)}>{b}</option>
                    {/each}
                  </select>
                </label>
                {#if $userStore}
                  <button
                    type="button"
                    onclick={() => toggleLinkToMe(p.id)}
                    title={p.userId === $userStore.id ? 'Linked to your account — click to unlink' : 'Link to your account'}
                    aria-pressed={p.userId === $userStore.id}
                    class="shrink-0 rounded border-2 p-1.5 transition-colors {p.userId === $userStore.id
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-foreground/30 text-muted-foreground hover:text-foreground'}"
                  >
                    <User class="size-4" aria-hidden="true" />
                  </button>
                {/if}
                <button
                  type="button"
                  onclick={() => removePerformer(p.id)}
                  title="Remove performer"
                  aria-label="Remove performer"
                  class="text-muted-foreground hover:text-destructive shrink-0 p-1.5"
                >
                  <Trash2 class="size-4" aria-hidden="true" />
                </button>
              </div>

              <!-- What this performer PLUGS INTO THE DESK: one row per mic/DI/
                   keyboard. One channel = mono, a second channel = stereo pair.
                   Channels carrying BarBro's own audio are never offered. -->
              <div class="flex flex-col gap-1 pb-1 pl-4">
                {#each p.inputs ?? [] as input (input.id)}
                  <div class="flex items-center gap-1.5">
                    <input
                      type="text"
                      bind:value={input.label}
                      placeholder="Instrument (e.g. Piano)"
                      maxlength="30"
                      class="border-foreground/20 bg-background w-40 min-w-0 border px-2 py-0.5 text-xs focus:border-foreground focus:outline-none"
                    />
                    <span class="text-muted-foreground text-[10px] font-bold uppercase">in</span>
                    <select
                      class="border-foreground/30 bg-background rounded border px-1 py-0.5 text-xs font-bold"
                      value={input.channels[0]}
                      onchange={(e) => setInputChannel(input, 0, (e.currentTarget as HTMLSelectElement).value)}
                      title="Desk input channel"
                    >
                      {#each [input.channels[0], ...inputChoicesFor(input.id).filter((c) => c !== input.channels[0])].filter((c): c is number => c !== undefined) as ch (ch)}
                        <option value={ch}>{ch}</option>
                      {/each}
                    </select>
                    <select
                      class="border-foreground/30 bg-background rounded border px-1 py-0.5 text-xs font-bold"
                      value={input.channels[1] ?? ''}
                      onchange={(e) => setInputChannel(input, 1, (e.currentTarget as HTMLSelectElement).value)}
                      title="Second channel = stereo pair. — = mono."
                    >
                      <option value="">mono</option>
                      {#each inputChoicesFor(input.id).filter((c) => c !== input.channels[0]) as ch (ch)}
                        <option value={ch}>+{ch}</option>
                      {/each}
                      {#if input.channels[1] !== undefined}
                        <option value={input.channels[1]}>+{input.channels[1]}</option>
                      {/if}
                    </select>
                    <button
                      type="button"
                      onclick={() => removePerformerInput(p, input.id)}
                      title="Remove this input"
                      class="text-muted-foreground hover:text-destructive p-1"
                    >
                      <Trash2 class="size-3" aria-hidden="true" />
                    </button>
                  </div>
                {/each}
                <button
                  type="button"
                  onclick={() => addPerformerInput(p)}
                  class="text-muted-foreground hover:text-foreground self-start text-[11px] font-bold"
                  title="Add a mic, DI or keyboard this performer plugs into the desk"
                >
                  + desk input
                </button>
              </div>

            {/each}
          </div>
        </div>

        <!-- Project sound (mastering) -->
        <div class="border-foreground/10 flex flex-col gap-2 border-t pt-3">
          <label class="flex items-start gap-3">
            <input type="checkbox" bind:checked={soundEnabled} class="accent-foreground mt-0.5 size-4" />
            <span class="flex flex-col">
              <span class="text-sm font-semibold">Project sound</span>
              <span class="text-muted-foreground text-xs">
                Keep drums, bass and the rest sitting at the same level in every song — applied in
                the mixer and to exported mixes.
              </span>
            </span>
          </label>

          <fieldset
            class="flex flex-col gap-2 pl-7 transition-opacity"
            class:opacity-40={!soundEnabled}
            disabled={!soundEnabled}
          >
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={soundMatchLoudness} class="accent-foreground size-3.5" />
              <span class="font-medium">Match loudness across songs</span>
            </label>

            <div class="mt-1 flex flex-col gap-2">
              {#each AUTO_STEM_NAMES as name (name)}
                <div class="border-foreground/15 flex flex-col gap-1.5 border p-2">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-semibold">{STEM_LABELS[name]}</span>
                    <label class="flex cursor-pointer items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        bind:checked={soundStems[name].tone}
                        class="accent-foreground size-3.5"
                      />
                      <span class="font-medium">{TONE_LABELS[name]}</span>
                    </label>
                  </div>
                  <label class="flex items-center gap-2">
                    <span class="text-muted-foreground w-10 text-[10px] font-bold uppercase tracking-wider">Level</span>
                    <input
                      type="range"
                      min="-9"
                      max="9"
                      step="1"
                      bind:value={soundStems[name].trimDb}
                      class="accent-foreground h-1 min-w-0 flex-1"
                      aria-label={`${STEM_LABELS[name]} level`}
                    />
                    <span class="w-14 text-right font-mono text-xs tabular-nums">
                      {soundStems[name].trimDb > 0 ? '+' : ''}{soundStems[name].trimDb} dB
                    </span>
                  </label>
                  <div class="flex items-center gap-2">
                    <span class="text-muted-foreground w-10 text-[10px] font-bold uppercase tracking-wider">Even</span>
                    <div class="flex gap-1" role="radiogroup" aria-label={`Even out ${STEM_LABELS[name]}`}>
                      {#each [{ v: 'off', l: 'Off' }, { v: 'light', l: 'Light' }, { v: 'firm', l: 'Firm' }] as opt (opt.v)}
                        <button
                          type="button"
                          class="border-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider {soundStems[name].intensity === opt.v
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-foreground/30 hover:border-foreground'}"
                          onclick={() => (soundStems[name].intensity = opt.v as MasteringIntensity)}
                          aria-pressed={soundStems[name].intensity === opt.v}
                        >
                          {opt.l}
                        </button>
                      {/each}
                    </div>
                  </div>
                  {#if name === 'drums'}
                    <!-- Kick punch is drums-only: it works on the sub-110 Hz
                         band, which in a drums stem is the kick and nothing
                         else. Snare, hats and cymbals are untouched. -->
                    <label class="flex items-center gap-2">
                      <span class="text-muted-foreground w-10 text-[10px] font-bold uppercase tracking-wider">Kick</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        bind:value={soundKickPunch}
                        class="accent-foreground h-1 min-w-0 flex-1"
                        aria-label="Kick punch"
                      />
                      <span class="w-14 text-right font-mono text-xs tabular-nums">
                        {soundKickPunch === 0 ? 'Off' : `${Math.round(soundKickPunch * 100)}%`}
                      </span>
                    </label>
                  {/if}
                </div>
              {/each}
            </div>
            <span class="text-muted-foreground text-[11px]">
              Level raises or lowers just that stem in every song. “Even” smooths its dynamics so
              e.g. every bass note lands with similar weight. The named toggle shapes the tone —
              rich low end for bass, punch and clarity for drums. “Kick” makes the kick drum hit
              harder without touching the snare, hats or cymbals.
            </span>

            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={soundMasterGlue} class="accent-foreground size-3.5" />
              <span class="font-medium">Glue &amp; protect the master</span>
              <span class="text-muted-foreground text-xs">— gentle bus compression + limiter</span>
            </label>
          </fieldset>
        </div>
      </section>

      <!-- ── This computer — per-machine, never shared ───────────────────── -->
      <section class="border-foreground/10 flex flex-col gap-2 border-t pt-4">
        <h3 class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
          This computer
        </h3>
        <label class="flex items-start gap-3">
          <input
            type="checkbox"
            bind:checked={localPrepare}
            class="accent-foreground mt-0.5 size-4"
            disabled={!$desktopCompanionStatus.reachable}
          />
          <span class="flex flex-col">
            <span class="text-sm font-semibold">Prepare stems automatically on this computer</span>
            <span class="text-muted-foreground text-xs">
              Only affects this machine. Leave it off if you'd rather wait for a shared audio
              package than have your computer run stem-splitting — it never changes the project or
              anyone else's machine.
            </span>
          </span>
        </label>
        {#if !$desktopCompanionStatus.reachable}
          <p class="text-muted-foreground pl-7 text-[11px]">BarBro Desktop must be running for this.</p>
        {/if}
      </section>

      <section class="border-foreground/10 flex flex-col gap-2 border-t pt-4">
        <h3 class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
          Export
        </h3>
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold">Setlist · Ableton Live 12</p>
            <p class="text-muted-foreground text-xs">
              One .als with a scene per song. Click track is re-rendered fresh on every export.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="shrink-0 gap-1"
            disabled={!canExportSetlist}
            onclick={requestSetlistExport}
            title={songCount === 0
              ? 'Add at least one song before exporting.'
              : !$desktopCompanionStatus.reachable
                ? 'Setlist export needs the BarBro desktop client running.'
                : 'Open the export dialog'}
          >
            <Music4 class="size-3.5" aria-hidden="true" />
            Export .als
          </Button>
        </div>
      </section>

      <section class="border-foreground/10 flex flex-col gap-2 border-t pt-4">
        <h3 class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">Lyrics</h3>
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold">Reanalyse all lyrics</p>
            <p class="text-muted-foreground text-xs">
              Re-fit every song’s imported lyrics to its audio with the current voice model. Only the
              timing is recomputed — your words stay exactly as you pasted them.{reanalyseMsg ? ` · ${reanalyseMsg}` : ''}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="shrink-0 gap-1"
            disabled={!reanalyseBusy && (!$desktopCompanionStatus.reachable || !$projectStore.osPath)}
            onclick={() => onReanalyseLyrics?.()}
            title={!$projectStore.osPath
              ? 'Open this project from disk (Studio) to reanalyse lyrics.'
              : !$desktopCompanionStatus.reachable
                ? 'Reanalysing lyrics needs the BarBro desktop client running.'
                : 'Re-fit every song’s imported lyrics.'}
          >
            <Mic class="size-3.5 {reanalyseBusy ? 'animate-pulse' : ''}" aria-hidden="true" />
            {reanalyseBusy ? 'Stop' : 'Reanalyse'}
          </Button>
        </div>
      </section>

      <section class="border-foreground/10 flex flex-col gap-2 border-t pt-4">
        <h3 class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
          Project health
        </h3>
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold">Check every song</p>
            <p class="text-muted-foreground text-xs">
              Reads every song file and reports anything broken — data that would be lost on load,
              bars out of order, songs that can’t derive playback timing, cue tracks pointing at
              removed performers. Changes nothing.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="shrink-0 gap-1"
            disabled={healthBusy || !$projectStore.osPath || !$desktopCompanionStatus.reachable}
            onclick={checkProjectHealth}
            title={!$projectStore.osPath
              ? 'Open this project from disk (Studio) to check its files.'
              : !$desktopCompanionStatus.reachable
                ? 'Checking song files needs the BarBro desktop client running.'
                : 'Read every song file and report problems.'}
          >
            {healthBusy ? 'Checking…' : 'Check health'}
          </Button>
        </div>
        {#if healthError}
          <p class="text-destructive text-xs">{healthError}</p>
        {/if}
        {#if healthReport}
          {#if healthReport.songs.length === 0 && healthReport.unreadableFolders.length === 0}
            <p class="text-xs text-emerald-600">
              All {healthReport.checkedSongs} songs are healthy.
            </p>
          {:else}
            <p class="text-xs font-semibold">
              {healthReport.healthySongs} of {healthReport.checkedSongs} songs healthy.
            </p>
            <ul class="flex flex-col gap-1.5">
              {#each healthReport.songs as s (s.folder)}
                <li class="text-xs">
                  <span class="font-semibold">{s.title}</span>
                  <ul class="text-muted-foreground mt-0.5 flex flex-col gap-0.5 pl-3">
                    {#each s.findings as f, i (i)}
                      <li class={f.severity === 'broken' ? 'text-destructive' : ''}>{f.message}</li>
                    {/each}
                  </ul>
                </li>
              {/each}
              {#each healthReport.unreadableFolders as folder (folder)}
                <li class="text-destructive text-xs">{folder}: the file could not be read.</li>
              {/each}
            </ul>
          {/if}
        {/if}
      </section>

      {#if noStemsButEnabled}
        <p class="text-amber-600 text-xs">Pick at least one stem, or turn “Use prepared stems” off.</p>
      {/if}
      {#if error}
        <p class="text-destructive text-xs">{error}</p>
      {/if}

      <div class="flex justify-end gap-2">
        <Button type="button" class="" variant="ghost" onclick={() => (open = false)} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" class="" onclick={save} disabled={busy || noStemsButEnabled}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
