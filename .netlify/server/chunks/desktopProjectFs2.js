import { t as BARBRO_DESKTOP_BEACON_PORT } from "./desktopBeacon.js";
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
*
* `withSha` opts into per-file SHA-256. Costs ~50ms per WAV at typical
* sizes — fine for one-shot work like the Phase 3 identity backfill
* sweep, but skip it for hot paths like `refreshProjectInfo`.
*/
async function getProjectWavInfoBatch(projectPath, files, options = {}) {
	return await postJson(`${BASE_URL}/native/project/wav-info/batch`, {
		projectPath,
		files,
		...options.withSha ? { withSha: true } : {}
	});
}
/**
* Walk `<projectPath>/<songFolder>/audio/` and return an identity bundle
* (sha256 + duration + sample rate + channels + file size) for each
* audio file. Used by the Phase 5 reconciler to find files matching
* `expectedAudio` even when the path recorded in the SongMap has
* drifted (file renamed, dropped from a hydration pack, etc.).
*
* The sidecar caches hashes by `(path, mtime, size)` in memory, so
* repeated calls on the same files are cheap.
*/
async function scanProjectSongAudio(projectPath, songFolder) {
	return await postJson(`${BASE_URL}/native/project/song/audio/scan`, {
		projectPath,
		songFolder
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
* Open the OS file picker, copy the chosen audio file into
* `<song>/audio/<filename>`, and return the relative path + SHA-256 in one
* round-trip. Callers compare the returned `sha256` against the SongMap's
* `audio.originalSha256` to detect a content mismatch.
*/
async function relinkProjectSongAudio(projectPath, songFolder, defaultName) {
	return await postJson(`${BASE_URL}/native/project/song/audio/relink`, {
		projectPath,
		songFolder,
		defaultName: defaultName ?? null
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
export { readProjectSong as a, removeProjectSong as c, writeProjectAsset as d, writeProjectManifest as f, getProjectWavInfoBatch as i, scanProjectSongAudio as l, writeProjectSongAsset as m, createProjectSong as n, readProjectSongAsset as o, writeProjectSong as p, getProjectInfo as r, relinkProjectSongAudio as s, createProject as t, transcodeProjectAudioToWav as u };
