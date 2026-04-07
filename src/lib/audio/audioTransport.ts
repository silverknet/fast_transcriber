const END_EPS = 0.028

export type TransportBindings = {
  getAudio: () => HTMLAudioElement | null | undefined
  getDuration: () => number
  getRange: () => { start: number; end: number }
  setCurrentTime: (t: number) => void
  getIsPlaying: () => boolean
  setIsPlaying: (v: boolean) => void
}

export function createAudioTransport() {
  let rafId = 0

  function stopRaf() {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }

  function playbackLoop(b: TransportBindings) {
    const el = b.getAudio()
    if (!el || !b.getIsPlaying()) return

    const d = b.getDuration()
    let clock = el.currentTime
    if (Number.isFinite(d) && d > 0) {
      clock = Math.min(Math.max(0, clock), d)
    }
    b.setCurrentTime(clock)

    const { start, end } = b.getRange()
    if (clock >= end - END_EPS) {
      el.pause()
      el.currentTime = start
      b.setCurrentTime(start)
      b.setIsPlaying(false)
      stopRaf()
      return
    }

    rafId = requestAnimationFrame(() => playbackLoop(b))
  }

  return {
    seek(b: TransportBindings, time: number) {
      const el = b.getAudio()
      const d = b.getDuration()
      if (!el || !(d > 0)) return
      const t = Math.max(0, Math.min(time, d))
      el.currentTime = t
      b.setCurrentTime(t)
    },

    play(b: TransportBindings) {
      void b
        .getAudio()
        ?.play()
        .catch((err) => {
          if (import.meta.env.DEV) {
            console.error('[audioTransport] audio.play() failed', err)
          }
        })
    },

    pause(b: TransportBindings) {
      b.getAudio()?.pause()
    },

    onPlay(b: TransportBindings) {
      stopRaf()
      b.setIsPlaying(true)
      if (import.meta.env.DEV) {
        console.debug('[audioTransport] onPlay -> rAF loop start')
      }
      rafId = requestAnimationFrame(() => playbackLoop(b))
    },

    onPause(b: TransportBindings) {
      b.setIsPlaying(false)
      stopRaf()
      const el = b.getAudio()
      if (!el) return
      const d = b.getDuration()
      let t = el.currentTime
      if (Number.isFinite(d) && d > 0) t = Math.min(Math.max(0, t), d)
      b.setCurrentTime(t)
    },

    syncPausedFromElement(b: TransportBindings) {
      if (b.getIsPlaying()) return
      const el = b.getAudio()
      if (!el) return
      const d = b.getDuration()
      let t = el.currentTime
      if (Number.isFinite(d) && d > 0) t = Math.min(Math.max(0, t), d)
      b.setCurrentTime(t)
    },

    ensurePlayheadInRange(b: TransportBindings) {
      const el = b.getAudio()
      if (!el) return
      const { start, end } = b.getRange()
      let t = el.currentTime
      if (t < start || t >= end - 0.02) {
        t = start
        el.currentTime = t
        b.setCurrentTime(t)
      }
    },

    stopRaf,

    destroy() {
      stopRaf()
    },
  }
}
