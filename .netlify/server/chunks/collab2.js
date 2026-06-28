//#region src/lib/songmap/collab.ts
/** Local-only top-level field names — never written to the cloud. */
var LOCAL_ONLY_TOP_LEVEL = [
	"projectFolder",
	"stemRefs",
	"sectionBorderHints",
	"chordHints",
	"mixState"
];
/**
* Strip a CueTrackExport / ClickTrackExport down to the collaborative
* subset: the rendered file's `relativePath` is local-only (different
* device = different disk), but the rest (fingerprint, duration,
* sampleRate, preludeOffsetSec, generatedAt) describes the render's
* validity and SHOULD sync — that's what lets a fresh device decide
* "no, this render doesn't match my current audio, regenerate".
*/
function stripExport(exp) {
	if (!exp) return void 0;
	const { relativePath: _relativePath, ...rest } = exp;
	return rest;
}
/**
* Project a local SongMap into its collaborative shape for upload.
* Always returns a new object — never mutates `sm`. Safe to JSON.stringify
* the result and POST.
*/
function toCollabSongMap(sm) {
	const out = { ...sm };
	for (const key of LOCAL_ONLY_TOP_LEVEL) delete out[key];
	if (sm.audio) {
		const { originalPath: _originalPath, ...audioRest } = sm.audio;
		out.audio = audioRest;
	}
	out.cueTrackExport = stripExport(sm.cueTrackExport);
	out.clickTrackExport = stripExport(sm.clickTrackExport);
	return out;
}
/**
* Merge a cloud SongMap (from a pull) into the local SongMap, preserving
* every local-only field. Collaborative fields take their values from
* the cloud copy.
*
* Conflict resolution beyond "cloud wins for collab fields" happens in
* Phase 8 (`collabMerge.ts`) — this function is the simpler "I trust
* what the server sent" path used during pull / initial join.
*/
function mergeLocalIntoCollab(local, cloud) {
	const merged = { ...cloud };
	for (const key of LOCAL_ONLY_TOP_LEVEL) {
		const v = local[key];
		if (v !== void 0) merged[key] = v;
	}
	if (cloud.audio) merged.audio = {
		...cloud.audio,
		originalPath: local.audio?.originalPath
	};
	else if (local.audio) merged.audio = local.audio;
	if (merged.cueTrackExport && local.cueTrackExport?.relativePath) merged.cueTrackExport = {
		...merged.cueTrackExport,
		relativePath: local.cueTrackExport.relativePath
	};
	if (merged.clickTrackExport && local.clickTrackExport?.relativePath) merged.clickTrackExport = {
		...merged.clickTrackExport,
		relativePath: local.clickTrackExport.relativePath
	};
	return merged;
}
//#endregion
export { toCollabSongMap as n, mergeLocalIntoCollab as t };
