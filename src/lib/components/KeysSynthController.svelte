<script lang="ts">
  /**
   * Headless bridge: APC Key 25 piano KEYBED → the in-app synth. While
   * `enabled`, it listens to the "…Keys" input port only (note on/off +
   * velocity) and plays `synth`. Renders nothing.
   *
   * The keybed is a SEPARATE input port from the control surface, so this can
   * never fire live commands — and the live controller ignores the Keys port,
   * so the two never fight over the device.
   */
  import { onMidiInput } from '$lib/hardware/midiService'
  import { isApcKey25KeysPortName } from '$lib/hardware/apcKey25'
  import type { KeysSynth } from '$lib/audio/keysSynth'

  let { enabled = false, synth }: { enabled?: boolean; synth: KeysSynth } = $props()

  function handle(ev: MIDIMessageEvent) {
    const data = ev.data
    if (!data || data.length < 3) return
    const name = (ev.target as { name?: string | null } | null)?.name ?? null
    if (!isApcKey25KeysPortName(name)) return // keybed only
    const status = data[0]! & 0xf0
    const note = data[1]! & 0x7f
    const vel = data[2]! & 0x7f
    if (status === 0x90 && vel > 0) synth.noteOn(note, vel)
    else if (status === 0x80 || (status === 0x90 && vel === 0)) synth.noteOff(note)
  }

  $effect(() => {
    if (!enabled) return
    const unsub = onMidiInput(handle)
    return () => {
      unsub()
      synth.panic()
    }
  })
</script>
