import "../../../chunks/index-server.js";
import { A as escape_html, N as get, h as unsubscribe_stores } from "../../../chunks/server.js";
import "../../../chunks/index-server2.js";
import { d as validateSongMap } from "../../../chunks/persist.js";
import { n as goto } from "../../../chunks/client.js";
import { A as patchSongMap, K as sortBeatsByTime, L as mergeAnalysisIntoSongMap, M as songMap, P as evenBeatTimes, z as createSongMapFromAudioSession } from "../../../chunks/commit.js";
import { r as analyzeDownbeatsViaDesktop, v as Button } from "../../../chunks/desktopBridge.js";
import { t as desktopCompanionStatus } from "../../../chunks/desktopCompanionStatus.js";
import "../../../chunks/stores.js";
import { t as analyzingState } from "../../../chunks/analyzingState.js";
import { t as setAnalyzingSpin } from "../../../chunks/uiAnimations.js";
import { n as trimAudioFileToWav } from "../../../chunks/trimAudio.js";
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
	if (trimmed.length === 0) throw new Error("No beats detected");
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
//#region src/routes/analyzing/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let status = "running";
		let errorMsg = "";
		async function run() {
			const state = get(analyzingState);
			const sm = get(songMap);
			if (!state || !sm?.audio) {
				await goto("/");
				return;
			}
			const trim = sm.audio.trim;
			setAnalyzingSpin(true);
			try {
				const { file: trimmedWav } = await trimAudioFileToWav(state.hqFile, trim.startSec, trim.endSec);
				if (!get(desktopCompanionStatus).reachable) throw new Error("BarBro Desktop sidecar isn’t running. Start it and reload.");
				const r = await analyzeDownbeatsViaDesktop(trimmedWav);
				if (!r.ok) throw new Error(`Analysis failed: ${r.error ?? "unknown sidecar error"}`);
				const analyzedSongMap = beatsToSongMap({
					filename: trimmedWav.name,
					durationSec: Math.max(0, trim.endSec - trim.startSec),
					mimeType: trimmedWav.type || "audio/wav",
					beats: r.beats
				});
				const fragment = {
					bars: analyzedSongMap.timeline.bars,
					beats: analyzedSongMap.timeline.beats,
					bpm: analyzedSongMap.metadata.bpm
				};
				const patched = patchSongMap((current) => {
					const merged = mergeAnalysisIntoSongMap(current, fragment);
					return {
						...merged,
						metadata: {
							...merged.metadata,
							...fragment.bpm !== void 0 ? { bpm: fragment.bpm } : {},
							analyzed: true
						}
					};
				});
				if (!patched.ok) throw new Error(patched.errors.join("; "));
				analyzingState.set(null);
				status = "done";
				await goto("/edit");
			} catch (e) {
				errorMsg = e instanceof Error ? e.message : "Analysis failed. Please try again.";
				status = "error";
			} finally {
				setAnalyzingSpin(false);
			}
		}
		async function retry() {
			status = "running";
			errorMsg = "";
			await run();
		}
		function cancel() {
			analyzingState.set(null);
			goto("/");
		}
		$$renderer.push(`<canvas class="fixed inset-0 -z-10 h-full w-full pointer-events-none" aria-hidden="true"></canvas> <main class="relative z-10 mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-8 px-6 py-16">`);
		if (status === "running") {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="flex flex-col items-center gap-6 text-center"><div class="border-muted-foreground/30 border-t-foreground/80 size-16 animate-spin rounded-full border-4"></div> <div class="flex flex-col gap-2"><h1 class="text-2xl font-black tracking-tight">Analyzing</h1> <p class="text-muted-foreground text-sm">Detecting beats and bars from your audio. This takes a few seconds.</p></div></div>`);
		} else if (status === "error") {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<div class="brutalist-shadow border-foreground bg-background w-full max-w-md border-2 p-8 text-center"><h1 class="mb-3 text-xl font-black">Analysis failed</h1> <p class="text-muted-foreground mb-6 text-sm">${escape_html(errorMsg)}</p> <div class="flex justify-center gap-3">`);
			Button($$renderer, {
				class: "",
				variant: "default",
				onclick: retry,
				children: ($$renderer) => {
					$$renderer.push(`<!---->Try again`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----> `);
			Button($$renderer, {
				class: "",
				variant: "outline",
				onclick: cancel,
				children: ($$renderer) => {
					$$renderer.push(`<!---->Back to import`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></main>`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
export { _page as default };
