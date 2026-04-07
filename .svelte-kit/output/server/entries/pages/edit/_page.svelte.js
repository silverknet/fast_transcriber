import { a as onDestroy, f as derived, x as unsubscribe_stores, y as store_get } from "../../../chunks/internal.js";
import "../../../chunks/exports.js";
import "../../../chunks/timelineEdit.js";
import "../../../chunks/client.js";
import { s as songMap } from "../../../chunks/beatPulse.js";
import "../../../chunks/chevron-down.js";
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
/** Pick spelling with preference for sharps vs flats in key of `preferFlats` (e.g. F major → flats). */
function pitchClassToRootAcc(pc, preferFlats) {
	const p = (pc % 12 + 12) % 12;
	return preferFlats ? [
		{ root: "C" },
		{
			root: "D",
			accidental: "flat"
		},
		{ root: "D" },
		{
			root: "E",
			accidental: "flat"
		},
		{ root: "E" },
		{ root: "F" },
		{
			root: "G",
			accidental: "flat"
		},
		{ root: "G" },
		{
			root: "A",
			accidental: "flat"
		},
		{ root: "A" },
		{
			root: "B",
			accidental: "flat"
		},
		{ root: "B" }
	][p] : [
		{ root: "C" },
		{
			root: "C",
			accidental: "sharp"
		},
		{ root: "D" },
		{
			root: "D",
			accidental: "sharp"
		},
		{ root: "E" },
		{ root: "F" },
		{
			root: "F",
			accidental: "sharp"
		},
		{ root: "G" },
		{
			root: "G",
			accidental: "sharp"
		},
		{ root: "A" },
		{
			root: "A",
			accidental: "sharp"
		},
		{ root: "B" }
	][p];
}
function transposePitchClass(pc, semitones) {
	return ((pc + semitones) % 12 + 12) % 12;
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
//#endregion
//#region src/lib/chords/diatonic.ts
var MAJOR_STEPS = [
	0,
	2,
	4,
	5,
	7,
	9,
	11
];
var MINOR_NATURAL_STEPS = [
	0,
	2,
	3,
	5,
	7,
	8,
	10
];
/** Major-key diatonic chord qualities per degree (0-based). */
var MAJOR_QUALITIES = [
	"major",
	"minor",
	"minor",
	"major",
	"major",
	"minor",
	"dim"
];
/** Natural minor diatonic qualities. */
var MINOR_QUALITIES = [
	"minor",
	"dim",
	"major",
	"minor",
	"minor",
	"major",
	"major"
];
function scaleStepsForKey(key) {
	const rootPc = chordRootToPitchClass(key.root, key.accidental);
	return (key.mode === "major" ? MAJOR_STEPS : MINOR_NATURAL_STEPS).map((s) => transposePitchClass(s, rootPc));
}
function buildChordAtDegree(key, degreeIndex, useSeventh, preferFlats) {
	const pc = scaleStepsForKey(key)[degreeIndex];
	let q = (key.mode === "major" ? MAJOR_QUALITIES : MINOR_QUALITIES)[degreeIndex];
	if (useSeventh) {
		if (q === "dim") q = "min7";
		else if (q === "major") q = degreeIndex === 4 ? "7" : "maj7";
		else if (q === "minor") q = "min7";
	}
	const { root, accidental } = pitchClassToRootAcc(pc, preferFlats);
	const chord = {
		root,
		accidental,
		quality: q,
		displayRaw: ""
	};
	chord.displayRaw = formatChordSymbol(chord, { preferFlats });
	return chord;
}
/** Diatonic triads and seventh chords in key (14 entries: 7 triads + 7 sevenths). */
function diatonicChordsInKey(key, preferFlats) {
	const out = [];
	for (let d = 0; d < 7; d++) out.push(buildChordAtDegree(key, d, false, preferFlats));
	for (let d = 0; d < 7; d++) out.push(buildChordAtDegree(key, d, true, preferFlats));
	return out;
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
//#region src/lib/chords/parseChordText.ts
var NOTE_NAMES = new Set([
	"C",
	"D",
	"E",
	"F",
	"G",
	"A",
	"B"
]);
function normalizeUnicode(s) {
	return s.trim().replace(/\u266F/g, "#").replace(/\u266D/g, "b").replace(/♯/g, "#").replace(/♭/g, "b");
}
/** Parse leading note letter + accidentals; returns remainder after root. */
function eatRoot(s) {
	if (s.length < 1) return null;
	const L = s[0].toUpperCase();
	if (!NOTE_NAMES.has(L)) return null;
	const root = L;
	let i = 1;
	let delta = 0;
	while (i < s.length) {
		const c = s[i];
		if (c === "#" || c === "♯") {
			delta += 1;
			i++;
			continue;
		}
		if (c === "b" || c === "♭") {
			delta -= 1;
			i++;
			continue;
		}
		break;
	}
	if (delta < -1 || delta > 1) return null;
	return {
		root,
		accidental: delta === 1 ? "sharp" : delta === -1 ? "flat" : void 0,
		rest: s.slice(i)
	};
}
function parseQuality(rest) {
	const r = rest;
	if (!r.length) return {
		quality: "major",
		extensions: void 0,
		restConsumed: ""
	};
	for (const { pattern, quality, ext } of [
		{
			pattern: /^maj7/i,
			quality: "maj7"
		},
		{
			pattern: /^ma7/i,
			quality: "maj7"
		},
		{
			pattern: /^M7(?![a-z])/i,
			quality: "maj7"
		},
		{
			pattern: /^m7(?![a-z0-9])/i,
			quality: "min7"
		},
		{
			pattern: /^min7/i,
			quality: "min7"
		},
		{
			pattern: /^mi7/i,
			quality: "min7"
		},
		{
			pattern: /^\-7/i,
			quality: "min7"
		},
		{
			pattern: /^maj(?!or)/i,
			quality: "major"
		},
		{
			pattern: /^major/i,
			quality: "major"
		},
		{
			pattern: /^min(?![or])/i,
			quality: "minor"
		},
		{
			pattern: /^mi(?![nor])/i,
			quality: "minor"
		},
		{
			pattern: /^dim/i,
			quality: "dim"
		},
		{
			pattern: /^°/,
			quality: "dim"
		},
		{
			pattern: /^o(?![0-9])/i,
			quality: "dim"
		},
		{
			pattern: /^aug/i,
			quality: "aug"
		},
		{
			pattern: /^\+(?![0-9])/,
			quality: "aug"
		},
		{
			pattern: /^sus4/i,
			quality: "sus4"
		},
		{
			pattern: /^sus2/i,
			quality: "sus2"
		},
		{
			pattern: /^sus/i,
			quality: "sus4"
		},
		{
			pattern: /^add9/i,
			quality: "add9"
		},
		{
			pattern: /^m(?![aj0-9])/i,
			quality: "minor"
		},
		{
			pattern: /^\-(?![0-9])/,
			quality: "minor"
		},
		{
			pattern: /^7(?![0-9])/i,
			quality: "7"
		},
		{
			pattern: /^9\b/i,
			quality: "7",
			ext: ["9"]
		},
		{
			pattern: /^11\b/i,
			quality: "7",
			ext: ["11"]
		},
		{
			pattern: /^13\b/i,
			quality: "7",
			ext: ["13"]
		}
	]) {
		const m = r.match(pattern);
		if (m) {
			const consumed = m[0].length;
			return {
				quality,
				extensions: ext,
				restConsumed: r.slice(consumed)
			};
		}
	}
	return {
		quality: "major",
		restConsumed: r
	};
}
/**
* Parse free-text chord (e.g. `Em`, `ebm`, `F#m7`, `C/E`) into `ChordSymbol`.
*/
function parseChordText(raw) {
	const s0 = normalizeUnicode(raw);
	if (!s0.length) return {
		ok: false,
		error: "Empty chord"
	};
	const slashIdx = s0.indexOf("/");
	const mainPart = slashIdx >= 0 ? s0.slice(0, slashIdx) : s0;
	const bassPart = slashIdx >= 0 ? s0.slice(slashIdx + 1) : "";
	const rootParsed = eatRoot(mainPart);
	if (!rootParsed) return {
		ok: false,
		error: "Invalid root"
	};
	let { root, accidental, rest } = rootParsed;
	const q = parseQuality(rest);
	let quality = q.quality;
	let extensions = q.extensions;
	const afterQ = q.restConsumed;
	if (afterQ.trim().length > 0 && !extensions) {
		const extM = afterQ.match(/^([0-9]+)/);
		if (extM && [
			"9",
			"11",
			"13"
		].includes(extM[1])) extensions = [extM[1]];
	}
	let bass;
	let bassAccidental;
	if (bassPart.length) {
		const bp = eatRoot(bassPart);
		if (!bp || bp.rest.trim().length > 0) return {
			ok: false,
			error: "Invalid bass note"
		};
		bass = bp.root;
		bassAccidental = bp.accidental;
	}
	const chord = {
		root,
		accidental,
		quality,
		extensions,
		bass,
		bassAccidental,
		displayRaw: ""
	};
	chord.displayRaw = formatChordSymbol(chord, accidental === "flat" || bassAccidental === "flat" ? { preferFlats: true } : void 0);
	return {
		ok: true,
		chord
	};
}
//#endregion
//#region src/lib/chords/rankSuggestions.ts
/** Common major triads for quick chromatic browse (subset). */
function chromaticMajorTriads(preferFlats) {
	const letters = [
		"C",
		"D",
		"E",
		"F",
		"G",
		"A",
		"B"
	];
	const out = [];
	for (const r of letters) for (const acc of [
		void 0,
		"sharp",
		"flat"
	]) {
		if (r === "C" && acc === "sharp") continue;
		if (r === "F" && acc === "sharp") continue;
		const ch = {
			root: r,
			accidental: acc,
			quality: "major",
			displayRaw: ""
		};
		ch.displayRaw = formatChordSymbol(ch, { preferFlats });
		out.push(ch);
	}
	return out;
}
function norm(s) {
	return s.toLowerCase().replace(/\s+/g, "");
}
/**
* Rank chord suggestions: diatonic matches first (when `key` set), then substring matches on labels.
*/
function rankChordSuggestions(query, key, opts) {
	const q = norm(query);
	const limit = opts?.limit ?? 24;
	const preferFlats = key ? songKeyPreferFlats(key) : false;
	const diatonic = key ? diatonicChordsInKey(key, preferFlats) : [];
	const diatonicLabels = diatonic.map((c) => formatChordSymbol(c, { preferFlats }));
	const ranked = [];
	const seen = /* @__PURE__ */ new Set();
	const push = (chord, label, inKey) => {
		const k = label;
		if (seen.has(k)) return;
		seen.add(k);
		ranked.push({
			chord,
			label,
			inKey
		});
	};
	if (q.length > 0) {
		const exact = parseChordText(query.trim());
		if (exact.ok) push(exact.chord, formatChordSymbol(exact.chord, { preferFlats }), false);
	}
	for (let i = 0; i < diatonic.length; i++) {
		const chord = diatonic[i];
		const label = diatonicLabels[i];
		if (!q || norm(label).includes(q) || q.length === 0) push(chord, label, true);
	}
	if (opts?.includeAllRoots !== false && q.length > 0) for (const rootChord of chromaticMajorTriads(preferFlats)) {
		const label = formatChordSymbol(rootChord, { preferFlats });
		if (norm(label).startsWith(q) || norm(label).includes(q)) push(rootChord, label, false);
	}
	if (!q.length) return ranked.slice(0, limit);
	return ranked.sort((a, b) => {
		if (a.inKey !== b.inKey) return a.inKey ? -1 : 1;
		const ap = norm(a.label).startsWith(q) ? 0 : 1;
		const bp = norm(b.label).startsWith(q) ? 0 : 1;
		if (ap !== bp) return ap - bp;
		return a.label.localeCompare(b.label);
	}).slice(0, limit);
}
//#endregion
//#region src/routes/edit/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let chordQuery = "";
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
		derived(() => rankChordSuggestions(chordQuery, store_get($$store_subs ??= {}, "$songMap", songMap)?.metadata.keyDetail, { limit: 32 }));
		let audioEl = null;
		let rafId = 0;
		let clickLoopRaf = 0;
		let clickCtx;
		function stopPreviewLoop() {
			if (rafId) cancelAnimationFrame(rafId);
			rafId = 0;
		}
		function stopClickLoop() {
			if (clickLoopRaf) cancelAnimationFrame(clickLoopRaf);
			clickLoopRaf = 0;
		}
		onDestroy(() => {
			stopPreviewLoop();
			stopClickLoop();
			audioEl?.pause();
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
