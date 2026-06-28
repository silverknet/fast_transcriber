function parse(v) {
	const parts = v.split(".").map((p) => {
		const n = parseInt(p, 10);
		return Number.isFinite(n) ? n : 0;
	});
	return [
		parts[0] ?? 0,
		parts[1] ?? 0,
		parts[2] ?? 0
	];
}
/** Negative if a < b, zero if equal, positive if a > b. */
function compareSidecarVersion(a, b) {
	const [a1, a2, a3] = parse(a);
	const [b1, b2, b3] = parse(b);
	if (a1 !== b1) return a1 - b1;
	if (a2 !== b2) return a2 - b2;
	return a3 - b3;
}
/**
* `null` reported version → `'unknown'` (the sidecar didn't tell us
* what it is; don't force-redirect on guesswork — the broader
* `reachable` check already covers "no sidecar at all"). A parseable
* version below `MIN_SIDECAR_VERSION` → `'outdated'`; otherwise `'ok'`.
*
* Dev mode bypass: when running `npm run dev`, the local sidecar's
* `desktop/package.json#version` lags the deployed `MIN_SIDECAR_VERSION`
* routinely (we bump the web constant ahead of cutting the desktop
* release). Force-redirecting to `/download` mid-development is just
* noise — the dev sidecar is the right one to talk to. Production
* gating is untouched.
*/
function classifySidecarVersion(reported) {
	if (!reported) return "unknown";
	return compareSidecarVersion(reported, "0.1.6") >= 0 ? "ok" : "outdated";
}
//#endregion
export { classifySidecarVersion as t };
