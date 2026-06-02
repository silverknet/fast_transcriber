import { F as writable, N as get } from "./server.js";
import "./index-server2.js";
import { c as encodeSmapFile, d as validateSongMap, f as defaultCueSettings, n as exportRestorableStateAsSmapBlob, o as safeExportBasename, p as emptySongMetadata, s as decodeSmapFile, u as smapFileDataToRestorableState } from "./persist.js";
import "./client.js";
import { t as STEM_PRESET_PRIORITY } from "./desktopBridge.js";
import { t as BARBRO_DESKTOP_BEACON_PORT } from "./desktopBeacon.js";
//#region src/lib/songmap/session.ts
/**
* After timeline/metadata edits, keep `map.audio` aligned with the live trim/file in `audioSession`
* so exported JSON and DB payloads stay consistent with what the user hears.
*/
function mergeAudioReferenceFromSession(map, session) {
	if (!session.file) return map;
	const audio = {
		...map.audio,
		fileName: session.name,
		mimeType: session.file.type || map.audio?.mimeType,
		trim: {
			startSec: session.startSec,
			endSec: session.endSec
		},
		source: map.audio?.source ?? "upload",
		sha256: map.audio?.sha256
	};
	return {
		...map,
		audio
	};
}
/**
* Build `AudioSession` from a parsed map + optional blob (e.g. after loading `.smap` JSON + sidecar).
*/
function audioSessionFromMapAndBlob(map, blob) {
	const a = map.audio;
	const trim = a?.trim ?? {
		startSec: 0,
		endSec: a?.durationSec ?? 0
	};
	const name = a?.fileName ?? "audio.wav";
	let file = null;
	if (blob) file = blob instanceof File ? blob : new File([blob], name, { type: a?.mimeType ?? "application/octet-stream" });
	return {
		file,
		name,
		startSec: trim.startSec,
		endSec: trim.endSec
	};
}
function restorableSongState(songMap, audioBlob, songId) {
	return {
		songMap,
		audioBlob,
		songId
	};
}
//#endregion
//#region src/lib/stores/audioSession.ts
var audioSession = writable({
	file: null,
	name: "",
	startSec: 0,
	endSec: 0
});
//#endregion
//#region src/lib/audio/computeCountIn.ts
/**
* Compute how many seconds must be prepended before the (trimmed) audio file
* so that `countInBeats` metronome clicks fit cleanly before the song start.
*
* The "song start" is `songStartBeat(sm)` — bar 1 beat 1 by default, or
* whatever beat `sm.startBeatId` references. `beatDurationSec` is taken
* from THAT beat's bar, not bar 1, so count-in spacing follows the local
* meter when the override puts the start in a later bar.
*
* Returns null when the song map lacks enough timeline data.
*/
function computeCountIn(songMap, countInBeats) {
	const { bars, beats } = songMap.timeline;
	if (bars.length === 0 || beats.length === 0) return null;
	const startBeat = songStartBeat(songMap);
	if (!startBeat) return null;
	const startBar = bars.find((b) => b.id === startBeat.barId);
	if (!startBar || startBar.beatCount <= 0) return null;
	const beatDurationSec = (startBar.endSec - startBar.startSec) / startBar.beatCount;
	if (!Number.isFinite(beatDurationSec) || beatDurationSec <= 0) return null;
	const trimStart = songMap.audio?.trim.startSec ?? 0;
	const effectiveFirstDownbeatSec = startBeat.timeSec - trimStart;
	const countInDuration = countInBeats * beatDurationSec;
	return {
		prependSec: Math.max(0, countInDuration - effectiveFirstDownbeatSec),
		beatDurationSec,
		effectiveFirstDownbeatSec
	};
}
//#endregion
//#region src/lib/songmap/countIn.ts
/**
* Single source of truth for "how many count-in beats does this song have."
*
* Reads the top-level `countInBeats` (decoupled from `cues.mode`). Returns
* `0` when absent, non-positive, or not a finite integer. A song with cue
* speech enabled AND a count-in coexist freely.
*
* Transitional behavior: while `.smap` migration to v2 is still landing,
* legacy files may carry the value at `cues.countInBeats` only. We honor
* that as a fallback so renderers keep working on un-migrated content.
* The fallback is removed in Step 4 of the v2 cutover.
*/
function effectiveCountInBeats(sm) {
	const top = sm.countInBeats;
	if (Number.isInteger(top) && top > 0) return top;
	if (sm.cues.mode === "countIn" && Number.isInteger(sm.cues.countInBeats) && sm.cues.countInBeats > 0) return sm.cues.countInBeats;
	return 0;
}
//#endregion
//#region src/lib/songmap/sectionEdit.ts
function ok$1(map) {
	return {
		ok: true,
		map
	};
}
function fail$1(error) {
	return {
		ok: false,
		error
	};
}
/** All kinds for pickers (order = common song flow). */
var SECTION_KIND_OPTIONS = [
	{
		kind: "intro",
		label: "Intro"
	},
	{
		kind: "verse",
		label: "Verse"
	},
	{
		kind: "preChorus",
		label: "Pre-chorus"
	},
	{
		kind: "chorus",
		label: "Chorus"
	},
	{
		kind: "bridge",
		label: "Bridge"
	},
	{
		kind: "solo",
		label: "Solo"
	},
	{
		kind: "riff",
		label: "Riff"
	},
	{
		kind: "break",
		label: "Break"
	},
	{
		kind: "outro",
		label: "Outro"
	},
	{
		kind: "custom",
		label: "Custom"
	}
];
function defaultSectionLabel(kind) {
	return SECTION_KIND_OPTIONS.find((o) => o.kind === kind)?.label ?? kind;
}
function rangesOverlap(a0, a1, b0, b1) {
	return !(a1 < b0 || b1 < a0);
}
/** Inclusive ranges that touch (border) or overlap — `[0..3]` and `[4..7]` are adjacent. */
function rangesOverlapOrAdjacent(a0, a1, b0, b1) {
	return !(a1 + 1 < b0 || b1 + 1 < a0);
}
/**
* Assigns a section to an inclusive bar index range.
*
* Behavior:
*   - **Same-kind neighbors** that overlap *or border* the new range are folded
*     into one larger section spanning the union of all touched ranges. Tagging
*     bars 4-7 as Chorus next to an existing Chorus 0-3 produces a single
*     Chorus 0-7, not two 4-bar choruses.
*   - **Different-kind sections** that overlap the (merged) range are dropped —
*     the new tag wins, same as before.
*
* `labelOverride` (when non-empty) replaces the default label. Otherwise, if a
* same-kind neighbor is being merged in and had a non-default label
* (e.g. "Big Chorus"), that label is preserved. Falls back to the default for
* the kind.
*/
function setSectionForBarRange(map, startBarIndex, endBarIndex, kind, idFactory, labelOverride) {
	const n = map.timeline.bars.length;
	if (n === 0) return fail$1("No bars in timeline");
	const a = Math.max(0, Math.min(startBarIndex, endBarIndex));
	const b = Math.min(n - 1, Math.max(startBarIndex, endBarIndex));
	if (a > b) return fail$1("Invalid bar range");
	const sameKindNeighbors = map.sections.filter((s) => s.kind === kind && rangesOverlapOrAdjacent(s.barRange.startBarIndex, s.barRange.endBarIndex, a, b));
	const unionStart = Math.min(a, ...sameKindNeighbors.map((s) => s.barRange.startBarIndex));
	const unionEnd = Math.max(b, ...sameKindNeighbors.map((s) => s.barRange.endBarIndex));
	const neighborIds = new Set(sameKindNeighbors.map((s) => s.id));
	const filtered = map.sections.filter((s) => {
		if (neighborIds.has(s.id)) return false;
		return !rangesOverlap(s.barRange.startBarIndex, s.barRange.endBarIndex, unionStart, unionEnd);
	});
	const fallback = defaultSectionLabel(kind);
	const trimmedOverride = labelOverride?.trim();
	let label = fallback;
	if (trimmedOverride && trimmedOverride.length > 0) label = trimmedOverride;
	else {
		const inherited = sameKindNeighbors.find((s) => s.label && s.label !== fallback);
		if (inherited) label = inherited.label;
	}
	const section = {
		id: idFactory(),
		kind,
		label,
		barRange: {
			startBarIndex: unionStart,
			endBarIndex: unionEnd
		}
	};
	return ok$1({
		...map,
		sections: [...filtered, section]
	});
}
/**
* Resize an existing section to a new bar range. Preserves the section's id
* and label. Allows shrinking (unlike re-tagging through `setSectionForBarRange`,
* which only ever grows the union). Same overlap conventions as
* `setSectionForBarRange`: same-kind neighbors that border or overlap the new
* range fold in; different-kind overlaps are dropped.
*
* Used by edge-drag in the bar strip to grow / shrink a section.
*/
function resizeSectionRange(map, sectionId, newStartBarIndex, newEndBarIndex) {
	const existing = map.sections.find((s) => s.id === sectionId);
	if (!existing) return fail$1("Section not found");
	const n = map.timeline.bars.length;
	if (n === 0) return fail$1("No bars in timeline");
	const a = Math.max(0, Math.min(newStartBarIndex, newEndBarIndex));
	const b = Math.min(n - 1, Math.max(newStartBarIndex, newEndBarIndex));
	if (a > b) return fail$1("Invalid bar range");
	const others = map.sections.filter((s) => s.id !== sectionId);
	const sameKindNeighbors = others.filter((s) => s.kind === existing.kind && rangesOverlapOrAdjacent(s.barRange.startBarIndex, s.barRange.endBarIndex, a, b));
	const unionStart = Math.min(a, ...sameKindNeighbors.map((s) => s.barRange.startBarIndex));
	const unionEnd = Math.max(b, ...sameKindNeighbors.map((s) => s.barRange.endBarIndex));
	const neighborIds = new Set(sameKindNeighbors.map((s) => s.id));
	const filtered = others.filter((s) => {
		if (neighborIds.has(s.id)) return false;
		return !rangesOverlap(s.barRange.startBarIndex, s.barRange.endBarIndex, unionStart, unionEnd);
	});
	const updated = {
		...existing,
		barRange: {
			startBarIndex: unionStart,
			endBarIndex: unionEnd
		}
	};
	return ok$1({
		...map,
		sections: [...filtered, updated]
	});
}
/**
* Move the shared edge between two adjacent sections — left.endBarIndex + 1 ===
* right.startBarIndex — by setting a new boundary bar index. The left section
* ends at `newBoundaryBarIndex - 1`, the right starts at `newBoundaryBarIndex`.
*
* Both sections must stay at least 1 bar wide; the boundary is clamped into
* `[left.start + 1, right.end]`. Used by the boundary drag handle in the bar
* strip — one drag, two sections updated, no gaps, no dropped sections.
*/
function resizeSectionBoundary(map, leftSectionId, rightSectionId, newBoundaryBarIndex) {
	const left = map.sections.find((s) => s.id === leftSectionId);
	const right = map.sections.find((s) => s.id === rightSectionId);
	if (!left || !right) return fail$1("Section not found");
	const minBoundary = left.barRange.startBarIndex + 1;
	const maxBoundary = right.barRange.endBarIndex;
	if (minBoundary > maxBoundary) return fail$1("Sections cannot both stay non-empty");
	const b = Math.max(minBoundary, Math.min(maxBoundary, newBoundaryBarIndex));
	const updatedSections = map.sections.map((s) => {
		if (s.id === leftSectionId) return {
			...s,
			barRange: {
				...s.barRange,
				endBarIndex: b - 1
			}
		};
		if (s.id === rightSectionId) return {
			...s,
			barRange: {
				...s.barRange,
				startBarIndex: b
			}
		};
		return s;
	});
	return ok$1({
		...map,
		sections: updatedSections
	});
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
//#region src/lib/audio/cueTrackSpeechSchedule.ts
/**
* Spoken phrases for the offline cue WAV (mixed after click render).
* Times are seconds on the **cue file** timeline (0 = start of exported WAV).
*
* Count-in numbers use **grid time** (same spacing as `computeCountIn` / metronome clicks),
* not one continuous TTS phrase at speech rate.
*/
var NUMBER_WORDS = [
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
	"thirteen",
	"fourteen",
	"fifteen",
	"sixteen"
];
/** Speak slightly before the click so the beat lands in the vowel. */
var COUNT_SPEECH_ANTICIPATION_SEC = .048;
/** Section name clip ends ~this far before the first shortened count syllable. */
var SECTION_NAME_BEFORE_SHORT_PICKUP_SEC = .52;
var MIN_SPEECH_ON_CUE_TIMELINE_SEC = .07;
/**
* Every section: **full bar** one…N (the bar before the pickup bar), **section name**, then
* **shortened** count (first syllable = `sectionOrdinal+1` up to N; wraps to 1…N when past N) into the
* section’s first downbeat. All times on the cue file timeline; shifted together if they start &lt; 0.
*/
function pushSectionCountInPack(events, opts) {
	const { preludeSec, prependSec, trimStart, bar, sectionOrdinal, middlePhrase } = opts;
	const N = Math.max(1, bar.beatCount);
	const bd = (bar.endSec - bar.startSec) / N;
	if (!(bd > 0) || !Number.isFinite(bd)) return;
	const T = bar.startSec;
	const baseOnCue = preludeSec + prependSec + (T - trimStart);
	const shortFrom = sectionOrdinal + 1 <= N ? sectionOrdinal + 1 : 1;
	const atoms = [];
	for (let k = 1; k <= N; k++) {
		const hit = baseOnCue - 2 * N * bd + (k - 1) * bd;
		const w = NUMBER_WORDS[k - 1] ?? String(k);
		atoms.push({
			t: hit - COUNT_SPEECH_ANTICIPATION_SEC,
			kind: "count",
			text: `${w}.`
		});
	}
	const tSectionSpeak = baseOnCue - (N - shortFrom + 1) * bd - COUNT_SPEECH_ANTICIPATION_SEC - SECTION_NAME_BEFORE_SHORT_PICKUP_SEC;
	const mid = sanitizeCueSpeechText(middlePhrase.endsWith(".") ? middlePhrase : `${middlePhrase}.`, 120);
	atoms.push({
		t: tSectionSpeak,
		kind: "section",
		text: mid
	});
	for (let k = shortFrom; k <= N; k++) {
		const hit = baseOnCue - (N - k + 1) * bd;
		const w = NUMBER_WORDS[k - 1] ?? String(k);
		atoms.push({
			t: hit - COUNT_SPEECH_ANTICIPATION_SEC,
			kind: "count",
			text: `${w}.`
		});
	}
	const minT = Math.min(...atoms.map((a) => a.t));
	const shift = minT < MIN_SPEECH_ON_CUE_TIMELINE_SEC ? MIN_SPEECH_ON_CUE_TIMELINE_SEC - minT : 0;
	atoms.sort((a, b) => a.t - b.t);
	for (const a of atoms) events.push({
		kind: a.kind,
		tSec: a.t + shift,
		text: a.text
	});
}
/**
* Seconds of **cue-file** timeline reserved at t=0 before the first count-in click, so the
* spoken title can finish without overlapping count numbers (desktop TTS).
*
* Needed whenever there's speech to fit at the head of the cue WAV — that is,
* when the cue mode is `'spoken'` OR a count-in is active (both create content
* the title would otherwise step on).
*/
function titleCuePreludeSec(sm) {
	const hasSpeech = sm.cues.mode === "spoken";
	const hasCountIn = effectiveCountInBeats(sm) > 0;
	if (!hasSpeech && !hasCountIn) return 0;
	const raw = (sm.metadata.title || "Untitled song").trim();
	const len = Math.min(72, raw.length);
	return Math.min(2.85, Math.max(.82, .34 + len * .055));
}
function firstBarDownbeatBeat(sm) {
	const firstBar = [...sm.timeline.bars].sort((a, b) => a.index - b.index)[0];
	if (!firstBar) return void 0;
	return sortBeatsByTime(sm.timeline.beats).find((b) => b.barId === firstBar.id && b.indexInBar === 0);
}
/**
* The song-start anchor. Single source of truth for "where does the song
* actually begin." Used by every renderer that needs to place count-in
* clicks, align stems, or compute the first downbeat on the click WAV.
*
* - Honors `sm.startBeatId` when set and the referenced beat exists.
* - Falls back to `firstBarDownbeatBeat(sm)` (bar 1, beat 1).
* - Returns `undefined` only when the timeline has no first-bar downbeat,
*   in which case downstream code already handles "no start" gracefully.
*/
function songStartBeat(sm) {
	if (sm.startBeatId) {
		const found = sm.timeline.beats.find((b) => b.id === sm.startBeatId);
		if (found) return found;
	}
	return firstBarDownbeatBeat(sm);
}
/** Sanitize for TTS: single line, bounded length. */
function sanitizeCueSpeechText(raw, maxLen) {
	const t = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
	return t.length <= maxLen ? t : `${t.slice(0, maxLen - 1).trimEnd()}…`;
}
/**
* Position on the click/cue WAV timeline (seconds from sample 0) where the
* song's first musical downbeat — bar 1, beat 1 — lands. This is the
* single, unambiguous "song start" anchor that the renderer uses for both
* count-in clicks and song-aligned clicks.
*
* Click WAV layout:
*
*   [0,                    preludeSec)           — title-cue silence
*   [preludeSec,           preludeSec + prependSec) — count-in silence
*   [preludeSec + prependSec, songStart)         — pre-roll inside the trimmed
*                                                  audio (= 0 if trim is tight
*                                                  to the first downbeat)
*    songStart                                   — bar 1, beat 1
*   [songStart, …)                               — song clicks (downbeat first)
*
* Invariants downstream depend on this:
*   - Count-in (N beats) → exactly N clicks at `[songStart − N·bd, songStart − bd]`,
*     each spaced one beat apart, ending one beat before the downbeat lands.
*   - The first downbeat-tone song click is mixed AT `songStart`.
*
* Returns null when timeline data is insufficient (no first-bar downbeat,
* no usable beat duration, no trim).
*/
function clickWavSongStartSec(sm, opts) {
	const start = songStartBeat(sm);
	if (!start) return null;
	const trim = sm.audio?.trim;
	if (!trim) return null;
	const t = opts.preludeSec + opts.prependSec + (start.timeSec - trim.startSec);
	return Number.isFinite(t) ? t : null;
}
/**
* Output-file times (seconds, on the click-WAV timeline BEFORE the title
* prelude — caller adds `titleCuePreludeSec(sm)`) for each count-in click.
*
* Returns **exactly `countInBeats`** times when timeline data is sufficient,
* ending one beat before the song-start anchor.
*
* Placement strategy:
*  - When the timeline has real beats BEFORE the song-start anchor (typically
*    because `startBeatId` was moved later in the song), the count-in clicks
*    land at those actual `beat.timeSec` values — preserving any per-beat
*    timing irregularity. Each beat has a specific moment; we honor it.
*  - For the earlier portion that extends before the timeline's earliest
*    available beat (or when the anchor is bar 1 beat 1 with no pre-start
*    beats at all), we synthesize uniform-bd spacing extending backward.
*/
function countInSpeechOutputTimes(sm, trim, prependSec, countInBeats) {
	if (countInBeats <= 0) return [];
	const start = songStartBeat(sm);
	if (!start) return [];
	const ci = computeCountIn(sm, countInBeats);
	if (!ci) return [];
	const bd = ci.beatDurationSec;
	if (!(bd > 0)) return [];
	const songStartNoPrelude = prependSec + (start.timeSec - trim.startSec);
	if (!Number.isFinite(songStartNoPrelude)) return [];
	const sorted = sortBeatsByTime(sm.timeline.beats);
	const startIdx = sorted.findIndex((b) => b.id === start.id);
	const preStartBeats = [];
	if (startIdx > 0) {
		const take = Math.min(countInBeats, startIdx);
		for (let i = startIdx - take; i < startIdx; i++) preStartBeats.push(sorted[i]);
	}
	const numActual = preStartBeats.length;
	const numSynth = countInBeats - numActual;
	const synthAnchorOriginal = numActual > 0 ? preStartBeats[0].timeSec : start.timeSec;
	const out = new Array(countInBeats);
	for (let k = 1; k <= countInBeats; k++) {
		let tOriginal;
		if (k <= numSynth) tOriginal = synthAnchorOriginal - (numSynth - k + 1) * bd;
		else tOriginal = preStartBeats[k - numSynth - 1].timeSec;
		out[k - 1] = songStartNoPrelude - (start.timeSec - tOriginal);
	}
	return out;
}
/**
* Build speech events: **title** (actual `metadata.title` once), count-in numbers if enabled, then for
* **each section** (intro, verse, chorus, …): **full bar** one…N → **section name** → **shortened**
* count into that section’s downbeat (2…N, 3…N, …; then wrap). Matches e.g. title + one two three four
* + Intro + two three four before the intro downbeat.
*/
function buildCueSpeechEvents(sm) {
	const trim = sm.audio?.trim;
	if (!trim || !(trim.endSec > trim.startSec)) return [];
	let prependSec = 0;
	const countInBeats = effectiveCountInBeats(sm);
	if (countInBeats > 0) {
		const ci = computeCountIn(sm, countInBeats);
		if (ci) prependSec = ci.prependSec;
	}
	const preludeSec = titleCuePreludeSec(sm);
	const events = [{
		kind: "title",
		tSec: .02,
		text: `${sanitizeCueSpeechText(sm.metadata.title || "Untitled song", 72)}.`
	}];
	if (countInBeats > 0) {
		const times = countInSpeechOutputTimes(sm, trim, prependSec, countInBeats);
		for (let i = 0; i < times.length; i++) {
			const w = NUMBER_WORDS[i] ?? String(i + 1);
			/** After prelude: same grid as clicks; anticipation keeps the beat in the syllable. */
			const tSpeak = preludeSec + times[i] - COUNT_SPEECH_ANTICIPATION_SEC;
			events.push({
				kind: "count",
				tSec: tSpeak,
				text: `${w}.`
			});
		}
	}
	const sorted = [...sm.sections].sort((a, b) => a.barRange.startBarIndex - b.barRange.startBarIndex);
	const barByIndex = new Map(sm.timeline.bars.map((b) => [b.index, b]));
	let sectionOrdinal = 0;
	const trimStart = trim.startSec;
	for (const sec of sorted) {
		const bar = barByIndex.get(sec.barRange.startBarIndex);
		if (!bar) continue;
		const tMaster = bar.startSec;
		const tCue = preludeSec + prependSec + (tMaster - trimStart) - .48;
		if (!Number.isFinite(tCue)) continue;
		const defaultLabel = defaultSectionLabel(sec.kind);
		const label = sec.label?.trim() ?? "";
		const middle = label === "" || label === defaultLabel ? defaultLabel : label;
		sectionOrdinal += 1;
		const before = events.length;
		pushSectionCountInPack(events, {
			preludeSec,
			prependSec,
			trimStart,
			bar,
			sectionOrdinal,
			middlePhrase: middle
		});
		if (events.length === before) {
			const phrase = sanitizeCueSpeechText(middle.endsWith(".") ? middle : `${middle}.`, 120);
			events.push({
				kind: "section",
				tSec: Math.max(.06, tCue),
				text: phrase
			});
		}
	}
	return events;
}
//#endregion
//#region src/lib/songmap/cueTrackFingerprint.ts
function round6(n) {
	return Math.round(n * 1e6) / 1e6;
}
/**
* Canonical payload for cue-track alignment. Any change here should invalidate
* a previously rendered cue WAV.
*/
function cueTrackFingerprintPayload(sm) {
	const trim = sm.audio?.trim ?? {
		startSec: 0,
		endSec: 0
	};
	const bars = sm.timeline.bars.map((b) => ({
		i: b.index,
		s: round6(b.startSec),
		e: round6(b.endSec),
		n: b.meter.numerator,
		d: b.meter.denominator,
		bc: b.beatCount,
		bids: [...b.beatIds]
	}));
	const beats = sortBeatsByTime(sm.timeline.beats).map((b) => ({
		id: b.id,
		bar: b.barId,
		t: round6(b.timeSec),
		iib: b.indexInBar
	}));
	const sections = sm.sections.map((s) => ({
		k: s.kind,
		l: s.label,
		s: s.barRange.startBarIndex,
		e: s.barRange.endBarIndex
	}));
	return {
		v: 3,
		trim: {
			startSec: round6(trim.startSec),
			endSec: round6(trim.endSec)
		},
		audioSha256: sm.audio?.sha256 ?? "",
		countInBeats: effectiveCountInBeats(sm),
		startBeatId: sm.startBeatId ?? null,
		cues: {
			mode: sm.cues.mode,
			useSectionLabels: sm.cues.useSectionLabels,
			titlePreludeSec: round6(titleCuePreludeSec(sm))
		},
		bars,
		beats,
		sections
	};
}
/** Stable short fingerprint (sync, for patch + UI). */
function fingerprintCueTrackInputs(sm) {
	const raw = JSON.stringify(cueTrackFingerprintPayload(sm));
	let h = 5381;
	for (let i = 0; i < raw.length; i++) h = h * 33 ^ raw.charCodeAt(i);
	return (h >>> 0).toString(16).padStart(8, "0");
}
//#endregion
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
//#region src/lib/songmap/harmonyEdit.ts
/** Half-open [startSec, endSec) for the beat in timeline order. */
function beatHarmonySpan(beat, allBeatsSorted, barsById) {
	const barEnd = barsById.get(beat.barId)?.endSec ?? beat.timeSec + .25;
	const idx = allBeatsSorted.findIndex((b) => b.id === beat.id);
	const next = idx >= 0 && idx + 1 < allBeatsSorted.length ? allBeatsSorted[idx + 1] : null;
	let endSec = barEnd;
	if (next && next.timeSec > beat.timeSec) endSec = Math.min(next.timeSec, barEnd);
	if (!(endSec > beat.timeSec)) endSec = Math.min(beat.timeSec + .02, barEnd);
	return {
		startSec: beat.timeSec,
		endSec
	};
}
/**
* Replace or insert exactly one harmony row for `beatId`, removing any prior row for that beat.
*/
function upsertHarmonyAtBeat(map, beatId, chord, newId) {
	const beat = map.timeline.beats.find((b) => b.id === beatId);
	if (!beat) return {
		ok: false,
		error: "Unknown beat"
	};
	if (!map.timeline.bars.find((b) => b.id === beat.barId)) return {
		ok: false,
		error: "Unknown bar for beat"
	};
	const { startSec, endSec } = beatHarmonySpan(beat, sortBeatsByTime(map.timeline.beats), new Map(map.timeline.bars.map((b) => [b.id, b])));
	if (!(endSec > startSec)) return {
		ok: false,
		error: "Invalid harmony span"
	};
	const filtered = map.harmony.filter((h) => h.beatId !== beatId);
	const next = {
		id: newId(),
		barId: beat.barId,
		beatId,
		startSec,
		endSec,
		chord,
		beatAnchor: { indexInBar: beat.indexInBar }
	};
	return {
		ok: true,
		map: {
			...map,
			harmony: [...filtered, next]
		}
	};
}
/** Remove harmony anchored to `beatId` if any. */
function clearHarmonyAtBeat(map, beatId) {
	return {
		...map,
		harmony: map.harmony.filter((h) => h.beatId !== beatId)
	};
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
//#region src/lib/stores/songMap.ts
/**
* In-memory durable song document (bars, beats, harmony, …). Playable bytes live in `audioSession`;
* after each successful patch we merge trim/file info into `map.audio` when a file is loaded.
* Full snapshot: `RestorableSongState` + `hydrateRestorableSong`.
*/
var songMap = writable(null);
function setSongMap(map) {
	songMap.set(map);
}
function clearSongMap() {
	songMap.set(null);
}
/**
* Apply an immutable update to the current map. On validation failure the store is unchanged.
*/
function patchSongMap(updater) {
	let result = {
		ok: false,
		errors: ["No song map loaded"]
	};
	songMap.update((sm) => {
		if (!sm) return sm;
		let next = updater(sm);
		const sess = get(audioSession);
		if (sess.file) next = mergeAudioReferenceFromSession(next, sess);
		if (next.cueTrackExport || next.clickTrackExport) {
			const fp = fingerprintCueTrackInputs(next);
			if (next.cueTrackExport && fp !== next.cueTrackExport.fingerprint) next = {
				...next,
				cueTrackExport: void 0
			};
			if (next.clickTrackExport && fp !== next.clickTrackExport.fingerprint) next = {
				...next,
				clickTrackExport: void 0
			};
		}
		const v = validateSongMap(next);
		if (!v.ok) {
			result = {
				ok: false,
				errors: v.errors
			};
			return sm;
		}
		result = { ok: true };
		const now = (/* @__PURE__ */ new Date()).toISOString();
		return {
			...next,
			metadata: {
				...next.metadata,
				updatedAt: now
			}
		};
	});
	return result;
}
//#endregion
//#region src/lib/stores/restorableSong.ts
/**
* Apply a full restorable snapshot: durable `SongMap` plus playable blob into app stores.
* Call after loading `.smap` JSON + sidecar audio, or when hydrating from DB + blob storage.
*/
function hydrateRestorableSong(state) {
	setSongMap(state.songMap);
	audioSession.set(audioSessionFromMapAndBlob(state.songMap, state.audioBlob));
}
/** Clears song document + audio session (same as closing the project in memory). */
function clearFullAppSongState() {
	clearSongMap();
	audioSession.set({
		file: null,
		name: "",
		startSec: 0,
		endSec: 0
	});
	if (typeof document !== "undefined") document.cookie = "barbro_session=; Max-Age=0; Path=/; SameSite=Lax";
}
//#endregion
//#region src/lib/stores/project.ts
/**
* BarBro project store — one project at a time.
*
* Canonical identity is the project's absolute OS path on disk. The desktop
* sidecar is the only I/O layer for project files; the web app does not
* touch the filesystem for project mode. A non-null `osPath` means a
* project is open.
*
* `activeSongFolder` and `activeSongId` are always set together or both
* null. They drive the autosave guard in `projectAutosave.ts` — if either
* is null, autosave will not write to disk.
*/
var empty = {
	osPath: null,
	data: null,
	metadataByFolder: {},
	activeSongFolder: null,
	activeSongId: null,
	editingMode: null
};
var project = writable(empty);
function setActiveProject(osPath, data, metadataByFolder = {}) {
	project.set({
		osPath,
		data,
		metadataByFolder,
		activeSongFolder: null,
		activeSongId: null,
		editingMode: null
	});
}
function setProjectData(data) {
	project.update((s) => ({
		...s,
		data
	}));
}
function setMetadataByFolder(map) {
	project.update((s) => ({
		...s,
		metadataByFolder: map
	}));
}
/**
* Merge a partial patch into the cached lite metadata for one song folder.
* Critical: this is a MERGE, not a replace. Disk-state fields (hasCueTrack,
* hasClickTrack, hasAls, stemsOnDisk) live alongside songMap-derived fields
* (title, bpm, etc.) — a caller updating one shouldn't wipe the other.
*
* Use `setMetadataByFolder` for the wholesale-replace path (called by
* `refreshProjectInfo` with the sidecar's authoritative scan).
*/
function patchMetadataForFolder(folder, patch) {
	project.update((s) => {
		const existing = s.metadataByFolder[folder] ?? { title: "" };
		return {
			...s,
			metadataByFolder: {
				...s.metadataByFolder,
				[folder]: {
					...existing,
					...patch
				}
			}
		};
	});
}
function setActiveSong(folder, id) {
	project.update((s) => ({
		...s,
		activeSongFolder: folder,
		activeSongId: id,
		editingMode: "project-song"
	}));
}
function closeProject() {
	project.set(empty);
}
//#endregion
//#region src/lib/project/types.ts
var PROJECT_SONGS_DIR = "songs";
/**
* Single helper used by every loop that walks the project for export
* purposes (Ableton bulk export, future PDF set list, future cloud sync).
* Hidden entries are filtered out at the source so future code can't
* accidentally include them.
*/
function getExportableSongs(project) {
	return project.songs.filter((s) => !s.hidden);
}
/** Returns the leaf folder name from `"songs/opener-7f3a9c2d"` → `"opener-7f3a9c2d"`. */
function songFolderLeaf(folder) {
	const ix = folder.lastIndexOf("/");
	return ix === -1 ? folder : folder.slice(ix + 1);
}
//#endregion
//#region src/lib/client/desktopProjectFs.ts
/**
* Web ⇄ desktop project filesystem bridge.
*
* All project I/O (manifest read/write, song.smap create/read/write,
* stems scan, song-folder remove) goes through these loopback HTTP calls.
* The browser File System Access API is NOT used for project mode — the
* desktop sidecar is the only disk-IO layer.
*
* Every function returns a typed Result `{ ok: true, ... } | { ok: false, error }`.
* No throws on network failure; callers handle the sidecar-offline case
* explicitly (project mode requires the desktop client).
*/
var BASE_URL = `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`;
async function postJson(url, body) {
	let res;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			cache: "no-store"
		});
	} catch (e) {
		return {
			ok: false,
			error: `Desktop sidecar unreachable: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	try {
		return await res.json();
	} catch {
		return {
			ok: false,
			error: `Sidecar returned non-JSON (HTTP ${res.status})`
		};
	}
}
/** Encode a Uint8Array as base64 (browser-safe). */
function bytesToBase64(bytes) {
	let bin = "";
	const chunk = 32768;
	for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
	return btoa(bin);
}
async function createProject(parentPath, name) {
	return await postJson(`${BASE_URL}/native/project/create`, {
		parentPath,
		name
	});
}
async function getProjectInfo(projectPath) {
	return await postJson(`${BASE_URL}/native/project/info`, { projectPath });
}
async function writeProjectManifest(projectPath, manifest) {
	return await postJson(`${BASE_URL}/native/project/manifest/write`, {
		projectPath,
		manifest
	});
}
async function createProjectSong(projectPath, songFolder, smapBytes) {
	return await postJson(`${BASE_URL}/native/project/song/create`, {
		projectPath,
		songFolder,
		smapBase64: bytesToBase64(smapBytes)
	});
}
async function readProjectSong(projectPath, songFolder) {
	const url = new URL(`${BASE_URL}/native/project/song/read`);
	url.searchParams.set("projectPath", projectPath);
	url.searchParams.set("songFolder", songFolder);
	let res;
	try {
		res = await fetch(url.toString(), { cache: "no-store" });
	} catch (e) {
		return {
			ok: false,
			error: `Desktop sidecar unreachable: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	if (!res.ok) {
		let err = `Read failed (HTTP ${res.status})`;
		try {
			const j = await res.json();
			if (j.error) err = j.error;
		} catch {}
		return {
			ok: false,
			error: err
		};
	}
	const buf = await res.arrayBuffer();
	return {
		ok: true,
		bytes: new Uint8Array(buf)
	};
}
async function writeProjectSong(projectPath, songFolder, smapBytes) {
	return await postJson(`${BASE_URL}/native/project/song/write`, {
		projectPath,
		songFolder,
		smapBase64: bytesToBase64(smapBytes)
	});
}
async function removeProjectSong(projectPath, songFolder, deleteFiles) {
	return await postJson(`${BASE_URL}/native/project/song/remove`, {
		projectPath,
		songFolder,
		deleteFiles
	});
}
/**
* Write an arbitrary file under a song folder (e.g. `cue/cue-track.wav`).
* Path is validated by the sidecar; no `..` segments allowed. Intermediate
* directories are created.
*/
async function writeProjectSongAsset(projectPath, songFolder, subpath, bytes) {
	return await postJson(`${BASE_URL}/native/project/song/asset/write`, {
		projectPath,
		songFolder,
		subpath,
		contentBase64: bytesToBase64(bytes)
	});
}
/**
* Write a single file at the PROJECT ROOT (e.g. `<projectName>.als`).
* Path is validated by the sidecar; no `..` segments allowed. Intermediate
* directories are created.
*/
async function writeProjectAsset(projectPath, subpath, bytes) {
	return await postJson(`${BASE_URL}/native/project/asset/write`, {
		projectPath,
		subpath,
		contentBase64: bytesToBase64(bytes)
	});
}
/**
* Read WAV header info (duration / sample rate / channels) for a batch of
* files under the project tree. Per-file errors don't abort the batch
* — each item either has the info fields or an `error` field.
*/
async function getProjectWavInfoBatch(projectPath, files) {
	return await postJson(`${BASE_URL}/native/project/wav-info/batch`, {
		projectPath,
		files
	});
}
/**
* Transcode a compressed audio file (typically MP3) to 16-bit PCM WAV
* inside the project tree. Cache-aware via sidecar mtime check — the
* actual ffmpeg call only runs when needed.
*
* Used by the Ableton setlist export to ensure every clip is uncompressed
* (no encoder priming offsets) for sample-accurate alignment.
*/
async function transcodeProjectAudioToWav(projectPath, songFolder, srcSubpath, dstSubpath) {
	return await postJson(`${BASE_URL}/native/project/transcode-to-wav`, {
		projectPath,
		songFolder,
		srcSubpath,
		dstSubpath
	});
}
/**
* Read an arbitrary file from under a song folder (e.g. `stems/vocals.wav`,
* `cue/cue-track.wav`). Returns the bytes as a Blob for direct use with
* `AudioContext.decodeAudioData`. 404 → ok:false.
*/
async function readProjectSongAsset(projectPath, songFolder, subpath) {
	const url = new URL(`${BASE_URL}/native/project/song/asset/read`);
	url.searchParams.set("projectPath", projectPath);
	url.searchParams.set("songFolder", songFolder);
	url.searchParams.set("subpath", subpath);
	let res;
	try {
		res = await fetch(url.toString(), { cache: "no-store" });
	} catch (e) {
		return {
			ok: false,
			error: `Desktop sidecar unreachable: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	if (!res.ok) {
		let err = `Read failed (HTTP ${res.status})`;
		try {
			const j = await res.json();
			if (j.error) err = j.error;
		} catch {}
		return {
			ok: false,
			error: err
		};
	}
	return {
		ok: true,
		blob: await res.blob()
	};
}
//#endregion
//#region src/lib/project/commit.ts
/**
* Project mutation primitives — create / open / commit-new-song /
* import-smap / hide / remove. All disk I/O goes through the desktop
* sidecar's `/native/project/*` endpoints (see [desktopProjectFs](../client/desktopProjectFs.ts));
* the browser File System Access API is not used for project mode.
*
* Canonical identity for a project is its absolute OS path. The store's
* `osPath` is the single source of truth; `localStorage[barbro::lastProjectPath]`
* persists it across reloads.
*
* The invariant: a manifest entry never points to a missing or invalid
* `song.smap` — the commit ladder writes the .smap first, then the
* manifest, with rollback if anything in between fails.
*/
/** localStorage key for "abs OS path of the project that was open when the user last left BarBro". */
var LAST_PROJECT_PATH_KEY = "barbro::lastProjectPath";
/** localStorage key for "song that was active when the user last left BarBro". */
var ACTIVE_SONG_ID_KEY = "barbro::activeSongId";
/** localStorage key for the recents list (`string[]` of abs OS paths). */
var RECENT_PROJECTS_KEY = "barbro::recentProjects";
var SONG_SMAP_FILENAME = "song.smap";
var RECENT_PROJECTS_CAP = 10;
function lsGet(key) {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
function lsSet(key, value) {
	try {
		localStorage.setItem(key, value);
	} catch {}
}
function lsRemove(key) {
	try {
		localStorage.removeItem(key);
	} catch {}
}
function readLastProjectPath() {
	const v = lsGet(LAST_PROJECT_PATH_KEY);
	return v && v.trim() ? v : null;
}
function writeLastProjectPath(p) {
	lsSet(LAST_PROJECT_PATH_KEY, p);
}
function clearLastProjectPath() {
	lsRemove(LAST_PROJECT_PATH_KEY);
}
/** Recents are pure paths — names are derived on read from `getProjectInfo`. */
function readRecentProjectPaths() {
	try {
		const raw = lsGet(RECENT_PROJECTS_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((x) => typeof x === "string" && !!x.trim());
	} catch {
		return [];
	}
}
function recordRecentProjectPath(projectPath) {
	const next = [projectPath, ...readRecentProjectPaths().filter((p) => p !== projectPath)].slice(0, RECENT_PROJECTS_CAP);
	lsSet(RECENT_PROJECTS_KEY, JSON.stringify(next));
}
function dropRecentProjectPath(projectPath) {
	const next = readRecentProjectPaths().filter((p) => p !== projectPath);
	lsSet(RECENT_PROJECTS_KEY, JSON.stringify(next));
}
/** Extract the lite metadata used by the project list view from a SongMap. */
function metadataLiteFromSongMap(map) {
	const m = map.metadata;
	const out = { title: m.title };
	if (m.artist) out.artist = m.artist;
	if (m.keyDetail) out.keyDetail = m.keyDetail;
	if (m.bpm !== void 0) out.bpm = m.bpm;
	const countIn = effectiveCountInBeats(map);
	if (countIn > 0) out.countInBeats = countIn;
	if (map.stemRefs && Object.keys(map.stemRefs).length > 0) out.stemRefs = { ...map.stemRefs };
	return out;
}
/** Translate the sidecar's per-song info shape into the store-friendly lite shape. */
function liteFromInfo(info, fallbackFolder) {
	const out = { title: info.title || songFolderLeaf(fallbackFolder) };
	if (info.artist) out.artist = info.artist;
	if (info.keyDetail) out.keyDetail = info.keyDetail;
	if (typeof info.bpm === "number") out.bpm = info.bpm;
	if (info.stemRefs && Object.keys(info.stemRefs).length > 0) out.stemRefs = info.stemRefs;
	if (info.stemsByPreset && Object.keys(info.stemsByPreset).length > 0) out.stemsByPreset = info.stemsByPreset;
	if (info.hasAls) out.hasAls = true;
	if (info.hasCueTrack) out.hasCueTrack = true;
	if (info.hasClickTrack) out.hasClickTrack = true;
	if (typeof info.countInBeats === "number" && info.countInBeats > 0) out.countInBeats = info.countInBeats;
	return out;
}
/**
* Best stem set available for a song, by preset priority. Returns null
* when no stems are on disk. The returned `pathPrefix` is the relative
* folder to prepend to each file name to get a sidecar-readable path —
* `stems/<preset>/` for tagged sets, `stems/` for legacy.
*/
function selectBestStemSet(meta) {
	const sets = meta?.stemsByPreset;
	if (!sets) return null;
	for (const slug of STEM_PRESET_PRIORITY) {
		const files = sets[slug];
		if (files && files.length > 0) return {
			preset: slug,
			files,
			pathPrefix: slug === "legacy" ? "stems/" : `stems/${slug}/`
		};
	}
	for (const [slug, files] of Object.entries(sets)) if (files.length > 0) return {
		preset: slug,
		files,
		pathPrefix: `stems/${slug}/`
	};
	return null;
}
function nowIso() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
/** Compute folder name `<slug>-<id.slice(0,8)>` for a song. */
function songFolderName(title, id) {
	return `${safeExportBasename(title)}-${id.slice(0, 8)}`;
}
/**
* Create a brand-new project on disk via the sidecar. The picked
* `parentPath` is the containing location; the sidecar slugifies `name`
* and creates a subfolder there. Hydrates the project store on success.
*/
async function createProjectOnDisk(parentPath, name) {
	const r = await createProject(parentPath, name);
	if (!r.ok) throw new Error(r.error);
	setActiveProject(r.projectPath, r.manifest, {});
	writeLastProjectPath(r.projectPath);
	recordRecentProjectPath(r.projectPath);
	return r.manifest;
}
/**
* Open an existing project by absolute OS path. The sidecar reads the
* manifest, scans each song's folder (smap header + stems), and we
* populate the store in one shot.
*/
async function openProjectByPath(projectPath) {
	const r = await getProjectInfo(projectPath);
	if (!r.ok) throw new Error(r.error);
	const meta = {};
	for (const [folder, info] of Object.entries(r.songsMetadata)) meta[folder] = liteFromInfo(info, folder);
	setActiveProject(projectPath, r.manifest, meta);
	writeLastProjectPath(projectPath);
	recordRecentProjectPath(projectPath);
	return r.manifest;
}
/**
* Best-effort restore of the most-recently-opened project on app load.
* Reads `lastProjectPath` from localStorage and re-hydrates via the
* sidecar. Silent on any failure — the user can re-open from the File menu.
*/
async function tryRestoreLastProject() {
	const p = readLastProjectPath();
	if (!p) return null;
	try {
		return await openProjectByPath(p);
	} catch {
		return null;
	}
}
/**
* Re-fetch project info from the sidecar and refresh the in-memory caches.
* Used after stems land, after manual file moves, and on `/project` mount.
* The sidecar's scan is the source of truth for what stems exist on disk;
* we also sync each song's `.smap.stemRefs` to match what was discovered.
*/
async function refreshProjectInfo() {
	const snap = get(project);
	if (!snap.osPath || !snap.data) return {
		updatedSongs: 0,
		errors: ["No active project"]
	};
	const r = await getProjectInfo(snap.osPath);
	if (!r.ok) return {
		updatedSongs: 0,
		errors: [r.error]
	};
	const errors = [];
	let updatedSongs = 0;
	const nextMeta = {};
	for (const entry of r.manifest.songs) {
		const info = r.songsMetadata[entry.folder];
		if (!info) {
			nextMeta[entry.folder] = { title: songFolderLeaf(entry.folder) };
			continue;
		}
		nextMeta[entry.folder] = liteFromInfo(info, entry.folder);
		const best = selectBestStemSet(nextMeta[entry.folder]);
		const discoveredRefs = {};
		if (best) for (const filename of best.files) {
			const slot = slotForStemFilename(filename);
			if (slot) discoveredRefs[slot] = `${best.pathPrefix}${filename}`;
		}
		const existingRefs = info.stemRefs ?? {};
		const toAdd = {};
		for (const [slot, rel] of Object.entries(discoveredRefs)) if (existingRefs[slot] !== rel) toAdd[slot] = rel;
		if (Object.keys(toAdd).length > 0 && info.hasSmap) try {
			await mergeStemRefsIntoSmap(snap.osPath, entry.folder, toAdd);
			updatedSongs++;
			nextMeta[entry.folder] = {
				...nextMeta[entry.folder],
				stemRefs: {
					...existingRefs,
					...toAdd
				}
			};
		} catch (e) {
			errors.push(`${entry.folder}: ${e instanceof Error ? e.message : "unknown"}`);
		}
	}
	setProjectData(r.manifest);
	setMetadataByFolder(nextMeta);
	return {
		updatedSongs,
		errors
	};
}
/**
* Atomic-ish commit: write song.smap to disk, then update the manifest.
* Folder collisions are handled by regenerating the song id (cap 3 retries).
* On manifest-write failure, the orphan song folder is removed. On
* song.smap-create failure, no manifest mutation has happened so the
* invariant holds.
*/
async function writeSongIntoProject(projectPath, manifest, smapBytes, meta) {
	let id = crypto.randomUUID();
	let leaf = songFolderName(meta.title, id);
	let folderRel = `${PROJECT_SONGS_DIR}/${leaf}`;
	let attempt = 0;
	while (attempt < 3) {
		const r = await createProjectSong(projectPath, folderRel, smapBytes);
		if (r.ok) break;
		if (r.error.toLowerCase().includes("already exists") && attempt < 2) {
			attempt++;
			id = crypto.randomUUID();
			leaf = songFolderName(meta.title, id);
			folderRel = `${PROJECT_SONGS_DIR}/${leaf}`;
			continue;
		}
		throw new Error(`Failed to create song.smap: ${r.error}`);
	}
	const entry = {
		id,
		folder: folderRel
	};
	const nextManifest = {
		...manifest,
		updatedAt: nowIso(),
		songs: [...manifest.songs, entry]
	};
	const w = await writeProjectManifest(projectPath, nextManifest);
	if (!w.ok) {
		await removeProjectSong(projectPath, folderRel, true).catch(() => {});
		throw new Error(`Failed to update barbro.project.json: ${w.error}`);
	}
	return {
		entry,
		nextManifest
	};
}
/**
* Commit a brand-new song (from the analyze flow) into the active project.
* Updates the project store and sets the song as active so autosave takes
* over.
*/
async function commitNewSongToProject(state) {
	const snap = get(project);
	if (!snap.osPath || !snap.data) throw new Error("No active project");
	const meta = metadataLiteFromSongMap(state.songMap);
	const blob = await exportRestorableStateAsSmapBlob(state);
	const smapBytes = new Uint8Array(await blob.arrayBuffer());
	const { entry, nextManifest } = await writeSongIntoProject(snap.osPath, snap.data, smapBytes, meta);
	setProjectData(nextManifest);
	patchMetadataForFolder(entry.folder, meta);
	setActiveSong(entry.folder, entry.id);
	return { entry };
}
/**
* Import an existing `.smap` file from anywhere into the active project.
* Bytes are copied as-is (audio preserved); a fresh song id is generated.
*/
async function importSmapToProject(smapBlob, meta) {
	const snap = get(project);
	if (!snap.osPath || !snap.data) throw new Error("No active project");
	const smapBytes = new Uint8Array(await smapBlob.arrayBuffer());
	const { entry, nextManifest } = await writeSongIntoProject(snap.osPath, snap.data, smapBytes, meta);
	setProjectData(nextManifest);
	patchMetadataForFolder(entry.folder, meta);
	return { entry };
}
/**
* Read a project song's `.smap` (with audio) and hydrate the editor stores.
* Caller still navigates to /edit.
*/
async function loadProjectSongIntoEditor(songId) {
	const snap = get(project);
	if (!snap.osPath || !snap.data) throw new Error("No active project");
	const entry = snap.data.songs.find((s) => s.id === songId);
	if (!entry) throw new Error("Song not found in project");
	const r = await readProjectSong(snap.osPath, entry.folder);
	if (!r.ok) throw new Error(`Could not read song.smap: ${r.error}`);
	const state = smapFileDataToRestorableState(await decodeSmapFile(new Blob([r.bytes], { type: "application/octet-stream" })), entry.id);
	hydrateRestorableSong(state);
	patchMetadataForFolder(entry.folder, metadataLiteFromSongMap(state.songMap));
	setActiveSong(entry.folder, entry.id);
}
async function setSongHidden(songId, hidden) {
	const snap = get(project);
	if (!snap.osPath || !snap.data) throw new Error("No active project");
	const idx = snap.data.songs.findIndex((s) => s.id === songId);
	if (idx === -1) throw new Error("Song not found in project");
	const next = {
		...snap.data,
		updatedAt: nowIso(),
		songs: snap.data.songs.map((s, i) => i === idx ? {
			...s,
			hidden: hidden || void 0
		} : s)
	};
	const w = await writeProjectManifest(snap.osPath, next);
	if (!w.ok) throw new Error(`Failed to write manifest: ${w.error}`);
	setProjectData(next);
}
async function removeSongFromProject(songId, options = {}) {
	const snap = get(project);
	if (!snap.osPath || !snap.data) throw new Error("No active project");
	const entry = snap.data.songs.find((s) => s.id === songId);
	if (!entry) throw new Error("Song not found in project");
	let filesRemoved = false;
	if (options.deleteFiles) filesRemoved = (await removeProjectSong(snap.osPath, entry.folder, true)).ok;
	const next = {
		...snap.data,
		updatedAt: nowIso(),
		songs: snap.data.songs.filter((s) => s.id !== songId)
	};
	const w = await writeProjectManifest(snap.osPath, next);
	if (!w.ok) throw new Error(`Failed to write manifest: ${w.error}`);
	setProjectData(next);
	project.update((s) => {
		const m = { ...s.metadataByFolder };
		delete m[entry.folder];
		return {
			...s,
			metadataByFolder: m
		};
	});
	if (snap.activeSongId === songId) project.update((s) => ({
		...s,
		activeSongFolder: null,
		activeSongId: null,
		editingMode: s.editingMode === "project-song" ? null : s.editingMode
	}));
	return { filesRemoved };
}
/**
* Map a Demucs output filename like `vocals.wav` to the canonical
* `STEM_TRACKS` slot name. Returns null when no obvious match.
*/
function slotForStemFilename(filename) {
	return {
		vocals: "Vocals",
		drums: "Drums",
		bass: "Bass",
		other: "Guitar",
		guitar: "Guitar",
		fx: "FX"
	}[filename.replace(/\.[^.]+$/, "").toLowerCase()] ?? null;
}
/**
* Read a song's `.smap` via the sidecar, merge in extra stemRefs, write back.
* Used by `refreshProjectInfo` when stems on disk drift from the manifest.
*/
async function mergeStemRefsIntoSmap(projectPath, songFolder, newRefs) {
	const r = await readProjectSong(projectPath, songFolder);
	if (!r.ok) throw new Error(r.error);
	const data = await decodeSmapFile(new Blob([r.bytes], { type: "application/octet-stream" }));
	const out = await encodeSmapFile({ project: {
		projectFormatVersion: 1,
		songMap: {
			...data.project.songMap,
			stemRefs: {
				...data.project.songMap.stemRefs ?? {},
				...newRefs
			}
		}
	} });
	const w = await writeProjectSong(projectPath, songFolder, new Uint8Array(await out.arrayBuffer()));
	if (!w.ok) throw new Error(w.error);
}
//#endregion
export { audioSession as $, patchSongMap as A, newId as B, writeProjectSongAsset as C, project as D, patchMetadataForFolder as E, clearHarmonyAtBeat as F, titleCuePreludeSec as G, clickWavSongStartSec as H, upsertHarmonyAtBeat as I, resizeSectionBoundary as J, sortBeatsByTime as K, mergeAnalysisIntoSongMap as L, songMap as M, applyBarGridAction as N, clearFullAppSongState as O, evenBeatTimes as P, computeCountIn as Q, createEmptySongMap as R, writeProjectSong as S, closeProject as T, countInSpeechOutputTimes as U, buildCueSpeechEvents as V, songStartBeat as W, setSectionForBarRange as X, resizeSectionRange as Y, effectiveCountInBeats as Z, getProjectWavInfoBatch as _, createProjectOnDisk as a, transcodeProjectAudioToWav as b, loadProjectSongIntoEditor as c, readRecentProjectPaths as d, restorableSongState as et, refreshProjectInfo as f, tryRestoreLastProject as g, setSongHidden as h, commitNewSongToProject as i, setSongMap as j, hydrateRestorableSong as k, metadataLiteFromSongMap as l, selectBestStemSet as m, SONG_SMAP_FILENAME as n, dropRecentProjectPath as o, removeSongFromProject as p, defaultSectionLabel as q, clearLastProjectPath as r, importSmapToProject as s, ACTIVE_SONG_ID_KEY as t, openProjectByPath as u, readProjectSong as v, getExportableSongs as w, writeProjectAsset as x, readProjectSongAsset as y, createSongMapFromAudioSession as z };
