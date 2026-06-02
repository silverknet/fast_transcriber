//#region src/lib/server/db/fingerprintHttp.ts
/** SHA-256 hex from the client (anonymous device / browser signal bundle). */
var FINGERPRINT_HEX_RE = /^[0-9a-f]{64}$/i;
function parseFingerprintHeaderOrQuery(headerVal, queryVal) {
	const raw = headerVal?.trim() || queryVal?.trim() || "";
	if (!FINGERPRINT_HEX_RE.test(raw)) return null;
	return raw.toLowerCase();
}
//#endregion
export { parseFingerprintHeaderOrQuery as t };
