//#region src/lib/desktop/downloadsManifest.ts
var DESKTOP_ARTIFACT_KEYS = [
	"darwin-arm64",
	"darwin-x64",
	"win-x64"
];
function isDesktopArtifactKey(s) {
	return DESKTOP_ARTIFACT_KEYS.includes(s);
}
function parseDesktopDownloadsManifest(raw) {
	if (!raw || typeof raw !== "object") return null;
	const o = raw;
	const version = typeof o.version === "string" ? o.version : "0.0.0";
	const rawArtifacts = o.artifacts;
	if (!rawArtifacts || typeof rawArtifacts !== "object") return null;
	const artifacts = {};
	for (const key of Object.keys(rawArtifacts)) {
		if (!isDesktopArtifactKey(key)) continue;
		const e = rawArtifacts[key];
		if (!e || typeof e !== "object") continue;
		const er = e;
		artifacts[key] = {
			label: typeof er.label === "string" ? er.label : key,
			url: typeof er.url === "string" ? er.url : ""
		};
	}
	return {
		version,
		artifacts
	};
}
//#endregion
export { parseDesktopDownloadsManifest as n, DESKTOP_ARTIFACT_KEYS as t };
