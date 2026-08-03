/**
 * Shared cue-render authority for the Song Edit UI.
 *
 * The Overview (`MixerPanel`) and the Cue tab (`CueEditor`) both need the SAME
 * view of "is the voice engine ready?", "is a render in flight?", "is the cue
 * WAV fresh?", plus the one `generateCueTrackWav()` that produces the cue +
 * click WAVs and stamps `renderExport` / `clickExport` onto the `.smap`. If each
 * component owned its own copy they could disagree (two Piper polls, two busy
 * flags, one render the other doesn't see). So this is a module-level singleton
 * — like `songMap` / `project` / `transport` — that both components read.
 *
 * Reactivity: the singleton mirrors the `songMap` + `desktopCompanionStatus`
 * stores into `$state` (subscribed once, for the app's lifetime) so its
 * `$derived` cue-status helpers stay live; components read the getters inside
 * their own reactive context and update with them. The Piper readiness poll is
 * a plain `setInterval` the shell starts once (`startPiperPoll`) and stops on
 * teardown (`stopPiperPoll`) — no `$effect` needed.
 *
 * Everything mutating stays on `patchSongMap`; nothing here is a new source of
 * truth, only a shared lens + the render side effect.
 */
import { get } from 'svelte/store'
import { patchSongMap, songMap } from '$lib/stores/songMap'
import { patchMetadataForFolder, project as projectStore } from '$lib/stores/project'
import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
import { cueTrackTotalDurationSec, renderCueTrackWavBlob } from '$lib/audio/renderCueTrack'
import { getPiperTtsSetupStatus } from '$lib/client/desktopBridge'
import { writeProjectSongAsset } from '$lib/client/desktopProjectFs'
import { metadataLiteFromSongMap } from '$lib/project/commit'
import {
  fingerprintClickTrackInputs,
  fingerprintCueTrackInputs,
} from '$lib/songmap/cueTrackFingerprint'
import { getPrimaryCueTrack } from '$lib/songmap/cueTracks'
import type { CueTrack, SongMap } from '$lib/songmap/types'

const CLICK_TRACK_REL = 'cue/click-track.wav'

/** Per-track cue WAV path — one folder per cue track so tracks never collide. */
function cueTrackRelativePath(trackId: string): string {
  return `cue/tracks/${trackId}/cue-track.wav`
}

export type CueRenderStatus = { kind: 'busy' | 'ready' | 'warn'; text: string }

class CueRenderStore {
  // ── Reactive mirrors of the stores this lens derives from ────────────
  #sm = $state<SongMap | null>(null)
  #companionReachable = $state(false)

  /** Piper venv + voice on disk (desktop beacon). Required to generate cue audio. */
  piperCueReady = $state(false)
  /** A cue/click render is in flight. */
  cueGenBusy = $state(false)
  /** Last render error (diagnostic; surfaced via `cueRenderStatus`). */
  cueGenErr = $state('')
  /** Piper / desktop unavailable — clicks-only note from the last render. */
  cueSpeechNote = $state('')

  // ── Derived cue-render state (shared by Overview + Cue tab) ───────────
  #overviewCueTrack = $derived(this.#sm ? getPrimaryCueTrack(this.#sm) : undefined)

  #overviewHasCueContent = $derived(
    !!this.#overviewCueTrack &&
      (this.#overviewCueTrack.events.some((e) => e.enabled && e.text?.trim()) ||
        !!this.#overviewCueTrack.spokenCountIn),
  )

  #overviewCueRendered = $derived.by(() => {
    const sm = this.#sm
    const t = this.#overviewCueTrack
    if (!sm || !t) return false
    const exp = t.renderExport
    if (!exp?.relativePath) return false
    return exp.fingerprint === fingerprintCueTrackInputs(sm, t, { announceTitle: this.#announceTitle() })
  })

  /**
   * THE announcement switch, derived from the project every time it is asked —
   * never copied. This is what makes "all songs announce" true from the
   * setting alone, including songs added after it was turned on.
   */
  #announceTitle(): boolean {
    return (get(projectStore).data?.defaults?.preCountInCue?.mode ?? 'off') !== 'off'
  }

  /** User-facing state of the cue render, for the Cue tab status badge. */
  #cueRenderStatus = $derived.by<CueRenderStatus | null>(() => {
    if (!this.#overviewHasCueContent) return null
    if (this.cueGenBusy) return { kind: 'busy', text: 'Rendering voice cues…' }
    if (this.#overviewCueRendered) return { kind: 'ready', text: 'Cues ready' }
    if (!this.#companionReachable) return { kind: 'warn', text: 'Start BarBro Desktop to hear voice cues' }
    if (!this.piperCueReady) return { kind: 'warn', text: 'Finish voice setup to render cues' }
    return { kind: 'busy', text: 'Preparing cues…' }
  })

  #pollId: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Lifetime subscriptions (singleton) — bridge the Svelte stores into the
    // reactive mirrors above so the `$derived` helpers stay live.
    songMap.subscribe((v) => (this.#sm = v))
    desktopCompanionStatus.subscribe((v) => (this.#companionReachable = v.reachable))
  }

  get overviewCueTrack(): CueTrack | undefined {
    return this.#overviewCueTrack
  }
  get overviewHasCueContent(): boolean {
    return this.#overviewHasCueContent
  }
  get overviewCueRendered(): boolean {
    return this.#overviewCueRendered
  }
  get cueRenderStatus(): CueRenderStatus | null {
    return this.#cueRenderStatus
  }

  /**
   * Start the desktop Piper readiness poll. Idempotent — the shell calls this
   * once (in `onMount`); repeat calls are no-ops. Fires immediately, then every
   * 5s, mirroring the previous in-page `$effect` poll.
   */
  startPiperPoll(): void {
    if (this.#pollId != null) return
    const poll = async () => {
      const st = await getPiperTtsSetupStatus()
      this.piperCueReady = !!st?.ready
    }
    void poll()
    this.#pollId = setInterval(poll, 5000)
  }

  stopPiperPoll(): void {
    if (this.#pollId != null) {
      clearInterval(this.#pollId)
      this.#pollId = null
    }
  }

  /**
   * Render the cue (speech-only) AND click (clicks-only) WAVs for `track`
   * (defaults to the primary cue track), write them into the project song
   * folder when in project-song mode, and stamp `renderExport` / `clickExport`
   * onto the `.smap`. The two files are sample-aligned (shared prelude/prepend
   * math) but carry orthogonal content, so mixing them sums to the legacy "cue
   * track" without doubling the clicks.
   */
  async generateCueTrackWav(track?: CueTrack | null): Promise<void> {
    const sm = get(songMap)
    if (!sm) return
    const cueTrack = track ?? getPrimaryCueTrack(sm)
    if (!cueTrack) {
      this.cueGenErr = 'Create a cue track first.'
      return
    }
    // The spoken count-in produces speech that isn't stored as text events, so
    // it must count toward "needs voice" — otherwise the render skips the
    // readiness guard and silently produces a cue with no speech.
    const needsVoice =
      !!cueTrack.spokenCountIn || cueTrack.events.some((event) => event.enabled && event.text?.trim())
    if (needsVoice && !this.piperCueReady) {
      this.cueGenErr = 'Voice cues are not ready. Start BarBro Desktop and finish voice setup.'
      return
    }
    this.cueGenBusy = true
    this.cueGenErr = ''
    this.cueSpeechNote = ''
    try {
      const announceTitle = this.#announceTitle()
      const cueRenderResult = await renderCueTrackWavBlob(sm, {
        includeSpeech: true,
        includeClicks: false,
        cueTrack,
        announceTitle,
      })
      const clickRenderResult = await renderCueTrackWavBlob(sm, {
        includeSpeech: false,
        includeClicks: true,
        cueTrack,
      })
      if (cueRenderResult.speechSkippedReason) this.cueSpeechNote = cueRenderResult.speechSkippedReason
      const dur = cueTrackTotalDurationSec(sm, cueTrack)
      if (dur == null) throw new Error('Could not derive cue duration from trim + beats')
      const fp = fingerprintCueTrackInputs(sm, cueTrack, { announceTitle })
      const clickFp = fingerprintClickTrackInputs(sm, cueTrack)
      const now = new Date().toISOString()
      let cueRelativePath: string | undefined
      let clickWritten = false

      const ps = get(projectStore)
      if (ps.editingMode === 'project-song' && ps.osPath && ps.activeSongFolder) {
        if (!get(desktopCompanionStatus).reachable) {
          this.cueGenErr =
            'Desktop client unreachable — tracks were not saved to project. Cue WAV is still available via Download.'
        } else {
          const cueBytes = new Uint8Array(await cueRenderResult.blob.arrayBuffer())
          const clickBytes = new Uint8Array(await clickRenderResult.blob.arrayBuffer())
          const nextCuePath = cueTrackRelativePath(cueTrack.id)
          const [cueWrite, clickWrite] = await Promise.all([
            writeProjectSongAsset(ps.osPath, ps.activeSongFolder, nextCuePath, cueBytes),
            writeProjectSongAsset(ps.osPath, ps.activeSongFolder, CLICK_TRACK_REL, clickBytes),
          ])
          if (cueWrite.ok) {
            cueRelativePath = nextCuePath
          } else {
            this.cueGenErr = `Could not write cue file: ${cueWrite.error}.`
          }
          if (clickWrite.ok) {
            clickWritten = true
          } else if (!this.cueGenErr) {
            this.cueGenErr = `Cue saved but click file failed: ${clickWrite.error}.`
          }
        }
      }

      // Both exports get an explicit `preludeOffsetSec` so consumers (like the
      // Ableton setlist export) can skip the silence + count-in head of each
      // WAV without re-deriving it. The renderer returns the exact value it
      // used; same number for both layers since they share the prelude math.
      const cuePreludeOffsetSec = cueRenderResult.preludeOffsetSec
      const clickPreludeOffsetSec = clickRenderResult.preludeOffsetSec
      const p = patchSongMap((m) => ({
        ...m,
        cueTracks: m.cueTracks.map((t) =>
          t.id === cueTrack.id
            ? {
                ...t,
                renderExport: {
                  fingerprint: fp,
                  durationSec: dur,
                  sampleRate: 44100,
                  generatedAt: now,
                  preludeOffsetSec: cuePreludeOffsetSec,
                  relativePath: cueRelativePath,
                },
              }
            : t,
        ),
        clickExport: clickWritten
          ? {
              fingerprint: clickFp,
              durationSec: dur,
              sampleRate: 44100,
              generatedAt: now,
              preludeOffsetSec: clickPreludeOffsetSec,
              relativePath: CLICK_TRACK_REL,
            }
          : m.clickExport,
      }))
      if (!p.ok) {
        this.cueGenErr = p.errors.join('; ')
        return
      }
      const snap = get(projectStore)
      if ((cueRelativePath || clickWritten) && snap.activeSongFolder) {
        const fresh = get(songMap)
        if (fresh) {
          const existing = snap.metadataByFolder[snap.activeSongFolder] ?? { title: '' }
          patchMetadataForFolder(snap.activeSongFolder, {
            ...existing,
            ...metadataLiteFromSongMap(fresh),
            // Flip the on-disk flags right away so /project's badges + the mixer
            // pick up both files without needing a Refresh.
            hasCueTrack: cueRelativePath ? true : existing.hasCueTrack,
            hasClickTrack: clickWritten ? true : existing.hasClickTrack,
          })
        }
      }
    } catch (e) {
      this.cueGenErr = e instanceof Error ? e.message : String(e)
    } finally {
      this.cueGenBusy = false
    }
  }
}

/** App-wide singleton — both `MixerPanel` and `CueEditor` import this instance. */
export const cueRender = new CueRenderStore()
