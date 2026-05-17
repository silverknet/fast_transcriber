import { n as defaultCueSettings, t as validateSongMap } from "./validate.js";
//#region src/lib/songmap/parse.ts
var SongMapParseError = class extends Error {
	constructor(message, path, cause) {
		super(message);
		this.path = path;
		this.cause = cause;
		this.name = "SongMapParseError";
	}
};
function expectObject(v, path) {
	if (!v || typeof v !== "object" || Array.isArray(v)) throw new SongMapParseError("Expected object", path);
	return v;
}
function optString(v) {
	if (v === void 0 || v === null) return void 0;
	if (typeof v !== "string") return void 0;
	return v;
}
function reqString(v, path) {
	if (typeof v !== "string") throw new SongMapParseError("Expected string", path);
	return v;
}
function optNum(v) {
	if (v === void 0 || v === null) return void 0;
	if (typeof v !== "number" || !Number.isFinite(v)) return void 0;
	return v;
}
function reqNum(v, path) {
	if (typeof v !== "number" || !Number.isFinite(v)) throw new SongMapParseError("Expected number", path);
	return v;
}
function parseMeter(raw, path) {
	const o = expectObject(raw, path);
	return {
		numerator: reqNum(o.numerator, `${path}.numerator`),
		denominator: reqNum(o.denominator, `${path}.denominator`)
	};
}
function parseChord(raw, path) {
	const o = expectObject(raw, path);
	return {
		root: reqString(o.root, `${path}.root`),
		accidental: optString(o.accidental),
		quality: optString(o.quality),
		extensions: Array.isArray(o.extensions) ? o.extensions.map((x) => String(x)) : void 0,
		bass: optString(o.bass),
		bassAccidental: optString(o.bassAccidental),
		displayRaw: reqString(o.displayRaw, `${path}.displayRaw`)
	};
}
function parseBar(raw, path) {
	const o = expectObject(raw, path);
	return {
		id: reqString(o.id, `${path}.id`),
		index: reqNum(o.index, `${path}.index`),
		startSec: reqNum(o.startSec, `${path}.startSec`),
		endSec: reqNum(o.endSec, `${path}.endSec`),
		meter: parseMeter(o.meter, `${path}.meter`),
		beatCount: reqNum(o.beatCount, `${path}.beatCount`),
		beatIds: Array.isArray(o.beatIds) ? o.beatIds.map((id, i) => reqString(id, `${path}.beatIds[${i}]`)) : (() => {
			throw new SongMapParseError("beatIds must be array", `${path}.beatIds`);
		})()
	};
}
function parseBeat(raw, path) {
	const o = expectObject(raw, path);
	return {
		id: reqString(o.id, `${path}.id`),
		barId: reqString(o.barId, `${path}.barId`),
		indexInBar: reqNum(o.indexInBar, `${path}.indexInBar`),
		timeSec: reqNum(o.timeSec, `${path}.timeSec`),
		strength: optNum(o.strength),
		confidence: optNum(o.confidence),
		source: optString(o.source)
	};
}
function parseSection(raw, path) {
	const o = expectObject(raw, path);
	const br = expectObject(o.barRange, `${path}.barRange`);
	return {
		id: reqString(o.id, `${path}.id`),
		kind: reqString(o.kind, `${path}.kind`),
		label: reqString(o.label, `${path}.label`),
		barRange: {
			startBarIndex: reqNum(br.startBarIndex, `${path}.barRange.startBarIndex`),
			endBarIndex: reqNum(br.endBarIndex, `${path}.barRange.endBarIndex`)
		},
		color: optString(o.color)
	};
}
function parseHarmony(raw, path) {
	const o = expectObject(raw, path);
	const beatAnchor = o.beatAnchor && typeof o.beatAnchor === "object" && !Array.isArray(o.beatAnchor) ? { indexInBar: reqNum(o.beatAnchor.indexInBar, `${path}.beatAnchor.indexInBar`) } : void 0;
	return {
		id: reqString(o.id, `${path}.id`),
		barId: reqString(o.barId, `${path}.barId`),
		beatId: optString(o.beatId),
		startSec: reqNum(o.startSec, `${path}.startSec`),
		endSec: reqNum(o.endSec, `${path}.endSec`),
		chord: parseChord(o.chord, `${path}.chord`),
		beatAnchor
	};
}
var SONG_KEY_MODES = new Set(["major", "minor"]);
function parseSongKey(raw, path) {
	if (raw === void 0 || raw === null) return void 0;
	const o = expectObject(raw, path);
	const mode = reqString(o.mode, `${path}.mode`);
	if (!SONG_KEY_MODES.has(mode)) throw new SongMapParseError("keyDetail.mode must be major or minor", `${path}.mode`);
	return {
		root: reqString(o.root, `${path}.root`),
		accidental: optString(o.accidental),
		mode
	};
}
function parseAudio(raw, path) {
	const o = expectObject(raw, path);
	const trim = expectObject(o.trim, `${path}.trim`);
	return {
		fileName: reqString(o.fileName, `${path}.fileName`),
		mimeType: optString(o.mimeType),
		durationSec: optNum(o.durationSec),
		trim: {
			startSec: reqNum(trim.startSec, `${path}.trim.startSec`),
			endSec: reqNum(trim.endSec, `${path}.trim.endSec`)
		},
		sha256: optString(o.sha256),
		originalSha256: optString(o.originalSha256),
		source: reqString(o.source, `${path}.source`)
	};
}
function parseStemRefs(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return void 0;
	const result = {};
	for (const [k, v] of Object.entries(raw)) if (typeof v === "string") result[k] = v;
	return Object.keys(result).length > 0 ? result : void 0;
}
function parseCues(raw, path) {
	const o = expectObject(raw, path);
	return {
		mode: reqString(o.mode, `${path}.mode`),
		countInBeats: reqNum(o.countInBeats, `${path}.countInBeats`),
		useSectionLabels: Boolean(o.useSectionLabels),
		prependSec: optNum(o.prependSec),
		template: optString(o.template),
		language: optString(o.language)
	};
}
function parseMixState(raw, path) {
	if (raw === void 0 || raw === null) return void 0;
	const o = expectObject(raw, path);
	const tracksRaw = o.tracks;
	if (!Array.isArray(tracksRaw)) throw new SongMapParseError("mixState.tracks must be an array", `${path}.tracks`);
	const tracks = [];
	for (let i = 0; i < tracksRaw.length; i++) {
		const t = expectObject(tracksRaw[i], `${path}.tracks[${i}]`);
		const key = reqString(t.key, `${path}.tracks[${i}].key`);
		const volume = reqNum(t.volume, `${path}.tracks[${i}].volume`);
		if (!(volume >= 0)) throw new SongMapParseError("volume must be >= 0", `${path}.tracks[${i}].volume`);
		const entry = {
			key,
			volume
		};
		if (typeof t.muted === "boolean" && t.muted) entry.muted = true;
		if (typeof t.soloed === "boolean" && t.soloed) entry.soloed = true;
		tracks.push(entry);
	}
	const out = { tracks };
	if (typeof o.master === "number" && o.master >= 0) out.master = o.master;
	return out;
}
function parseCueTrackExport(raw, path) {
	if (raw === void 0 || raw === null) return void 0;
	const o = expectObject(raw, path);
	const fingerprint = reqString(o.fingerprint, `${path}.fingerprint`);
	const durationSec = reqNum(o.durationSec, `${path}.durationSec`);
	const sampleRate = reqNum(o.sampleRate, `${path}.sampleRate`);
	const generatedAt = reqString(o.generatedAt, `${path}.generatedAt`);
	const relativePath = optString(o.relativePath);
	if (!(durationSec > 0)) throw new SongMapParseError("cueTrackExport.durationSec must be > 0", `${path}.durationSec`);
	if (!(sampleRate > 0)) throw new SongMapParseError("cueTrackExport.sampleRate must be > 0", `${path}.sampleRate`);
	return {
		fingerprint,
		durationSec,
		sampleRate,
		generatedAt,
		relativePath
	};
}
function parseMetadata(raw, path) {
	const o = expectObject(raw, path);
	const keyDetail = o.keyDetail !== void 0 && o.keyDetail !== null ? parseSongKey(o.keyDetail, `${path}.keyDetail`) : void 0;
	const analyzedRaw = o.analyzed;
	const analyzed = typeof analyzedRaw === "boolean" ? analyzedRaw : void 0;
	return {
		title: reqString(o.title, `${path}.title`),
		artist: optString(o.artist),
		composer: optString(o.composer),
		arranger: optString(o.arranger),
		key: optString(o.key),
		keyDetail,
		bpm: optNum(o.bpm),
		notes: optString(o.notes),
		createdAt: reqString(o.createdAt, `${path}.createdAt`),
		updatedAt: reqString(o.updatedAt, `${path}.updatedAt`),
		analyzed
	};
}
function parseApp(raw, path) {
	if (raw === void 0 || raw === null) return void 0;
	const o = expectObject(raw, path);
	if (reqString(o.name, `${path}.name`) !== "BarBro") throw new SongMapParseError("app.name must be BarBro", `${path}.name`);
	return {
		name: "BarBro",
		appVersion: optString(o.appVersion)
	};
}
function parseTimeline(raw, path) {
	if (raw === void 0 || raw === null) return {
		bars: [],
		beats: []
	};
	const o = expectObject(raw, path);
	const barsRaw = o.bars;
	const beatsRaw = o.beats;
	return {
		bars: Array.isArray(barsRaw) ? barsRaw.map((b, i) => parseBar(b, `${path}.bars[${i}]`)) : [],
		beats: Array.isArray(beatsRaw) ? beatsRaw.map((b, i) => parseBeat(b, `${path}.beats[${i}]`)) : []
	};
}
function extractSongMapV1(raw) {
	const formatVersion = raw.formatVersion;
	if (formatVersion !== 1) throw new SongMapParseError(`Unsupported formatVersion: ${String(formatVersion)}`, "formatVersion");
	const metadata = parseMetadata(raw.metadata, "metadata");
	const timeline = parseTimeline(raw.timeline, "timeline");
	if (metadata.analyzed === void 0) metadata.analyzed = timeline.bars.length > 0;
	return {
		formatVersion: 1,
		app: parseApp(raw.app, "app"),
		metadata,
		audio: raw.audio !== void 0 && raw.audio !== null ? parseAudio(raw.audio, "audio") : void 0,
		timeline,
		sections: Array.isArray(raw.sections) ? raw.sections.map((s, i) => parseSection(s, `sections[${i}]`)) : [],
		harmony: Array.isArray(raw.harmony) ? raw.harmony.map((h, i) => parseHarmony(h, `harmony[${i}]`)) : [],
		cues: raw.cues !== void 0 && raw.cues !== null ? parseCues(raw.cues, "cues") : defaultCueSettings(),
		projectFolder: typeof raw.projectFolder === "string" ? raw.projectFolder : void 0,
		stemRefs: parseStemRefs(raw.stemRefs),
		cueTrackExport: raw.cueTrackExport !== void 0 && raw.cueTrackExport !== null ? parseCueTrackExport(raw.cueTrackExport, "cueTrackExport") : void 0,
		mixState: parseMixState(raw.mixState, "mixState")
	};
}
/**
* Parse JSON string into `SongMap`. Unknown keys are ignored when `stripUnknown` is true (default).
*/
function parseSongMap(json, options = {}) {
	const { stripUnknown = true } = options;
	let parsed;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		throw new SongMapParseError("Invalid JSON", void 0, e);
	}
	const root = expectObject(parsed, "");
	if (!stripUnknown && Object.keys(root).some((k) => !KNOWN_TOP_KEYS.has(k))) throw new SongMapParseError("Unknown top-level keys present (stripUnknown is false)", "");
	const map = extractSongMapV1(root);
	const v = validateSongMap(map);
	if (!v.ok) throw new SongMapParseError(v.errors[0] ?? "Validation failed");
	return map;
}
var KNOWN_TOP_KEYS = new Set([
	"formatVersion",
	"app",
	"metadata",
	"audio",
	"timeline",
	"sections",
	"harmony",
	"cues",
	"projectFolder",
	"stemRefs",
	"cueTrackExport",
	"mixState"
]);
//#endregion
//#region src/lib/songmap/serialize.ts
function omitUndefinedDeep(value) {
	if (value === void 0) return void 0;
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map((v) => omitUndefinedDeep(v)).filter((v) => v !== void 0);
	const out = {};
	for (const [k, v] of Object.entries(value)) {
		const next = omitUndefinedDeep(v);
		if (next !== void 0) out[k] = next;
	}
	return out;
}
/**
* Serialize `SongMap` to JSON string. Key order follows object literal construction order
* from `parse` / factories (stable round-trip if you parse and serialize again).
*/
function serializeSongMap(map, options = {}) {
	const { pretty = true, omitUndefined = true } = options;
	const payload = omitUndefined ? omitUndefinedDeep(map) : map;
	return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}
/** MIME type for downloaded `.smap` files. */
var SMAP_BLOB_TYPE = "application/vnd.barbro.smap";
/** Magic bytes at file start (ASCII "SMAP"). */
var MAGIC = new Uint8Array([
	83,
	77,
	65,
	80
]);
function readMagicMismatchError() {
	return /* @__PURE__ */ new Error("Invalid .smap: wrong magic bytes (expected \"SMAP\" at offset 0). Is this a BarBro .smap file?");
}
function readUnsupportedVersionError(found) {
	return /* @__PURE__ */ new Error(`Invalid .smap: unsupported container version ${found} (only version 1 is supported).`);
}
function readTruncatedFileError(expectedBytes, actualBytes) {
	return /* @__PURE__ */ new Error(`Invalid .smap: file is truncated (expected at least ${expectedBytes} bytes from header, got ${actualBytes}).`);
}
function readInvalidJsonError() {
	return /* @__PURE__ */ new Error("Invalid .smap: JSON chunk is not valid JSON.");
}
function readHasAudioButZeroLengthError() {
	return /* @__PURE__ */ new Error("Invalid .smap: hasAudio flag is set but audioLength is 0.");
}
function readFileShorterThanDeclaredError(expectedTotal, actual) {
	return /* @__PURE__ */ new Error(`Invalid .smap: file shorter than declared lengths (need ${expectedTotal} bytes total, got ${actual}).`);
}
function readTrailingGarbageError(extra) {
	return /* @__PURE__ */ new Error(`Invalid .smap: ${extra} unexpected byte(s) after the audio chunk.`);
}
function readFlagAudioMismatchError() {
	return /* @__PURE__ */ new Error("Invalid .smap: audio bytes are present but hasAudio flag is not set (or inconsistent lengths).");
}
/** Deep-sort object keys so `JSON.stringify` is stable for round-trip byte identity. Arrays keep order. */
function sortKeysDeep(x) {
	if (x === void 0) return void 0;
	if (x === null || typeof x !== "object") return x;
	if (Array.isArray(x)) return x.map(sortKeysDeep);
	const o = x;
	const out = {};
	for (const k of Object.keys(o).sort()) {
		const v = o[k];
		if (v === void 0) continue;
		const inner = sortKeysDeep(v);
		if (inner !== void 0) out[k] = inner;
	}
	return out;
}
/**
* Serialize `SongProject` to UTF-8 bytes deterministically (same logical project → same bytes).
* Ensures save → load → save yields an identical `.smap` when data is unchanged.
*/
function serializeProjectToUtf8(project) {
	const sorted = sortKeysDeep(project);
	return new TextEncoder().encode(JSON.stringify(sorted));
}
function validateMagic(buf) {
	if (buf.byteLength < 4) throw readMagicMismatchError();
	for (let i = 0; i < 4; i++) if (buf[i] !== MAGIC[i]) throw readMagicMismatchError();
}
function bigintToSafeNumber(n, label) {
	if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Invalid .smap: ${label} is too large for this environment.`);
	return Number(n);
}
/**
* Build the canonical JSON project envelope from in-memory state.
*/
function songProjectFromRestorableState(state) {
	return {
		projectFormatVersion: 1,
		songMap: state.songMap
	};
}
/**
* Convert decoded `.smap` data into the store hydration shape.
*/
function smapFileDataToRestorableState(data, songId) {
	const meta = data.project.songMap.audio;
	const name = meta?.fileName ?? "audio";
	const mime = meta?.mimeType ?? "application/octet-stream";
	let audioBlob = null;
	if (data.audioBlob !== void 0 && data.audioBlob.size > 0) {
		const b = data.audioBlob;
		audioBlob = b instanceof File ? b : new File([b], name, {
			type: b.type || mime,
			lastModified: Date.now()
		});
	}
	return {
		songMap: data.project.songMap,
		audioBlob,
		songId
	};
}
/**
* Whether we should write an audio chunk: only a **non-empty** `Blob`.
* `undefined`, missing, or `size === 0` → no audio chunk (`hasAudio = false`, `audioLength = 0`).
*/
function shouldWriteAudioChunk(audioBlob) {
	return audioBlob !== void 0 && audioBlob.size > 0;
}
/**
* Encode one `.smap` file: fixed header + UTF-8 JSON chunk + optional raw audio chunk.
*/
async function encodeSmapFile(data) {
	if (data.project.projectFormatVersion !== 1) throw new Error(`Unsupported SongProject format version: ${data.project.projectFormatVersion}`);
	const jsonBytes = serializeProjectToUtf8(data.project);
	let audioBytes = null;
	if (shouldWriteAudioChunk(data.audioBlob)) audioBytes = new Uint8Array(await data.audioBlob.arrayBuffer());
	const hasAudio = audioBytes !== null && audioBytes.byteLength > 0;
	const flags = hasAudio ? 1 : 0;
	const jsonLen = BigInt(jsonBytes.byteLength);
	const audioLen = hasAudio && audioBytes ? BigInt(audioBytes.byteLength) : 0n;
	const header = /* @__PURE__ */ new ArrayBuffer(28);
	const view = new DataView(header);
	new Uint8Array(header, 0, 4).set(MAGIC);
	view.setUint32(4, 1, true);
	view.setUint32(8, flags, true);
	view.setBigUint64(12, jsonLen, true);
	view.setBigUint64(20, audioLen, true);
	const total = 28 + jsonBytes.byteLength + (audioBytes ? audioBytes.byteLength : 0);
	const out = new Uint8Array(total);
	out.set(new Uint8Array(header), 0);
	out.set(jsonBytes, 28);
	if (audioBytes) out.set(audioBytes, 28 + jsonBytes.byteLength);
	return new Blob([out], { type: SMAP_BLOB_TYPE });
}
/**
* Decode a `.smap` from a `Blob` or `File`.
*/
async function decodeSmapFile(fileOrBlob) {
	return decodeSmapBytes(new Uint8Array(await fileOrBlob.arrayBuffer()));
}
function decodeSmapBytes(buf) {
	if (buf.byteLength < 28) throw readTruncatedFileError(28, buf.byteLength);
	validateMagic(buf);
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const version = view.getUint32(4, true);
	if (version !== 1) throw readUnsupportedVersionError(version);
	const flags = view.getUint32(8, true);
	const jsonLenBI = view.getBigUint64(12, true);
	const audioLenBI = view.getBigUint64(20, true);
	const jsonLen = bigintToSafeNumber(jsonLenBI, "jsonLength");
	const audioLen = bigintToSafeNumber(audioLenBI, "audioLength");
	const hasAudioFlag = (flags & 1) !== 0;
	if (hasAudioFlag && audioLen === 0) throw readHasAudioButZeroLengthError();
	if (!hasAudioFlag && audioLen > 0) throw readFlagAudioMismatchError();
	const expectedTotal = 28 + jsonLen + audioLen;
	if (buf.byteLength < expectedTotal) throw readFileShorterThanDeclaredError(expectedTotal, buf.byteLength);
	if (buf.byteLength > expectedTotal) throw readTrailingGarbageError(buf.byteLength - expectedTotal);
	const jsonStart = 28;
	const jsonEnd = jsonStart + jsonLen;
	const jsonBytes = buf.subarray(jsonStart, jsonEnd);
	let text;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes);
	} catch {
		throw new Error("Invalid .smap: JSON chunk is not valid UTF-8.");
	}
	let raw;
	try {
		raw = JSON.parse(text);
	} catch {
		throw readInvalidJsonError();
	}
	if (!raw || typeof raw !== "object") throw new Error("Invalid .smap: JSON root must be an object.");
	const o = raw;
	if (o.projectFormatVersion !== 1) throw new Error(`Invalid .smap: unsupported SongProject version ${String(o.projectFormatVersion)} (expected 1).`);
	if (!o.songMap || typeof o.songMap !== "object") throw new Error("Invalid .smap: missing or invalid songMap in JSON.");
	let songMap;
	try {
		songMap = parseSongMap(JSON.stringify(o.songMap));
	} catch (e) {
		const msg = e instanceof Error ? e.message : "parse failed";
		throw new Error(`Invalid .smap: songMap does not parse: ${msg}`);
	}
	const project = {
		projectFormatVersion: 1,
		songMap
	};
	if (!hasAudioFlag) return { project };
	const audioStart = jsonEnd;
	const audioEnd = audioStart + audioLen;
	const rawAudio = buf.subarray(audioStart, audioEnd);
	const mime = project.songMap.audio?.mimeType ?? "application/octet-stream";
	return {
		project,
		audioBlob: new Blob([new Uint8Array(rawAudio)], { type: mime })
	};
}
/** Sanity bound for `jsonLength`: 10 MB. Real projects are <100 KB. */
var MAX_REASONABLE_JSON_LENGTH = 10 * 1024 * 1024;
/**
* Fast-path read of just the JSON chunk without decoding the audio bytes.
* Used by the project list view (load metadata for many songs cheaply) and
* any other place that wants song metadata without paying for audio.
*
* Validates magic, version, length-sanity, and the size invariant
* `28 + jsonLength + audioLength === file.size`. Audio bytes are skipped
* entirely.
*/
async function readSmapJsonOnly(fileOrBlob) {
	const totalSize = fileOrBlob.size;
	if (totalSize < 28) throw readTruncatedFileError(28, totalSize);
	const headerBuf = new Uint8Array(await fileOrBlob.slice(0, 28).arrayBuffer());
	validateMagic(headerBuf);
	const headerView = new DataView(headerBuf.buffer, headerBuf.byteOffset, headerBuf.byteLength);
	const version = headerView.getUint32(4, true);
	if (version !== 1) throw readUnsupportedVersionError(version);
	const flags = headerView.getUint32(8, true);
	const jsonLenBI = headerView.getBigUint64(12, true);
	const audioLenBI = headerView.getBigUint64(20, true);
	const jsonLen = bigintToSafeNumber(jsonLenBI, "jsonLength");
	const audioLen = bigintToSafeNumber(audioLenBI, "audioLength");
	if (jsonLen > MAX_REASONABLE_JSON_LENGTH) throw new Error(`Invalid .smap: jsonLength ${jsonLen} exceeds reasonable bound`);
	const hasAudioFlag = (flags & 1) !== 0;
	if (hasAudioFlag && audioLen === 0) throw readHasAudioButZeroLengthError();
	if (!hasAudioFlag && audioLen > 0) throw readFlagAudioMismatchError();
	const expectedTotal = 28 + jsonLen + audioLen;
	if (totalSize !== expectedTotal) {
		if (totalSize < expectedTotal) throw readFileShorterThanDeclaredError(expectedTotal, totalSize);
		throw readTrailingGarbageError(totalSize - expectedTotal);
	}
	const jsonStart = 28;
	const jsonEnd = jsonStart + jsonLen;
	const jsonBuf = new Uint8Array(await fileOrBlob.slice(jsonStart, jsonEnd).arrayBuffer());
	let text;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(jsonBuf);
	} catch {
		throw new Error("Invalid .smap: JSON chunk is not valid UTF-8.");
	}
	let raw;
	try {
		raw = JSON.parse(text);
	} catch {
		throw readInvalidJsonError();
	}
	if (!raw || typeof raw !== "object") throw new Error("Invalid .smap: JSON root must be an object.");
	const o = raw;
	if (o.projectFormatVersion !== 1) throw new Error(`Invalid .smap: unsupported SongProject version ${String(o.projectFormatVersion)} (expected 1).`);
	if (!o.songMap || typeof o.songMap !== "object") throw new Error("Invalid .smap: missing or invalid songMap in JSON.");
	let songMap;
	try {
		songMap = parseSongMap(JSON.stringify(o.songMap));
	} catch (e) {
		const msg = e instanceof Error ? e.message : "parse failed";
		throw new Error(`Invalid .smap: songMap does not parse: ${msg}`);
	}
	return {
		projectFormatVersion: 1,
		songMap
	};
}
//#endregion
//#region src/lib/songmap/persist.ts
/**
* Serialize the musical document for DB / plain JSON export. Does not embed audio bytes in JSON.
*/
function exportSongMapJson(map, pretty = true) {
	return serializeSongMap(map, { pretty });
}
function parseSongMapJsonString(raw) {
	try {
		return {
			ok: true,
			map: parseSongMap(raw)
		};
	} catch (e) {
		return {
			ok: false,
			error: e instanceof SongMapParseError ? e.message : e instanceof Error ? e.message : "Parse failed"
		};
	}
}
function restorableStateFromJsonAndBlob(json, audioBlob, songId) {
	const parsed = parseSongMapJsonString(json);
	if (!parsed.ok) return parsed;
	return {
		ok: true,
		state: {
			songMap: parsed.map,
			audioBlob,
			songId
		}
	};
}
/** SHA-256 hex digest; use for `AudioReference.sha256` and blob storage keys. */
async function sha256HexOfBlob(blob) {
	const buf = await blob.arrayBuffer();
	const hash = await crypto.subtle.digest("SHA-256", buf);
	return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
/**
* Encode full restorable state as a single binary `.smap` file (see `smapFile.ts`).
*/
async function exportRestorableStateAsSmapBlob(state) {
	return encodeSmapFile({
		project: songProjectFromRestorableState(state),
		audioBlob: state.audioBlob ?? void 0
	});
}
/** Browser download for a `Blob` (e.g. `.smap`). */
function downloadBlob(blob, filename) {
	if (typeof document === "undefined") return;
	const a = document.createElement("a");
	const url = URL.createObjectURL(blob);
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
/** Safe single-segment filename stem from song title. */
function safeExportBasename(title) {
	return (title.trim() || "song").replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 80) || "song";
}
//#endregion
export { restorableStateFromJsonAndBlob as a, decodeSmapFile as c, smapFileDataToRestorableState as d, parseSongMapJsonString as i, encodeSmapFile as l, exportRestorableStateAsSmapBlob as n, safeExportBasename as o, exportSongMapJson as r, sha256HexOfBlob as s, downloadBlob as t, readSmapJsonOnly as u };
