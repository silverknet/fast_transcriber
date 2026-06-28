import { t as BARBRO_DESKTOP_BEACON_PORT } from "./desktopBeacon.js";
//#region src/lib/client/desktopBridge.ts
/**
* Web ⇄ desktop bridge over the same loopback the `/ping` beacon uses.
*
* The desktop client is **headless**: all UI stays in this web app. Native
* jobs (beats analysis, stems, Piper TTS, OS pickers) are reachable only when the
* Electron sidecar is running and `desktopCompanionStatus.reachable` is true.
*
* Keep the URL base in sync with `desktop/electron/main.mjs` —
* `BARBRO_DESKTOP_BEACON_PORT` is the single source of truth for the port.
*/
var BASE_URL = `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}`;
var ANALYZE_DOWNBEATS_URL = `${BASE_URL}/native/analyze-downbeats`;
var SUGGEST_SECTION_BORDERS_URL = `${BASE_URL}/native/suggest-section-borders`;
`${BASE_URL}`;
var SEPARATE_STEMS_URL = `${BASE_URL}/native/separate-stems`;
var PIPER_TTS_SETUP_STATUS_URL = `${BASE_URL}/native/setup/piper-tts/status`;
var PIPER_TTS_SETUP_URL = `${BASE_URL}/native/setup/piper-tts`;
var TTS_HELLO_WORLD_URL = `${BASE_URL}/native/tts/hello-world`;
var TTS_SYNTHESIZE_URL = `${BASE_URL}/native/tts/synthesize`;
/**
* Send WAV bytes to the desktop sidecar and receive raw beats rows back.
* Caller is responsible for running `beatsToSongMap()` against the result.
*
* Returns a typed Result rather than throwing so the analyze UI can fall
* back to `/api/analyze` cleanly on any failure (sidecar offline, Python
* missing, audio rejected, etc.).
*/
async function analyzeDownbeatsViaDesktop(wavBlob, signal) {
	let res;
	try {
		res = await fetch(ANALYZE_DOWNBEATS_URL, {
			method: "POST",
			headers: { "Content-Type": "audio/wav" },
			body: wavBlob,
			signal,
			cache: "no-store"
		});
	} catch (e) {
		return {
			ok: false,
			error: `Desktop sidecar unreachable: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	let data;
	try {
		data = await res.json();
	} catch {
		return {
			ok: false,
			error: `Desktop sidecar returned non-JSON (HTTP ${res.status})`
		};
	}
	const o = data;
	if (!res.ok || o.ok !== true) return {
		ok: false,
		error: o.error ?? `Desktop analyze failed (HTTP ${res.status})`
	};
	const beatsRaw = o.data?.beats;
	if (!Array.isArray(beatsRaw)) return {
		ok: false,
		error: "Desktop analyzer returned no beats array"
	};
	const beats = [];
	for (const b of beatsRaw) {
		const r = b;
		const time = Number(r.time);
		const beatInBar = Number(r.beatInBar);
		if (Number.isFinite(time) && Number.isFinite(beatInBar)) beats.push({
			time,
			beatInBar
		});
	}
	return {
		ok: true,
		beats
	};
}
/**
* Send WAV audio + bar timing to the sidecar and receive suggested section
* borders (bar indices where novelty in the audio implies a new section, with
* a confidence score in [0, 1]). Bars are passed in the `X-Bars-Json` header
* as URL-encoded JSON.
*
* Display-only signal — callers should render these as weak hints the user
* can accept; never commit them to the SongMap automatically.
*/
async function suggestSectionBordersViaDesktop(wavBlob, bars, signal) {
	const barsHeader = encodeURIComponent(JSON.stringify({ bars }));
	let res;
	try {
		res = await fetch(SUGGEST_SECTION_BORDERS_URL, {
			method: "POST",
			headers: {
				"Content-Type": "audio/wav",
				"X-Bars-Json": barsHeader
			},
			body: wavBlob,
			signal,
			cache: "no-store"
		});
	} catch (e) {
		return {
			ok: false,
			error: `Desktop sidecar unreachable: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	let data;
	try {
		data = await res.json();
	} catch {
		return {
			ok: false,
			error: `Desktop sidecar returned non-JSON (HTTP ${res.status})`
		};
	}
	const o = data;
	if (!res.ok || o.ok !== true) return {
		ok: false,
		error: o.error ?? `Border suggest failed (HTTP ${res.status})`
	};
	const raw = o.data?.borders;
	if (!Array.isArray(raw)) return {
		ok: true,
		borders: []
	};
	const borders = [];
	for (const item of raw) {
		const r = item;
		const bar = Number(r.bar);
		const confidence = Number(r.confidence);
		if (Number.isFinite(bar) && Number.isFinite(confidence)) borders.push({
			bar: Math.trunc(bar),
			confidence: Math.max(0, Math.min(1, confidence))
		});
	}
	return {
		ok: true,
		borders
	};
}
/**
* `htdemucs_ft` is a "bag of 4" — internally ensembles 4 fine-tuned
* checkpoints per shift. So `shifts: 10` produces 40 actual passes,
* `shifts: 5` produces 20, etc. The Python wrapper accounts for this
* when reporting overall progress so the bar tracks linearly to 100%.
*/
var STEM_QUALITY_PRESETS = [
	{
		slug: "best",
		label: "Best — htdemucs_ft, shifts 10 (slow)",
		model: "htdemucs_ft",
		shifts: 10,
		overlap: .5
	},
	{
		slug: "balanced",
		label: "Balanced — htdemucs_ft, shifts 5 (medium)",
		model: "htdemucs_ft",
		shifts: 5,
		overlap: .25
	},
	{
		slug: "preview",
		label: "Preview — htdemucs, shifts 1 (fast)",
		model: "htdemucs",
		shifts: 1,
		overlap: .25
	}
];
/**
* Priority order — first wins. The `legacy` slug refers to flat-layout
* stems left over from before this split (i.e. `<song>/stems/vocals.wav`
* with no preset subfolder). They're treated as the lowest-quality
* fallback so a re-render at any tier supersedes them automatically.
*/
var STEM_PRESET_PRIORITY = [
	"best",
	"balanced",
	"preview",
	"legacy"
];
/**
* Enqueue a stem-separation job on the desktop sidecar. **No audio bytes
* cross HTTP** — the sidecar reads from `inputPath` and writes flat stem
* files into `outputDir` directly. Returns the jobId immediately; the
* sidecar runs jobs serially in a queue.
*
* Subscribe to progress via `subscribeToJobEvents(jobId)`. On `state:done`
* the stems are already on disk — no fetch step needed.
*/
async function enqueueStemSeparation(opts) {
	let res;
	try {
		res = await fetch(SEPARATE_STEMS_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				inputPath: opts.inputPath,
				outputDir: opts.outputDir,
				model: opts.preset.model,
				shifts: opts.preset.shifts,
				overlap: opts.preset.overlap,
				stems: opts.stems.join(","),
				songId: opts.songId ?? void 0
			}),
			cache: "no-store"
		});
	} catch (e) {
		return {
			ok: false,
			error: `Desktop sidecar unreachable: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	let data;
	try {
		data = await res.json();
	} catch {
		return {
			ok: false,
			error: `Desktop sidecar returned non-JSON (HTTP ${res.status})`
		};
	}
	const o = data;
	if (!res.ok || o.ok !== true || !o.jobId) return {
		ok: false,
		error: o.error ?? `Enqueue failed (HTTP ${res.status})`
	};
	return {
		ok: true,
		jobId: o.jobId,
		queuePosition: o.queuePosition ?? 0
	};
}
/**
* Subscribe to the NDJSON progress stream for a job. The desktop sidecar
* replays the full event buffer first, then streams new events live; the
* connection closes when the job reaches a terminal state.
*
* Returns a `disconnect()` function the caller can invoke to abort early.
*/
function subscribeToJobEvents(jobId, onEvent, onError) {
	const ctrl = new AbortController();
	(async () => {
		let res;
		try {
			res = await fetch(`${BASE_URL}/native/jobs/${encodeURIComponent(jobId)}/events`, {
				signal: ctrl.signal,
				cache: "no-store"
			});
		} catch (e) {
			if (!ctrl.signal.aborted) onError?.(e instanceof Error ? e : new Error(String(e)));
			return;
		}
		if (!res.ok || !res.body) {
			onError?.(/* @__PURE__ */ new Error(`Job event subscribe failed (HTTP ${res.status})`));
			return;
		}
		const reader = res.body.getReader();
		const decoder = new TextDecoder("utf-8");
		let buffer = "";
		const handle = (line) => {
			const trimmed = line.trim();
			if (!trimmed) return;
			let ev;
			try {
				ev = JSON.parse(trimmed);
			} catch {
				ev = {
					type: "log",
					msg: trimmed
				};
			}
			onEvent(ev);
		};
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let idx = buffer.indexOf("\n");
				while (idx !== -1) {
					handle(buffer.slice(0, idx));
					buffer = buffer.slice(idx + 1);
					idx = buffer.indexOf("\n");
				}
			}
			if (buffer.trim()) handle(buffer);
		} catch (e) {
			if (!ctrl.signal.aborted) onError?.(e instanceof Error ? e : new Error(String(e)));
		}
	})();
	return () => ctrl.abort();
}
/**
* Ask the desktop sidecar to open a native folder picker and return the
* chosen absolute path. The path can then be sent in subsequent stems
* requests so the sidecar reads/writes the project filesystem directly,
* no audio bytes crossing HTTP.
*/
async function pickFolderViaDesktop(opts) {
	let res;
	try {
		res = await fetch(`${BASE_URL}/native/pick-folder`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(opts ?? {}),
			cache: "no-store"
		});
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		};
	}
	try {
		return await res.json();
	} catch {
		return {
			ok: false,
			error: `Picker returned non-JSON (HTTP ${res.status})`
		};
	}
}
async function pickFileViaDesktop(endpoint, opts) {
	let res;
	try {
		res = await fetch(`${BASE_URL}${endpoint}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(opts ?? {}),
			cache: "no-store"
		});
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		};
	}
	try {
		return await res.json();
	} catch {
		return {
			ok: false,
			error: `Picker returned non-JSON (HTTP ${res.status})`
		};
	}
}
var pickSaveFileViaDesktop = (opts) => pickFileViaDesktop("/native/pick-save-file", opts);
var pickOpenFileViaDesktop = (opts) => pickFileViaDesktop("/native/pick-open-file", opts);
async function exportHydrationPackViaDesktop(args) {
	let res;
	try {
		res = await fetch(`${BASE_URL}/native/project/hydration/export`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(args),
			cache: "no-store"
		});
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e)
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
async function importHydrationPackViaDesktop(args) {
	let res;
	try {
		res = await fetch(`${BASE_URL}/native/project/hydration/import`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(args),
			cache: "no-store"
		});
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e)
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
/** Snapshot of all known jobs on the sidecar. Useful on reload. */
async function listJobsViaDesktop() {
	let res;
	try {
		res = await fetch(`${BASE_URL}/native/jobs`, { cache: "no-store" });
	} catch {
		return [];
	}
	if (!res.ok) return [];
	try {
		const data = await res.json();
		return Array.isArray(data.jobs) ? data.jobs : [];
	} catch {
		return [];
	}
}
/**
* Cancel a queued or running job (or destroy a terminal one). The sidecar
* sends SIGTERM if the job is running. For a paused job the sidecar thaws
* it first (SIGCONT) so SIGTERM actually delivers.
*/
async function cancelJob(jobId) {
	try {
		await fetch(`${BASE_URL}/native/jobs/${encodeURIComponent(jobId)}`, {
			method: "DELETE",
			cache: "no-store"
		});
	} catch {}
}
async function postJobControl(jobId, action) {
	let res;
	try {
		res = await fetch(`${BASE_URL}/native/jobs/${encodeURIComponent(jobId)}/${action}`, {
			method: "POST",
			cache: "no-store"
		});
	} catch (e) {
		return {
			ok: false,
			error: `Desktop sidecar unreachable: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	let data;
	try {
		data = await res.json();
	} catch {
		return {
			ok: false,
			error: `Non-JSON response (HTTP ${res.status})`
		};
	}
	if (!res.ok || data.ok !== true || !data.state) return {
		ok: false,
		error: data.error ?? `${action} failed (HTTP ${res.status})`
	};
	return {
		ok: true,
		state: data.state
	};
}
/**
* Suspend a running Demucs job via SIGSTOP — CPU/GPU usage drops to zero,
* progress freezes. The job keeps its queue slot, so other queued jobs
* still wait their turn. Cancel + re-enqueue if you'd rather free the slot.
*
* Limitations:
*  - macOS/Linux only.
*  - Does not survive sidecar restart.
*/
async function pauseJob(jobId) {
	return postJobControl(jobId, "pause");
}
/** Resume a paused Demucs job via SIGCONT. Picks up exactly where it left off. */
async function resumeJob(jobId) {
	return postJobControl(jobId, "resume");
}
/**
* Create the stems venv on the sidecar and pip-install Demucs. Streams the
* same NDJSON shape the stems job uses — callers can drive a progress UI
* off `onEvent` and the result tells them whether the install succeeded.
*
* Re-running when the venv already exists is safe and quick (pip re-checks
* each package).
*/
async function setupStemsDeps(onEvent, signal) {
	let res;
	try {
		res = await fetch(`${BASE_URL}/native/setup/stems`, {
			method: "POST",
			cache: "no-store",
			signal
		});
	} catch (e) {
		return {
			ok: false,
			error: `Desktop sidecar unreachable: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	if (!res.ok || !res.body) return {
		ok: false,
		error: `Setup failed (HTTP ${res.status})`
	};
	const reader = res.body.getReader();
	const decoder = new TextDecoder("utf-8");
	let buffer = "";
	let venvPython = null;
	let errorMsg = null;
	const handle = (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;
		let ev;
		try {
			ev = JSON.parse(trimmed);
		} catch {
			ev = {
				type: "log",
				msg: trimmed
			};
		}
		if (ev.type === "done") venvPython = ev.venvPython;
		else if (ev.type === "error") errorMsg = ev.msg;
		onEvent(ev);
	};
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let idx = buffer.indexOf("\n");
			while (idx !== -1) {
				handle(buffer.slice(0, idx));
				buffer = buffer.slice(idx + 1);
				idx = buffer.indexOf("\n");
			}
		}
		if (buffer.trim()) handle(buffer);
	} catch (e) {
		return {
			ok: false,
			error: `Setup stream interrupted: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	if (errorMsg) return {
		ok: false,
		error: errorMsg
	};
	if (!venvPython) return {
		ok: false,
		error: "Setup did not report a venv path"
	};
	return {
		ok: true,
		venvPython
	};
}
async function getSectionsSetupStatus() {
	try {
		const res = await fetch(`${BASE_URL}/native/setup/sections/status`, { cache: "no-store" });
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}
/**
* Create the sections venv on the sidecar and pip-install librosa + scipy.
* Streams NDJSON events the caller can render as a progress UI.
*
* Footprint is small (~60 MB) vs. stems (~1 GB torch). Typically finishes
* in <30s on a fast network.
*/
async function setupSectionsDeps(onEvent, signal) {
	let res;
	try {
		res = await fetch(`${BASE_URL}/native/setup/sections`, {
			method: "POST",
			cache: "no-store",
			signal
		});
	} catch (e) {
		return {
			ok: false,
			error: `Desktop sidecar unreachable: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	if (!res.ok || !res.body) return {
		ok: false,
		error: `Setup failed (HTTP ${res.status})`
	};
	const reader = res.body.getReader();
	const decoder = new TextDecoder("utf-8");
	let buffer = "";
	let venvPython = null;
	let errorMsg = null;
	const handle = (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;
		let ev;
		try {
			ev = JSON.parse(trimmed);
		} catch {
			ev = {
				type: "log",
				msg: trimmed
			};
		}
		if (ev.type === "done") venvPython = ev.venvPython;
		else if (ev.type === "error") errorMsg = ev.msg;
		onEvent(ev);
	};
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let idx = buffer.indexOf("\n");
			while (idx !== -1) {
				handle(buffer.slice(0, idx));
				buffer = buffer.slice(idx + 1);
				idx = buffer.indexOf("\n");
			}
		}
		if (buffer.trim()) handle(buffer);
	} catch (e) {
		return {
			ok: false,
			error: `Setup stream interrupted: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	if (errorMsg) return {
		ok: false,
		error: errorMsg
	};
	if (!venvPython) return {
		ok: false,
		error: "Setup did not report a venv path"
	};
	return {
		ok: true,
		venvPython
	};
}
async function getPiperTtsSetupStatus() {
	try {
		const res = await fetch(PIPER_TTS_SETUP_STATUS_URL, { cache: "no-store" });
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}
/**
* Create Piper venv, install `piper-tts`, download default voice. Same NDJSON
* event shape as {@link setupStemsDeps}.
*/
async function setupPiperTtsDeps(onEvent, signal) {
	let res;
	try {
		res = await fetch(PIPER_TTS_SETUP_URL, {
			method: "POST",
			cache: "no-store",
			signal
		});
	} catch (e) {
		return {
			ok: false,
			error: `Desktop sidecar unreachable: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	if (!res.ok || !res.body) return {
		ok: false,
		error: `Piper setup failed (HTTP ${res.status})`
	};
	const reader = res.body.getReader();
	const decoder = new TextDecoder("utf-8");
	let buffer = "";
	let venvPython = null;
	let errorMsg = null;
	const handle = (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;
		let ev;
		try {
			ev = JSON.parse(trimmed);
		} catch {
			ev = {
				type: "log",
				msg: trimmed
			};
		}
		if (ev.type === "done") venvPython = ev.venvPython;
		else if (ev.type === "error") errorMsg = ev.msg;
		onEvent(ev);
	};
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let idx = buffer.indexOf("\n");
			while (idx !== -1) {
				handle(buffer.slice(0, idx));
				buffer = buffer.slice(idx + 1);
				idx = buffer.indexOf("\n");
			}
		}
		if (buffer.trim()) handle(buffer);
	} catch (e) {
		return {
			ok: false,
			error: `Piper setup stream interrupted: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	if (errorMsg) return {
		ok: false,
		error: errorMsg
	};
	if (!venvPython) return {
		ok: false,
		error: "Piper setup did not report a venv path"
	};
	return {
		ok: true,
		venvPython
	};
}
/** Piper WAV for arbitrary short text (cue-track speech). Desktop sidecar only. */
async function fetchDesktopTtsSynthesizeWav(text, signal) {
	const body = JSON.stringify({ text });
	try {
		const res = await fetch(TTS_SYNTHESIZE_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json; charset=utf-8" },
			body,
			cache: "no-store",
			signal
		});
		const ct = res.headers.get("content-type") ?? "";
		if (!res.ok) {
			if (ct.includes("application/json")) try {
				const j = await res.json();
				return {
					ok: false,
					error: [j.error, j.hint].filter(Boolean).join(" — ") || `HTTP ${res.status}`
				};
			} catch {
				return {
					ok: false,
					error: `HTTP ${res.status}`
				};
			}
			return {
				ok: false,
				error: await res.text() || `HTTP ${res.status}`
			};
		}
		if (!ct.includes("audio") && !ct.includes("octet-stream")) return {
			ok: false,
			error: `Unexpected content type: ${ct || "(none)"}`
		};
		return {
			ok: true,
			blob: await res.blob()
		};
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}
async function fetchDesktopTtsHelloWorldWav(signal) {
	try {
		const res = await fetch(TTS_HELLO_WORLD_URL, {
			cache: "no-store",
			signal
		});
		const ct = res.headers.get("content-type") ?? "";
		if (!res.ok) {
			if (ct.includes("application/json")) try {
				const j = await res.json();
				return {
					ok: false,
					error: [j.error, j.hint].filter(Boolean).join(" — ") || `HTTP ${res.status}`
				};
			} catch {
				return {
					ok: false,
					error: `HTTP ${res.status}`
				};
			}
			return {
				ok: false,
				error: await res.text() || `HTTP ${res.status}`
			};
		}
		if (!ct.includes("audio") && !ct.includes("octet-stream")) return {
			ok: false,
			error: `Unexpected content type: ${ct || "(none)"}`
		};
		return {
			ok: true,
			blob: await res.blob()
		};
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}
/** Best-effort: tell the desktop sidecar to clean up the temp dir for a job. */
async function releaseStemsJob(jobId) {
	try {
		await fetch(`${BASE_URL}/native/stems/${encodeURIComponent(jobId)}`, {
			method: "DELETE",
			cache: "no-store"
		});
	} catch {}
}
//#endregion
export { suggestSectionBordersViaDesktop as C, subscribeToJobEvents as S, releaseStemsJob as _, enqueueStemSeparation as a, setupSectionsDeps as b, fetchDesktopTtsSynthesizeWav as c, importHydrationPackViaDesktop as d, listJobsViaDesktop as f, pickSaveFileViaDesktop as g, pickOpenFileViaDesktop as h, cancelJob as i, getPiperTtsSetupStatus as l, pickFolderViaDesktop as m, STEM_QUALITY_PRESETS as n, exportHydrationPackViaDesktop as o, pauseJob as p, analyzeDownbeatsViaDesktop as r, fetchDesktopTtsHelloWorldWav as s, STEM_PRESET_PRIORITY as t, getSectionsSetupStatus as u, resumeJob as v, setupStemsDeps as x, setupPiperTtsDeps as y };
