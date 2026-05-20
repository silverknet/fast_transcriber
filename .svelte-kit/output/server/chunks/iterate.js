//#region src/lib/leadsheet/iterate.ts
function harmonyByBarId(songMap) {
	const map = /* @__PURE__ */ new Map();
	for (const h of songMap.harmony) {
		const list = map.get(h.barId) ?? [];
		list.push(h);
		map.set(h.barId, list);
	}
	return map;
}
function beatById(songMap) {
	return new Map(songMap.timeline.beats.map((b) => [b.id, b]));
}
function harmonyBeatOffset(h, beats) {
	if (h.beatAnchor) return Math.max(0, h.beatAnchor.indexInBar);
	if (h.beatId) return Math.max(0, beats.get(h.beatId)?.indexInBar ?? 0);
	return 0;
}
function sectionAtBar(songMap, barIndex) {
	const s = songMap.sections.find((sec) => sec.barRange.startBarIndex === barIndex);
	return s ? s.label || s.kind : null;
}
//#endregion
export { sectionAtBar as i, harmonyBeatOffset as n, harmonyByBarId as r, beatById as t };
