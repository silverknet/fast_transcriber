import { B as titleCuePreludeSec, L as countInSpeechOutputTimes, R as resolvedSpokenIntroText, V as sortBeatsByTime, Y as effectiveCountInBeats, z as songStartBeat } from "./commit.js";
/** Auto-stop epsilon at clip ends; mirrored in transport / render code. */
var END_EPS = .028;
/**
* Compute the canonical playback plan, or `null` when the song can't
* be played (no trim, no usable timeline).
*/
function songPlaybackPlan(sm) {
	const trim = sm.audio?.trim;
	if (!trim || !(trim.endSec > trim.startSec)) return null;
	const bpm = sm.metadata.bpm && sm.metadata.bpm > 0 ? sm.metadata.bpm : 120;
	const bars = [...sm.timeline.bars].sort((a, b) => a.index - b.index);
	const sortedBeats = sortBeatsByTime(sm.timeline.beats);
	const startBeat = songStartBeat(sm);
	const firstDownbeatOriginalSec = startBeat?.timeSec ?? trim.startSec;
	const startBar = startBeat ? bars.find((b) => b.id === startBeat.barId) : void 0;
	const beatDurationSec = startBar && startBar.beatCount > 0 ? (startBar.endSec - startBar.startSec) / startBar.beatCount : 60 / bpm;
	const countInBeats = effectiveCountInBeats(sm);
	const countInDurationSec = countInBeats * beatDurationSec;
	const effectiveFirstDownbeatSec = firstDownbeatOriginalSec - trim.startSec;
	const prependSec = Math.max(0, countInDurationSec - effectiveFirstDownbeatSec);
	const firstBeat = sortedBeats.find((b) => b.timeSec >= trim.startSec - 1e-9);
	const firstBeatSongTimeSec = firstBeat ? Math.max(0, firstBeat.timeSec - trim.startSec) : 0;
	const titlePreludeSec = titleCuePreludeSec(sm);
	const spokenIntroText = resolvedSpokenIntroText(sm);
	const clickPoints = [];
	if (countInBeats > 0 && startBeat) {
		const grid = countInSpeechOutputTimes(sm, trim, prependSec, countInBeats);
		for (const t of grid) clickPoints.push({
			timeSec: t - prependSec,
			downbeat: false,
			isCountIn: true
		});
	}
	for (const b of sortedBeats) {
		if (b.timeSec < trim.startSec - 1e-9) continue;
		if (b.timeSec >= trim.endSec - END_EPS) continue;
		if (countInBeats > 0 && startBeat && b.timeSec < startBeat.timeSec) continue;
		clickPoints.push({
			timeSec: b.timeSec - trim.startSec,
			downbeat: b.indexInBar === 0,
			isCountIn: false
		});
	}
	clickPoints.sort((a, b) => a.timeSec - b.timeSec);
	return {
		bpm,
		trimStartSec: trim.startSec,
		trimEndSec: trim.endSec,
		songDurationSec: trim.endSec - trim.startSec,
		firstDownbeatOriginalSec,
		beatDurationSec,
		firstBeatSongTimeSec,
		countInBeats,
		countInDurationSec,
		prependSec,
		titlePreludeSec,
		spokenIntroText,
		clickPoints
	};
}
//#endregion
export { songPlaybackPlan as t };
