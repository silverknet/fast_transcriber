import { r as onDestroy } from "../../../chunks/index-server.js";
import { a as derived, h as unsubscribe_stores, p as store_get } from "../../../chunks/server.js";
import "../../../chunks/index-server2.js";
import "../../../chunks/timelineEdit.js";
import "../../../chunks/persist.js";
import "../../../chunks/client.js";
import { D as songMap, P as defaultSectionLabel, R as computeCountIn, z as audioSession } from "../../../chunks/commit.js";
import "../../../chunks/button.js";
import "../../../chunks/Icon.js";
import "../../../chunks/iterate.js";
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
function formatRoot(root, accidental, unicode) {
	let s = root;
	if (accidental === "sharp") s += unicode ? "♯" : "#";
	else if (accidental === "flat") s += unicode ? "♭" : "b";
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
* Format structured chord for display. ASCII by default (`Cm7/Bb`); pass
* `{ unicode: true }` for typeset accidentals (`Cm7/B♭`) — used by the SVG
* lead-sheet view where music typography matters and the font supports it.
*/
function formatChordSymbol(chord, opts) {
	const unicode = opts?.unicode ?? false;
	let s = formatRoot(chord.root, chord.accidental, unicode);
	s += qualitySuffix(chord.quality, chord.extensions);
	if (chord.bass) s += "/" + formatRoot(chord.bass, chord.bassAccidental, unicode);
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
//#region src/lib/sections/predictNext.ts
/** Default lengths for kinds we've never seen in this song before. */
var DEFAULT_BARS = {
	intro: 4,
	verse: 8,
	preChorus: 4,
	chorus: 8,
	bridge: 8,
	solo: 8,
	riff: 4,
	break: 2,
	outro: 4,
	custom: 4
};
function sortedSections(songMap) {
	return [...songMap.sections].sort((a, b) => a.barRange.startBarIndex - b.barRange.startBarIndex);
}
function sectionBarCount(s) {
	return s.barRange.endBarIndex - s.barRange.startBarIndex + 1;
}
function countByKind(sections) {
	const out = {};
	for (const s of sections) out[s.kind] = (out[s.kind] ?? 0) + 1;
	return out;
}
/** Most-frequent prior bar count for this kind; falls back to the default. */
function predictBarCount(sections, kind) {
	const sameKind = sections.filter((s) => s.kind === kind);
	if (sameKind.length === 0) return DEFAULT_BARS[kind];
	const freq = {};
	for (const s of sameKind) {
		const n = sectionBarCount(s);
		freq[n] = (freq[n] ?? 0) + 1;
	}
	let bestN = 0;
	let bestF = -1;
	for (const [n, f] of Object.entries(freq)) if (f > bestF) {
		bestN = Number(n);
		bestF = f;
	}
	return bestN;
}
/**
* Predict the kind of the next section given the chronological history.
* Riff / break are treated as instrumental detours — they don't drive the
* macro form, so the prediction "looks past" them at what came before.
*/
function predictKind(sections) {
	if (sections.length === 0) return null;
	const last = sections[sections.length - 1];
	if (last.kind === "outro" || last.kind === "custom") return null;
	const counts = countByKind(sections);
	const verseCount = counts.verse ?? 0;
	const chorusCount = counts.chorus ?? 0;
	const hasBridge = (counts.bridge ?? 0) > 0;
	const hasPreChorus = (counts.preChorus ?? 0) > 0;
	let driver = last;
	if (driver.kind === "riff" || driver.kind === "break") {
		for (let i = sections.length - 2; i >= 0; i--) {
			const s = sections[i];
			if (s.kind !== "riff" && s.kind !== "break") {
				driver = s;
				break;
			}
		}
		if (driver === last) return null;
	}
	switch (driver.kind) {
		case "intro": return {
			kind: "verse",
			reason: "Intros usually lead into a verse."
		};
		case "verse":
			if (hasPreChorus) return {
				kind: "preChorus",
				reason: "You used a pre-chorus earlier — likely the same pattern here."
			};
			return {
				kind: "chorus",
				reason: "Verse → chorus is the common move."
			};
		case "preChorus": return {
			kind: "chorus",
			reason: "Pre-chorus → chorus."
		};
		case "chorus":
			if (chorusCount >= 2 && !hasBridge) return {
				kind: "bridge",
				reason: "Two choruses in — typically a bridge is up next."
			};
			if (verseCount <= chorusCount) return {
				kind: "verse",
				reason: "Back to a verse before the next chorus."
			};
			return {
				kind: "chorus",
				reason: "Chorus repeats — pop song form."
			};
		case "bridge": return {
			kind: "chorus",
			reason: "Bridge → final chorus."
		};
		case "solo": return {
			kind: "chorus",
			reason: "Solo → chorus."
		};
		default: return null;
	}
}
/**
* Public entry point. Returns `null` when:
*   - the song has no sections (cold start),
*   - the last section is `outro` / `custom`,
*   - the predicted range would overrun the timeline.
*/
function predictNextSection(songMap) {
	const sections = sortedSections(songMap);
	const pick = predictKind(sections);
	if (!pick) return null;
	const bars = predictBarCount(sections, pick.kind);
	if (bars <= 0) return null;
	if (sections[sections.length - 1].barRange.endBarIndex + 1 + bars - 1 >= songMap.timeline.bars.length) return null;
	const lengthHint = sections.some((s) => s.kind === pick.kind && sectionBarCount(s) === bars) ? ` (${bars} bars to match your other ${defaultSectionLabel(pick.kind).toLowerCase()}s)` : ` (${bars} bars)`;
	return {
		kind: pick.kind,
		bars,
		reason: pick.reason + lengthHint
	};
}
//#endregion
//#region src/routes/edit/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		/**
		* Suggestion lifecycle:
		*   - `predictNextSection` is purely derived from `$songMap` — it re-fires
		*     whenever sections / bars change.
		*   - Dismissals are local: the user clicking ✕ records the suggestion's
		*     signature (`kind:bars:lastEnd`). The derived `nextSectionSuggestion`
		*     filters out anything matching the dismissed sig, so the same
		*     suggestion doesn't reappear until the song state changes.
		*   - Accepting auto-clears `dismissedSuggestionSig` for the next round.
		*/
		let dismissedSuggestionSig = null;
		function suggestionSig(sm, sug) {
			if (!sm || !sug || sm.sections.length === 0) return null;
			const lastEnd = Math.max(...sm.sections.map((s) => s.barRange.endBarIndex));
			return `${sug.kind}:${sug.bars}:${lastEnd}`;
		}
		const nextSectionSuggestion = derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			if (!sm) return null;
			const raw = predictNextSection(sm);
			if (!raw) return null;
			const sig = suggestionSig(sm, raw);
			if (sig && sig === dismissedSuggestionSig) return null;
			return raw;
		});
		derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			const sug = nextSectionSuggestion();
			if (!sm || !sug || sm.sections.length === 0) return null;
			const start = Math.max(...sm.sections.map((s) => s.barRange.endBarIndex)) + 1;
			const end = start + sug.bars - 1;
			if (end >= sm.timeline.bars.length) return null;
			return {
				kind: sug.kind,
				label: defaultSectionLabel(sug.kind),
				startBarIndex: start,
				endBarIndex: end
			};
		});
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
