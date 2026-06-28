//#region src/lib/client/desktopBeacon.ts
/**
* Probe the BarBro Electron companion on loopback.
* Port must match `desktop/electron/main.mjs` (BARBRO_DESKTOP_BEACON_PORT).
*/
var BARBRO_DESKTOP_BEACON_PORT = 47842;
var BARBRO_DESKTOP_PING_URL = `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}/ping`;
var PROBE_MS = 2e3;
/**
* Probe the sidecar's Python deps. Returns `null` when the sidecar is
* unreachable or the response is unparseable. Callers should also check
* `probeDesktopCompanion()` first — there's no point asking about deps
* if the sidecar isn't running.
*
* The sidecar caches health internally for 60 s, so polling this every
* few seconds doesn't actually spawn Python interpreters each time.
*/
async function probeDesktopPythonHealth() {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 6e3);
	try {
		const res = await fetch(`http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}/native/health`, {
			method: "GET",
			signal: ctrl.signal,
			cache: "no-store"
		});
		clearTimeout(t);
		if (!res.ok) return null;
		const data = await res.json();
		if (typeof data?.ok !== "boolean" || !Array.isArray(data.checks)) return null;
		return {
			ok: data.ok,
			installing: data.installing === true,
			checks: data.checks
		};
	} catch {
		clearTimeout(t);
		return null;
	}
}
/**
* Fetch the auto-setup orchestrator's state. Returns `null` when the
* sidecar is unreachable. Useful while `pythonHealth === 'installing'`
* to render per-stage progress bars on the download page.
*/
async function probeDesktopSetupStatus() {
	try {
		const res = await fetch(`http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}/native/setup/status`, {
			method: "GET",
			cache: "no-store"
		});
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}
async function probeDesktopCompanion() {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), PROBE_MS);
	try {
		const res = await fetch(BARBRO_DESKTOP_PING_URL, {
			method: "GET",
			signal: ctrl.signal,
			cache: "no-store"
		});
		clearTimeout(t);
		if (!res.ok) return {
			ok: false,
			version: null,
			error: `HTTP ${res.status}`
		};
		const data = await res.json();
		if (data?.ok === true && data?.name === "barbro-desktop") return {
			ok: true,
			version: typeof data.version === "string" ? data.version : null,
			error: null
		};
		return {
			ok: false,
			version: null,
			error: "Unexpected ping response"
		};
	} catch (e) {
		clearTimeout(t);
		const msg = e instanceof Error ? e.message : String(e);
		if (msg === "The user aborted a request." || /abort/i.test(msg)) return {
			ok: false,
			version: null,
			error: null
		};
		return {
			ok: false,
			version: null,
			error: msg
		};
	}
}
//#endregion
export { probeDesktopSetupStatus as i, probeDesktopCompanion as n, probeDesktopPythonHealth as r, BARBRO_DESKTOP_BEACON_PORT as t };
