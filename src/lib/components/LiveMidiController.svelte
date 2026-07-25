<script lang="ts">
  /**
   * Headless live-performance MIDI glue. While `enabled` it maps the APC's
   * buttons to `LiveCommand`s (via the user's learnable mapping) and drives the
   * LEDs: bottom pad row = stems (green on / red muted), top 4 rows = the song's
   * sections (current = yellow, others = blue), plus the mapped transport
   * buttons. Uses the app-wide MIDI service; renders nothing.
   */
  import { onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import {
    parseApcKey25Message,
    apcSingleLedMessage,
    apcTrackButtonLedMessage,
    apcSceneLaunchLedMessage,
    isApcKey25ControlPortName,
    type ApcSingleLedState,
    APC_PLAY_NOTE,
    APC_RECORD_NOTE,
    APC_STOP_ALL_CLIPS_NOTE,
  } from '$lib/hardware/apcKey25'
  import {
    resolveLiveCommand,
    padToSection,
    sectionToPad,
    SECTION_KIND_VELOCITY,
    SECTION_DEFAULT_VELOCITY,
    STEM_ON_VELOCITY,
    CUE_ON_VELOCITY,
    CLICK_ON_VELOCITY,
    type LiveCommand,
    type LiveLedState,
  } from '$lib/hardware/liveMidiMap'
  import { liveMapping } from '$lib/hardware/liveMidiStore'
  import { onMidiInput, sendApc, sendPad, sendPadRaw, sendPadDim, claimLeds, releaseLeds } from '$lib/hardware/midiService'

  let {
    enabled = false,
    onCommand,
    led,
  } = $props<{
    enabled?: boolean
    onCommand: (cmd: LiveCommand) => void
    led?: LiveLedState
  }>()

  let unsub: (() => void) | null = null
  let lastSig = ''

  function handle(ev: MIDIMessageEvent) {
    const data = ev.data
    if (!data) return
    // ONLY the APC Key 25's CONTROL port drives live commands. The MIDI service
    // fans out messages from EVERY connected input, and the mk2 exposes its
    // 25-key piano keybed as a SEPARATE port ("APC Key 25 mk2 Keys") — playing it
    // was being read as pad/scene presses and jumping songs. Ignore the keybed
    // port and any other device. (Unknown/nameless port → allow, so the control
    // surface is never accidentally muted.)
    const portName = (ev.target as { name?: string | null } | null)?.name ?? null
    if (portName != null && !isApcKey25ControlPortName(portName)) return
    const action = parseApcKey25Message(data)
    if (!action) return
    const cmd = resolveLiveCommand(action, get(liveMapping))
    if (cmd) onCommand(cmd)
  }

  /** Light whichever physical button is currently bound to an action. */
  function lightButton(id: string | undefined, state: ApcSingleLedState) {
    if (!id) return
    if (id === 'play') sendApc(apcSingleLedMessage(APC_PLAY_NOTE, state))
    else if (id === 'record') sendApc(apcSingleLedMessage(APC_RECORD_NOTE, state))
    else if (id === 'stop-all') sendApc(apcSingleLedMessage(APC_STOP_ALL_CLIPS_NOTE, state))
    else if (id.startsWith('scene:')) sendApc(apcSceneLaunchLedMessage(Number(id.slice(6)), state))
    else if (id.startsWith('track:')) sendApc(apcTrackButtonLedMessage(Number(id.slice(6)), state))
    // pad:* controls are painted by the grid loop below.
  }

  function sendLeds() {
    if (!enabled || !led) return
    const map = get(liveMapping)
    // Exclude beatOn — the current-section beat blink is a targeted update below,
    // not a full-frame repaint (which would flood MIDI every beat).
    const { beatOn: _beatOn, ...structural } = led
    const sig = JSON.stringify({ structural, map })
    if (sig === lastSig) return
    lastSig = sig

    // Full-frame pad repaint (nothing left stale).
    for (let pad = 0; pad < 40; pad++) {
      if (pad < 8) {
        // Bottom row = live lanes: stem = turquoise, cue = orange, click = white.
        // Bright when audible, dim when muted; dark if no lane at this pad.
        const lane = led.lanes[pad]
        if (!lane) {
          sendPad(pad, 'off')
        } else {
          const vel =
            lane.kind === 'cue' ? CUE_ON_VELOCITY : lane.kind === 'click' ? CLICK_ON_VELOCITY : STEM_ON_VELOCITY
          if (lane.on) sendPadRaw(pad, vel, 'solid')
          else sendPadDim(pad, vel)
        }
        continue
      }
      const s = padToSection(pad)
      if (s === null || s >= led.sectionKinds.length) {
        sendPad(pad, 'off')
      } else {
        // Each section in its BarBro colour; queued blinks. The CURRENT section
        // is solid here — its beat-synced blink is driven separately below.
        const vel = SECTION_KIND_VELOCITY[led.sectionKinds[s]!] ?? SECTION_DEFAULT_VELOCITY
        sendPadRaw(pad, vel, s === led.queuedSection ? 'blink' : 'solid')
      }
    }

    // Buttons: start all dark, then light only the mapped/usable ones so the
    // active control surface stands out and everything else stays off. Engaged
    // states (playing, looping, armed) blink; unavailable moves stay dark.
    sendApc(apcSingleLedMessage(APC_PLAY_NOTE, 'off'))
    sendApc(apcSingleLedMessage(APC_RECORD_NOTE, 'off'))
    sendApc(apcSingleLedMessage(APC_STOP_ALL_CLIPS_NOTE, 'off'))
    for (let i = 0; i < 5; i++) sendApc(apcSceneLaunchLedMessage(i, 'off'))
    for (let i = 0; i < 8; i++) sendApc(apcTrackButtonLedMessage(i, 'off'))

    lightButton(map['play-pause'], led.awaitingStart ? 'blink' : 'on')
    lightButton(map['stop'], 'on')
    lightButton(map['replay-once'], led.replayArmed ? 'blink' : led.canReplay ? 'on' : 'off')
    lightButton(map['prev-song'], led.canPrev ? 'on' : 'off')
    lightButton(map['next-song'], led.canNext ? 'on' : 'off')
    lightButton(map['loop'], led.loopActive ? 'blink' : 'on')
  }

  $effect(() => {
    if (enabled) {
      if (!unsub) unsub = onMidiInput(handle)
      claimLeds()
      lastSig = ''
      sendLeds()
    } else {
      if (unsub) {
        unsub()
        unsub = null
      }
      releaseLeds()
    }
  })

  // Repaint when live state OR the mapping changes.
  $effect(() => {
    void led
    void $liveMapping
    sendLeds()
  })

  // Current-section beat blink — a targeted update on beat/section change only
  // (bright on the beat, dim off it), so it flashes in time with the music.
  let lastBeatSig = ''
  $effect(() => {
    if (!enabled || !led) return
    const s = led.currentSection
    const sig = `${s}:${led.beatOn}`
    if (sig === lastBeatSig) return
    lastBeatSig = sig
    if (s < 0 || s >= led.sectionKinds.length) return
    const pad = sectionToPad(s)
    if (pad == null) return
    const vel = SECTION_KIND_VELOCITY[led.sectionKinds[s]!] ?? SECTION_DEFAULT_VELOCITY
    if (led.beatOn) sendPadRaw(pad, vel, 'solid')
    else sendPadDim(pad, vel)
  })

  onDestroy(() => {
    if (unsub) unsub()
    releaseLeds()
  })
</script>
