/**
 * WHICH CHORD VOICES THE JAM MAY FIRE ON A GIVEN SURFACE.
 *
 * There are two ways a chord can sound in this app:
 *
 *  1. As a MIXER LANE (`chord-machine` / `arp-machine`) — a scheduled MIDI
 *     lane on the engine's clock, with a channel, a fader, a mute, a pill and
 *     a live button.
 *  2. As a JAM VOICE — the Chords tab's "hear chords" preview, fired per frame
 *     by `ChordJam.setPosition` straight into its own audio path. No channel,
 *     no fader, no mute, nothing on screen.
 *
 * On the MIXER surface only (1) is allowed. Ever. Two reasons, and they are
 * different failures:
 *
 *  - a voice that is hosted as a lane and ALSO fired by the jam sounds TWICE,
 *    once on each clock;
 *  - the jam copy cannot be turned off. Muting the lane, pressing its live
 *    pad, pulling its fader — none of it touches the jam voice, because the
 *    jam voice was never in the mixer's graph. On stage that is a chord track
 *    you cannot stop.
 *
 * The mixer used to compute this list by EXCLUDING a voice when its lane
 * existed, which is precisely inverted: adding the Chords track to the mixer
 * was what switched the unstoppable parallel copy ON. It only bit when both
 * halves were armed — the lane added here, "hear chords" ticked over in the
 * Chords tab, each remembered separately in localStorage — which is why it
 * came and went between songs and sessions and read as "sometimes".
 *
 * What you see is what sounds. On the mixer, the jam fires nothing.
 */

/** The jam's three voices. */
export const JAM_VOICES = ['keys', 'bass', 'arp'] as const

export type JamVoiceName = (typeof JAM_VOICES)[number]

/**
 * Voices the JAM must not fire on the mixer/live surface — all of them.
 *
 * Takes the lane keys so the rule is stated against the thing that tempted the
 * original bug ("but this one has a lane…") and so a test can prove that
 * hosting a lane does NOT open a second path.
 */
export function jamVoicesSuppressedInMixer(_laneKeys: readonly string[] = []): JamVoiceName[] {
  return [...JAM_VOICES]
}

/**
 * Voices the jam may fire on the CHORDS TAB, where previewing is the whole
 * point and there is no mixer lane playing them.
 */
export function jamVoicesSuppressedInEditor(): JamVoiceName[] {
  return []
}
