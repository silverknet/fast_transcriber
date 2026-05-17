import { F as writable, N as get } from "./server.js";
import "./index-server2.js";
import { t as validateSongMap } from "./validate.js";
import { r as sortBeatsByTime } from "./timelineEdit.js";
import { c as decodeSmapFile, d as smapFileDataToRestorableState, l as encodeSmapFile, n as exportRestorableStateAsSmapBlob, o as safeExportBasename } from "./persist.js";
import "./client.js";
import { h as BARBRO_DESKTOP_BEACON_PORT, t as STEM_PRESET_PRIORITY } from "./desktopBridge.js";
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
* so that `countInBeats` metronome clicks fit cleanly before bar 1.
*
* Returns null when the song map lacks enough timeline data.
*/
function computeCountIn(songMap, countInBeats) {
	const { bars, beats } = songMap.timeline;
	if (bars.length === 0 || beats.length === 0) return null;
	const firstBar = bars[0];
	if (firstBar.beatCount <= 0) return null;
	const beatDurationSec = (firstBar.endSec - firstBar.startSec) / firstBar.beatCount;
	if (!Number.isFinite(beatDurationSec) || beatDurationSec <= 0) return null;
	const firstDownbeat = beats.find((b) => b.indexInBar === 0);
	if (!firstDownbeat) return null;
	const trimStart = songMap.audio?.trim.startSec ?? 0;
	const effectiveFirstDownbeatSec = firstDownbeat.timeSec - trimStart;
	const countInDuration = countInBeats * beatDurationSec;
	return {
		prependSec: Math.max(0, countInDuration - effectiveFirstDownbeatSec),
		beatDurationSec,
		effectiveFirstDownbeatSec
	};
}
//#endregion
//#region src/lib/songmap/sectionEdit.ts
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
/**
* Assigns a section to an inclusive bar index range. Drops existing sections that overlap
* the range, then appends the new section.
*/
function setSectionForBarRange(map, startBarIndex, endBarIndex, kind, idFactory) {
	const n = map.timeline.bars.length;
	if (n === 0) return fail("No bars in timeline");
	const a = Math.max(0, Math.min(startBarIndex, endBarIndex));
	const b = Math.min(n - 1, Math.max(startBarIndex, endBarIndex));
	if (a > b) return fail("Invalid bar range");
	const filtered = map.sections.filter((s) => {
		return !rangesOverlap(s.barRange.startBarIndex, s.barRange.endBarIndex, a, b);
	});
	const section = {
		id: idFactory(),
		kind,
		label: defaultSectionLabel(kind),
		barRange: {
			startBarIndex: a,
			endBarIndex: b
		}
	};
	return ok({
		...map,
		sections: [...filtered, section]
	});
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
* Only used when `cues.mode === 'countIn'` and `countInBeats > 0`.
*/
function titleCuePreludeSec(sm) {
	if (sm.cues.mode !== "countIn" || sm.cues.countInBeats <= 0) return 0;
	const raw = (sm.metadata.title || "Untitled song").trim();
	const len = Math.min(72, raw.length);
	return Math.min(2.85, Math.max(.82, .34 + len * .055));
}
function firstBarDownbeatBeat(sm) {
	const firstBar = [...sm.timeline.bars].sort((a, b) => a.index - b.index)[0];
	if (!firstBar) return void 0;
	return sortBeatsByTime(sm.timeline.beats).find((b) => b.barId === firstBar.id && b.indexInBar === 0);
}
/** Sanitize for TTS: single line, bounded length. */
function sanitizeCueSpeechText(raw, maxLen) {
	const t = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
	return t.length <= maxLen ? t : `${t.slice(0, maxLen - 1).trimEnd()}…`;
}
/**
* Output-file times (seconds) for each count-in beat: same steady spacing as the click track
* leading up to the first bar-1 downbeat on the cue timeline.
*/
function countInSpeechOutputTimes(sm, trim, prependSec, countInBeats) {
	if (countInBeats <= 0) return [];
	const firstBar = [...sm.timeline.bars].sort((a, b) => a.index - b.index)[0];
	if (!firstBar) return [];
	const fd = sortBeatsByTime(sm.timeline.beats).find((b) => b.barId === firstBar.id && b.indexInBar === 0);
	if (!fd) return [];
	const ci = computeCountIn(sm, countInBeats);
	if (!ci) return [];
	const trimStart = trim.startSec;
	const T = prependSec + (fd.timeSec - trimStart);
	const bd = ci.beatDurationSec;
	if (!(bd > 0) || !Number.isFinite(T)) return [];
	const out = [];
	for (let k = 1; k <= countInBeats; k++) out.push(T - (countInBeats - k + 1) * bd);
	return out.map((t) => Number.isFinite(t) ? Math.max(0, t) : 0);
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
	let countInBeats = 0;
	if (sm.cues.mode === "countIn" && sm.cues.countInBeats > 0) {
		const ci = computeCountIn(sm, sm.cues.countInBeats);
		if (ci) prependSec = ci.prependSec;
		countInBeats = sm.cues.countInBeats;
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
		v: 2,
		trim: {
			startSec: round6(trim.startSec),
			endSec: round6(trim.endSec)
		},
		audioSha256: sm.audio?.sha256 ?? "",
		cues: {
			mode: sm.cues.mode,
			countInBeats: sm.cues.countInBeats,
			prependSec: sm.cues.prependSec !== void 0 ? round6(sm.cues.prependSec) : null,
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
		if (next.cueTrackExport) {
			if (fingerprintCueTrackInputs(next) !== next.cueTrackExport.fingerprint) next = {
				...next,
				cueTrackExport: void 0
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
async function moveProjectSong(songId, delta) {
	const snap = get(project);
	if (!snap.osPath || !snap.data) throw new Error("No active project");
	const songs = snap.data.songs;
	const idx = songs.findIndex((s) => s.id === songId);
	if (idx === -1) throw new Error("Song not found in project");
	const newIdx = idx + delta;
	if (newIdx < 0 || newIdx >= songs.length) return;
	const nextSongs = [...songs];
	const [removed] = nextSongs.splice(idx, 1);
	nextSongs.splice(newIdx, 0, removed);
	const next = {
		...snap.data,
		updatedAt: nowIso(),
		songs: nextSongs
	};
	const w = await writeProjectManifest(snap.osPath, next);
	if (!w.ok) throw new Error(`Failed to write manifest: ${w.error}`);
	setProjectData(next);
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
	const out = await encodeSmapFile({
		project: {
			projectFormatVersion: 1,
			songMap: {
				...data.project.songMap,
				stemRefs: {
					...data.project.songMap.stemRefs ?? {},
					...newRefs
				}
			}
		},
		audioBlob: data.audioBlob
	});
	const w = await writeProjectSong(projectPath, songFolder, new Uint8Array(await out.arrayBuffer()));
	if (!w.ok) throw new Error(w.error);
}
//#endregion
export { buildCueSpeechEvents as A, clearFullAppSongState as C, songMap as D, setSongMap as E, computeCountIn as F, audioSession as I, restorableSongState as L, firstBarDownbeatBeat as M, titleCuePreludeSec as N, clearHarmonyAtBeat as O, setSectionForBarRange as P, project as S, patchSongMap as T, tryRestoreLastProject as _, createProjectOnDisk as a, closeProject as b, loadProjectSongIntoEditor as c, openProjectByPath as d, readRecentProjectPaths as f, setSongHidden as g, selectBestStemSet as h, commitNewSongToProject as i, countInSpeechOutputTimes as j, upsertHarmonyAtBeat as k, metadataLiteFromSongMap as l, removeSongFromProject as m, SONG_SMAP_FILENAME as n, dropRecentProjectPath as o, refreshProjectInfo as p, clearLastProjectPath as r, importSmapToProject as s, ACTIVE_SONG_ID_KEY as t, moveProjectSong as u, readProjectSongAsset as v, hydrateRestorableSong as w, patchMetadataForFolder as x, writeProjectSong as y };
