<script lang="ts">
  import { get } from 'svelte/store'
  import EditSectionToolbar from '$lib/components/EditSectionToolbar.svelte'
  import CueTimeline from '$lib/components/CueTimeline.svelte'
  import PerformerMixPanel from '$lib/components/editor/PerformerMixPanel.svelte'
  import {
    announcementOverrideText,
    withAnnouncementOverride,
    withSpokenCountIn,
  } from '$lib/songmap/cueTracks'
  import { effectiveCountInBeats } from '$lib/songmap/countIn'
  import { project as cueProjectStore } from '$lib/stores/project'
  import { sectionKindColor } from '$lib/songmap/sectionColors'
  import { patchSongMap, songMap } from '$lib/stores/songMap'
  import { project as projectStore } from '$lib/stores/project'
  import { resolveCueEventOriginalTimeSec } from '$lib/audio/cueTrackSpeechSchedule'
  import {
    buildSectionCueEvents,
    createDefaultCueTrack,
    generateCueTrackFromSections,
    generatedSectionKey,
    getPrimaryCueTrack,
  } from '$lib/songmap/cueTracks'
  import { newId } from '$lib/songmap/factory'
  import { sortBeatsByTime } from '$lib/songmap/normalize'
  import { cueRender } from '$lib/audio/cueRender.svelte'
  import type { CueEvent, CueTrack } from '$lib/songmap/types'

  // Local error sink for patch failures. It was only ever surfaced on the
  // grid/sections/chords tabs (never rendered on the Cue tab), so keeping it
  // component-local preserves behavior — the cue ops still capture failures,
  // they just remain invisible here exactly as before.
  let beatEditError = $state('')

  let selectedCueTrackId = $state<string | null>(null)

  let cueTracks = $derived($songMap?.cueTracks ?? [])
  let selectedCueTrack = $derived.by<CueTrack | null>(() => {
    const sm = $songMap
    if (!sm) return null
    return sm.cueTracks.find((track) => track.id === selectedCueTrackId) ?? getPrimaryCueTrack(sm) ?? null
  })
  // ── The spoken parts of the selected track ───────────────────────────────
  //
  // The announcement's SWITCH lives in Project Settings (derived everywhere);
  // here a person authors only the WORDS ("Winehouse" instead of the full
  // title) and the spoken count-in. Both write through the pure helpers so the
  // Auto-generate pass and the bulk pass can never disagree with this field.
  const announcementOn = $derived(
    ($cueProjectStore.data?.defaults?.preCountInCue?.mode ?? 'off') !== 'off',
  )
  const overrideText = $derived(selectedCueTrack ? (announcementOverrideText(selectedCueTrack) ?? '') : '')
  const songCountInBeats = $derived($songMap ? effectiveCountInBeats($songMap) : 0)

  function patchSelectedTrack(fn: (t: CueTrack) => CueTrack): void {
    const id = selectedCueTrack?.id
    if (!id) return
    patchSongMap((m) => ({
      ...m,
      cueTracks: m.cueTracks.map((t) => (t.id === id ? fn(t) : t)),
    }))
  }

  function setAnnouncementOverride(text: string): void {
    patchSelectedTrack((t) => withAnnouncementOverride(t, text))
  }

  function setSpokenCountIn(on: boolean): void {
    patchSelectedTrack((t) => withSpokenCountIn(t, on))
  }

  let selectedCueEvents = $derived.by(() => {
    const track = selectedCueTrack
    if (!track) return [] as CueEvent[]
    return [...track.events].sort((a, b) => {
      const sm = $songMap
      if (!sm) return 0
      const ta = resolveCueEventOriginalTimeSec(sm, a) ?? 0
      const tb = resolveCueEventOriginalTimeSec(sm, b) ?? 0
      return ta - tb || a.id.localeCompare(b.id)
    })
  })

  $effect(() => {
    const sm = $songMap
    if (!sm) {
      selectedCueTrackId = null
      return
    }
    if (selectedCueTrackId && sm.cueTracks.some((track) => track.id === selectedCueTrackId)) return
    selectedCueTrackId = sm.cueTracks[0]?.id ?? null
  })

  // ── Performer-linked cue tracks (one cue track per project performer) ──────
  const projectPerformers = $derived($projectStore.data?.performers ?? [])

  /** One entry per performer, in roster order — or null when there's no roster
   *  (then the legacy ad-hoc "Voice" tracks are used instead). */
  const cuePerformerView = $derived.by(() => {
    const perfs = projectPerformers
    if (perfs.length === 0) return null
    const tracks = $songMap?.cueTracks ?? []
    return perfs.map((p) => ({
      performerId: p.id,
      name: p.name,
      role: p.role,
      track: tracks.find((t) => t.performerId === p.id) ?? null,
    }))
  })

  /** Ensure every performer has a cue track. Claims a legacy unlinked track for
   *  the first performer (existing cues carry over), then creates the rest. */
  function ensurePerformerCueTracks() {
    const perfs = get(projectStore).data?.performers ?? []
    const sm = get(songMap)
    if (!sm || perfs.length === 0) return
    const tracks = sm.cueTracks.map((t) => ({ ...t }))
    let changed = false
    for (const p of perfs) {
      if (tracks.some((t) => t.performerId === p.id)) continue
      const unlinked = tracks.findIndex((t) => !t.performerId)
      if (unlinked >= 0) {
        tracks[unlinked] = { ...tracks[unlinked]!, performerId: p.id, name: p.name }
      } else {
        tracks.push({ ...createDefaultCueTrack({ id: newId(), name: p.name }), performerId: p.id })
      }
      changed = true
    }
    if (changed) patchSongMap((m) => ({ ...m, cueTracks: tracks }))
  }

  // Materialize the per-performer cue tracks while the Cue editor is open. This
  // panel mounts only when the Cue tab is active, so the old `editMode === 'cue'`
  // gate is implicit; kept as an `$effect` (not `onMount`) so adding a performer
  // while the tab is open still materializes its track.
  $effect(() => {
    void projectPerformers
    void $songMap
    ensurePerformerCueTracks()
  })

  function selectPerformerCue(performerId: string) {
    ensurePerformerCueTracks()
    const t = get(songMap)?.cueTracks.find((x) => x.performerId === performerId)
    if (t) selectedCueTrackId = t.id
  }

  function cueEventLabel(event: CueEvent): string {
    if (event.kind === 'custom-text') return 'Custom'
    if (event.kind === 'recorded-audio-placeholder') return 'Recorded'
    return event.kind.charAt(0).toUpperCase() + event.kind.slice(1)
  }

  function addCueTrack() {
    const id = newId()
    const p = patchSongMap((m) => ({
      ...m,
      cueTracks: [
        ...m.cueTracks,
        createDefaultCueTrack({ id, name: `Cue track ${m.cueTracks.length + 1}` }),
      ],
    }))
    if (!p.ok) beatEditError = p.errors.join('; ')
    else {
      beatEditError = ''
      selectedCueTrackId = id
    }
  }

  function renameSelectedCueTrack(name: string) {
    const track = selectedCueTrack
    const trimmed = name.trim()
    if (!track || !trimmed) return
    const p = patchSongMap((m) => ({
      ...m,
      cueTracks: m.cueTracks.map((t) => (t.id === track.id ? { ...t, name: trimmed } : t)),
    }))
    if (!p.ok) beatEditError = p.errors.join('; ')
    else beatEditError = ''
  }

  function deleteSelectedCueTrack() {
    const track = selectedCueTrack
    if (!track) return
    const ok = confirm(`Delete cue track "${track.name}"?`)
    if (!ok) return
    const p = patchSongMap((m) => ({ ...m, cueTracks: m.cueTracks.filter((t) => t.id !== track.id) }))
    if (!p.ok) beatEditError = p.errors.join('; ')
    else {
      beatEditError = ''
      selectedCueTrackId = null
    }
  }

  function generateSelectedCueTrackFromSections() {
    const track = selectedCueTrack
    if (!track) {
      addCueTrack()
      return
    }
    const p = patchSongMap((m) => ({
      ...m,
      cueTracks: m.cueTracks.map((t) => (t.id === track.id ? generateCueTrackFromSections(m, t) : t)),
    }))
    if (!p.ok) beatEditError = p.errors.join('; ')
    else beatEditError = ''
  }

  // ── Visual cue timeline ────────────────────────────────────────────────────
  let selectedCueEventId = $state<string | null>(null)

  /** Per-section state: colour + whether its speech/count cues are on. */
  const cueSectionRegions = $derived.by(() => {
    const sm = $songMap
    const dur = sm?.audio?.durationSec ?? 0
    const track = selectedCueTrack
    if (!sm?.sections?.length || !sm.timeline.bars.length || !(dur > 0)) return []
    const barByIndex = new Map(sm.timeline.bars.map((b) => [b.index, b]))
    const events = track?.events ?? []
    return sm.sections
      .map((s) => {
        const sb = barByIndex.get(s.barRange.startBarIndex)
        const eb = barByIndex.get(s.barRange.endBarIndex)
        if (!sb || !eb) return null
        const speechEvent = events.find((e) => e.kind === 'section' && e.generatedSource?.sectionId === s.id)
        const speechOn = !!speechEvent?.enabled
        const countOn = events.some((e) => e.kind === 'count' && e.generatedSource?.sectionId === s.id && e.enabled)
        return {
          id: s.id,
          label: s.label,
          startSec: sb.startSec,
          endSec: eb.endSec,
          color: sectionKindColor(s.kind),
          speechOn,
          countOn,
          speechText: speechEvent?.text ?? s.label,
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
  })

  /** Only the one-off custom/intro cues become free bubbles (section + count
   *  cues are represented by the per-section toggles). */
  const cueTimelineCues = $derived.by(() => {
    const sm = $songMap
    const dur = sm?.audio?.durationSec ?? 0
    if (!sm || !(dur > 0)) return []
    return selectedCueEvents
      .filter((ev) => ev.kind !== 'section' && ev.kind !== 'count')
      .map((ev) => {
        const t = resolveCueEventOriginalTimeSec(sm, ev) ?? 0
        const sec = cueSectionRegions.find((r) => t >= r.startSec - 1e-6 && t < r.endSec + 1e-6)
        return { id: ev.id, text: ev.text || cueEventLabel(ev), timeSec: t, color: sec?.color ?? '#71717a', enabled: ev.enabled }
      })
  })

  /** Toggle the spoken section-name cue for one section. */
  function toggleSectionSpeech(sectionId: string) {
    const track = selectedCueTrack
    const sm = get(songMap)
    const section = sm?.sections.find((s) => s.id === sectionId)
    if (!track || !sm || !section) return
    const key = generatedSectionKey(section)
    const on = track.events.some((e) => e.kind === 'section' && e.generatedSource?.sectionId === sectionId && e.enabled)
    const p = patchSongMap((m) => ({
      ...m,
      cueTracks: m.cueTracks.map((t) => {
        if (t.id !== track.id) return t
        const events = t.events.filter((e) => e.generatedKey !== key)
        if (on) {
          return { ...t, events, suppressedGeneratedKeys: [...new Set([...t.suppressedGeneratedKeys, key])] }
        }
        const built = buildSectionCueEvents(m, section)
        return {
          ...t,
          events: built.speech ? [...events, built.speech] : events,
          suppressedGeneratedKeys: t.suppressedGeneratedKeys.filter((k) => k !== key),
        }
      }),
    }))
    if (!p.ok) beatEditError = p.errors.join('; ')
  }

  /** Set the spoken-cue text for a section (updates its speech event). */
  function setSectionSpeechText(sectionId: string, text: string) {
    const track = selectedCueTrack
    const sm = get(songMap)
    const section = sm?.sections.find((s) => s.id === sectionId)
    if (!track || !sm || !section) return
    const key = generatedSectionKey(section)
    const ev = track.events.find((e) => e.generatedKey === key)
    if (ev) updateCueEvent(track.id, ev.id, { text })
  }

  /** Rename the current cue track (prompted). */
  function promptRenameCueTrack(trackId: string) {
    selectedCueTrackId = trackId
    const track = get(songMap)?.cueTracks.find((t) => t.id === trackId)
    const name = prompt('Voice track name', track?.name ?? '')?.trim()
    if (name) renameSelectedCueTrack(name)
  }

  /** Toggle the count-in for one section (all its count events at once). */
  function toggleSectionCount(sectionId: string) {
    const track = selectedCueTrack
    const sm = get(songMap)
    const section = sm?.sections.find((s) => s.id === sectionId)
    if (!track || !sm || !section) return
    const countKeys = new Set(buildSectionCueEvents(sm, section).count.map((e) => e.generatedKey!))
    const on = track.events.some((e) => e.kind === 'count' && e.generatedSource?.sectionId === sectionId && e.enabled)
    const p = patchSongMap((m) => ({
      ...m,
      cueTracks: m.cueTracks.map((t) => {
        if (t.id !== track.id) return t
        const events = t.events.filter((e) => !(e.generatedKey && countKeys.has(e.generatedKey)))
        if (on) {
          return {
            ...t,
            events,
            suppressedGeneratedKeys: [...new Set([...t.suppressedGeneratedKeys, ...countKeys])],
          }
        }
        const built = buildSectionCueEvents(m, section)
        return {
          ...t,
          events: [...events, ...built.count],
          suppressedGeneratedKeys: t.suppressedGeneratedKeys.filter((k) => !countKeys.has(k)),
        }
      }),
    }))
    if (!p.ok) beatEditError = p.errors.join('; ')
  }

  const cueTimelineDuration = $derived($songMap?.audio?.durationSec ?? 0)

  /** Insert a custom spoken cue at a clicked time on the timeline. */
  function insertCueAtSec(sec: number) {
    const track = selectedCueTrack
    const sm = get(songMap)
    if (!track || !sm) {
      if (!track) addCueTrack()
      return
    }
    // Anchor to the nearest beat so the cue stays on the grid through edits.
    const beats = sortBeatsByTime(sm.timeline.beats)
    let nearest = beats[0]
    let best = Infinity
    for (const b of beats) {
      const d = Math.abs(b.timeSec - sec)
      if (d < best) {
        best = d
        nearest = b
      }
    }
    const anchor = nearest
      ? { kind: 'beat' as const, beatId: nearest.id }
      : { kind: 'time' as const, timeSec: sec }
    const event: CueEvent = { id: newId(), kind: 'custom-text', enabled: true, anchor, text: '', source: 'custom' }
    const p = patchSongMap((m) => ({
      ...m,
      cueTracks: m.cueTracks.map((t) => (t.id === track.id ? { ...t, events: [...t.events, event] } : t)),
    }))
    if (p.ok) selectedCueEventId = event.id
    else beatEditError = p.errors.join('; ')
  }

  function updateCueEvent(trackId: string, eventId: string, patch: Partial<CueEvent>) {
    const p = patchSongMap((m) => ({
      ...m,
      cueTracks: m.cueTracks.map((track) =>
        track.id === trackId
          ? {
              ...track,
              events: track.events.map((event) =>
                event.id === eventId
                  ? {
                      ...event,
                      ...patch,
                      edited: event.source === 'generated' ? true : (patch.edited ?? event.edited),
                    }
                  : event,
              ),
            }
          : track,
      ),
    }))
    if (!p.ok) beatEditError = p.errors.join('; ')
    else beatEditError = ''
  }
</script>

<section class="flex min-h-0 w-full flex-1 flex-col" aria-label="Cue editor">
  <EditSectionToolbar
    title="Cue"
    helpText="Per section, toggle a spoken cue and/or a count-in — click a section to edit its voice line. Switch voice tracks with the pills; Auto-generate reads each section name just before it starts."
  />
  <!-- Pills stay pinned; the cue timeline fills the remaining height and only
       scrolls internally if the content genuinely overflows. -->
  <div class="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
    <!-- Voice / performer track pills -->
    <div class="flex shrink-0 flex-wrap items-center gap-1.5">
      {#if cuePerformerView}
        <span class="text-muted-foreground mr-1 text-[11px] font-bold uppercase tracking-wide">Performer</span>
        {#each cuePerformerView as pv (pv.performerId)}
          <button
            type="button"
            class="rounded-full border-2 px-3 py-1 text-xs font-bold transition-colors {pv.track &&
            pv.track.id === selectedCueTrack?.id
              ? 'border-foreground bg-foreground text-background'
              : 'border-foreground/40 hover:border-foreground'}"
            onclick={() => selectPerformerCue(pv.performerId)}
            title={pv.role ? `${pv.name} · ${pv.role}` : pv.name}
          >
            {pv.name}{pv.role ? ` · ${pv.role}` : ''}
          </button>
        {/each}
        <span class="text-muted-foreground text-[11px]">— manage the band in Project settings</span>
      {:else}
        <span class="text-muted-foreground mr-1 text-[11px] font-bold uppercase tracking-wide">Voice</span>
        {#each cueTracks as track (track.id)}
          <button
            type="button"
            class="rounded-full border-2 px-3 py-1 text-xs font-bold transition-colors {track.id === selectedCueTrack?.id
              ? 'border-foreground bg-foreground text-background'
              : 'border-foreground/40 hover:border-foreground'}"
            onclick={() => (selectedCueTrackId = track.id)}
            ondblclick={() => promptRenameCueTrack(track.id)}
            title="Click to select · double-click to rename"
          >
            {track.name}{track.enabled ? '' : ' (off)'}
          </button>
        {/each}
        <button
          type="button"
          class="border-foreground/40 hover:border-foreground rounded-full border-2 px-2.5 py-1 text-xs font-black"
          onclick={addCueTrack}
          title="Add a voice track"
        >
          ＋
        </button>
        {#if selectedCueTrack}
          <button
            type="button"
            class="border-foreground/40 hover:border-destructive hover:text-destructive rounded-full border-2 px-2.5 py-1 text-xs font-bold"
            onclick={deleteSelectedCueTrack}
            title="Delete this voice track"
          >
            🗑
          </button>
        {/if}
      {/if}
      {#if selectedCueTrack}
        <button
          type="button"
          class="border-foreground rounded-full border-2 px-3 py-1 text-xs font-bold hover:bg-foreground hover:text-background"
          onclick={generateSelectedCueTrackFromSections}
          title="Read each section name just before it starts"
        >
          ✨ Auto-generate
        </button>
      {/if}
      {#if cueRender.cueRenderStatus}
        <span
          class="ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold {cueRender.cueRenderStatus.kind ===
          'ready'
            ? 'text-green-600'
            : cueRender.cueRenderStatus.kind === 'warn'
              ? 'text-amber-600'
              : 'text-muted-foreground'}"
          role="status"
          aria-live="polite"
        >
          {#if cueRender.cueRenderStatus.kind === 'busy'}
            <span class="border-foreground/30 border-t-foreground size-3 animate-spin rounded-full border-2"></span>
          {:else if cueRender.cueRenderStatus.kind === 'ready'}
            ✓
          {:else}
            ⚠
          {/if}
          {cueRender.cueRenderStatus.text}
        </span>
      {/if}
    </div>

    {#if selectedCueTrack}
      <div class="border-foreground/15 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius)] border p-2">
        <label class="flex min-w-0 flex-1 items-center gap-2 text-xs" title={announcementOn
            ? 'What the announcement says for this song. Leave empty to speak the song title (and keep following renames).'
            : 'Announcements are switched off for this project (Project settings → Song announcement). The words are kept for when it is switched on.'}>
          <span class="shrink-0 font-semibold">Announced as</span>
          <input
            type="text"
            value={overrideText}
            placeholder={$songMap?.metadata.title?.trim() || 'Song title'}
            onchange={(e) => setAnnouncementOverride(e.currentTarget.value)}
            class="border-foreground/30 bg-background min-w-0 flex-1 border-2 px-2 py-1 text-xs focus:border-foreground focus:outline-none {announcementOn
              ? ''
              : 'opacity-60'}"
          />
        </label>
        {#if !announcementOn}
          <span class="text-muted-foreground text-[10px]">announcements off in Project settings</span>
        {/if}
        <label
          class="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs {songCountInBeats > 0
            ? ''
            : 'opacity-50'}"
          title={songCountInBeats > 0
            ? `Speak the count-in: “${$songMap?.metadata.title?.trim() || 'Song'} … ${songCountInBeats}” then the numbers on the beats.`
            : 'This song has no count-in — set one in the Grid tab first.'}
        >
          <input
            type="checkbox"
            checked={!!selectedCueTrack.spokenCountIn}
            disabled={songCountInBeats === 0}
            onchange={(e) => setSpokenCountIn(e.currentTarget.checked)}
            class="accent-foreground size-3.5"
          />
          <span class="font-semibold">Speak the count-in</span>
        </label>
      </div>
    {/if}

    <CueTimeline
      sections={cueSectionRegions}
      customCues={cueTimelineCues}
      duration={cueTimelineDuration}
      onToggleSpeech={toggleSectionSpeech}
      onToggleCount={toggleSectionCount}
      onSetSpeechText={setSectionSpeechText}
      onInsertAtSec={insertCueAtSec}
    />

    {#if selectedCueTrack}
      <PerformerMixPanel track={selectedCueTrack} />
    {/if}
  </div>
</section>
