//#region src/lib/client/desktopBeacon.ts
/**
* Probe the BarBro Electron companion on loopback.
* Port must match `desktop/electron/main.mjs` (BARBRO_DESKTOP_BEACON_PORT).
*/
var BARBRO_DESKTOP_BEACON_PORT = 47842;
var BARBRO_DESKTOP_PING_URL = `http://127.0.0.1:${BARBRO_DESKTOP_BEACON_PORT}/ping`;
var PROBE_MS = 2e3;
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
export { probeDesktopCompanion as n, BARBRO_DESKTOP_BEACON_PORT as t };
