import { writable } from 'svelte/store'

export type AudioSession = {
  file: File | null
  name: string
  startSec: number
  endSec: number
}

export const audioSession = writable<AudioSession>({
  file: null,
  name: '',
  startSec: 0,
  endSec: 0,
})
