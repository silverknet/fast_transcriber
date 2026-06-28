import { F as mergeAnalysisIntoSongMap, V as sortBeatsByTime, Z as createSongMapFromAudioSession, j as evenBeatTimes } from "./commit.js";
import { c as validateSongMap } from "./smapFile.js";
//#region src/lib/analysis/beatsToSongMap.ts
function medianSorted(values) {
	if (values.length === 0) return .5;
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
/** Aligns beat times with equal spacing inside each bar (bar interval is authoritative). */
function applyEvenSpacingToBeats(map) {
	const barById = new Map(map.timeline.bars.map((b) => [b.id, b]));
	const byBar = /* @__PURE__ */ new Map();
	for (const b of map.timeline.beats) {
		const arr = byBar.get(b.barId) ?? [];
		arr.push(b);
		byBar.set(b.barId, arr);
	}
	const next = [];
	for (const [barId, list] of byBar) {
		const bar = barById.get(barId);
		if (!bar) continue;
		const sorted = [...list].sort((a, b) => a.indexInBar - b.indexInBar || a.id.localeCompare(b.id));
		const n = sorted.length;
		const times = evenBeatTimes(bar, n);
		for (let i = 0; i < n; i++) next.push({
			...sorted[i],
			indexInBar: i,
			timeSec: times[i]
		});
	}
	return {
		...map,
		timeline: {
			...map.timeline,
			beats: sortBeatsByTime(next)
		}
	};
}
/**
* Converts madmom-style rows into a valid SongMap v1 (bars from downbeats, flat beats).
*/
function beatsToSongMap(input) {
	const id = input.idFactory ?? (() => crypto.randomUUID());
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const rows = [...input.beats].filter((b) => Number.isFinite(b.time) && Number.isFinite(b.beatInBar)).sort((a, b) => a.time - b.time);
	const firstDown = rows.findIndex((b) => b.beatInBar === 1);
	const trimmed = firstDown >= 0 ? rows.slice(firstDown) : rows;
	if (trimmed.length === 0) {
		if (input.beats.length === 0) throw new Error("The analyzer found no beats. The selected audio region may be too short, too quiet, or have no clear rhythm — try a longer region with audible drums.");
		throw new Error(`The analyzer returned ${input.beats.length} beats but none were valid (missing time or beatInBar). This is a sidecar bug — please report it.`);
	}
	const segments = [];
	let seg = [];
	for (const b of trimmed) if (b.beatInBar === 1 && seg.length > 0) {
		segments.push(seg);
		seg = [b];
	} else seg.push(b);
	if (seg.length) segments.push(seg);
	const intervals = [];
	for (let i = 1; i < trimmed.length; i++) intervals.push(trimmed[i].time - trimmed[i - 1].time);
	const medianBeat = medianSorted(intervals.filter((x) => x > 0));
	const bpm = medianBeat > 1e-6 ? Math.round(60 / medianBeat * 100) / 100 : void 0;
	const bars = [];
	const beats = [];
	for (let bi = 0; bi < segments.length; bi++) {
		const segment = segments[bi];
		const barId = id();
		const beatCount = segment.length;
		const beatIds = [];
		const startSec = segment[0].time;
		const nextStart = bi + 1 < segments.length ? segments[bi + 1][0].time : null;
		const lastT = segment[segment.length - 1].time;
		let endSec;
		if (nextStart !== null) endSec = nextStart;
		else {
			endSec = Math.min(input.durationSec, lastT + medianBeat);
			if (endSec <= lastT) endSec = lastT + Math.max(medianBeat * .25, .001);
			endSec = Math.min(endSec, input.durationSec + 1e6);
			if (endSec <= lastT) endSec = lastT + .001;
		}
		const times = evenBeatTimes({
			id: barId,
			index: bi,
			startSec,
			endSec,
			meter: {
				numerator: beatCount,
				denominator: 4
			},
			beatCount,
			beatIds: []
		}, beatCount);
		const segByBeatInBar = [...segment].sort((a, b) => a.beatInBar - b.beatInBar);
		for (let k = 0; k < segByBeatInBar.length; k++) {
			const bid = id();
			beatIds.push(bid);
			beats.push({
				id: bid,
				barId,
				indexInBar: k,
				timeSec: times[k],
				source: "detected"
			});
		}
		bars.push({
			id: barId,
			index: bi,
			startSec,
			endSec,
			meter: {
				numerator: beatCount,
				denominator: 4
			},
			beatCount,
			beatIds
		});
	}
	const titleStem = input.filename.replace(/\.[^.]+$/, "") || "Untitled";
	const base = createSongMapFromAudioSession({
		file: null,
		name: input.filename,
		startSec: 0,
		endSec: input.durationSec
	}, { title: titleStem });
	if (input.mimeType) base.audio = {
		...base.audio,
		mimeType: input.mimeType
	};
	let map = mergeAnalysisIntoSongMap(base, {
		bars,
		beats
	});
	map = applyEvenSpacingToBeats(map);
	map = {
		...map,
		metadata: {
			...map.metadata,
			...bpm !== void 0 ? { bpm } : {},
			updatedAt: now,
			analyzed: true
		}
	};
	const v = validateSongMap(map);
	if (!v.ok) throw new Error(`Invalid SongMap: ${v.errors.join("; ")}`);
	return map;
}
//#endregion
export { beatsToSongMap as t };
