/**
 * Load the official **lame.min.js** (single-file IIFE) as a classic script.
 * Importing `lamejs` npm `src/js/index.js` through Vite breaks at runtime (`MPEGMode is not defined`)
 * because the bundler splits CJS modules incorrectly; the min bundle keeps one closure.
 */

const LOG = '[reference-audio]'

export type LamejsMp3Encoder = new (
  channels: number,
  samplerate: number,
  kbps: number,
) => {
  encodeBuffer(left: Int16Array, right: Int16Array): Int8Array
  flush(): Int8Array
}

export type LamejsGlobal = {
  Mp3Encoder: LamejsMp3Encoder
}

function getWindow(): Window & { lamejs?: LamejsGlobal } {
  return window as Window & { lamejs?: LamejsGlobal }
}

let loadPromise: Promise<LamejsGlobal> | null = null

/**
 * Ensures `window.lamejs.Mp3Encoder` exists (loads `/vendor/lame.min.js` once).
 */
export function ensureLamejsLoaded(): Promise<LamejsGlobal> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error(`${LOG} MP3 encode runs only in the browser`))
  }

  const w = getWindow()
  if (w.lamejs?.Mp3Encoder) {
    console.debug(`${LOG} lamejs already present`)
    return Promise.resolve(w.lamejs)
  }

  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    console.debug(`${LOG} loading script /vendor/lame.min.js …`)
    const s = document.createElement('script')
    s.src = '/vendor/lame.min.js'
    s.async = true
    s.onload = () => {
      const lj = w.lamejs
      if (!lj?.Mp3Encoder) {
        console.error(`${LOG} after script load, window.lamejs =`, w.lamejs)
        reject(
          new Error(
            `${LOG} lame.min.js ran but Mp3Encoder is missing — check Network tab for /vendor/lame.min.js`,
          ),
        )
        return
      }
      console.debug(`${LOG} lamejs.Mp3Encoder ready`)
      resolve(lj)
    }
    s.onerror = () => {
      console.error(`${LOG} script error for /vendor/lame.min.js`)
      reject(new Error(`${LOG} Failed to load /vendor/lame.min.js (404 or blocked)`))
    }
    document.head.appendChild(s)
  })

  return loadPromise
}
