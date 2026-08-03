/**
 * Reset the shared audio device before every test.
 *
 * `audioDevice()` caches one `AudioContext` for the whole app — that is the
 * point of it. Tests stub `globalThis.AudioContext` per file, so without a
 * reset the first test's context is handed to every later one and their mocks
 * observe nothing.
 */
import { beforeEach } from 'vitest'
import { __setAudioDeviceForTest } from '../audioDevice'

beforeEach(() => {
  __setAudioDeviceForTest(null)
})
