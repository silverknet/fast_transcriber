import { n as defaultCueSettings, r as emptySongMetadata, t as validateSongMap } from "./validate.js";
//#region src/lib/songmap/factory.ts
var defaultIdFactory = () => crypto.randomUUID();
function createEmptySongMap(options = {}) {
	return {
		formatVersion: 1,
		app: { name: "BarBro" },
		metadata: emptySongMetadata(options.now?.() ?? (/* @__PURE__ */ new Date()).toISOString()),
		timeline: {
			bars: [],
			beats: []
		},
		sections: [],
		harmony: [],
		cues: defaultCueSettings()
	};
}
/**
* Builds a SongMap with `AudioReference` from the current session and empty timeline.
* Bars/beats are filled by analysis or import later.
*/
function createSongMapFromAudioSession(session, options = {}) {
	const nowIso = options.now?.() ?? (/* @__PURE__ */ new Date()).toISOString();
	const baseName = session.name.replace(/\.[^.]+$/, "") || "Untitled";
	const title = options.title ?? baseName;
	const map = createEmptySongMap({
		...options,
		now: () => nowIso
	});
	map.metadata = {
		...map.metadata,
		title,
		createdAt: nowIso,
		updatedAt: nowIso
	};
	map.audio = {
		fileName: session.name,
		mimeType: session.file?.type,
		durationSec: Math.max(0, session.endSec - session.startSec),
		trim: {
			startSec: session.startSec,
			endSec: session.endSec
		},
		source: "upload"
	};
	return map;
}
function newId(factory = defaultIdFactory) {
	return factory();
}
//#endregion
//#region src/lib/songmap/merge.ts
/**
* Merges analysis fragments into a copy of `map` and bumps `metadata.updatedAt`.
* Replaces `timeline.bars` / `timeline.beats` when the fragment includes them.
*/
function mergeAnalysisIntoSongMap(map, fragment) {
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const next = {
		...map,
		metadata: {
			...map.metadata,
			updatedAt: now
		},
		timeline: {
			bars: fragment.bars ?? map.timeline.bars,
			beats: fragment.beats ?? map.timeline.beats
		}
	};
	const v = validateSongMap(next);
	if (!v.ok) throw new Error(`mergeAnalysisIntoSongMap: invalid result — ${v.errors.join("; ")}`);
	return next;
}
//#endregion
//#region src/lib/songmap/normalize.ts
/** Sort bars by `index` ascending (stable for already-sorted lists). */
function sortBarsByIndex(bars) {
	return [...bars].sort((a, b) => a.index - b.index);
}
/** Sort beats by `timeSec`, then `id`. */
function sortBeatsByTime(beats) {
	return [...beats].sort((a, b) => a.timeSec - b.timeSec || a.id.localeCompare(b.id));
}
//#endregion
//#region src/lib/songmap/timelineEdit.ts
var T_EPS = 1e-4;
function ok(map) {
	return {
		ok: true,
		map
	};
}
function fail(error) {
	return {
		ok: false,
		error
	};
}
function beatsForBarByIndex(map, barId) {
	return [...map.timeline.beats.filter((b) => b.barId === barId)].sort((a, b) => a.indexInBar - b.indexInBar);
}
function barById(map, barId) {
	return map.timeline.bars.find((b) => b.id === barId);
}
/** `timeSec[i] = startSec + (i/n) * (endSec - startSec)` for `i = 0..n-1`. */
function evenBeatTimes(bar, n) {
	const D = bar.endSec - bar.startSec;
	if (n < 1 || !(D > 0)) return [];
	const out = [];
	for (let i = 0; i < n; i++) out.push(bar.startSec + i / n * D);
	return out;
}
function replaceBarBeats(map, barId, nextInBar) {
	const bar = barById(map, barId);
	if (!bar) return map;
	const ordered = [...nextInBar].sort((a, b) => a.indexInBar - b.indexInBar);
	const nextBar = {
		...bar,
		beatCount: ordered.length,
		beatIds: ordered.map((b) => b.id),
		meter: {
			...bar.meter,
			numerator: ordered.length
		}
	};
	const otherBeats = map.timeline.beats.filter((b) => b.barId !== barId);
	return {
		...map,
		timeline: {
			...map.timeline,
			bars: map.timeline.bars.map((b) => b.id === barId ? nextBar : b),
			beats: sortBeatsByTime([...otherBeats, ...ordered])
		}
	};
}
/** Minimum bar length (seconds) when stretching boundaries — keeps room for evenly spaced beats. */
function minBarDurationSec(bar) {
	return Math.max(.1, bar.beatCount * .032);
}
/**
* Move a bar boundary in time: **left** edge drags the start of `barId` (and the previous bar’s end);
* **right** edge drags the end of `barId` (and the next bar’s start, or extends the last bar to `timelineMaxSec`).
* Beats in each affected bar are re-equalized on the new interval.
*
* `timelineMinSec` / `timelineMaxSec` clamp the outer song timeline (e.g. 0 … decoded duration).
*/
function setBarBoundary(map, barId, edge, boundarySec, timelineMinSec, timelineMaxSec) {
	const sorted = sortBarsByIndex(map.timeline.bars);
	const i = sorted.findIndex((b) => b.id === barId);
	if (i < 0) return fail(`Unknown bar ${barId}`);
	const cur = sorted[i];
	const replaceTwoBars = (a, b) => {
		const bars = sortBarsByIndex([
			...map.timeline.bars.filter((x) => x.id !== a.id && x.id !== b.id),
			a,
			b
		]).map((x, j) => ({
			...x,
			index: j
		}));
		return {
			...map,
			timeline: {
				...map.timeline,
				bars
			}
		};
	};
	const replaceOneBar = (a) => {
		const bars = sortBarsByIndex([...map.timeline.bars.filter((x) => x.id !== a.id), a]).map((x, j) => ({
			...x,
			index: j
		}));
		return {
			...map,
			timeline: {
				...map.timeline,
				bars
			}
		};
	};
	if (edge === "left") {
		if (i === 0) {
			const hi = cur.endSec - minBarDurationSec(cur);
			const lo = timelineMinSec;
			if (!(hi > lo + T_EPS)) return fail("Bar is too short to stretch");
			const newB = Math.min(Math.max(boundarySec, lo), hi);
			return redistributeBeatsEvenly(replaceOneBar({
				...cur,
				startSec: newB
			}), cur.id);
		}
		const prev = sorted[i - 1];
		const lo = prev.startSec + minBarDurationSec(prev);
		const hi = cur.endSec - minBarDurationSec(cur);
		if (!(hi > lo + T_EPS)) return fail("Adjacent bars too tight");
		const newB = Math.min(Math.max(boundarySec, lo), hi);
		let nextMap = replaceTwoBars({
			...prev,
			endSec: newB
		}, {
			...cur,
			startSec: newB
		});
		const r1 = redistributeBeatsEvenly(nextMap, prev.id);
		if (!r1.ok) return r1;
		nextMap = r1.map;
		return redistributeBeatsEvenly(nextMap, cur.id);
	}
	const hiBound = timelineMaxSec > timelineMinSec + T_EPS ? timelineMaxSec : sorted[sorted.length - 1].endSec + 120;
	if (i >= sorted.length - 1) {
		const lo = cur.startSec + minBarDurationSec(cur);
		if (!(hiBound > lo + T_EPS)) return fail("No room to extend last bar");
		const newB = Math.min(Math.max(boundarySec, lo), hiBound);
		return redistributeBeatsEvenly(replaceOneBar({
			...cur,
			endSec: newB
		}), cur.id);
	}
	const next = sorted[i + 1];
	const lo = cur.startSec + minBarDurationSec(cur);
	const hi = next.endSec - minBarDurationSec(next);
	if (!(hi > lo + T_EPS)) return fail("Adjacent bars too tight");
	const newB = Math.min(Math.max(boundarySec, lo), hi);
	let nextMap = replaceTwoBars({
		...cur,
		endSec: newB
	}, {
		...next,
		startSec: newB
	});
	const r1 = redistributeBeatsEvenly(nextMap, cur.id);
	if (!r1.ok) return r1;
	nextMap = r1.map;
	return redistributeBeatsEvenly(nextMap, next.id);
}
/**
* Rewrite every beat in the bar so `timeSec` matches equal spacing for the current
* `[startSec,endSec)` and `beatCount`.
*/
function redistributeBeatsEvenly(map, barId) {
	const bar = barById(map, barId);
	if (!bar) return fail(`Unknown bar ${barId}`);
	const inBar = beatsForBarByIndex(map, barId);
	if (inBar.length === 0) return ok(map);
	if (inBar.length !== bar.beatCount) return fail(`Bar ${barId}: beat list length does not match beatCount`);
	const n = inBar.length;
	if (!(bar.endSec - bar.startSec > 0)) return fail("Bar has no usable duration");
	const times = evenBeatTimes(bar, n);
	const updated = inBar.map((b, i) => ({
		...b,
		timeSec: times[i]
	}));
	const other = map.timeline.beats.filter((b) => b.barId !== barId);
	return ok({
		...map,
		timeline: {
			...map.timeline,
			beats: sortBeatsByTime([...other, ...updated])
		}
	});
}
/**
* Set the number of beats in a bar; times are always re-derived (equal spacing).
* Extra beats are dropped from the end (by index); new beats get fresh ids.
*/
function setBarBeatCount(map, barId, count, idFactory) {
	const bar = barById(map, barId);
	if (!bar) return fail(`Unknown bar ${barId}`);
	if (!(bar.endSec - bar.startSec > 0)) return fail("Bar has no usable duration");
	const n = Math.max(1, Math.min(32, Math.floor(count)));
	const cur = beatsForBarByIndex(map, barId);
	let nextBeats;
	if (n === cur.length) nextBeats = cur;
	else if (n < cur.length) nextBeats = cur.slice(0, n).map((b, i) => ({
		...b,
		indexInBar: i
	}));
	else {
		nextBeats = cur.map((b, i) => ({
			...b,
			indexInBar: i
		}));
		const source = cur[0]?.source ?? "manual";
		for (let i = cur.length; i < n; i++) nextBeats.push({
			id: idFactory(),
			barId,
			indexInBar: i,
			timeSec: bar.startSec,
			source
		});
	}
	return redistributeBeatsEvenly(replaceBarBeats(map, barId, nextBeats), barId);
}
function splitHarmonyOnBarDivide(harmony, oldBarId, newBarId, splitSec) {
	const out = [];
	for (const h of harmony) {
		if (h.barId !== oldBarId) {
			out.push(h);
			continue;
		}
		if (h.startSec >= splitSec - 1e-9) {
			out.push({
				...h,
				barId: newBarId
			});
			continue;
		}
		if (h.endSec <= splitSec + 1e-9) {
			out.push(h);
			continue;
		}
		const clipped = {
			...h,
			endSec: splitSec
		};
		if (clipped.endSec > clipped.startSec + 1e-9) out.push(clipped);
	}
	return out;
}
/**
* Split `[startSec,endSec)` at the midpoint in time. Beats split as
* `nLeft = max(1, floor(n/2))`, `nRight = n - nLeft` (requires `n >= 2`).
*/
function splitBarAtMidpoint(map, barId, idFactory) {
	const bar = barById(map, barId);
	if (!bar) return fail(`Unknown bar ${barId}`);
	const byIdx = beatsForBarByIndex(map, bar.id);
	const n = byIdx.length;
	if (n < 2) return fail("Need at least two beats to split a bar");
	const T = (bar.startSec + bar.endSec) * .5;
	if (!(T > bar.startSec + T_EPS && T < bar.endSec - T_EPS)) return fail("Bar is too short to split at the midpoint");
	const nLeft = Math.max(1, Math.floor(n / 2));
	if (n - nLeft < 1) return fail("Invalid beat partition");
	const leftSlice = byIdx.slice(0, nLeft).map((b, i) => ({
		...b,
		barId: bar.id,
		indexInBar: i
	}));
	const newBarId = idFactory();
	const rightSlice = byIdx.slice(nLeft).map((b, i) => ({
		...b,
		barId: newBarId,
		indexInBar: i
	}));
	const leftBar = {
		...bar,
		endSec: T,
		beatCount: leftSlice.length,
		beatIds: leftSlice.map((b) => b.id),
		meter: {
			...bar.meter,
			numerator: leftSlice.length
		}
	};
	const newBar = {
		id: newBarId,
		index: bar.index + 1,
		startSec: T,
		endSec: bar.endSec,
		beatCount: rightSlice.length,
		beatIds: rightSlice.map((b) => b.id),
		meter: {
			numerator: rightSlice.length,
			denominator: bar.meter.denominator
		}
	};
	const normalizedBars = [
		...map.timeline.bars.filter((b) => b.id !== bar.id),
		leftBar,
		newBar
	].sort((a, b) => a.startSec - b.startSec || a.index - b.index).map((b, i) => ({
		...b,
		index: i
	}));
	let allBeats = sortBeatsByTime([
		...map.timeline.beats.filter((b) => b.barId !== bar.id),
		...leftSlice,
		...rightSlice
	]);
	const splitAt = bar.index;
	const sections = map.sections.map((s) => ({
		...s,
		barRange: {
			startBarIndex: s.barRange.startBarIndex > splitAt ? s.barRange.startBarIndex + 1 : s.barRange.startBarIndex,
			endBarIndex: s.barRange.endBarIndex >= splitAt ? s.barRange.endBarIndex + 1 : s.barRange.endBarIndex
		}
	}));
	const harmony = splitHarmonyOnBarDivide(map.harmony, bar.id, newBarId, T);
	let next = {
		...map,
		timeline: {
			bars: normalizedBars,
			beats: allBeats
		},
		sections,
		harmony
	};
	const r1 = redistributeBeatsEvenly(next, bar.id);
	if (!r1.ok) return r1;
	next = r1.map;
	const r2 = redistributeBeatsEvenly(next, newBarId);
	if (!r2.ok) return r2;
	return ok(r2.map);
}
/**
* Merges this bar into the previous one (removes a bar line). First bar cannot merge.
* Beat times are re-equalized over the combined interval.
*/
function mergeBarWithPrevious(map, barId) {
	const barsSorted = sortBarsByIndex(map.timeline.bars);
	const i = barsSorted.findIndex((b) => b.id === barId);
	if (i <= 0) return fail("No previous bar to merge into");
	const prev = barsSorted[i - 1];
	const cur = barsSorted[i];
	const prevBeats = beatsForBarByIndex(map, prev.id);
	const curBeats = beatsForBarByIndex(map, cur.id);
	const mergedBeats = [...prevBeats, ...curBeats.map((b, k) => ({
		...b,
		barId: prev.id,
		indexInBar: prevBeats.length + k
	}))];
	const mergedBar = {
		...prev,
		endSec: cur.endSec,
		beatCount: mergedBeats.length,
		beatIds: mergedBeats.map((b) => b.id),
		meter: {
			...prev.meter,
			numerator: mergedBeats.length
		}
	};
	const normalizedBars = [...map.timeline.bars.filter((b) => b.id !== prev.id && b.id !== cur.id), mergedBar].sort((a, b) => a.startSec - b.startSec).map((b, j) => ({
		...b,
		index: j
	}));
	const allBeats = sortBeatsByTime([...map.timeline.beats.filter((b) => b.barId !== prev.id && b.barId !== cur.id), ...mergedBeats]);
	const removedIndex = cur.index;
	const sections = map.sections.map((s) => {
		let a = s.barRange.startBarIndex;
		let b = s.barRange.endBarIndex;
		if (a > removedIndex) a -= 1;
		if (b >= removedIndex) b -= 1;
		if (a > b) b = a;
		return {
			...s,
			barRange: {
				startBarIndex: a,
				endBarIndex: b
			}
		};
	});
	const harmony = map.harmony.map((h) => h.barId === cur.id ? {
		...h,
		barId: prev.id
	} : h);
	return redistributeBeatsEvenly({
		...map,
		timeline: {
			bars: normalizedBars,
			beats: allBeats
		},
		sections,
		harmony
	}, prev.id);
}
/** Shift all timeline times (bars, beats, harmony) — used when prepending a bar at t=0. */
function shiftTimeline(map, deltaSec) {
	return {
		...map,
		timeline: {
			bars: map.timeline.bars.map((b) => ({
				...b,
				startSec: b.startSec + deltaSec,
				endSec: b.endSec + deltaSec
			})),
			beats: map.timeline.beats.map((b) => ({
				...b,
				timeSec: b.timeSec + deltaSec
			}))
		},
		harmony: map.harmony.map((h) => ({
			...h,
			startSec: h.startSec + deltaSec,
			endSec: h.endSec + deltaSec
		}))
	};
}
function removeBarById(map, barId) {
	const bar = barById(map, barId);
	if (!bar) return fail(`Unknown bar ${barId}`);
	const ri = bar.index;
	const normalizedBars = map.timeline.bars.filter((b) => b.id !== barId).sort((a, b) => a.startSec - b.startSec).map((b, i) => ({
		...b,
		index: i
	}));
	const otherBeats = map.timeline.beats.filter((b) => b.barId !== barId);
	const sections = map.sections.map((s) => {
		let a = s.barRange.startBarIndex;
		let b = s.barRange.endBarIndex;
		if (a > ri) a -= 1;
		if (b >= ri) b -= 1;
		if (a > b) b = a;
		return {
			...s,
			barRange: {
				startBarIndex: a,
				endBarIndex: b
			}
		};
	});
	const harmony = map.harmony.filter((h) => h.barId !== barId);
	return ok({
		...map,
		timeline: {
			bars: normalizedBars,
			beats: sortBeatsByTime(otherBeats)
		},
		sections,
		harmony
	});
}
/**
* Insert a bar before the first bar. If the first bar starts too early to fit another bar of the
* same duration before it, the whole timeline is shifted forward first.
*/
function addBarAtStart(map, idFactory) {
	const sorted = sortBarsByIndex(map.timeline.bars);
	if (sorted.length === 0) return fail("No bars — analyze audio first");
	const first = sorted[0];
	const D = Math.max(.25, first.endSec - first.startSec);
	const beatCount = Math.max(1, Math.min(32, first.beatCount));
	const denom = first.meter.denominator;
	let m = map;
	if (first.startSec < D - 1e-9) m = shiftTimeline(m, D);
	const sorted2 = sortBarsByIndex(m.timeline.bars);
	const first2 = sorted2[0];
	const startSec = first2.startSec - D;
	const endSec = first2.startSec;
	if (!(startSec < endSec - T_EPS)) return fail("Cannot add bar at start");
	const barId = idFactory();
	const beatIds = [];
	const beats = [];
	for (let i = 0; i < beatCount; i++) {
		const bid = idFactory();
		beatIds.push(bid);
		beats.push({
			id: bid,
			barId,
			indexInBar: i,
			timeSec: 0,
			source: "manual"
		});
	}
	const allBars = [{
		id: barId,
		index: 0,
		startSec,
		endSec,
		meter: {
			numerator: beatCount,
			denominator: denom
		},
		beatCount,
		beatIds
	}, ...sorted2].sort((a, b) => a.startSec - b.startSec).map((b, i) => ({
		...b,
		index: i
	}));
	const otherBeats = m.timeline.beats;
	const allBeats = sortBeatsByTime([...otherBeats, ...beats]);
	const sections = m.sections.map((s) => ({
		...s,
		barRange: {
			startBarIndex: s.barRange.startBarIndex + 1,
			endBarIndex: s.barRange.endBarIndex + 1
		}
	}));
	return redistributeBeatsEvenly({
		...m,
		timeline: {
			bars: allBars,
			beats: allBeats
		},
		sections
	}, barId);
}
/** Append a bar after the last bar with the same duration and beat count template as the last bar. */
function addBarAtEnd(map, idFactory) {
	const sorted = sortBarsByIndex(map.timeline.bars);
	if (sorted.length === 0) return fail("No bars — analyze audio first");
	const last = sorted[sorted.length - 1];
	const D = Math.max(.25, last.endSec - last.startSec);
	const beatCount = Math.max(1, Math.min(32, last.beatCount));
	const denom = last.meter.denominator;
	const startSec = last.endSec;
	const endSec = last.endSec + D;
	const barId = idFactory();
	const beatIds = [];
	const beats = [];
	for (let i = 0; i < beatCount; i++) {
		const bid = idFactory();
		beatIds.push(bid);
		beats.push({
			id: bid,
			barId,
			indexInBar: i,
			timeSec: 0,
			source: "manual"
		});
	}
	const newBar = {
		id: barId,
		index: sorted.length,
		startSec,
		endSec,
		meter: {
			numerator: beatCount,
			denominator: denom
		},
		beatCount,
		beatIds
	};
	const allBars = [...sorted, newBar].map((b, i) => ({
		...b,
		index: i
	}));
	const allBeats = sortBeatsByTime([...map.timeline.beats, ...beats]);
	return redistributeBeatsEvenly({
		...map,
		timeline: {
			bars: allBars,
			beats: allBeats
		}
	}, barId);
}
function removeBarAtStart(map) {
	const sorted = sortBarsByIndex(map.timeline.bars);
	if (sorted.length === 0) return fail("No bars");
	if (sorted.length <= 1) return fail("Cannot remove the only bar");
	return removeBarById(map, sorted[0].id);
}
function removeBarAtEnd(map) {
	const sorted = sortBarsByIndex(map.timeline.bars);
	if (sorted.length === 0) return fail("No bars");
	if (sorted.length <= 1) return fail("Cannot remove the only bar");
	return removeBarById(map, sorted[sorted.length - 1].id);
}
function applyBarGridAction(map, action, idFactory) {
	switch (action.type) {
		case "setBarBoundary": return setBarBoundary(map, action.barId, action.edge, action.boundarySec, action.timelineMinSec, action.timelineMaxSec);
		case "setBarBeatCount": return setBarBeatCount(map, action.barId, action.count, idFactory);
		case "splitBarAtMidpoint": return splitBarAtMidpoint(map, action.barId, idFactory);
		case "mergeBarWithPrevious": return mergeBarWithPrevious(map, action.barId);
		case "redistributeBar": return redistributeBeatsEvenly(map, action.barId);
		case "addBarAtStart": return addBarAtStart(map, idFactory);
		case "addBarAtEnd": return addBarAtEnd(map, idFactory);
		case "removeBarAtStart": return removeBarAtStart(map);
		case "removeBarAtEnd": return removeBarAtEnd(map);
		default: return fail("Unknown bar grid action");
	}
}
//#endregion
export { createEmptySongMap as a, mergeAnalysisIntoSongMap as i, evenBeatTimes as n, createSongMapFromAudioSession as o, sortBeatsByTime as r, newId as s, applyBarGridAction as t };
