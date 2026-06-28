import { r as onDestroy } from "../../../chunks/index-server.js";
import { a as derived, h as unsubscribe_stores, p as store_get } from "../../../chunks/server.js";
import "../../../chunks/index-server2.js";
import "../../../chunks/client.js";
import "../../../chunks/navigation.js";
import "../../../chunks/button.js";
import "../../../chunks/dialog.js";
import "../../../chunks/Icon.js";
import "../../../chunks/x.js";
import "../../../chunks/desktopBridge.js";
import { H as defaultSectionLabel, K as computeCountIn, M as timelineMatchesOriginal, O as songMap, R as resolvedSpokenIntroText, V as sortBeatsByTime, Y as effectiveCountInBeats, q as audioSession } from "../../../chunks/commit.js";
import "../../../chunks/desktopProjectFs2.js";
import "../../../chunks/desktopCompanionStatus.js";
import "../../../chunks/arrow-left.js";
import "../../../chunks/renderCueTrack.js";
import "../../../chunks/loader-circle.js";
import { n as PlaybackController } from "../../../chunks/WaveformPlayer.js";
import "../../../chunks/play.js";
import "../../../chunks/refresh-cw.js";
import "../../../chunks/sparkles.js";
import "../../../chunks/triangle-alert.js";
import "../../../chunks/iterate.js";
import { t as songPlaybackPlan } from "../../../chunks/playbackPlan.js";
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
//#region src/lib/chords/autoFill.ts
/** Internal lookup keyed by `bar.index` → bar. */
function barsByIndex(songMap) {
	const m = /* @__PURE__ */ new Map();
	for (const bar of songMap.timeline.bars) m.set(bar.index, {
		id: bar.id,
		beatIds: bar.beatIds
	});
	return m;
}
/** Build a single proposal for one source-section → target-section pair. */
function buildProposal(songMap, source, target) {
	const beatsById = new Map(songMap.timeline.beats.map((b) => [b.id, b]));
	const bars = barsByIndex(songMap);
	const harmonyByBeat = new Map(songMap.harmony.filter((h) => h.beatId).map((h) => [h.beatId, h]));
	const sourceEvents = songMap.harmony.filter((h) => {
		if (!h.beatId) return false;
		const beat = beatsById.get(h.beatId);
		if (!beat) return false;
		if (!bars.get(songMap.timeline.bars.find((b) => b.id === beat.barId)?.index ?? -1)) return false;
		const sourceBar = songMap.timeline.bars.find((b) => b.id === h.barId);
		if (!sourceBar) return false;
		return sourceBar.index >= source.barRange.startBarIndex && sourceBar.index <= source.barRange.endBarIndex;
	});
	const entries = [];
	let skippedExistingCount = 0;
	for (const ev of sourceEvents) {
		const sourceBeat = beatsById.get(ev.beatId);
		if (!sourceBeat) continue;
		const sourceBar = songMap.timeline.bars.find((b) => b.id === sourceBeat.barId);
		if (!sourceBar) continue;
		const barOffset = sourceBar.index - source.barRange.startBarIndex;
		const targetBarIndex = target.barRange.startBarIndex + barOffset;
		if (targetBarIndex > target.barRange.endBarIndex) continue;
		const targetBar = bars.get(targetBarIndex);
		if (!targetBar) continue;
		const targetBeatId = targetBar.beatIds.find((bid) => {
			const b = beatsById.get(bid);
			return b && b.indexInBar === sourceBeat.indexInBar;
		});
		if (!targetBeatId) continue;
		if (harmonyByBeat.has(targetBeatId)) {
			skippedExistingCount++;
			continue;
		}
		entries.push({
			sourceBeatId: sourceBeat.id,
			targetBeatId,
			chord: ev.chord
		});
	}
	return {
		sourceSection: source,
		targetSection: target,
		entries,
		fillCount: entries.length,
		skippedExistingCount
	};
}
/**
* Ranked list of section-pair auto-fill proposals.
*
* - Groups sections by `kind`; only same-kind pairs are matched.
* - In each group, the "source" is the section with the most explicit
*   HarmonyEvents (tie-breaker: chronologically earliest).
* - Proposals are emitted for every OTHER section in the group; only those
*   that gain ≥1 chord are kept (fillCount ≥ 1).
* - Ranked chronologically by target start bar (left-to-right reading).
* - Capped at MAX_AUTOFILL_CANDIDATES.
*/
function proposeChordAutoFillCandidates(songMap) {
	const explicitCountBySectionId = /* @__PURE__ */ new Map();
	for (const section of songMap.sections) explicitCountBySectionId.set(section.id, 0);
	const beatsById = new Map(songMap.timeline.beats.map((b) => [b.id, b]));
	const barsById = new Map(songMap.timeline.bars.map((b) => [b.id, b]));
	for (const h of songMap.harmony) {
		if (!h.beatId) continue;
		const beat = beatsById.get(h.beatId);
		if (!beat) continue;
		const bar = barsById.get(beat.barId);
		if (!bar) continue;
		for (const section of songMap.sections) if (bar.index >= section.barRange.startBarIndex && bar.index <= section.barRange.endBarIndex) {
			explicitCountBySectionId.set(section.id, (explicitCountBySectionId.get(section.id) ?? 0) + 1);
			break;
		}
	}
	const byKind = /* @__PURE__ */ new Map();
	for (const section of songMap.sections) {
		const list = byKind.get(section.kind) ?? [];
		list.push(section);
		byKind.set(section.kind, list);
	}
	const proposals = [];
	for (const [, group] of byKind) {
		if (group.length < 2) continue;
		const source = [...group].sort((a, b) => {
			const ca = explicitCountBySectionId.get(a.id) ?? 0;
			const cb = explicitCountBySectionId.get(b.id) ?? 0;
			if (ca !== cb) return cb - ca;
			return a.barRange.startBarIndex - b.barRange.startBarIndex;
		})[0];
		if ((explicitCountBySectionId.get(source.id) ?? 0) === 0) continue;
		for (const target of group) {
			if (target.id === source.id) continue;
			const proposal = buildProposal(songMap, source, target);
			if (proposal.fillCount > 0) proposals.push(proposal);
		}
	}
	proposals.sort((a, b) => a.targetSection.barRange.startBarIndex - b.targetSection.barRange.startBarIndex);
	return proposals.slice(0, 5);
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
* Return *all* plausible next-section kinds, ranked by base score.
*
* Driven by the last placed section (with riff/break being transparent —
* we look past them at the previous "real" driver). Context modifiers
* lift / lower scores based on how many of each kind we've already seen.
*
* Returns `[]` when no kind makes sense (cold start, after outro/custom,
* or a song made entirely of riffs).
*/
function kindCandidates(sections) {
	if (sections.length === 0) return [];
	const last = sections[sections.length - 1];
	if (last.kind === "outro" || last.kind === "custom") return [];
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
		if (driver === last) return [];
	}
	const out = [];
	switch (driver.kind) {
		case "intro":
			out.push({
				kind: "verse",
				score: .9,
				reason: "Intros usually lead into a verse."
			});
			out.push({
				kind: "chorus",
				score: .2,
				reason: "Some songs go straight from intro to chorus."
			});
			break;
		case "verse":
			out.push({
				kind: "preChorus",
				score: hasPreChorus ? .9 : .55,
				reason: hasPreChorus ? "You used a pre-chorus earlier — likely the same pattern here." : "Verse → pre-chorus is a common pop pattern."
			});
			out.push({
				kind: "chorus",
				score: .7,
				reason: "Verse → chorus is the most common move."
			});
			out.push({
				kind: "verse",
				score: .25,
				reason: "Two verses back-to-back happens occasionally."
			});
			break;
		case "preChorus":
			out.push({
				kind: "chorus",
				score: .95,
				reason: "Pre-chorus → chorus."
			});
			out.push({
				kind: "verse",
				score: .1,
				reason: "Pre-chorus → verse is unusual but possible."
			});
			break;
		case "chorus": {
			const bridgeStrong = chorusCount >= 2 && !hasBridge;
			if (bridgeStrong) out.push({
				kind: "bridge",
				score: .95,
				reason: "Two choruses in — typically a bridge is up next."
			});
			if (verseCount <= chorusCount) out.push({
				kind: "verse",
				score: bridgeStrong ? .4 : .65,
				reason: "Back to a verse before the next chorus."
			});
			out.push({
				kind: "chorus",
				score: .4,
				reason: "Chorus repeats — pop song form."
			});
			out.push({
				kind: "outro",
				score: .3,
				reason: "Songs often end on or just after a chorus."
			});
			break;
		}
		case "bridge":
			out.push({
				kind: "chorus",
				score: .9,
				reason: "Bridge → final chorus."
			});
			out.push({
				kind: "outro",
				score: .2,
				reason: "Some songs go bridge → outro."
			});
			break;
		case "solo":
			out.push({
				kind: "chorus",
				score: .7,
				reason: "Solo → chorus."
			});
			out.push({
				kind: "verse",
				score: .4,
				reason: "Solo → verse is also common."
			});
			break;
		default: return [];
	}
	return out.sort((a, b) => b.score - a.score);
}
/** Range (in bars) that an audio-border-derived length must fall into to be trusted. */
var AUDIO_BARS_MIN = 2;
var AUDIO_BARS_MAX = 16;
/** Confidence floor — below this the predictor falls back to the rule-based length. */
var AUDIO_CONFIDENCE_FLOOR = .35;
/** Hard ceiling on how many candidates the UI can sensibly cycle through. */
var MAX_CANDIDATES = 5;
/**
* Length candidates for a given kind: audio borders (if any in range),
* the most-frequent prior length for this kind, and the default.
* Deduped by `bars`, highest-scored reason wins.
*/
function lengthCandidates(sections, kind, audioBorders, nextStart) {
	const byBars = /* @__PURE__ */ new Map();
	const add = (cand) => {
		const existing = byBars.get(cand.bars);
		if (!existing || cand.score > existing.score) byBars.set(cand.bars, cand);
	};
	if (audioBorders && audioBorders.length > 0) for (const b of audioBorders) {
		if (b.confidence < AUDIO_CONFIDENCE_FLOOR) continue;
		const delta = b.bar - nextStart;
		if (delta < AUDIO_BARS_MIN || delta > AUDIO_BARS_MAX) continue;
		add({
			bars: delta,
			score: .6 + .4 * Math.max(0, Math.min(1, b.confidence)),
			reason: `audio detected a change around bar ${b.bar + 1} (${Math.round(b.confidence * 100)}% confidence)`
		});
	}
	const prior = predictBarCount(sections, kind);
	if (prior > 0 && sections.some((s) => s.kind === kind)) add({
		bars: prior,
		score: .55,
		reason: `${prior} bars to match your other ${defaultSectionLabel(kind).toLowerCase()}s`
	});
	const def = DEFAULT_BARS[kind];
	if (def > 0) add({
		bars: def,
		score: .4,
		reason: `${def} bars is a typical ${defaultSectionLabel(kind).toLowerCase()} length`
	});
	return [...byBars.values()].sort((a, b) => b.score - a.score);
}
/**
* Top-ranked next-section candidates. Cross-product of kind candidates ×
* length candidates, scored by `kind.score * length.score`, filtered to
* candidates that fit the timeline, deduped by `(kind, bars)`, sorted
* descending, capped at `MAX_CANDIDATES`.
*
* Returns `[]` for cold start, after outro / custom, or when no candidate
* fits in the remaining bars.
*/
function predictNextSectionCandidates(songMap, opts) {
	const sections = sortedSections(songMap);
	const kinds = kindCandidates(sections);
	if (kinds.length === 0) return [];
	const nextStart = sections[sections.length - 1].barRange.endBarIndex + 1;
	const totalBars = songMap.timeline.bars.length;
	const combined = [];
	for (const k of kinds) {
		const lengths = lengthCandidates(sections, k.kind, opts?.audioBorders, nextStart);
		for (const l of lengths) {
			if (l.bars <= 0) continue;
			if (nextStart + l.bars - 1 >= totalBars) continue;
			combined.push({
				kind: k.kind,
				bars: l.bars,
				score: k.score * l.score,
				reason: `${k.reason} (${l.reason})`
			});
		}
	}
	const byKey = /* @__PURE__ */ new Map();
	for (const c of combined) {
		const key = `${c.kind}:${c.bars}`;
		const existing = byKey.get(key);
		if (!existing || c.score > existing.score) byKey.set(key, c);
	}
	return [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES).map(({ kind, bars, reason }) => ({
		kind,
		bars,
		reason
	}));
}
//#endregion
//#region src/lib/chords/suggestFromChroma.ts
/** Pitch-class offsets from the root for a major triad. */
var MAJOR_TRIAD = [
	0,
	4,
	7
];
/** Pitch-class offsets from the root for a minor triad. */
var MINOR_TRIAD = [
	0,
	3,
	7
];
/** Multiplicative score bonus for chords whose root is in the song key's diatonic scale. */
var DIATONIC_BIAS = 1.15;
/** Major-key diatonic scale degrees (semitone offsets from tonic). */
var MAJOR_SCALE = [
	0,
	2,
	4,
	5,
	7,
	9,
	11
];
/** Natural-minor diatonic scale degrees. */
var MINOR_SCALE = [
	0,
	2,
	3,
	5,
	7,
	8,
	10
];
/** Pitch classes in the diatonic scale of `key`. */
function diatonicPitchClasses(key) {
	if (!key) return null;
	const rootPc = chordRootToPitchClass(key.root, key.accidental);
	const base = key.mode === "major" ? MAJOR_SCALE : MINOR_SCALE;
	return new Set(base.map((s) => (s + rootPc) % 12));
}
/** Build the 12-d template vector for a triad rooted at pitch class `pc`. */
function buildTemplate(pc, intervals) {
	const v = new Array(12).fill(0);
	for (const ivl of intervals) v[(pc + ivl) % 12] = 1;
	return v;
}
/** Pearson correlation between two equal-length vectors. */
function pearson(a, b) {
	const n = a.length;
	if (n === 0 || n !== b.length) return 0;
	let meanA = 0;
	let meanB = 0;
	for (let i = 0; i < n; i++) {
		meanA += a[i];
		meanB += b[i];
	}
	meanA /= n;
	meanB /= n;
	let num = 0;
	let varA = 0;
	let varB = 0;
	for (let i = 0; i < n; i++) {
		const da = a[i] - meanA;
		const db = b[i] - meanB;
		num += da * db;
		varA += da * da;
		varB += db * db;
	}
	if (varA === 0 || varB === 0) return 0;
	return num / Math.sqrt(varA * varB);
}
/** Build a `ChordSymbol` for the given pitch class + quality, spelled per `preferFlats`. */
function buildChord(pc, quality, preferFlats) {
	const { root, accidental } = pitchClassToRootAcc(pc, preferFlats);
	const c = {
		root,
		...accidental ? { accidental } : {},
		quality,
		displayRaw: ""
	};
	c.displayRaw = formatChordSymbol(c, { preferFlats });
	return c;
}
/**
* Match a chroma vector against the 24 triad templates and rank by
* (Pearson correlation × optional diatonic bonus). Returns descending
* list of all 24 with scores.
*/
function rankTriadFitsForChroma(chroma, songKey) {
	const inKey = diatonicPitchClasses(songKey);
	const scored = [];
	for (let pc = 0; pc < 12; pc++) for (const quality of ["major", "minor"]) {
		let score = pearson(chroma, buildTemplate(pc, quality === "major" ? MAJOR_TRIAD : MINOR_TRIAD));
		if (inKey && inKey.has(pc)) score *= DIATONIC_BIAS;
		scored.push({
			pc,
			quality,
			score
		});
	}
	scored.sort((a, b) => b.score - a.score);
	return scored;
}
/**
* Aggregate per-beat chroma for one bar by averaging then L1-normalizing.
* Returns null if the bar has no beats or all chroma frames are empty.
*/
function aggregateBarChroma(barBeatIndices, beatChroma) {
	if (barBeatIndices.length === 0) return null;
	const acc = new Array(12).fill(0);
	let used = 0;
	for (const idx of barBeatIndices) {
		const vec = beatChroma[idx];
		if (!vec || vec.length !== 12) continue;
		for (let i = 0; i < 12; i++) acc[i] += vec[i];
		used++;
	}
	if (used === 0) return null;
	let sum = 0;
	for (const v of acc) sum += v;
	if (sum <= 0) return null;
	for (let i = 0; i < 12; i++) acc[i] /= sum;
	return acc;
}
/**
* Build a map of `downbeatId → ChordSuggestion` for every bar that has
* usable chroma. Bars without chroma, or whose top fit is below
* `MIN_SUGGESTION_CONFIDENCE`, are omitted from the result.
*/
function proposeChordSuggestions(songMap) {
	const out = /* @__PURE__ */ new Map();
	if (!songMap) return out;
	const hints = songMap.chordHints;
	if (!hints || hints.beatChroma.length === 0) return out;
	if (hints.beatChroma.length !== songMap.timeline.beats.length) return out;
	const sortedBeats = sortBeatsByTime(songMap.timeline.beats);
	const beatIndex = /* @__PURE__ */ new Map();
	for (let i = 0; i < sortedBeats.length; i++) beatIndex.set(sortedBeats[i].id, i);
	const songKey = songMap.metadata.keyDetail;
	const preferFlats = songKey ? songKeyPreferFlats(songKey) : false;
	for (const bar of songMap.timeline.bars) {
		if (bar.beatIds.length === 0) continue;
		const indices = [];
		for (const bid of bar.beatIds) {
			const idx = beatIndex.get(bid);
			if (idx !== void 0) indices.push(idx);
		}
		if (indices.length === 0) continue;
		const barChroma = aggregateBarChroma(indices, hints.beatChroma);
		if (!barChroma) continue;
		const ranked = rankTriadFitsForChroma(barChroma, songKey);
		if (ranked.length < 2) continue;
		const top = ranked[0];
		const second = ranked[1];
		const confidence = top.score - second.score;
		if (confidence < .02) continue;
		const downbeatId = bar.beatIds[0];
		out.set(downbeatId, {
			beatId: downbeatId,
			barIndex: bar.index,
			chord: buildChord(top.pc, top.quality, preferFlats),
			confidence,
			alternatives: ranked.slice(1, 3).map((c) => buildChord(c.pc, c.quality, preferFlats))
		});
	}
	return out;
}
//#endregion
//#region src/routes/edit/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		derived(() => !store_get($$store_subs ??= {}, "$songMap", songMap) || !store_get($$store_subs ??= {}, "$songMap", songMap).timeline.original || timelineMatchesOriginal(store_get($$store_subs ??= {}, "$songMap", songMap)));
		/**
		* Suggestion lifecycle (multi-candidate):
		*   - `predictNextSectionCandidates` returns a ranked list of next-section
		*     suggestions; it re-derives whenever sections / audioBorders change.
		*   - `currentSuggestionIndex` cycles through *visible* (non-dismissed)
		*     candidates. Skip = increment. Wraps modulo length.
		*   - `dismissedSuggestionSigs` is a LIFO stack of dismissed signatures.
		*     Dismiss = push. Undo = pop. Accept clears it.
		*   - Song-state change (sections list mutates) shifts every signature's
		*     `lastEnd` field, so old dismissals naturally stop matching — no
		*     manual reset needed.
		*/
		let dismissedSuggestionSigs = [];
		let currentSuggestionIndex = 0;
		/**
		* Audio-derived section-border hints — cached in `songMap.sectionBorderHints`
		* so old `.smap` files migrate to having hints on first sections-mode entry,
		* and re-opening the same song reuses the cached result. Audio fingerprint
		* mismatch / `ANALYZER_VERSION` bump invalidates the cache and re-runs.
		*
		* Version 2: bars are now passed in **file-absolute** time (we add
		* `audio.trim.startSec` to `bar.startSec` before sending). Earlier runs
		* sent post-trim times against the full audio file, which produced
		* systematically offset borders. Bumping invalidates v1 hints.
		*
		* Version 3: feature set changed (dropped chroma_stft, added
		* spectral_bandwidth + spectral_rolloff) after librosa 0.11 + numpy 2.x
		* crashed natively on Apple Silicon. Bump invalidates v2 hints.
		*
		* Version 4: novelty algorithm rewritten (past-vs-future window comparison
		* instead of "this bar vs. previous chunk"); adaptive prominence
		* threshold replaces the fixed 0.15; snap-to-grid disabled. The v3
		* borders were systematically wrong because of those three things;
		* v4 invalidates them.
		*
		* Version 5: feature set changed from 5 correlated spectral stats
		* (rms / centroid / bandwidth / rolloff / flux) to MFCC-13 + RMS + flux.
		* MFCCs give a richer, more independent novelty signal — v4's curve was
		* dominated by a single outlier peak, suppressing real boundaries.
		* Threshold also loosened (ADAPTIVE_K 1.8 → 0.8).
		*
		* Version 6: added chroma_cqt (12-dim harmonic features) to catch
		* chord-progression changes that MFCC misses. Replaced MAD-based
		* threshold (which gave wildly inconsistent border counts — sometimes
		* 2, sometimes 30) with predictable top-N selection: target ~1 border
		* per 18 bars, clamped to [3, 12]. Bump invalidates v5 hints.
		*
		* Version 7: dropped chroma_cqt entirely — it crashed natively (SIGKILL)
		* on Apple Silicon, same as chroma_stft did. Both chroma paths are
		* unusable on macOS arm64 with this librosa/numpy stack. Sticking with
		* MFCC-13 + RMS + flux. Borders will be less accurate for harmonic-only
		* section changes but at least the analyzer doesn't die mid-run.
		*/
		const ANALYZER_VERSION = 7;
		/** Fingerprint used to invalidate cached hints when audio changes. */
		function currentAudioFingerprint(sm) {
			if (sm?.audio?.sha256) return sm.audio.sha256;
			const f = store_get($$store_subs ??= {}, "$audioSession", audioSession).file;
			if (f) return `${f.name}:${f.size}`;
			if (sm?.audio?.fileName) return `${sm.audio.fileName}:${Math.round(sm.audio.durationSec ?? 0)}`;
			return null;
		}
		/** Cached borders if the stored fingerprint + analyzer version still match. */
		const audioBorders = derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			if (!sm?.sectionBorderHints) return [];
			const fp = currentAudioFingerprint(sm);
			const hints = sm.sectionBorderHints;
			if (hints.analyzerVersion !== ANALYZER_VERSION) return [];
			if (fp && hints.audioFingerprint !== fp) return [];
			return hints.borders;
		});
		/** Derived: the detected key from the cached chord hints, or null. */
		const detectedKey = derived(() => store_get($$store_subs ??= {}, "$songMap", songMap)?.chordHints?.detectedKey ?? null);
		/**
		* True when the existing key picker matches the detected key — so we
		* can hide the "Use" hint once it's been accepted (or the user picked
		* the same thing themselves).
		*/
		const detectedKeyMatchesPicker = derived(() => {
			const dk = detectedKey();
			const kd = store_get($$store_subs ??= {}, "$songMap", songMap)?.metadata.keyDetail;
			if (!dk || !kd) return false;
			return kd.root === dk.root && (kd.accidental ?? null) === (dk.accidental ?? null) && kd.mode === dk.mode;
		});
		derived(() => detectedKey() !== null && detectedKey().confidence >= .05 && !detectedKeyMatchesPicker());
		function suggestionSig(sm, sug) {
			if (!sm || !sug || sm.sections.length === 0) return null;
			const lastEnd = Math.max(...sm.sections.map((s) => s.barRange.endBarIndex));
			return `${sug.kind}:${sug.bars}:${lastEnd}`;
		}
		/** Ranked list of next-section candidates (top 5 by combined score). */
		const sectionSuggestionCandidates = derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			if (!sm) return [];
			return predictNextSectionCandidates(sm, { audioBorders: audioBorders().length > 0 ? audioBorders() : void 0 });
		});
		/** Candidates the user hasn't dismissed in this round, in original rank order. */
		const visibleSuggestions = derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			const dismissed = new Set(dismissedSuggestionSigs);
			return sectionSuggestionCandidates().filter((c) => {
				const sig = suggestionSig(sm, c);
				return sig === null || !dismissed.has(sig);
			});
		});
		/** The currently-active candidate (what banner + ghost preview show). */
		const activeSuggestion = derived(() => visibleSuggestions().length === 0 ? null : visibleSuggestions()[currentSuggestionIndex % visibleSuggestions().length] ?? null);
		derived(() => visibleSuggestions().length === 0 ? 0 : currentSuggestionIndex % visibleSuggestions().length + 1);
		derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			const sug = activeSuggestion();
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
		/**
		* Chord auto-fill lifecycle (same shape as section-suggestion above):
		*   - `chordAutoFillCandidates` re-derives from `$songMap` whenever
		*     sections or harmony change.
		*   - `dismissedAutoFillSigs` is a LIFO stack for undo.
		*   - Signature `${sourceSection.id}->${targetSection.id}` invalidates
		*     naturally as soon as the target fills up (proposal stops being
		*     generated when `fillCount = 0`), so explicit reset isn't needed.
		*/
		let dismissedAutoFillSigs = [];
		let currentAutoFillIndex = 0;
		function autoFillSig(proposal) {
			return `${proposal.sourceSection.id}->${proposal.targetSection.id}`;
		}
		const chordAutoFillCandidates = derived(() => store_get($$store_subs ??= {}, "$songMap", songMap) ? proposeChordAutoFillCandidates(store_get($$store_subs ??= {}, "$songMap", songMap)) : []);
		const visibleAutoFills = derived(() => chordAutoFillCandidates().filter((p) => !dismissedAutoFillSigs.includes(autoFillSig(p))));
		derived(() => visibleAutoFills().length === 0 ? null : visibleAutoFills()[currentAutoFillIndex % visibleAutoFills().length] ?? null);
		derived(() => visibleAutoFills().length === 0 ? 0 : currentAutoFillIndex % visibleAutoFills().length + 1);
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
		/**
		* Per-bar chord suggestions derived from cached chroma. Pure function;
		* recomputes when songMap mutates (key change, section edits, beats edits,
		* or new chroma from the analyzer). Bars whose downbeat already has a
		* user-placed chord are filtered out at render time in the strip (ghosts
		* only show when no real chord is present).
		*/
		const chordSuggestions = derived(() => proposeChordSuggestions(store_get($$store_subs ??= {}, "$songMap", songMap)));
		derived(() => {
			const out = {};
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			const preferFlats = sm?.metadata.keyDetail ? songKeyPreferFlats(sm.metadata.keyDetail) : false;
			for (const [beatId, sug] of chordSuggestions()) out[beatId] = {
				label: formatChordSymbol(sug.chord, { preferFlats }),
				confidence: sug.confidence
			};
			return out;
		});
		derived(() => {
			return null;
		});
		derived(() => store_get($$store_subs ??= {}, "$songMap", songMap)?.metadata.keyDetail ?? keyDraft);
		let audioEl = null;
		let rafId = 0;
		/**
		* Centralised playback engine for the grid editor — single owner of
		* the `<audio>` element, click loop, count-in pre-roll, transport,
		* range-end auto-stop, AND the click/volume UI state. The toolbar
		* inside `WaveformPlayer` binds directly to `playbackController.playWithClick`
		* / `.clickVolume` / `.songVolume` — no intermediate parent state,
		* no $effect bridge. WaveformPlayer reads `currentTime` / `isPlaying`
		* via `$derived` from the controller and dispatches `play() / pause()
		* / stop() / seek()`.
		*/
		const playbackController = new PlaybackController();
		onDestroy(() => {
			playbackController.destroy();
		});
		function stopPreviewLoop() {
			if (rafId) cancelAnimationFrame(rafId);
			rafId = 0;
		}
		let cueCountInBeats = derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			if (!sm) return 0;
			return effectiveCountInBeats(sm);
		});
		derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			if (!sm || cueCountInBeats() === 0) return null;
			return computeCountIn(sm, cueCountInBeats());
		});
		derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			if (!sm) return "Untitled song";
			return resolvedSpokenIntroText(sm);
		});
		derived(() => store_get($$store_subs ??= {}, "$songMap", songMap)?.cues.spokenIntroText ?? "");
		derived(() => store_get($$store_subs ??= {}, "$songMap", songMap) ? sortBeatsByTime(store_get($$store_subs ??= {}, "$songMap", songMap).timeline.beats).length : 0);
		let cueStartBeatIndex = derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			if (!sm || !sm.startBeatId) return 1;
			const i = sortBeatsByTime(sm.timeline.beats).findIndex((b) => b.id === sm.startBeatId);
			return i >= 0 ? i + 1 : 1;
		});
		let cueStartBeatInfo = derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			if (!sm) return null;
			const beat = sortBeatsByTime(sm.timeline.beats)[Math.max(0, cueStartBeatIndex() - 1)];
			if (!beat) return null;
			return {
				barIndex: sm.timeline.bars.find((b) => b.id === beat.barId)?.index ?? 0,
				indexInBar: beat.indexInBar,
				timeSec: beat.timeSec
			};
		});
		derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			if (!sm) return [];
			const plan = songPlaybackPlan(sm);
			if (!plan || plan.countInBeats === 0) return [];
			return plan.clickPoints.filter((c) => c.isCountIn).map((c) => ({
				timeSec: c.timeSec + plan.trimStartSec,
				downbeat: c.downbeat
			}));
		});
		derived(() => cueStartBeatInfo()?.barIndex ?? 0);
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
		onDestroy(() => {
			stopPreviewLoop();
			audioEl?.pause();
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
