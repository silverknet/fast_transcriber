import { r as onDestroy } from "../../../chunks/index-server.js";
import { a as derived, h as unsubscribe_stores, p as store_get } from "../../../chunks/server.js";
import "../../../chunks/index-server2.js";
import "../../../chunks/timelineEdit.js";
import "../../../chunks/persist.js";
import "../../../chunks/client.js";
import { D as songMap, F as computeCountIn, I as audioSession } from "../../../chunks/commit.js";
import "../../../chunks/button.js";
import "../../../chunks/Icon.js";
import "../../../chunks/desktopCompanionStatus.js";
import "../../../chunks/desktopBridge.js";
import "../../../chunks/arrow-left.js";
import "../../../chunks/renderCueTrack.js";
import "../../../chunks/play.js";
import "../../../chunks/WaveformPlayer.js";
//#endregion
//#region src/lib/chords/pitchClass.ts
/** C = 0 … B = 11 */
var LETTER_PC = {
	C: 0,
	D: 2,
	E: 4,
	F: 5,
	G: 7,
	A: 9,
	B: 11
};
function chordRootToPitchClass(root, accidental) {
	let pc = LETTER_PC[root];
	if (accidental === "sharp") pc = (pc + 1) % 12;
	if (accidental === "flat") pc = (pc + 11) % 12;
	if (accidental === "natural") {}
	return pc % 12;
}
//#endregion
//#region src/lib/chords/formatChordSymbol.ts
function formatRoot(root, accidental) {
	let s = root;
	if (accidental === "sharp") s += "#";
	else if (accidental === "flat") s += "b";
	else if (accidental === "natural") s += "♮";
	return s;
}
function qualitySuffix(quality, extensions) {
	const q = quality ?? "major";
	let base = {
		major: "",
		minor: "m",
		dim: "dim",
		aug: "aug",
		"7": "7",
		maj7: "maj7",
		min7: "m7",
		sus2: "sus2",
		sus4: "sus4",
		add9: "add9"
	}[q] ?? q;
	if (q === "minor" && base === "m") base = "m";
	if (extensions?.length) {
		const ext = extensions.filter(Boolean).join("");
		if (q === "7" && ext) return `7(${ext})`;
		if (ext && !base.includes(ext)) base += ext;
	}
	return base;
}
/**
* Format structured chord for display (ASCII `#` `b`).
*/
function formatChordSymbol(chord, _opts) {
	let s = formatRoot(chord.root, chord.accidental);
	s += qualitySuffix(chord.quality, chord.extensions);
	if (chord.bass) s += "/" + formatRoot(chord.bass, chord.bassAccidental);
	return s;
}
function songKeyPreferFlats(key) {
	const pc = chordRootToPitchClass(key.root, key.accidental);
	const flatMajor = new Set([
		5,
		10,
		3,
		8,
		1,
		6,
		11
	]);
	const flatMinor = new Set([
		8,
		1,
		3,
		6,
		10,
		2,
		5
	]);
	return key.mode === "major" ? flatMajor.has(pc) : flatMinor.has(pc);
}
//#endregion
//#region src/routes/edit/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		store_get($$store_subs ??= {}, "$audioSession", audioSession).startSec;
		store_get($$store_subs ??= {}, "$audioSession", audioSession).endSec;
		let keyDraft = {
			root: "C",
			mode: "major"
		};
		derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			if (!sm) return {};
			const key = sm.metadata.keyDetail;
			const preferFlats = key ? songKeyPreferFlats(key) : false;
			const out = {};
			for (const h of sm.harmony) {
				if (!h.beatId) continue;
				out[h.beatId] = formatChordSymbol(h.chord, { preferFlats });
			}
			return out;
		});
		derived(() => store_get($$store_subs ??= {}, "$songMap", songMap)?.metadata.keyDetail ?? keyDraft);
		let audioEl = null;
		let mixPreviewAudioEl = null;
		let mixClickRaf = 0;
		let rafId = 0;
		let clickLoopRaf = 0;
		let clickCtx;
		function stopMixClickLoop() {
			if (mixClickRaf) cancelAnimationFrame(mixClickRaf);
			mixClickRaf = 0;
		}
		function stopPreviewLoop() {
			if (rafId) cancelAnimationFrame(rafId);
			rafId = 0;
		}
		function stopClickLoop() {
			if (clickLoopRaf) cancelAnimationFrame(clickLoopRaf);
			clickLoopRaf = 0;
		}
		let cueCountInBeats = derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			if (!sm) return 0;
			return sm.cues.mode === "countIn" ? sm.cues.countInBeats : 0;
		});
		derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			if (!sm || cueCountInBeats() === 0) return null;
			return computeCountIn(sm, cueCountInBeats());
		});
		derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			if (!sm) return {
				ok: false,
				reason: "No song."
			};
			if (!sm.timeline.beats.length) return {
				ok: false,
				reason: "Need beats (Grid)."
			};
			if (!sm.audio?.trim || !(sm.audio.trim.endSec > sm.audio.trim.startSec)) return {
				ok: false,
				reason: "Need trim (Grid)."
			};
			return {
				ok: false,
				reason: "BarBro desktop + Piper required."
			};
		});
		derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			if (!sm) return {
				ok: false,
				reason: "No song."
			};
			if (!sm.timeline.beats.length) return {
				ok: false,
				reason: "Need beats (Grid)."
			};
			if (!sm.audio?.trim || !(sm.audio.trim.endSec > sm.audio.trim.startSec)) return {
				ok: false,
				reason: "Need trim (Grid)."
			};
			return {
				ok: false,
				reason: "Generate cue track first (preview uses this tab’s WAV)."
			};
		});
		onDestroy(() => {
			stopPreviewLoop();
			stopClickLoop();
			stopMixClickLoop();
			audioEl?.pause();
			mixPreviewAudioEl?.pause();
			clickCtx?.close();
			clickCtx = void 0;
		});
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			$$renderer.push(`<main class="relative z-10 flex min-h-dvh w-full max-w-none flex-col gap-6 px-2 py-8 sm:px-4 md:px-6 md:py-12 lg:px-8">`);
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="min-h-[50vh]" aria-hidden="true"></div>`);
			$$renderer.push(`<!--]--></main>`);
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
export { _page as default };
