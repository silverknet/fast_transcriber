<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { FileAudio, Pause, Play, RotateCcw, Volume2 } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import { audioDevice, resumeAudioDevice } from '$lib/audio/audioDevice'
  import {
    CLICK_SOUND_OPTIONS,
    createClickSoundResources,
    PROJECT_CLICK_SOUND,
    scheduleClickSound,
    type ClickSoundId,
    type ClickSoundResources,
  } from '$lib/audio/clickSounds'
  import { readProjectSong, readProjectSongAsset } from '$lib/client/desktopProjectFs'
  import { decodeSmapBytes } from '$lib/songmap/smapFile'
  import { audioSession } from '$lib/stores/audioSession'
  import { project as projectStore } from '$lib/stores/project'

  type BeatPoint = { timeSec: number; downbeat: boolean }
  type SongOption = { id: string; folder: string; title: string; bpm?: number }
  type AuditionSoundId = ClickSoundId | 'custom-sample'

  let audioElement: HTMLAudioElement
  let fileInput: HTMLInputElement
  let customRegularInput: HTMLInputElement
  let customAccentInput: HTMLInputElement
  let ctx: AudioContext | null = null
  let musicSource: MediaElementAudioSourceNode | null = null
  let musicGain: GainNode | null = null
  let clickGain: GainNode | null = null
  let resources: ClickSoundResources | null = null
  let objectUrl: string | null = null
  let schedulerId: ReturnType<typeof setInterval> | null = null
  let projectUnsubscribe: (() => void) | null = null
  let loadingToken = 0
  let nextBeatIndex = 0
  let syntheticBeatIndex = 0

  let selectedSound = $state<AuditionSoundId>(PROJECT_CLICK_SOUND)
  let customRegularBuffer = $state<AudioBuffer | null>(null)
  let customAccentBuffer = $state<AudioBuffer | null>(null)
  let customRegularName = $state('')
  let customAccentName = $state('')
  let projectSongs = $state<SongOption[]>([])
  let selectedSongId = $state('')
  let sourceLabel = $state('No music loaded')
  let sourceDetail = $state('Choose a project song or an audio file.')
  let loading = $state(false)
  let error = $state('')
  let playing = $state(false)
  let durationSec = $state(0)
  let positionSec = $state(0)
  let bpm = $state(120)
  let beatsPerBar = $state(4)
  let gridOffsetSec = $state(0)
  let beatPoints = $state<BeatPoint[]>([])
  let musicVolume = $state(0.72)
  let clickVolume = $state(0.75)
  let clickEnabled = $state(true)
  let accentEnabled = $state(true)

  const hasAnalyzedGrid = $derived(beatPoints.length > 0)
  const selectedSoundName = $derived(
    selectedSound === 'custom-sample'
      ? 'Logic / custom'
      : (CLICK_SOUND_OPTIONS.find((option) => option.id === selectedSound)?.name ?? CLICK_SOUND_OPTIONS[0].name),
  )

  function formatTime(value: number): string {
    if (!Number.isFinite(value) || value < 0) return '0:00'
    const whole = Math.floor(value)
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
  }

  function estimateBpm(points: BeatPoint[]): number | null {
    const gaps = points
      .slice(1, 25)
      .map((point, index) => point.timeSec - points[index]!.timeSec)
      .filter((gap) => gap > 0.2 && gap < 2)
      .sort((a, b) => a - b)
    if (gaps.length === 0) return null
    return Math.round(60 / gaps[Math.floor(gaps.length / 2)]!)
  }

  function revokeAudioUrl(): void {
    if (!objectUrl) return
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }

  function stopScheduler(): void {
    if (schedulerId !== null) clearInterval(schedulerId)
    schedulerId = null
  }

  function firstBeatAtOrAfter(timeSec: number): number {
    let low = 0
    let high = beatPoints.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (beatPoints[middle]!.timeSec < timeSec - 0.015) low = middle + 1
      else high = middle
    }
    return low
  }

  function resetBeatCursor(): void {
    const time = audioElement?.currentTime ?? positionSec
    nextBeatIndex = firstBeatAtOrAfter(time)
    const beatDuration = 60 / Math.max(30, bpm)
    syntheticBeatIndex = Math.max(0, Math.ceil((time - gridOffsetSec - 0.015) / beatDuration))
  }

  function scheduleAhead(): void {
    if (!ctx || !resources || !clickGain || !audioElement || audioElement.paused) return
    positionSec = audioElement.currentTime
    if (!clickEnabled) return

    const nowInSong = audioElement.currentTime
    const horizon = nowInSong + 0.12
    if (hasAnalyzedGrid) {
      while (nextBeatIndex < beatPoints.length && beatPoints[nextBeatIndex]!.timeSec <= horizon) {
        const point = beatPoints[nextBeatIndex]!
        if (point.timeSec >= nowInSong - 0.025) {
          scheduleSelectedClick(
            selectedSound,
            ctx.currentTime + Math.max(0.004, point.timeSec - nowInSong),
            accentEnabled && point.downbeat,
          )
        }
        nextBeatIndex += 1
      }
      return
    }

    const beatDuration = 60 / Math.max(30, bpm)
    while (gridOffsetSec + syntheticBeatIndex * beatDuration <= horizon) {
      const beatTime = gridOffsetSec + syntheticBeatIndex * beatDuration
      if (beatTime >= nowInSong - 0.025) {
        scheduleSelectedClick(
          selectedSound,
          ctx.currentTime + Math.max(0.004, beatTime - nowInSong),
          accentEnabled && syntheticBeatIndex % Math.max(1, beatsPerBar) === 0,
        )
      }
      syntheticBeatIndex += 1
    }
  }

  async function ensureAudioGraph(): Promise<void> {
    ctx = await resumeAudioDevice()
    if (!resources) resources = createClickSoundResources(ctx)
    if (!clickGain) {
      clickGain = ctx.createGain()
      clickGain.gain.value = clickVolume
      clickGain.connect(ctx.destination)
    }
    if (!musicGain) {
      musicGain = ctx.createGain()
      musicGain.gain.value = musicVolume
      musicGain.connect(ctx.destination)
    }
    if (!musicSource) {
      musicSource = ctx.createMediaElementSource(audioElement)
      musicSource.connect(musicGain)
    }
  }

  function writeGain(node: GainNode | null, value: number): void {
    if (!node || !ctx) return
    const safeValue = Math.max(0, Math.min(1.2, value))
    const now = ctx.currentTime
    node.gain.cancelScheduledValues(now)
    node.gain.setTargetAtTime(safeValue, now, 0.01)
  }

  function changeMusicVolume(value: number): void {
    musicVolume = value
    writeGain(musicGain, value)
  }

  function changeClickVolume(value: number): void {
    clickVolume = value
    writeGain(clickGain, value)
  }

  function scheduleSelectedClick(sound: AuditionSoundId, startTime: number, downbeat: boolean): boolean {
    if (!ctx || !resources || !clickGain) return false
    if (sound !== 'custom-sample') {
      scheduleClickSound({
        ctx,
        destination: clickGain,
        resources,
        sound,
        startTime,
        downbeat,
      })
      return true
    }

    const buffer = downbeat ? (customAccentBuffer ?? customRegularBuffer) : (customRegularBuffer ?? customAccentBuffer)
    if (!buffer) return false
    const source = ctx.createBufferSource()
    source.buffer = buffer
    if (downbeat && !customAccentBuffer) source.playbackRate.setValueAtTime(1.12, startTime)
    source.connect(clickGain)
    source.start(startTime)
    return true
  }

  async function audition(sound: AuditionSoundId): Promise<void> {
    selectedSound = sound
    error = ''
    try {
      await ensureAudioGraph()
      if (!ctx || !resources || !clickGain) return
      const start = ctx.currentTime + 0.025
      if (!scheduleSelectedClick(sound, start, true)) {
        error = 'Load a Logic or custom click sample first.'
        return
      }
      scheduleSelectedClick(sound, start + 0.32, false)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not start audio.'
    }
  }

  async function loadCustomSample(file: File | null, kind: 'regular' | 'accent'): Promise<void> {
    if (!file) return
    error = ''
    try {
      await ensureAudioGraph()
      if (!ctx) return
      const decoded = await ctx.decodeAudioData(await file.arrayBuffer())
      if (kind === 'regular') {
        customRegularBuffer = decoded
        customRegularName = file.name
        customRegularInput.value = ''
      } else {
        customAccentBuffer = decoded
        customAccentName = file.name
        customAccentInput.value = ''
      }
      selectedSound = 'custom-sample'
      void audition('custom-sample')
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not decode that click sample.'
    }
  }

  async function togglePlayback(): Promise<void> {
    error = ''
    if (!audioElement.src) {
      error = 'Load a project song or audio file first.'
      return
    }
    try {
      await ensureAudioGraph()
      if (audioElement.paused) {
        resetBeatCursor()
        await audioElement.play()
        playing = true
        stopScheduler()
        schedulerId = setInterval(scheduleAhead, 25)
        scheduleAhead()
      } else {
        audioElement.pause()
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not play this audio file.'
    }
  }

  function stopPlayback(): void {
    audioElement?.pause()
    playing = false
    stopScheduler()
  }

  function setAudioBlob(blob: Blob, label: string, detail: string): void {
    stopPlayback()
    revokeAudioUrl()
    objectUrl = URL.createObjectURL(blob)
    audioElement.src = objectUrl
    audioElement.load()
    sourceLabel = label
    sourceDetail = detail
    positionSec = 0
    durationSec = 0
    resetBeatCursor()
  }

  async function loadProjectSong(songId: string): Promise<void> {
    const token = ++loadingToken
    selectedSongId = songId
    loading = true
    error = ''
    stopPlayback()
    try {
      const snapshot = get(projectStore)
      const entry = snapshot.data?.songs.find((song) => song.id === songId)
      if (!snapshot.osPath || !entry) throw new Error('This project song is not available from local disk.')

      const read = await readProjectSong(snapshot.osPath, entry.folder)
      if (!read.ok) throw new Error(read.error)
      const decoded = decodeSmapBytes(read.bytes)
      const map = decoded.project.songMap
      const audio = map.audio
      let blob = decoded.audioBlob ?? null
      if (!blob && audio?.originalPath) {
        const asset = await readProjectSongAsset(snapshot.osPath, entry.folder, audio.originalPath)
        if (!asset.ok) throw new Error(asset.error)
        blob = asset.blob
      }
      if (!blob) throw new Error('The song has no readable audio file.')
      if (token !== loadingToken) return

      const points = map.timeline.beats
        .map((beat) => ({ timeSec: beat.timeSec, downbeat: beat.indexInBar === 0 }))
        .filter((beat) => Number.isFinite(beat.timeSec) && beat.timeSec >= 0)
        .sort((a, b) => a.timeSec - b.timeSec)
      beatPoints = points
      const mapBpm = map.metadata.bpm ?? estimateBpm(points)
      if (mapBpm) bpm = Math.round(mapBpm * 10) / 10
      const firstBar = map.timeline.bars[0]
      if (firstBar?.beatIds.length) beatsPerBar = firstBar.beatIds.length
      gridOffsetSec = points[0]?.timeSec ?? 0
      setAudioBlob(
        blob,
        map.metadata.title?.trim() || entry.folder,
        points.length > 0 ? `${points.length} analyzed beats · ${bpm} BPM` : `${bpm} BPM · using fallback grid`,
      )
    } catch (cause) {
      if (token !== loadingToken) return
      beatPoints = []
      error = cause instanceof Error ? cause.message : 'Could not load project audio.'
    } finally {
      if (token === loadingToken) loading = false
    }
  }

  function loadLocalFile(file: File | null): void {
    if (!file) return
    loadingToken += 1
    selectedSongId = ''
    error = ''
    beatPoints = []
    setAudioBlob(file, file.name, `${bpm} BPM · using fallback grid`)
    fileInput.value = ''
  }

  function seekTo(value: number): void {
    if (!audioElement || !Number.isFinite(value)) return
    audioElement.currentTime = Math.max(0, Math.min(value, durationSec || value))
    positionSec = audioElement.currentTime
    resetBeatCursor()
  }

  function restart(): void {
    seekTo(0)
  }

  function handleKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null
    if (target?.matches('input, select, textarea, button')) return
    if (event.code === 'Space') {
      event.preventDefault()
      void togglePlayback()
      return
    }
    const index = Number(event.key) - 1
    if (index === CLICK_SOUND_OPTIONS.length) {
      void audition('custom-sample')
      return
    }
    const option = CLICK_SOUND_OPTIONS[index]
    if (option) void audition(option.id)
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown)
    let initialSelectionMade = false
    projectUnsubscribe = projectStore.subscribe((snapshot) => {
      projectSongs = (snapshot.data?.songs ?? []).map((entry) => ({
        id: entry.id,
        folder: entry.folder,
        title: snapshot.metadataByFolder[entry.folder]?.title?.trim() || entry.folder,
        bpm: snapshot.metadataByFolder[entry.folder]?.bpm,
      }))
      if (initialSelectionMade || projectSongs.length === 0 || !snapshot.osPath) return
      initialSelectionMade = true
      const initialId = snapshot.activeSongId && projectSongs.some((song) => song.id === snapshot.activeSongId)
        ? snapshot.activeSongId
        : projectSongs[0]!.id
      void loadProjectSong(initialId)
    })

    // A browser-cloud song can still be auditioned when its audio is already hydrated.
    const session = get(audioSession)
    const snapshot = get(projectStore)
    if (!snapshot.osPath && session.file) {
      initialSelectionMade = true
      const mapTitle = snapshot.activeSongFolder
        ? snapshot.metadataByFolder[snapshot.activeSongFolder]?.title
        : null
      setAudioBlob(session.file, mapTitle?.trim() || session.name, `${bpm} BPM · using fallback grid`)
    }
  })

  onDestroy(() => {
    stopScheduler()
    projectUnsubscribe?.()
    if (typeof window !== 'undefined') window.removeEventListener('keydown', handleKeydown)
    stopPlayback()
    revokeAudioUrl()
    musicSource?.disconnect()
    musicGain?.disconnect()
    clickGain?.disconnect()
  })
</script>

<svelte:head>
  <title>Click sound lab - BarBro</title>
</svelte:head>

<audio
  bind:this={audioElement}
  preload="metadata"
  onloadedmetadata={() => {
    durationSec = Number.isFinite(audioElement.duration) ? audioElement.duration : 0
  }}
  onplay={() => (playing = true)}
  onpause={() => {
    playing = false
    positionSec = audioElement.currentTime
    stopScheduler()
  }}
  onended={() => {
    playing = false
    positionSec = durationSec
    stopScheduler()
  }}
  onseeking={resetBeatCursor}
></audio>

<main class="click-lab">
  <div class="shell">
    <header class="page-header">
      <div>
        <p class="eyebrow">Debug · monitoring</p>
        <h1>Click sound lab</h1>
      </div>
      <a href="/debug">Back to debug</a>
    </header>

    <section class="source-strip" aria-label="Music source">
      <div class="source-copy">
        <span>Music</span>
        <strong>{loading ? 'Loading song…' : sourceLabel}</strong>
        <small>{sourceDetail}</small>
      </div>

      {#if projectSongs.length > 0}
        <label class="song-picker">
          <span>Project song</span>
          <select
            value={selectedSongId}
            onchange={(event) => void loadProjectSong(event.currentTarget.value)}
            disabled={loading}
          >
            <option value="" disabled>Select song</option>
            {#each projectSongs as song (song.id)}
              <option value={song.id}>{song.title}{song.bpm ? ` · ${Math.round(song.bpm)} BPM` : ''}</option>
            {/each}
          </select>
        </label>
      {/if}

      <input
        bind:this={fileInput}
        class="sr-only"
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg"
        onchange={(event) => loadLocalFile(event.currentTarget.files?.[0] ?? null)}
      />
      <Button class="" variant="outline" onclick={() => fileInput.click()}>
        <FileAudio />
        Audio file
      </Button>
    </section>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <section class="transport" aria-label="Audition transport">
      <div class="transport-buttons">
        <Button class="" size="icon-lg" onclick={() => void togglePlayback()} aria-label={playing ? 'Pause' : 'Play'}>
          {#if playing}<Pause />{:else}<Play />{/if}
        </Button>
        <Button class="" size="icon-lg" variant="outline" onclick={restart} aria-label="Restart">
          <RotateCcw />
        </Button>
      </div>

      <div class="timeline">
        <div class="time-row">
          <strong>{formatTime(positionSec)}</strong>
          <span>{formatTime(durationSec)}</span>
        </div>
        <input
          aria-label="Song position"
          type="range"
          min="0"
          max={Math.max(durationSec, 1)}
          step="0.05"
          value={positionSec}
          oninput={(event) => seekTo(Number(event.currentTarget.value))}
        />
      </div>

      <label class="level-control">
        <span>Music</span>
        <input
          type="range"
          min="0"
          max="1.2"
          step="0.01"
          value={musicVolume}
          oninput={(event) => changeMusicVolume(Number(event.currentTarget.value))}
        />
        <output>{Math.round(musicVolume * 100)}%</output>
      </label>
      <label class="level-control">
        <span>Click</span>
        <input
          type="range"
          min="0"
          max="1.2"
          step="0.01"
          value={clickVolume}
          oninput={(event) => changeClickVolume(Number(event.currentTarget.value))}
        />
        <output>{Math.round(clickVolume * 100)}%</output>
      </label>
    </section>

    <div class="workspace">
      <section class="candidate-list" aria-labelledby="candidate-heading">
        <div class="section-heading">
          <div>
            <p class="eyebrow">1–9 to switch</p>
            <h2 id="candidate-heading">Sound candidates</h2>
          </div>
          <span>{selectedSoundName}</span>
        </div>

        {#each CLICK_SOUND_OPTIONS as option, index (option.id)}
          <div class:active={selectedSound === option.id} class="candidate-row">
            <button
              type="button"
              class="candidate-select"
              onclick={() => (selectedSound = option.id)}
              aria-pressed={selectedSound === option.id}
            >
              <span class="number">{index + 1}</span>
              <span class="candidate-copy">
                <strong>{option.name}</strong>
                <small>{option.description}</small>
              </span>
            </button>
            <Button
              class=""
              size="icon-sm"
              variant={selectedSound === option.id ? 'default' : 'ghost'}
              onclick={() => void audition(option.id)}
              aria-label={`Audition ${option.name}`}
              title={`Audition ${option.name}`}
            >
              <Volume2 />
            </Button>
          </div>
        {/each}

        <div class:active={selectedSound === 'custom-sample'} class="candidate-row custom-row">
          <button
            type="button"
            class="candidate-select"
            onclick={() => (selectedSound = 'custom-sample')}
            aria-pressed={selectedSound === 'custom-sample'}
          >
            <span class="number">9</span>
            <span class="candidate-copy">
              <strong>Logic / custom</strong>
              <small>{customRegularName || customAccentName || 'Load bounced Klopfgeist or another sample.'}</small>
            </span>
          </button>
          <Button
            class=""
            size="icon-sm"
            variant={selectedSound === 'custom-sample' ? 'default' : 'ghost'}
            onclick={() => void audition('custom-sample')}
            disabled={!customRegularBuffer && !customAccentBuffer}
            aria-label="Audition Logic or custom sample"
            title="Audition Logic or custom sample"
          >
            <Volume2 />
          </Button>
        </div>
      </section>

      <aside class="grid-controls" aria-label="Click grid controls">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Timing</p>
            <h2>Click grid</h2>
          </div>
          <span class:analyzed={hasAnalyzedGrid}>{hasAnalyzedGrid ? 'Song grid' : 'BPM grid'}</span>
        </div>

        <label class="toggle-row">
          <span>
            <strong>Click enabled</strong>
            <small>Keep music playing while comparing.</small>
          </span>
          <input type="checkbox" bind:checked={clickEnabled} />
        </label>
        <label class="toggle-row">
          <span>
            <strong>Downbeat accent</strong>
            <small>Beat one uses a higher, firmer hit.</small>
          </span>
          <input type="checkbox" bind:checked={accentEnabled} />
        </label>

        <div class="number-grid">
          <label>
            <span>BPM</span>
            <input type="number" min="30" max="300" step="0.1" bind:value={bpm} disabled={hasAnalyzedGrid} />
          </label>
          <label>
            <span>Beats / bar</span>
            <input type="number" min="1" max="12" step="1" bind:value={beatsPerBar} disabled={hasAnalyzedGrid} />
          </label>
          <label class="wide">
            <span>First beat offset</span>
            <input type="number" min="0" step="0.01" bind:value={gridOffsetSec} disabled={hasAnalyzedGrid} />
          </label>
        </div>

        <p class="grid-note">
          {hasAnalyzedGrid
            ? `Following ${beatPoints.length} beat markers from the project song.`
            : 'Set BPM and the first-beat offset for imported audio. Project songs with analysis follow their stored beat markers automatically.'}
        </p>

        <div class="sample-loader">
          <div>
            <p class="eyebrow">Local only</p>
            <h3>Logic / custom samples</h3>
          </div>
          <input
            bind:this={customRegularInput}
            class="sr-only"
            type="file"
            accept="audio/*,.wav,.aif,.aiff,.mp3,.m4a,.flac,.ogg"
            onchange={(event) => void loadCustomSample(event.currentTarget.files?.[0] ?? null, 'regular')}
          />
          <input
            bind:this={customAccentInput}
            class="sr-only"
            type="file"
            accept="audio/*,.wav,.aif,.aiff,.mp3,.m4a,.flac,.ogg"
            onchange={(event) => void loadCustomSample(event.currentTarget.files?.[0] ?? null, 'accent')}
          />
          <Button class="" variant="outline" onclick={() => customRegularInput.click()}>
            Regular hit
            {#if customRegularName}<span class="loaded-dot" aria-label="Loaded"></span>{/if}
          </Button>
          <Button class="" variant="outline" onclick={() => customAccentInput.click()}>
            Accent hit
            {#if customAccentName}<span class="loaded-dot" aria-label="Loaded"></span>{/if}
          </Button>
          <small>
            The accent file is optional. With one sample, beat one is pitched slightly higher automatically.
          </small>
        </div>
      </aside>
    </div>
  </div>
</main>

<style>
  .click-lab {
    min-height: 100dvh;
    padding: clamp(18px, 3vw, 42px);
    color: var(--studio-ink);
    background:
      radial-gradient(circle at 1px 1px, color-mix(in oklch, var(--studio-ink) 10%, transparent) 1px, transparent 1.4px),
      var(--studio-paper);
    background-size: 18px 18px;
  }

  .shell {
    width: min(1120px, 100%);
    margin: 0 auto;
  }

  .page-header,
  .source-strip,
  .transport,
  .section-heading,
  .candidate-row,
  .toggle-row,
  .time-row,
  .level-control {
    display: flex;
    align-items: center;
  }

  .page-header {
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  .page-header h1,
  .section-heading h2,
  .page-header p,
  .section-heading p {
    margin: 0;
  }

  .page-header h1 {
    font-family: var(--font-display);
    font-size: clamp(2rem, 5vw, 4rem);
    line-height: 0.95;
  }

  .page-header a {
    color: inherit;
    font-size: 0.82rem;
    font-weight: 900;
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
  }

  .eyebrow,
  .source-copy > span,
  .song-picker > span,
  .level-control > span,
  .number-grid label > span {
    font-size: 0.68rem;
    font-weight: 950;
    text-transform: uppercase;
  }

  .source-strip,
  .transport,
  .candidate-list,
  .grid-controls {
    border: 2px solid var(--studio-ink);
    border-radius: var(--radius);
    background: var(--studio-panel);
  }

  .source-strip {
    min-height: 74px;
    gap: 1rem;
    padding: 0.8rem;
    box-shadow: 4px 4px 0 var(--studio-ink);
  }

  .source-copy {
    display: grid;
    min-width: 180px;
    margin-right: auto;
  }

  .source-copy strong {
    overflow: hidden;
    max-width: 34ch;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-copy small,
  .candidate-copy small,
  .toggle-row small {
    color: color-mix(in oklch, var(--studio-ink) 62%, transparent);
    font-weight: 650;
  }

  .song-picker {
    display: grid;
    gap: 0.2rem;
  }

  select,
  input[type='number'] {
    min-height: 34px;
    border: 2px solid var(--studio-ink);
    border-radius: var(--radius);
    background: white;
    padding: 0.25rem 0.45rem;
    color: var(--studio-ink);
    font: inherit;
    font-weight: 750;
  }

  select {
    width: min(300px, 34vw);
  }

  .error {
    margin: 0.9rem 0 0;
    border-left: 5px solid #d92d20;
    background: white;
    padding: 0.55rem 0.7rem;
    color: #9f1b12;
    font-weight: 800;
  }

  .transport {
    gap: 1.2rem;
    margin-top: 1rem;
    padding: 0.75rem;
  }

  .transport-buttons {
    display: flex;
    gap: 0.45rem;
  }

  .timeline {
    min-width: 180px;
    flex: 1;
  }

  .timeline input,
  .level-control input {
    width: 100%;
    accent-color: var(--studio-orange);
  }

  .time-row {
    justify-content: space-between;
    margin-bottom: 0.1rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
  }

  .time-row span {
    opacity: 0.55;
  }

  .level-control {
    display: grid;
    grid-template-columns: 1fr auto;
    width: 145px;
  }

  .level-control input {
    grid-column: 1 / -1;
  }

  .level-control output {
    font-family: var(--font-mono);
    font-size: 0.68rem;
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 1.55fr) minmax(290px, 0.8fr);
    gap: 1rem;
    margin-top: 1rem;
  }

  .candidate-list,
  .grid-controls {
    overflow: hidden;
  }

  .section-heading {
    min-height: 66px;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 0.9rem;
    border-bottom: 2px solid var(--studio-ink);
    background: var(--studio-muted);
  }

  .section-heading h2 {
    font-family: var(--font-display);
    font-size: 1.25rem;
    line-height: 1;
  }

  .section-heading > span {
    border-radius: 999px;
    background: var(--studio-ink);
    padding: 0.22rem 0.55rem;
    color: white;
    font-size: 0.68rem;
    font-weight: 900;
  }

  .section-heading > span.analyzed {
    background: var(--studio-orange);
    color: var(--studio-ink);
  }

  .candidate-row {
    min-height: 61px;
    gap: 0.4rem;
    padding-right: 0.65rem;
    border-bottom: 1px solid color-mix(in oklch, var(--studio-ink) 25%, transparent);
  }

  .candidate-row:last-child {
    border-bottom: 0;
  }

  .candidate-row.active {
    background: color-mix(in oklch, var(--studio-orange) 22%, white);
    box-shadow: inset 6px 0 0 var(--studio-orange);
  }

  .candidate-select {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 0.8rem;
    align-self: stretch;
    border: 0;
    background: transparent;
    padding: 0.55rem 0.8rem;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .candidate-row:not(.active):hover {
    background: var(--studio-muted);
  }

  .number {
    width: 1.5rem;
    color: color-mix(in oklch, var(--studio-ink) 55%, transparent);
    font-family: var(--font-mono);
    font-size: 0.78rem;
    font-weight: 900;
    text-align: center;
  }

  .candidate-copy {
    display: grid;
    min-width: 0;
  }

  .candidate-copy strong {
    font-size: 0.95rem;
  }

  .candidate-copy small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toggle-row {
    justify-content: space-between;
    gap: 1rem;
    padding: 0.9rem;
    border-bottom: 1px solid color-mix(in oklch, var(--studio-ink) 25%, transparent);
  }

  .toggle-row > span {
    display: grid;
  }

  .toggle-row input {
    width: 2.4rem;
    height: 1.15rem;
    accent-color: var(--studio-orange);
  }

  .number-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    padding: 0.9rem;
  }

  .number-grid label {
    display: grid;
    gap: 0.25rem;
  }

  .number-grid .wide {
    grid-column: 1 / -1;
  }

  input:disabled,
  select:disabled {
    opacity: 0.5;
  }

  .grid-note {
    margin: 0;
    border-top: 1px solid color-mix(in oklch, var(--studio-ink) 25%, transparent);
    padding: 0.9rem;
    font-size: 0.78rem;
    font-weight: 650;
    line-height: 1.35;
  }

  .sample-loader {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.55rem;
    border-top: 2px solid var(--studio-ink);
    padding: 0.9rem;
    background: color-mix(in oklch, var(--studio-orange) 11%, white);
  }

  .sample-loader > div,
  .sample-loader > small {
    grid-column: 1 / -1;
  }

  .sample-loader h3,
  .sample-loader p {
    margin: 0;
  }

  .sample-loader h3 {
    font-family: var(--font-display);
    font-size: 1rem;
  }

  .sample-loader > small {
    font-size: 0.7rem;
    font-weight: 650;
    line-height: 1.3;
  }

  .loaded-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: var(--studio-orange);
  }

  @media (max-width: 820px) {
    .source-strip,
    .transport {
      align-items: stretch;
      flex-wrap: wrap;
    }

    .song-picker,
    select {
      width: 100%;
    }

    .workspace {
      grid-template-columns: 1fr;
    }

    .level-control {
      width: calc(50% - 0.6rem);
    }
  }

  @media (max-width: 520px) {
    .page-header {
      align-items: flex-start;
    }

    .level-control {
      width: 100%;
    }

    .candidate-copy small {
      white-space: normal;
    }
  }
</style>
