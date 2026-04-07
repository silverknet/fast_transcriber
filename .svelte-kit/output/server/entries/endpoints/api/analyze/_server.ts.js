import { n as private_env } from "../../../../chunks/shared-server.js";
import { a as validateSongMap, i as mergeAnalysisIntoSongMap, n as evenBeatTimes, o as createSongMapFromAudioSession, r as sortBeatsByTime } from "../../../../chunks/timelineEdit.js";
import { json } from "@sveltejs/kit";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
//#region src/lib/server/analysis/analysisPaths.ts
/**
* Path to `analyze_downbeats.py` (repo layout: src/lib/server/analysis/python/).
*/
function getAnalyzeDownbeatsScriptPath() {
	const fromEnv = process.env.BARBRO_ANALYZE_SCRIPT?.trim();
	if (fromEnv && existsSync(fromEnv)) return fromEnv;
	const cwd = join(process.cwd(), "src/lib/server/analysis/python/analyze_downbeats.py");
	if (existsSync(cwd)) return cwd;
	const here = fileURLToPath(new URL("./python/analyze_downbeats.py", import.meta.url));
	if (existsSync(here)) return here;
	return cwd;
}
//#endregion
//#region src/lib/server/analysis/beatsToSongMap.ts
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
			updatedAt: now
		}
	};
	const v = validateSongMap(map);
	if (!v.ok) throw new Error(`Invalid SongMap: ${v.errors.join("; ")}`);
	return map;
}
//#endregion
//#region src/lib/server/analysis/wavDuration.ts
/**
* Minimal WAV duration from buffer (PCM). Trimming on the client produces WAV.
*/
function readWavDurationSec(buffer) {
	if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") throw new Error("Not a RIFF/WAV buffer");
	let offset = 12;
	let sampleRate = 44100;
	let numChannels = 2;
	let bitsPerSample = 16;
	let dataSize = 0;
	let foundData = false;
	while (offset + 8 <= buffer.length) {
		const id = buffer.toString("ascii", offset, offset + 4);
		const size = buffer.readUInt32LE(offset + 4);
		const chunkStart = offset + 8;
		if (id === "fmt " && size >= 16) {
			numChannels = buffer.readUInt16LE(chunkStart + 2);
			sampleRate = buffer.readUInt32LE(chunkStart + 4);
			bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
		} else if (id === "data") {
			dataSize = size;
			foundData = true;
			break;
		}
		offset = chunkStart + size + size % 2;
	}
	if (!foundData || sampleRate <= 0 || numChannels <= 0 || bitsPerSample <= 0) throw new Error("Could not parse WAV data chunk");
	const bytesPerFrame = numChannels * (bitsPerSample / 8);
	return dataSize / bytesPerFrame / sampleRate;
}
//#endregion
//#region src/routes/api/analyze/+server.ts
/** WAV uploads can be large vs MP3; keep below typical reverse-proxy limits (~100MB). */
var MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
var ALLOWED_TYPES = new Set([
	"audio/mpeg",
	"audio/wav",
	"audio/x-wav",
	"audio/wave"
]);
var ANALYZE_TIMEOUT_MS = 12e4;
/**
* SvelteKit loads `.env` into `$env/dynamic/private`, not `process.env`. Check both.
*/
function pythonExecutableRaw() {
	return private_env.PYTHON ?? private_env.BARBRO_PYTHON ?? process.env.PYTHON ?? process.env.BARBRO_PYTHON ?? "python3";
}
function toAbsoluteInterpreterPath(raw) {
	if (raw === "python3" || raw === "python") return raw;
	if (raw.startsWith("/")) return raw;
	if (/^[A-Za-z]:[\\/]/.test(raw)) return raw;
	return resolve(process.cwd(), raw);
}
/**
* Some venvs only ship `.venv/bin/python3`, not `.venv/bin/python`. ENOENT otherwise.
*/
function resolvePythonExecutable() {
	const raw = pythonExecutableRaw();
	const candidate = toAbsoluteInterpreterPath(raw);
	if (existsSync(candidate)) return candidate;
	if (raw.endsWith("/python") || raw.endsWith("\\python")) {
		const altPath = toAbsoluteInterpreterPath(raw.slice(0, -6) + "python3");
		if (existsSync(altPath)) return altPath;
	}
	return candidate;
}
var MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
/** Map Python stderr / spawn errors to a short, actionable client message. */
function userFacingAnalyzeError(err) {
	const msg = err instanceof Error ? err.message : String(err);
	if (/timed out/i.test(msg)) return "Analysis timed out. Try a shorter clip or increase server resources.";
	if (/ENOENT|spawn .* ENOENT/i.test(msg) || /not found/i.test(msg)) return `Python not found (${pythonExecutableRaw()}). Set PYTHON=.venv/bin/python3 in .env (repo root) and restart dev, or run: bash src/lib/server/analysis/python/install-deps.sh`;
	if (/No module named ['"]?madmom['"]?/i.test(msg) || /madmom import failed/i.test(msg)) return "madmom is not installed for the Python used by the server. Run: bash src/lib/server/analysis/python/install-deps.sh — then set PYTHON=.venv/bin/python3 in .env (repo root) and restart npm run dev.";
	return "Beat detection failed. See the terminal for details.";
}
function runPythonScript(scriptPath, wavPath) {
	return new Promise((resolve, reject) => {
		const cmd = resolvePythonExecutable();
		console.info("[analyze] spawn", cmd);
		const child = spawn(cmd, [scriptPath, wavPath], { stdio: [
			"ignore",
			"pipe",
			"pipe"
		] });
		let stdout = "";
		let stderr = "";
		let settled = false;
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			if (!settled) {
				settled = true;
				reject(/* @__PURE__ */ new Error(`Python timed out after ${ANALYZE_TIMEOUT_MS}ms`));
			}
		}, ANALYZE_TIMEOUT_MS);
		child.stdout?.on("data", (d) => {
			stdout += d.toString("utf8");
		});
		child.stderr?.on("data", (d) => {
			stderr += d.toString("utf8");
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			if (!settled) {
				settled = true;
				reject(err);
			}
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (settled) return;
			settled = true;
			if (code === 0) resolve({
				stdout,
				stderr
			});
			else reject(new Error(stderr || `Python exited with code ${code}`));
		});
	});
}
async function POST({ request }) {
	const file = (await request.formData()).get("file");
	if (!(file instanceof File)) return json({
		ok: false,
		error: "Missing file field"
	}, { status: 400 });
	if (!ALLOWED_TYPES.has(file.type)) return json({
		ok: false,
		error: `Unsupported file type: ${file.type}`
	}, { status: 415 });
	if (file.size > MAX_UPLOAD_BYTES) return json({
		ok: false,
		error: `File too large (max ${MAX_UPLOAD_MB} MB after trim). Shorten the selection or raise the limit in /api/analyze.`
	}, { status: 413 });
	const req = {
		filename: file.name,
		mimeType: file.type,
		sizeBytes: file.size
	};
	const scriptPath = getAnalyzeDownbeatsScriptPath();
	if (!existsSync(scriptPath)) {
		console.error("[analyze] Script not found:", scriptPath);
		return json({
			ok: false,
			error: "Analysis script is not available on the server."
		}, { status: 500 });
	}
	let workDir;
	try {
		const buf = Buffer.from(await file.arrayBuffer());
		workDir = await mkdtemp(join(tmpdir(), "barbro-analyze-"));
		const wavPath = join(workDir, "clip.wav");
		await writeFile(wavPath, buf);
		let stdout;
		let stderr;
		try {
			({stdout, stderr} = await runPythonScript(scriptPath, wavPath));
		} catch (e) {
			console.error("[analyze] Python failed:", e);
			return json({
				ok: false,
				error: userFacingAnalyzeError(e)
			}, { status: 503 });
		}
		if (stderr) console.warn("[analyze] Python stderr:", stderr.slice(0, 2e3));
		let parsed;
		try {
			parsed = JSON.parse(stdout.trim());
		} catch {
			console.error("[analyze] Invalid JSON from Python:", stdout.slice(0, 500));
			return json({
				ok: false,
				error: "Invalid output from analysis"
			}, { status: 500 });
		}
		const beatsRaw = parsed;
		if (!Array.isArray(beatsRaw.beats)) return json({
			ok: false,
			error: "Analysis returned no beats array"
		}, { status: 500 });
		const rows = beatsRaw.beats.map((b) => {
			const o = b;
			return {
				time: Number(o.time),
				beatInBar: Number(o.beatInBar)
			};
		});
		let durationSec;
		try {
			durationSec = readWavDurationSec(buf);
		} catch {
			durationSec = (rows.length ? Math.max(...rows.map((r) => r.time)) : 0) + .5;
		}
		let songMap;
		try {
			songMap = beatsToSongMap({
				filename: file.name,
				durationSec,
				mimeType: file.type,
				beats: rows
			});
		} catch (e) {
			console.error("[analyze] beatsToSongMap:", e);
			return json({
				ok: false,
				error: e instanceof Error ? e.message : "Could not build SongMap"
			}, { status: 500 });
		}
		return json({
			ok: true,
			status: "complete",
			message: "Analysis complete",
			request: req,
			songMap
		});
	} finally {
		if (workDir) try {
			await rm(workDir, {
				recursive: true,
				force: true
			});
		} catch {}
	}
}
//#endregion
export { POST };
