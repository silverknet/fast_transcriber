//#region src/lib/songmap/defaults.ts
function defaultCueSettings() {
	return {
		mode: "off",
		countInBeats: 4,
		useSectionLabels: true
	};
}
function emptySongMetadata(nowIso) {
	return {
		title: "Untitled",
		createdAt: nowIso,
		updatedAt: nowIso,
		analyzed: false
	};
}
//#endregion
//#region src/lib/songmap/validate.ts
function isFiniteNumber(n) {
	return typeof n === "number" && Number.isFinite(n);
}
var NOTE_NAMES = new Set([
	"C",
	"D",
	"E",
	"F",
	"G",
	"A",
	"B"
]);
var KEY_MODES = new Set(["major", "minor"]);
function validateSongKey(k, path, errors) {
	if (!NOTE_NAMES.has(k.root)) errors.push(`${path}.root invalid`);
	if (!KEY_MODES.has(k.mode)) errors.push(`${path}.mode invalid`);
}
function validateMetadata(m, path, errors) {
	if (typeof m.title !== "string" || !m.title.trim()) errors.push(`${path}.title required`);
	if (typeof m.createdAt !== "string") errors.push(`${path}.createdAt must be ISO string`);
	if (typeof m.updatedAt !== "string") errors.push(`${path}.updatedAt must be ISO string`);
	if (m.keyDetail != null) validateSongKey(m.keyDetail, `${path}.keyDetail`, errors);
}
function validateBar(bar, path, errors) {
	if (typeof bar.id !== "string" || !bar.id) errors.push(`${path}.id required`);
	if (!Number.isInteger(bar.index) || bar.index < 0) errors.push(`${path}.index invalid`);
	if (!isFiniteNumber(bar.startSec)) errors.push(`${path}.startSec invalid`);
	if (!isFiniteNumber(bar.endSec)) errors.push(`${path}.endSec invalid`);
	if (bar.endSec <= bar.startSec) errors.push(`${path}.endSec must be > startSec (half-open [start,end))`);
	if (!bar.meter || typeof bar.meter.numerator !== "number" || bar.meter.numerator < 1) errors.push(`${path}.meter.numerator invalid`);
	if (!bar.meter || typeof bar.meter.denominator !== "number" || bar.meter.denominator < 1) errors.push(`${path}.meter.denominator invalid`);
	if (!Number.isInteger(bar.beatCount) || bar.beatCount < 0) errors.push(`${path}.beatCount invalid`);
	if (!Array.isArray(bar.beatIds)) errors.push(`${path}.beatIds must be array`);
	else if (bar.beatIds.length !== bar.beatCount) errors.push(`${path}.beatIds length must equal beatCount`);
}
function validateBeat(b, path, errors) {
	if (typeof b.id !== "string" || !b.id) errors.push(`${path}.id required`);
	if (typeof b.barId !== "string" || !b.barId) errors.push(`${path}.barId required`);
	if (!Number.isInteger(b.indexInBar) || b.indexInBar < 0) errors.push(`${path}.indexInBar invalid`);
	if (!isFiniteNumber(b.timeSec)) errors.push(`${path}.timeSec invalid`);
}
var SECTION_KINDS = new Set([
	"intro",
	"verse",
	"preChorus",
	"chorus",
	"bridge",
	"solo",
	"outro",
	"custom"
]);
function validateSection(s, path, errors) {
	if (typeof s.id !== "string" || !s.id) errors.push(`${path}.id required`);
	if (typeof s.kind !== "string" || !SECTION_KINDS.has(s.kind)) errors.push(`${path}.kind invalid`);
	if (typeof s.label !== "string") errors.push(`${path}.label required`);
	if (!s.barRange || !Number.isInteger(s.barRange.startBarIndex) || !Number.isInteger(s.barRange.endBarIndex)) errors.push(`${path}.barRange invalid`);
	else if (s.barRange.endBarIndex < s.barRange.startBarIndex) errors.push(`${path}.barRange end must be >= start`);
}
function validateChordSymbol(c, path, errors) {
	if (!NOTE_NAMES.has(c.root)) errors.push(`${path}.root invalid`);
	if (c.bass != null && !NOTE_NAMES.has(c.bass)) errors.push(`${path}.bass invalid`);
	if (typeof c.displayRaw !== "string") errors.push(`${path}.displayRaw required`);
}
function validateHarmony(h, path, errors) {
	if (typeof h.id !== "string" || !h.id) errors.push(`${path}.id required`);
	if (typeof h.barId !== "string" || !h.barId) errors.push(`${path}.barId required`);
	if (!isFiniteNumber(h.startSec)) errors.push(`${path}.startSec invalid`);
	if (!isFiniteNumber(h.endSec)) errors.push(`${path}.endSec invalid`);
	if (h.endSec <= h.startSec) errors.push(`${path}.endSec must be > startSec`);
	validateChordSymbol(h.chord, `${path}.chord`, errors);
}
function validateSongMap(map) {
	const errors = [];
	const warnings = [];
	if (map.formatVersion !== 1) errors.push(`formatVersion must be 1`);
	validateMetadata(map.metadata, "metadata", errors);
	const bars = map.timeline?.bars;
	const beats = map.timeline?.beats;
	if (!Array.isArray(bars)) errors.push("timeline.bars must be array");
	if (!Array.isArray(beats)) errors.push("timeline.beats must be array");
	if (Array.isArray(bars)) {
		bars.forEach((bar, i) => validateBar(bar, `timeline.bars[${i}]`, errors));
		for (let i = 1; i < bars.length; i++) if (bars[i].index <= bars[i - 1].index) warnings.push(`timeline.bars: bar index not strictly increasing at ${i}`);
		if (new Set(bars.map((b) => b.id)).size !== bars.length) errors.push("timeline.bars: duplicate bar id");
		for (let i = 1; i < bars.length; i++) {
			const prev = bars[i - 1];
			const cur = bars[i];
			if (prev.endSec > cur.startSec + 1e-9) warnings.push(`timeline.bars[${i}]: may overlap previous bar end (${prev.endSec}) vs current start (${cur.startSec})`);
		}
	}
	if (Array.isArray(beats)) {
		const beatIds = /* @__PURE__ */ new Set();
		beats.forEach((b, i) => {
			validateBeat(b, `timeline.beats[${i}]`, errors);
			if (beatIds.has(b.id)) errors.push(`timeline.beats[${i}]: duplicate beat id`);
			beatIds.add(b.id);
		});
		if (Array.isArray(bars)) {
			const barById = new Map(bars.map((b) => [b.id, b]));
			for (let i = 0; i < beats.length; i++) {
				const b = beats[i];
				const bar = barById.get(b.barId);
				if (!bar) {
					errors.push(`timeline.beats[${i}]: unknown barId ${b.barId}`);
					continue;
				}
				if (b.indexInBar >= bar.beatCount) errors.push(`timeline.beats[${i}]: indexInBar out of range for bar`);
				if (b.timeSec < bar.startSec || b.timeSec >= bar.endSec) errors.push(`timeline.beats[${i}]: timeSec must fall within bar [startSec,endSec)`);
			}
			for (const bar of bars) {
				if (beats.filter((b) => b.barId === bar.id).length !== bar.beatCount) errors.push(`bar ${bar.id}: beat count mismatch (beatIds vs beats list)`);
				for (const bid of bar.beatIds) {
					const beat = beats.find((b) => b.id === bid);
					if (!beat || beat.barId !== bar.id) errors.push(`bar ${bar.id}: beatId ${bid} missing or wrong bar`);
				}
			}
		}
	}
	if (map.timeline?.original !== void 0) {
		const orig = map.timeline.original;
		if (!orig || !Array.isArray(orig.bars) || !Array.isArray(orig.beats)) errors.push("timeline.original must have bars[] and beats[]");
		else {
			orig.bars.forEach((bar, i) => validateBar(bar, `timeline.original.bars[${i}]`, errors));
			orig.beats.forEach((b, i) => validateBeat(b, `timeline.original.beats[${i}]`, errors));
		}
	}
	if (!map.cues || typeof map.cues.mode !== "string") errors.push("cues invalid");
	else {
		if (!Number.isInteger(map.cues.countInBeats) || map.cues.countInBeats < 0) errors.push("cues.countInBeats invalid");
		if (typeof map.cues.useSectionLabels !== "boolean") errors.push("cues.useSectionLabels invalid");
		if (map.cues.prependSec !== void 0 && (!Number.isFinite(map.cues.prependSec) || map.cues.prependSec < 0)) errors.push("cues.prependSec invalid");
		if (map.cues.spokenIntroText !== void 0 && typeof map.cues.spokenIntroText !== "string") errors.push("cues.spokenIntroText invalid");
	}
	if (map.countInBeats !== void 0) {
		if (!Number.isInteger(map.countInBeats) || map.countInBeats < 0) errors.push("countInBeats must be a non-negative integer");
	}
	if (map.startBeatId !== void 0) {
		if (typeof map.startBeatId !== "string" || map.startBeatId.length === 0) errors.push("startBeatId must be a non-empty string");
		else if (Array.isArray(beats) && !beats.some((b) => b.id === map.startBeatId)) warnings.push(`startBeatId references missing beat "${map.startBeatId}"`);
	}
	const validateRenderedExport = (c, label) => {
		if (!c || typeof c !== "object") {
			errors.push(`${label} invalid`);
			return;
		}
		const r = c;
		if (typeof r.fingerprint !== "string" || !r.fingerprint) errors.push(`${label}.fingerprint invalid`);
		if (!Number.isFinite(r.durationSec) || r.durationSec <= 0) errors.push(`${label}.durationSec invalid`);
		if (!Number.isFinite(r.sampleRate) || r.sampleRate <= 0) errors.push(`${label}.sampleRate invalid`);
		if (typeof r.generatedAt !== "string" || !r.generatedAt) errors.push(`${label}.generatedAt invalid`);
		if (!Number.isFinite(r.preludeOffsetSec) || r.preludeOffsetSec < 0) errors.push(`${label}.preludeOffsetSec invalid`);
		if (r.relativePath !== void 0 && typeof r.relativePath !== "string") errors.push(`${label}.relativePath invalid`);
	};
	if (map.cueTrackExport !== void 0) validateRenderedExport(map.cueTrackExport, "cueTrackExport");
	if (map.clickTrackExport !== void 0) validateRenderedExport(map.clickTrackExport, "clickTrackExport");
	if (!Array.isArray(map.sections)) errors.push("sections must be array");
	else map.sections.forEach((s, i) => validateSection(s, `sections[${i}]`, errors));
	if (!Array.isArray(map.harmony)) errors.push("harmony must be array");
	else {
		map.harmony.forEach((h, i) => validateHarmony(h, `harmony[${i}]`, errors));
		if (Array.isArray(beats) && Array.isArray(bars)) {
			const beatById = new Map(beats.map((b) => [b.id, b]));
			const seenBeat = /* @__PURE__ */ new Set();
			const SPAN_EPS = .09;
			for (let i = 0; i < map.harmony.length; i++) {
				const h = map.harmony[i];
				if (h.beatId) {
					if (seenBeat.has(h.beatId)) errors.push(`harmony[${i}]: duplicate beatId ${h.beatId}`);
					seenBeat.add(h.beatId);
					const beat = beatById.get(h.beatId);
					if (!beat) errors.push(`harmony[${i}]: unknown beatId`);
					else {
						if (beat.barId !== h.barId) errors.push(`harmony[${i}]: barId does not match beat's bar`);
						if (h.beatAnchor != null && h.beatAnchor.indexInBar !== beat.indexInBar) warnings.push(`harmony[${i}]: beatAnchor.indexInBar does not match beat`);
						if (Math.abs(h.startSec - beat.timeSec) > SPAN_EPS) warnings.push(`harmony[${i}]: startSec differs from beat.timeSec`);
					}
				}
			}
		}
	}
	if (Array.isArray(map.sections) && Array.isArray(bars)) {
		const maxBarIndex = bars.length ? Math.max(...bars.map((b) => b.index)) : -1;
		map.sections.forEach((s, i) => {
			if (s.barRange.endBarIndex > maxBarIndex) warnings.push(`sections[${i}]: barRange extends past last bar index (${maxBarIndex})`);
		});
	}
	if (map.projectFolder !== void 0 && typeof map.projectFolder !== "string") errors.push("projectFolder must be a string");
	if (map.stemRefs !== void 0) {
		if (typeof map.stemRefs !== "object" || Array.isArray(map.stemRefs)) errors.push("stemRefs must be an object");
		else for (const [k, v] of Object.entries(map.stemRefs)) if (typeof v !== "string") errors.push(`stemRefs.${k} must be a string`);
	}
	if (map.mixState !== void 0) if (!map.mixState || typeof map.mixState !== "object") errors.push("mixState invalid");
	else if (!Array.isArray(map.mixState.tracks)) errors.push("mixState.tracks must be an array");
	else for (let i = 0; i < map.mixState.tracks.length; i++) {
		const t = map.mixState.tracks[i];
		if (!t || typeof t !== "object") errors.push(`mixState.tracks[${i}] invalid`);
		else {
			if (typeof t.key !== "string" || !t.key) errors.push(`mixState.tracks[${i}].key invalid`);
			if (!Number.isFinite(t.volume) || t.volume < 0) errors.push(`mixState.tracks[${i}].volume invalid`);
		}
	}
	return {
		ok: errors.length === 0,
		errors,
		warnings
	};
}
//#endregion
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
		sampleRate: optNum(o.sampleRate),
		channels: optNum(o.channels),
		fileSize: optNum(o.fileSize),
		trim: {
			startSec: reqNum(trim.startSec, `${path}.trim.startSec`),
			endSec: reqNum(trim.endSec, `${path}.trim.endSec`)
		},
		sha256: optString(o.sha256),
		originalSha256: optString(o.originalSha256),
		originalPath: optString(o.originalPath),
		source: reqString(o.source, `${path}.source`)
	};
}
function parseExpectedAudio(raw, path) {
	if (raw === void 0 || raw === null) return void 0;
	const o = expectObject(raw, path);
	return {
		fileName: reqString(o.fileName, `${path}.fileName`),
		mimeType: optString(o.mimeType),
		durationSec: optNum(o.durationSec),
		sampleRate: optNum(o.sampleRate),
		channels: optNum(o.channels),
		fileSize: optNum(o.fileSize),
		sha256: optString(o.sha256),
		originalSha256: optString(o.originalSha256)
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
	if (typeof o.preludeOffsetSec !== "number") return void 0;
	const fingerprint = reqString(o.fingerprint, `${path}.fingerprint`);
	const durationSec = reqNum(o.durationSec, `${path}.durationSec`);
	const sampleRate = reqNum(o.sampleRate, `${path}.sampleRate`);
	const generatedAt = reqString(o.generatedAt, `${path}.generatedAt`);
	const preludeOffsetSec = reqNum(o.preludeOffsetSec, `${path}.preludeOffsetSec`);
	const relativePath = optString(o.relativePath);
	if (!(durationSec > 0)) throw new SongMapParseError(`${path}.durationSec must be > 0`, `${path}.durationSec`);
	if (!(sampleRate > 0)) throw new SongMapParseError(`${path}.sampleRate must be > 0`, `${path}.sampleRate`);
	if (!(preludeOffsetSec >= 0)) throw new SongMapParseError(`${path}.preludeOffsetSec must be ≥ 0`, `${path}.preludeOffsetSec`);
	return {
		fingerprint,
		durationSec,
		sampleRate,
		generatedAt,
		preludeOffsetSec,
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
		countInBeats: optNum(raw.countInBeats),
		startBeatId: optString(raw.startBeatId),
		projectFolder: typeof raw.projectFolder === "string" ? raw.projectFolder : void 0,
		stemRefs: parseStemRefs(raw.stemRefs),
		cueTrackExport: raw.cueTrackExport !== void 0 && raw.cueTrackExport !== null ? parseCueTrackExport(raw.cueTrackExport, "cueTrackExport") : void 0,
		clickTrackExport: raw.clickTrackExport !== void 0 && raw.clickTrackExport !== null ? parseCueTrackExport(raw.clickTrackExport, "clickTrackExport") : void 0,
		mixState: parseMixState(raw.mixState, "mixState"),
		expectedAudio: parseExpectedAudio(raw.expectedAudio, "expectedAudio")
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
	"countInBeats",
	"startBeatId",
	"projectFolder",
	"stemRefs",
	"cueTrackExport",
	"clickTrackExport",
	"mixState"
]);
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
	return /* @__PURE__ */ new Error(`Invalid .smap: unsupported container version ${found} (only version 2 is supported).`);
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
* Encode one `.smap` file: 16-byte header + UTF-8 JSON chunk.
*
* v2 is JSON-only. Audio is never embedded — it lives on disk via the
* sidecar at `<song>/audio/<filename>` and is referenced by
* `songMap.audio.originalPath`. The `audioBlob` field on `SmapFileData`
* exists only so legacy v1 decode results can travel through the same
* type; the encoder ignores it.
*/
async function encodeSmapFile(data) {
	if (data.project.projectFormatVersion !== 1) throw new Error(`Unsupported SongProject format version: ${data.project.projectFormatVersion}`);
	const jsonBytes = serializeProjectToUtf8(data.project);
	const jsonLen = BigInt(jsonBytes.byteLength);
	const header = /* @__PURE__ */ new ArrayBuffer(16);
	const view = new DataView(header);
	new Uint8Array(header, 0, 4).set(MAGIC);
	view.setUint32(4, 2, true);
	view.setBigUint64(8, jsonLen, true);
	const total = 16 + jsonBytes.byteLength;
	const out = new Uint8Array(total);
	out.set(new Uint8Array(header), 0);
	out.set(jsonBytes, 16);
	return new Blob([out], { type: SMAP_BLOB_TYPE });
}
/**
* Decode a `.smap` from a `Blob` or `File`.
*/
async function decodeSmapFile(fileOrBlob) {
	return decodeSmapBytes(new Uint8Array(await fileOrBlob.arrayBuffer()));
}
function decodeSmapBytes(buf) {
	if (buf.byteLength < 8) throw readTruncatedFileError(8, buf.byteLength);
	validateMagic(buf);
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const version = view.getUint32(4, true);
	if (version === 2) return decodeSmapV2(buf, view);
	if (version === 1) return decodeSmapV1(buf, view);
	throw readUnsupportedVersionError(version);
}
/**
* v2 decode: 16-byte header + JSON chunk. No audio.
*/
function decodeSmapV2(buf, view) {
	if (buf.byteLength < 16) throw readTruncatedFileError(16, buf.byteLength);
	const expectedTotal = 16 + bigintToSafeNumber(view.getBigUint64(8, true), "jsonLength");
	if (buf.byteLength < expectedTotal) throw readFileShorterThanDeclaredError(expectedTotal, buf.byteLength);
	if (buf.byteLength > expectedTotal) throw readTrailingGarbageError(buf.byteLength - expectedTotal);
	return { project: parseProjectJson(buf.subarray(16, expectedTotal)) };
}
/**
* v1 decode (legacy): 28-byte header + JSON chunk + optional audio chunk.
*
* Kept so users can still open `.smap` files saved before the v2 cutover.
* Re-saving any decoded v1 file produces v2 and drops the audio bytes —
* users will need to re-link the audio file via the sidecar (or the
* audio chunk will surface in-session for one editing session).
*/
function decodeSmapV1(buf, view) {
	if (buf.byteLength < 28) throw readTruncatedFileError(28, buf.byteLength);
	const flags = view.getUint32(8, true);
	const jsonLen = bigintToSafeNumber(view.getBigUint64(12, true), "jsonLength");
	const audioLen = bigintToSafeNumber(view.getBigUint64(20, true), "audioLength");
	const hasAudioFlag = (flags & 1) !== 0;
	if (hasAudioFlag && audioLen === 0) throw readHasAudioButZeroLengthError();
	if (!hasAudioFlag && audioLen > 0) throw readFlagAudioMismatchError();
	const expectedTotal = 28 + jsonLen + audioLen;
	if (buf.byteLength < expectedTotal) throw readFileShorterThanDeclaredError(expectedTotal, buf.byteLength);
	if (buf.byteLength > expectedTotal) throw readTrailingGarbageError(buf.byteLength - expectedTotal);
	const jsonStart = 28;
	const jsonEnd = jsonStart + jsonLen;
	const project = parseProjectJson(buf.subarray(jsonStart, jsonEnd));
	if (!hasAudioFlag) return { project };
	const audioEnd = jsonEnd + audioLen;
	const rawAudio = buf.subarray(jsonEnd, audioEnd);
	const mime = project.songMap.audio?.mimeType ?? "application/octet-stream";
	return {
		project,
		audioBlob: new Blob([new Uint8Array(rawAudio)], { type: mime })
	};
}
/**
* Decode the UTF-8 JSON chunk into a `SongProject`. Shared by v1 + v2.
*/
function parseProjectJson(jsonBytes) {
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
	return {
		projectFormatVersion: 1,
		songMap
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
	const probeLen = Math.min(totalSize, 28);
	if (probeLen < 8) throw readTruncatedFileError(8, totalSize);
	const headerBuf = new Uint8Array(await fileOrBlob.slice(0, probeLen).arrayBuffer());
	validateMagic(headerBuf);
	const headerView = new DataView(headerBuf.buffer, headerBuf.byteOffset, headerBuf.byteLength);
	const version = headerView.getUint32(4, true);
	let headerLen;
	let jsonLen;
	let audioLen = 0;
	if (version === 2) {
		if (probeLen < 16) throw readTruncatedFileError(16, totalSize);
		headerLen = 16;
		jsonLen = bigintToSafeNumber(headerView.getBigUint64(8, true), "jsonLength");
	} else if (version === 1) {
		if (probeLen < 28) throw readTruncatedFileError(28, totalSize);
		headerLen = 28;
		const flags = headerView.getUint32(8, true);
		jsonLen = bigintToSafeNumber(headerView.getBigUint64(12, true), "jsonLength");
		audioLen = bigintToSafeNumber(headerView.getBigUint64(20, true), "audioLength");
		const hasAudioFlag = (flags & 1) !== 0;
		if (hasAudioFlag && audioLen === 0) throw readHasAudioButZeroLengthError();
		if (!hasAudioFlag && audioLen > 0) throw readFlagAudioMismatchError();
	} else throw readUnsupportedVersionError(version);
	if (jsonLen > MAX_REASONABLE_JSON_LENGTH) throw new Error(`Invalid .smap: jsonLength ${jsonLen} exceeds reasonable bound`);
	const expectedTotal = headerLen + jsonLen + audioLen;
	if (totalSize !== expectedTotal) {
		if (totalSize < expectedTotal) throw readFileShorterThanDeclaredError(expectedTotal, totalSize);
		throw readTrailingGarbageError(totalSize - expectedTotal);
	}
	const jsonStart = headerLen;
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
export { readSmapJsonOnly as a, validateSongMap as c, encodeSmapFile as i, defaultCueSettings as l, decodeSmapBytes as n, smapFileDataToRestorableState as o, decodeSmapFile as r, songProjectFromRestorableState as s, SMAP_BLOB_TYPE as t, emptySongMetadata as u };
