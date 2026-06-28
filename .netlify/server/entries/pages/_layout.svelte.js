import { r as onDestroy } from "../../chunks/index-server.js";
import "../../chunks/shared-server.js";
import { A as escape_html, F as writable, N as get, O as attr, a as derived, c as head, d as slot, f as spread_props, h as unsubscribe_stores, m as stringify, p as store_get, r as attributes, s as ensure_array_like, t as attr_class } from "../../chunks/server.js";
import "../../chunks/index-server2.js";
import { n as goto, t as beforeNavigate } from "../../chunks/client.js";
import "../../chunks/navigation.js";
import { t as Button } from "../../chunks/button.js";
import { a as Dialog_title, i as Dialog_footer, n as Dialog_content, o as Dialog, r as Dialog_header, t as Dialog_description } from "../../chunks/dialog.js";
import { _ as Dropdown_menu_content, f as pushCloudSong, g as Dropdown_menu_item, m as Dropdown_menu_trigger, n as cloudConflict, p as NewProjectDialog, t as Folder_open, v as Dropdown_menu } from "../../chunks/folder-open.js";
import { t as Icon } from "../../chunks/Icon.js";
import { t as Check } from "../../chunks/check.js";
import "../../chunks/desktopBeacon.js";
import { m as pickFolderViaDesktop } from "../../chunks/desktopBridge.js";
import { J as restorableSongState, O as songMap, S as clearFullAppSongState, _ as closeProject, et as exportRestorableStateAsSmapBlob, i as dropRecentProjectPath, n as clearLastProjectPath, o as metadataLiteFromSongMap, q as audioSession, s as openProjectByPath, v as patchMetadataForFolder, x as setProjectData, y as project } from "../../chunks/commit.js";
import { p as writeProjectSong } from "../../chunks/desktopProjectFs2.js";
import { t as page } from "../../chunks/stores.js";
import { t as desktopCompanionStatus } from "../../chunks/desktopCompanionStatus.js";
import { t as Arrow_left } from "../../chunks/arrow-left.js";
import { t as Refresh_cw } from "../../chunks/refresh-cw.js";
import { t as Triangle_alert } from "../../chunks/triangle-alert.js";
import "../../chunks/iterate.js";
import "../../chunks/minSidecarVersion.js";
import "../../chunks/analyzingState.js";
import "@supabase/ssr";
//#region src/lib/songmap/collabMerge.ts
function shallowEqual(a, b) {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a)) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!shallowEqual(a[i], b[i])) return false;
		return true;
	}
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	for (const k of ka) if (!shallowEqual(a[k], b[k])) return false;
	return true;
}
/**
* Merge two `id`-keyed lists. Items unique to one side survive as-is.
* Items with the same `id` whose contents differ produce a Conflict
* with `theirs` (cloud) as the default in the merged output.
*/
function mergeByIdList(mine, theirs, pathPrefix, label) {
	const mineMap = /* @__PURE__ */ new Map();
	for (const item of mine ?? []) mineMap.set(item.id, item);
	const conflicts = [];
	/** Preserve cloud order, then append local-only items. */
	const merged = [];
	const seen = /* @__PURE__ */ new Set();
	for (const item of theirs ?? []) {
		const local = mineMap.get(item.id);
		if (local && !shallowEqual(local, item)) conflicts.push({
			path: `${pathPrefix}/${item.id}`,
			label: `${label} ${item.id.slice(0, 8)}`,
			severity: "safe",
			mine: local,
			theirs: item
		});
		merged.push(item);
		seen.add(item.id);
	}
	for (const item of mine ?? []) if (!seen.has(item.id)) merged.push(item);
	return {
		merged,
		conflicts
	};
}
function classifyScalar(mine, theirs, path, label) {
	if (shallowEqual(mine, theirs)) return null;
	return {
		path,
		label,
		severity: "safe",
		mine,
		theirs
	};
}
/**
* Build the merged SongMap + conflict report. Defaults every disputed
* field to the cloud value; the UI can flip individual entries back
* via `applyConflictDecisions`.
*/
function mergeForConflict(local, cloud) {
	const conflicts = [];
	const harmony = mergeByIdList(local.harmony, cloud.harmony, "harmony", "Chord at beat");
	conflicts.push(...harmony.conflicts);
	const sections = mergeByIdList(local.sections, cloud.sections, "sections", "Section");
	conflicts.push(...sections.conflicts);
	const bars = mergeByIdList(local.timeline?.bars, cloud.timeline?.bars, "timeline/bars", "Bar");
	conflicts.push(...bars.conflicts);
	const beats = mergeByIdList(local.timeline?.beats, cloud.timeline?.beats, "timeline/beats", "Beat");
	conflicts.push(...beats.conflicts);
	if ((local.timeline?.bars?.length ?? 0) !== (cloud.timeline?.bars?.length ?? 0)) conflicts.push({
		path: "timeline/bars-count",
		label: "Timeline length",
		severity: "dangerous",
		mine: local.timeline?.bars?.length ?? 0,
		theirs: cloud.timeline?.bars?.length ?? 0
	});
	for (const f of [
		"title",
		"artist",
		"composer",
		"arranger",
		"bpm",
		"notes",
		"keyDetail"
	]) {
		const c = classifyScalar(local.metadata?.[f], cloud.metadata?.[f], `metadata/${String(f)}`, `Metadata · ${String(f)}`);
		if (c) conflicts.push(c);
	}
	if ((local.metadata?.analyzed ?? false) !== (cloud.metadata?.analyzed ?? false)) conflicts.push({
		path: "metadata/analyzed",
		label: "Analyzed flag",
		severity: "dangerous",
		mine: !!local.metadata?.analyzed,
		theirs: !!cloud.metadata?.analyzed
	});
	const cuesC = classifyScalar(local.cues, cloud.cues, "cues", "Cue settings");
	if (cuesC) conflicts.push(cuesC);
	const cibC = classifyScalar(local.countInBeats, cloud.countInBeats, "countInBeats", "Count-in beats");
	if (cibC) conflicts.push(cibC);
	const sbC = classifyScalar(local.startBeatId, cloud.startBeatId, "startBeatId", "Start beat");
	if (sbC) conflicts.push(sbC);
	if (local.expectedAudio?.sha256 && cloud.expectedAudio?.sha256 && local.expectedAudio.sha256 !== cloud.expectedAudio.sha256) conflicts.push({
		path: "expectedAudio",
		label: "Expected audio identity",
		severity: "dangerous",
		mine: local.expectedAudio,
		theirs: cloud.expectedAudio
	});
	return {
		merged: {
			...cloud,
			harmony: harmony.merged,
			sections: sections.merged,
			timeline: {
				bars: bars.merged,
				beats: beats.merged
			}
		},
		conflicts
	};
}
/**
* Apply user choices over a merge report. For every conflict the user
* picked "mine", swap that path's value in the merged SongMap.
*
* Handles list-keyed paths (`harmony/<id>`, `sections/<id>`,
* `timeline/bars/<id>`, `timeline/beats/<id>`) and scalar paths
* (`metadata/<field>`, `cues`, `countInBeats`, `startBeatId`,
* `expectedAudio`, `timeline/bars-count`, `metadata/analyzed`).
*/
function applyConflictDecisions(report, decisions) {
	let result = report.merged;
	for (const c of report.conflicts) {
		if ((decisions.get(c.path) ?? "theirs") === "theirs") continue;
		if (c.path.startsWith("harmony/")) {
			const id = c.path.slice(8);
			result = {
				...result,
				harmony: result.harmony.map((h) => h.id === id ? c.mine : h)
			};
			continue;
		}
		if (c.path.startsWith("sections/")) {
			const id = c.path.slice(9);
			result = {
				...result,
				sections: result.sections.map((s) => s.id === id ? c.mine : s)
			};
			continue;
		}
		if (c.path.startsWith("timeline/bars/")) {
			const id = c.path.slice(14);
			result = {
				...result,
				timeline: {
					...result.timeline,
					bars: result.timeline.bars.map((b) => b.id === id ? c.mine : b)
				}
			};
			continue;
		}
		if (c.path.startsWith("timeline/beats/")) {
			const id = c.path.slice(15);
			result = {
				...result,
				timeline: {
					...result.timeline,
					beats: result.timeline.beats.map((b) => b.id === id ? c.mine : b)
				}
			};
			continue;
		}
		if (c.path.startsWith("metadata/")) {
			const f = c.path.slice(9);
			if (f === "analyzed") result = {
				...result,
				metadata: {
					...result.metadata,
					analyzed: c.mine
				}
			};
			else result = {
				...result,
				metadata: {
					...result.metadata,
					[f]: c.mine
				}
			};
			continue;
		}
		if (c.path === "cues") result = {
			...result,
			cues: c.mine
		};
		else if (c.path === "countInBeats") result = {
			...result,
			countInBeats: c.mine
		};
		else if (c.path === "startBeatId") result = {
			...result,
			startBeatId: c.mine
		};
		else if (c.path === "expectedAudio") result = {
			...result,
			expectedAudio: c.mine
		};
	}
	return result;
}
//#endregion
//#region src/lib/client/projectAutosave.ts
/**
* Project song auto-save: subscribes to the songMap store and writes
* `song.smap` to the project folder via the desktop sidecar when **all**
* of the following hold:
*
* 1. A project is open (`project.osPath` non-null)
* 2. `project.activeSongFolder` is non-null
* 3. `project.activeSongId` is non-null
* 4. `project.editingMode === 'project-song'`
* 5. Current route is `/edit` (read from `$page.route.id`)
* 6. The desktop companion is reachable (sidecar ping succeeded)
* 7. **Manifest invariant**: there exists an entry `e` in the manifest with
*    `e.folder === activeSongFolder` AND `e.id === activeSongId`
*
* Any failure of these guards aborts the write — no exception leaks. The
* `id` mismatch in (7) catches the case where the manifest changed
* underneath us (entry removed, replaced, path-edited).
*
* The manifest itself is NOT rewritten by autosave. Manifest changes only
* happen in response to structural edits (add/remove/hide/reorder/rename).
*/
var DEBOUNCE_MS = 1500;
/**
* Cloud push runs on its own longer debounce so we don't fire on every
* keystroke. Disk write fires first (faster, local) and is independent;
* a failed cloud push must never block the local save.
*/
var CLOUD_DEBOUNCE_MS = 7e3;
var debounceTimer = null;
var cloudDebounceTimer = null;
var writing = false;
var pendingWhileWriting = false;
var cloudPushing = false;
var cloudPendingWhilePushing = false;
async function tryWriteOnce() {
	const snap = get(project);
	const sm = get(songMap);
	if (!sm) return;
	if (!snap.data || !snap.osPath) return;
	if (!snap.activeSongFolder || !snap.activeSongId) return;
	if (snap.editingMode !== "project-song") return;
	if (get(page)?.route?.id !== "/edit") return;
	if (!snap.data.songs.find((e) => e.folder === snap.activeSongFolder && e.id === snap.activeSongId)) return;
	if (!get(desktopCompanionStatus).reachable) return;
	const state = restorableSongState(sm, get(audioSession).file ?? null);
	let blob;
	try {
		blob = await exportRestorableStateAsSmapBlob(state);
	} catch {
		return;
	}
	const bytes = new Uint8Array(await blob.arrayBuffer());
	if (!(await writeProjectSong(snap.osPath, snap.activeSongFolder, bytes)).ok) return;
	patchMetadataForFolder(snap.activeSongFolder, metadataLiteFromSongMap(sm));
}
function schedule() {
	if (debounceTimer) clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		if (writing) {
			pendingWhileWriting = true;
			return;
		}
		writing = true;
		tryWriteOnce().catch(() => {}).finally(() => {
			writing = false;
			if (pendingWhileWriting) {
				pendingWhileWriting = false;
				schedule();
			}
		});
	}, DEBOUNCE_MS);
}
/**
* Push the current active song to the cloud if the project is linked.
* Independent of disk write — runs on its own debounce, fails silently
* (the local .smap on disk stays the source of truth).
*
* Conflict handling here is minimal for Phase 4 (caller sees the
* 409, increments pendingChanges, and a later pull will resolve).
* Phase 8 wires the actual merge UI.
*/
async function tryCloudPushOnce() {
	const snap = get(project);
	const sm = get(songMap);
	if (!sm || !snap.data || !snap.data.cloud) return;
	if (!snap.activeSongId) return;
	if (snap.editingMode !== "project-song") return;
	if (get(page)?.route?.id !== "/edit") return;
	if (get(cloudConflict) !== null) return;
	const cloud = snap.data.cloud;
	const entry = snap.data.songs.find((e) => e.id === snap.activeSongId);
	if (!entry) return;
	const cloudSongId = entry.cloudSongId ?? entry.id;
	const baseRev = entry.lastSyncedRevision ?? cloud.lastSyncedRevision;
	const sortOrder = snap.data.songs.indexOf(entry);
	if (sortOrder < 0) return;
	const r = await pushCloudSong(cloud.projectId, cloudSongId, sm, sortOrder, !!entry.hidden, baseRev);
	if (r.ok) {
		setProjectData({
			...snap.data,
			cloud: {
				...cloud,
				lastSyncedRevision: r.revision,
				lastPushedAt: (/* @__PURE__ */ new Date()).toISOString(),
				pendingChanges: 0
			},
			songs: snap.data.songs.map((s) => s.id === entry.id ? {
				...s,
				cloudSongId,
				lastSyncedRevision: r.revision
			} : s)
		});
		return;
	}
	if ("conflict" in r && r.conflict && r.remote?.song_map) {
		if (get(cloudConflict) === null) {
			const report = mergeForConflict(sm, r.remote.song_map);
			cloudConflict.set({
				cloudProjectId: cloud.projectId,
				cloudSongId,
				localSongId: entry.id,
				local: sm,
				remote: r.remote.song_map,
				remoteRevision: r.remote.revision,
				report
			});
		}
	}
	setProjectData({
		...snap.data,
		cloud: {
			...cloud,
			pendingChanges: (cloud.pendingChanges ?? 0) + 1
		}
	});
}
function scheduleCloudPush() {
	if (cloudDebounceTimer) clearTimeout(cloudDebounceTimer);
	cloudDebounceTimer = setTimeout(() => {
		cloudDebounceTimer = null;
		if (cloudPushing) {
			cloudPendingWhilePushing = true;
			return;
		}
		cloudPushing = true;
		tryCloudPushOnce().catch(() => {}).finally(() => {
			cloudPushing = false;
			if (cloudPendingWhilePushing) {
				cloudPendingWhilePushing = false;
				scheduleCloudPush();
			}
		});
	}, CLOUD_DEBOUNCE_MS);
}
//#endregion
//#region node_modules/@lucide/svelte/dist/icons/chevron-down.svelte
function Chevron_down($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* @license @lucide/svelte v1.7.0 - ISC
		*
		* ISC License
		*
		* Copyright (c) 2026 Lucide Icons and Contributors
		*
		* Permission to use, copy, modify, and/or distribute this software for any
		* purpose with or without fee is hereby granted, provided that the above
		* copyright notice and this permission notice appear in all copies.
		*
		* THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
		* WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
		* MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
		* ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
		* WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
		* ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
		* OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
		*
		* ---
		*
		* The following Lucide icons are derived from the Feather project:
		*
		* airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out
		*
		* The MIT License (MIT) (for the icons listed above)
		*
		* Copyright (c) 2013-present Cole Bemis
		*
		* Permission is hereby granted, free of charge, to any person obtaining a copy
		* of this software and associated documentation files (the "Software"), to deal
		* in the Software without restriction, including without limitation the rights
		* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
		* copies of the Software, and to permit persons to whom the Software is
		* furnished to do so, subject to the following conditions:
		*
		* The above copyright notice and this permission notice shall be included in all
		* copies or substantial portions of the Software.
		*
		* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
		* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
		* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
		* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
		* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
		* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
		* SOFTWARE.
		*
		*/
		let { $$slots, $$events, ...props } = $$props;
		Icon($$renderer, spread_props([
			{ name: "chevron-down" },
			props,
			{
				iconNode: [["path", { "d": "m6 9 6 6 6-6" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
//#endregion
//#region node_modules/@lucide/svelte/dist/icons/cloud-check.svelte
function Cloud_check($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* @license @lucide/svelte v1.7.0 - ISC
		*
		* ISC License
		*
		* Copyright (c) 2026 Lucide Icons and Contributors
		*
		* Permission to use, copy, modify, and/or distribute this software for any
		* purpose with or without fee is hereby granted, provided that the above
		* copyright notice and this permission notice appear in all copies.
		*
		* THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
		* WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
		* MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
		* ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
		* WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
		* ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
		* OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
		*
		* ---
		*
		* The following Lucide icons are derived from the Feather project:
		*
		* airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out
		*
		* The MIT License (MIT) (for the icons listed above)
		*
		* Copyright (c) 2013-present Cole Bemis
		*
		* Permission is hereby granted, free of charge, to any person obtaining a copy
		* of this software and associated documentation files (the "Software"), to deal
		* in the Software without restriction, including without limitation the rights
		* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
		* copies of the Software, and to permit persons to whom the Software is
		* furnished to do so, subject to the following conditions:
		*
		* The above copyright notice and this permission notice shall be included in all
		* copies or substantial portions of the Software.
		*
		* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
		* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
		* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
		* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
		* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
		* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
		* SOFTWARE.
		*
		*/
		let { $$slots, $$events, ...props } = $$props;
		Icon($$renderer, spread_props([
			{ name: "cloud-check" },
			props,
			{
				iconNode: [["path", { "d": "m17 15-5.5 5.5L9 18" }], ["path", { "d": "M5.516 16.07A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 3.501 7.327" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
//#endregion
//#region node_modules/@lucide/svelte/dist/icons/cloud-off.svelte
function Cloud_off($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* @license @lucide/svelte v1.7.0 - ISC
		*
		* ISC License
		*
		* Copyright (c) 2026 Lucide Icons and Contributors
		*
		* Permission to use, copy, modify, and/or distribute this software for any
		* purpose with or without fee is hereby granted, provided that the above
		* copyright notice and this permission notice appear in all copies.
		*
		* THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
		* WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
		* MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
		* ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
		* WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
		* ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
		* OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
		*
		* ---
		*
		* The following Lucide icons are derived from the Feather project:
		*
		* airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out
		*
		* The MIT License (MIT) (for the icons listed above)
		*
		* Copyright (c) 2013-present Cole Bemis
		*
		* Permission is hereby granted, free of charge, to any person obtaining a copy
		* of this software and associated documentation files (the "Software"), to deal
		* in the Software without restriction, including without limitation the rights
		* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
		* copies of the Software, and to permit persons to whom the Software is
		* furnished to do so, subject to the following conditions:
		*
		* The above copyright notice and this permission notice shall be included in all
		* copies or substantial portions of the Software.
		*
		* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
		* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
		* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
		* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
		* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
		* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
		* SOFTWARE.
		*
		*/
		let { $$slots, $$events, ...props } = $$props;
		Icon($$renderer, spread_props([
			{ name: "cloud-off" },
			props,
			{
				iconNode: [
					["path", { "d": "M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057" }],
					["path", { "d": "M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78" }],
					["path", { "d": "m2 2 20 20" }]
				],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
//#endregion
//#region node_modules/@lucide/svelte/dist/icons/log-in.svelte
function Log_in($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* @license @lucide/svelte v1.7.0 - ISC
		*
		* ISC License
		*
		* Copyright (c) 2026 Lucide Icons and Contributors
		*
		* Permission to use, copy, modify, and/or distribute this software for any
		* purpose with or without fee is hereby granted, provided that the above
		* copyright notice and this permission notice appear in all copies.
		*
		* THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
		* WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
		* MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
		* ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
		* WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
		* ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
		* OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
		*
		* ---
		*
		* The following Lucide icons are derived from the Feather project:
		*
		* airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out
		*
		* The MIT License (MIT) (for the icons listed above)
		*
		* Copyright (c) 2013-present Cole Bemis
		*
		* Permission is hereby granted, free of charge, to any person obtaining a copy
		* of this software and associated documentation files (the "Software"), to deal
		* in the Software without restriction, including without limitation the rights
		* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
		* copies of the Software, and to permit persons to whom the Software is
		* furnished to do so, subject to the following conditions:
		*
		* The above copyright notice and this permission notice shall be included in all
		* copies or substantial portions of the Software.
		*
		* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
		* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
		* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
		* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
		* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
		* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
		* SOFTWARE.
		*
		*/
		let { $$slots, $$events, ...props } = $$props;
		Icon($$renderer, spread_props([
			{ name: "log-in" },
			props,
			{
				iconNode: [
					["path", { "d": "m10 17 5-5-5-5" }],
					["path", { "d": "M15 12H3" }],
					["path", { "d": "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" }]
				],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
//#endregion
//#region node_modules/@lucide/svelte/dist/icons/monitor.svelte
function Monitor($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* @license @lucide/svelte v1.7.0 - ISC
		*
		* ISC License
		*
		* Copyright (c) 2026 Lucide Icons and Contributors
		*
		* Permission to use, copy, modify, and/or distribute this software for any
		* purpose with or without fee is hereby granted, provided that the above
		* copyright notice and this permission notice appear in all copies.
		*
		* THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
		* WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
		* MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
		* ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
		* WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
		* ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
		* OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
		*
		* ---
		*
		* The following Lucide icons are derived from the Feather project:
		*
		* airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out
		*
		* The MIT License (MIT) (for the icons listed above)
		*
		* Copyright (c) 2013-present Cole Bemis
		*
		* Permission is hereby granted, free of charge, to any person obtaining a copy
		* of this software and associated documentation files (the "Software"), to deal
		* in the Software without restriction, including without limitation the rights
		* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
		* copies of the Software, and to permit persons to whom the Software is
		* furnished to do so, subject to the following conditions:
		*
		* The above copyright notice and this permission notice shall be included in all
		* copies or substantial portions of the Software.
		*
		* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
		* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
		* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
		* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
		* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
		* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
		* SOFTWARE.
		*
		*/
		let { $$slots, $$events, ...props } = $$props;
		Icon($$renderer, spread_props([
			{ name: "monitor" },
			props,
			{
				iconNode: [
					["rect", {
						"width": "20",
						"height": "14",
						"x": "2",
						"y": "3",
						"rx": "2"
					}],
					["line", {
						"x1": "8",
						"x2": "16",
						"y1": "21",
						"y2": "21"
					}],
					["line", {
						"x1": "12",
						"x2": "12",
						"y1": "17",
						"y2": "21"
					}]
				],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
//#endregion
//#region node_modules/@lucide/svelte/dist/icons/moon.svelte
function Moon($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* @license @lucide/svelte v1.7.0 - ISC
		*
		* ISC License
		*
		* Copyright (c) 2026 Lucide Icons and Contributors
		*
		* Permission to use, copy, modify, and/or distribute this software for any
		* purpose with or without fee is hereby granted, provided that the above
		* copyright notice and this permission notice appear in all copies.
		*
		* THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
		* WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
		* MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
		* ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
		* WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
		* ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
		* OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
		*
		* ---
		*
		* The following Lucide icons are derived from the Feather project:
		*
		* airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out
		*
		* The MIT License (MIT) (for the icons listed above)
		*
		* Copyright (c) 2013-present Cole Bemis
		*
		* Permission is hereby granted, free of charge, to any person obtaining a copy
		* of this software and associated documentation files (the "Software"), to deal
		* in the Software without restriction, including without limitation the rights
		* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
		* copies of the Software, and to permit persons to whom the Software is
		* furnished to do so, subject to the following conditions:
		*
		* The above copyright notice and this permission notice shall be included in all
		* copies or substantial portions of the Software.
		*
		* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
		* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
		* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
		* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
		* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
		* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
		* SOFTWARE.
		*
		*/
		let { $$slots, $$events, ...props } = $$props;
		Icon($$renderer, spread_props([
			{ name: "moon" },
			props,
			{
				iconNode: [["path", { "d": "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
//#endregion
//#region node_modules/@lucide/svelte/dist/icons/shield.svelte
function Shield($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* @license @lucide/svelte v1.7.0 - ISC
		*
		* ISC License
		*
		* Copyright (c) 2026 Lucide Icons and Contributors
		*
		* Permission to use, copy, modify, and/or distribute this software for any
		* purpose with or without fee is hereby granted, provided that the above
		* copyright notice and this permission notice appear in all copies.
		*
		* THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
		* WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
		* MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
		* ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
		* WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
		* ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
		* OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
		*
		* ---
		*
		* The following Lucide icons are derived from the Feather project:
		*
		* airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out
		*
		* The MIT License (MIT) (for the icons listed above)
		*
		* Copyright (c) 2013-present Cole Bemis
		*
		* Permission is hereby granted, free of charge, to any person obtaining a copy
		* of this software and associated documentation files (the "Software"), to deal
		* in the Software without restriction, including without limitation the rights
		* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
		* copies of the Software, and to permit persons to whom the Software is
		* furnished to do so, subject to the following conditions:
		*
		* The above copyright notice and this permission notice shall be included in all
		* copies or substantial portions of the Software.
		*
		* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
		* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
		* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
		* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
		* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
		* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
		* SOFTWARE.
		*
		*/
		let { $$slots, $$events, ...props } = $$props;
		Icon($$renderer, spread_props([
			{ name: "shield" },
			props,
			{
				iconNode: [["path", { "d": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }]],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
//#endregion
//#region node_modules/@lucide/svelte/dist/icons/sun.svelte
function Sun($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* @license @lucide/svelte v1.7.0 - ISC
		*
		* ISC License
		*
		* Copyright (c) 2026 Lucide Icons and Contributors
		*
		* Permission to use, copy, modify, and/or distribute this software for any
		* purpose with or without fee is hereby granted, provided that the above
		* copyright notice and this permission notice appear in all copies.
		*
		* THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
		* WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
		* MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
		* ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
		* WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
		* ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
		* OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
		*
		* ---
		*
		* The following Lucide icons are derived from the Feather project:
		*
		* airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out
		*
		* The MIT License (MIT) (for the icons listed above)
		*
		* Copyright (c) 2013-present Cole Bemis
		*
		* Permission is hereby granted, free of charge, to any person obtaining a copy
		* of this software and associated documentation files (the "Software"), to deal
		* in the Software without restriction, including without limitation the rights
		* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
		* copies of the Software, and to permit persons to whom the Software is
		* furnished to do so, subject to the following conditions:
		*
		* The above copyright notice and this permission notice shall be included in all
		* copies or substantial portions of the Software.
		*
		* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
		* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
		* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
		* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
		* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
		* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
		* SOFTWARE.
		*
		*/
		let { $$slots, $$events, ...props } = $$props;
		Icon($$renderer, spread_props([
			{ name: "sun" },
			props,
			{
				iconNode: [
					["circle", {
						"cx": "12",
						"cy": "12",
						"r": "4"
					}],
					["path", { "d": "M12 2v2" }],
					["path", { "d": "M12 20v2" }],
					["path", { "d": "m4.93 4.93 1.41 1.41" }],
					["path", { "d": "m17.66 17.66 1.41 1.41" }],
					["path", { "d": "M2 12h2" }],
					["path", { "d": "M20 12h2" }],
					["path", { "d": "m6.34 17.66-1.41 1.41" }],
					["path", { "d": "m19.07 4.93-1.41 1.41" }]
				],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
//#endregion
//#region src/lib/components/CloudSyncPill.svelte
function CloudSyncPill($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		/**
		* Phase 7 — cloud sync status indicator.
		*
		* One small pill in the header showing the current state of the
		* active project's cloud sync:
		*  - "Offline"   — browser reports navigator.onLine === false
		*  - "N pending" — at least one debounced cloud push failed or is
		*                  queued; user is online, so it'll flush soon
		*  - "Synced"    — pendingChanges === 0, online
		*  - "—"         — no cloud project linked (hidden by default)
		*
		* Subscribes to `online` / `offline` window events directly so the
		* pill flips immediately on connectivity change. The autosave
		* already retries on `online`; we don't have to do anything else.
		*/
		const cloud = derived(() => store_get($$store_subs ??= {}, "$project", project).data?.cloud ?? null);
		const pending = derived(() => cloud()?.pendingChanges ?? 0);
		const display = derived(() => !cloud() ? { kind: "hidden" } : pending() > 0 ? {
			kind: "pending",
			count: pending()
		} : { kind: "synced" });
		if (display().kind !== "hidden") {
			$$renderer.push("<!--[0-->");
			if (display().kind === "offline") {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<span class="border-foreground/30 text-muted-foreground inline-flex h-8 shrink-0 items-center gap-1.5 border-2 px-2 text-[11px] font-semibold uppercase tracking-wider" title="Browser reports offline — edits stay local until you're back online.">`);
				Cloud_off($$renderer, {
					class: "size-3.5",
					"aria-hidden": "true"
				});
				$$renderer.push(`<!----> Offline</span>`);
			} else if (display().kind === "pending") {
				$$renderer.push("<!--[1-->");
				$$renderer.push(`<button type="button" class="border-foreground text-foreground hover:bg-foreground/5 inline-flex h-8 shrink-0 items-center gap-1.5 border-2 px-2 text-[11px] font-semibold uppercase tracking-wider"${attr("title", `${stringify(display().count)} edit${stringify(display().count === 1 ? "" : "s")} waiting to sync. Click to retry now.`)}>`);
				Refresh_cw($$renderer, {
					class: "size-3.5",
					"aria-hidden": "true"
				});
				$$renderer.push(`<!----> ${escape_html(display().count)} pending</button>`);
			} else {
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<span class="border-emerald-700/40 text-emerald-700 dark:border-emerald-400/40 dark:text-emerald-300 inline-flex h-8 shrink-0 items-center gap-1.5 border-2 px-2 text-[11px] font-semibold uppercase tracking-wider" title="All edits pushed to the cloud.">`);
				Cloud_check($$renderer, {
					class: "size-3.5",
					"aria-hidden": "true"
				});
				$$renderer.push(`<!----> Synced</span>`);
			}
			$$renderer.push(`<!--]-->`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
var STAFF_LINE_GAP = 1.8;
STAFF_LINE_GAP * 4;
STAFF_LINE_GAP * 2.4;
//#endregion
//#region src/lib/stores/user.ts
/**
* Current signed-in user, mirrored from the SvelteKit server-side session.
*
* Populated by `+layout.svelte` from the layout load's `user` field, which
* `hooks.server.ts` resolves via `supabase.auth.getUser()`. Components that
* want to render conditionally on auth state subscribe to this store.
*
* Why a store + not just `$page.data.user`: the store decouples auth-state
* consumers from SvelteKit's page-data subscription, lets us update from
* client-side `onAuthStateChange` events (no full navigation needed), and
* gives us a single source of truth that works in both Svelte components
* and plain `.ts` modules via `get(userStore)`.
*/
var userStore = writable(null);
//#endregion
//#region src/lib/components/AppMenuBar.svelte
function AppMenuBar($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		/**
		* App menu: shadcn dropdowns (File / Edit / View) + debug JSON dialog.
		*/
		let dark = false;
		function toggleDarkMode() {
			dark = !dark;
			document.documentElement.classList.toggle("dark", dark);
			try {
				localStorage.setItem("barbro-theme", dark ? "dark" : "light");
			} catch {}
		}
		let menuError = "";
		let menuStatus = "";
		let debugOpen = false;
		let newProjectDialogOpen = false;
		let hydrationImportOpen = false;
		function openNewProjectDialog() {
			if (!store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).reachable) {
				menuError = "Desktop client unreachable — install/start BarBro desktop to manage projects.";
				return;
			}
			newProjectDialogOpen = true;
		}
		let desktopConnected = derived(() => store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).reachable);
		let desktopCheckedLabel = derived(() => store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).lastCheckedAt ? store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).lastCheckedAt.slice(11, 19) : "--:--:--");
		let desktopStatusTitle = derived(() => {
			const ping = ` · ping ${desktopCheckedLabel()}`;
			if (desktopConnected()) {
				const v = store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).version;
				return v ? `Desktop app: connected (v${v})${ping}` : `Desktop app: connected${ping}`;
			}
			return `Desktop app: not running${store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).lastError ? ` (${store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).lastError})` : ""}${ping}`;
		});
		const debugJsonText = derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			const sess = store_get($$store_subs ??= {}, "$audioSession", audioSession);
			const payload = {
				songMap: sm,
				audioSession: {
					name: sess.name,
					startSec: sess.startSec,
					endSec: sess.endSec,
					file: sess.file ? {
						name: sess.file.name,
						size: sess.file.size,
						type: sess.file.type
					} : null
				}
			};
			return JSON.stringify(payload, null, 2);
		});
		function clearMenuMessages() {
			menuError = "";
			menuStatus = "";
		}
		async function onExportHydration() {
			clearMenuMessages();
		}
		async function onImportHydration() {
			clearMenuMessages();
		}
		async function onExportFull() {
			menuError = "";
		}
		async function onExportMusicXml() {
			menuError = "";
		}
		async function onExportPdf() {
			menuError = "";
		}
		/**
		* Project mode is desktop-only. The sidecar's native picker returns the
		* absolute OS path, and that path is the project's canonical identity —
		* the web app never touches the filesystem directly for project I/O.
		*/
		async function onOpenProject() {
			menuError = "";
			if (!store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).reachable) {
				menuError = "Desktop client unreachable — install/start BarBro desktop to manage projects.";
				return;
			}
			const pick = await pickFolderViaDesktop({ title: "Open a BarBro project folder" });
			if (!pick.ok) {
				if ("cancelled" in pick) return;
				menuError = pick.error ?? "Could not open picker";
				return;
			}
			try {
				await openProjectByPath(pick.path);
				refreshRecents();
				await goto("/project");
			} catch (e) {
				menuError = e instanceof Error ? e.message : "Could not open project";
			}
		}
		async function onBackToProject() {
			await goto("/project");
		}
		let recentProjects = [];
		function refreshRecents() {}
		async function onOpenRecent(entry) {
			menuError = "";
			if (!store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).reachable) {
				menuError = "Desktop client unreachable — start BarBro desktop and try again.";
				return;
			}
			try {
				await openProjectByPath(entry.path);
				refreshRecents();
				await goto("/project");
			} catch (e) {
				dropRecentProjectPath(entry.path);
				refreshRecents();
				menuError = e instanceof Error ? e.message : `Could not open "${entry.label}"`;
			}
		}
		/** Project open on disk (manifest + folder handle). */
		let isInProjectMode = derived(() => store_get($$store_subs ??= {}, "$projectStore", project).data !== null);
		/**
		* Logo target: in project mode the project view is home; otherwise fall
		* back to the song editor if a song's loaded, else the import page.
		*/
		let logoHref = derived(() => isInProjectMode() ? "/project" : store_get($$store_subs ??= {}, "$songMap", songMap) && store_get($$store_subs ??= {}, "$audioSession", audioSession).file ? "/edit" : "/");
		let logoAria = derived(() => isInProjectMode() ? `BarBro — back to project ${store_get($$store_subs ??= {}, "$projectStore", project).data?.name ?? ""}` : store_get($$store_subs ??= {}, "$songMap", songMap) && store_get($$store_subs ??= {}, "$audioSession", audioSession).file ? "BarBro — back to editor" : "BarBro — import audio");
		async function onCloseProject() {
			menuError = "";
			closeProject();
			clearFullAppSongState();
			clearLastProjectPath();
			await goto("/", { replaceState: true });
		}
		/**
		* POST to /logout (the endpoint at `src/routes/logout/+server.ts` that
		* clears the Supabase session cookies) then full-reload to /welcome so
		* the root layout's user-store + access gate re-evaluate from scratch.
		*/
		async function onSignOut() {
			menuError = "";
			try {
				const res = await fetch("/logout", { method: "POST" });
				if (!res.ok) {
					menuError = `Sign out failed (HTTP ${res.status}).`;
					return;
				}
			} catch (e) {
				menuError = e instanceof Error ? e.message : "Sign out failed.";
				return;
			}
			window.location.assign("/welcome");
		}
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			$$renderer.push(`<header class="bg-background border-foreground flex flex-wrap items-center gap-2 border-b-2 px-3 py-1.5 text-sm" aria-label="Application" data-app-menu=""><a${attr("href", logoHref())} class="text-foreground hover:text-foreground flex shrink-0 items-center gap-2 py-1 pr-2 transition-colors"${attr("aria-label", logoAria())}><span class="logo-mark inline-flex svelte-1r2sgmv" aria-label="BarBro"><span class="logo-mark-bar svelte-1r2sgmv">BAR</span> <span class="logo-mark-bro svelte-1r2sgmv">BRO</span></span></a> <div class="flex flex-1 flex-wrap items-center gap-1.5">`);
			Dropdown_menu($$renderer, {
				children: ($$renderer) => {
					{
						function child($$renderer, { props }) {
							Button($$renderer, spread_props([
								{
									variant: "outline",
									size: "sm",
									class: "h-8 gap-1 px-2.5"
								},
								props,
								{
									children: ($$renderer) => {
										$$renderer.push(`<!---->File `);
										Chevron_down($$renderer, {
											class: "size-3.5 opacity-60",
											"aria-hidden": "true"
										});
										$$renderer.push(`<!---->`);
									},
									$$slots: { default: true }
								}
							]));
						}
						Dropdown_menu_trigger($$renderer, {
							child,
							$$slots: { child: true }
						});
					}
					$$renderer.push(`<!----> `);
					Dropdown_menu_content($$renderer, {
						align: "start",
						class: "min-w-[12rem]",
						children: ($$renderer) => {
							if (isInProjectMode()) {
								$$renderer.push("<!--[0-->");
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => void onBackToProject(),
									children: ($$renderer) => {
										$$renderer.push(`<!---->Back to Project`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => {
										onExportFull();
									},
									children: ($$renderer) => {
										$$renderer.push(`<!---->Save current song (.smap)…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => {
										onExportMusicXml();
									},
									children: ($$renderer) => {
										$$renderer.push(`<!---->Export as lead sheet (.musicxml)…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => {
										onExportPdf();
									},
									children: ($$renderer) => {
										$$renderer.push(`<!---->Export as PDF…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> <div class="bg-foreground/15 my-1 h-px" role="separator"></div> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => {
										onExportHydration();
									},
									children: ($$renderer) => {
										$$renderer.push(`<!---->Export hydration package…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => {
										onImportHydration();
									},
									children: ($$renderer) => {
										$$renderer.push(`<!---->Import hydration package…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> <div class="bg-foreground/15 my-1 h-px" role="separator"></div> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => void onCloseProject(),
									children: ($$renderer) => {
										$$renderer.push(`<!---->Close Project`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!---->`);
							} else {
								$$renderer.push("<!--[-1-->");
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: openNewProjectDialog,
									children: ($$renderer) => {
										$$renderer.push(`<!---->New Project…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => void onOpenProject(),
									children: ($$renderer) => {
										$$renderer.push(`<!---->Open Project…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								if (recentProjects.length > 0) {
									$$renderer.push("<!--[0-->");
									$$renderer.push(`<div class="text-muted-foreground px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider">Recent</div> <!--[-->`);
									const each_array = ensure_array_like(recentProjects);
									for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
										let r = each_array[$$index];
										Dropdown_menu_item($$renderer, {
											class: "cursor-pointer",
											onclick: () => void onOpenRecent(r),
											children: ($$renderer) => {
												$$renderer.push(`<div class="flex w-full min-w-0 flex-col gap-0"><span class="truncate font-medium">${escape_html(r.label)}</span> <span class="text-muted-foreground truncate font-mono text-[10px]">${escape_html(r.path)}</span></div>`);
											},
											$$slots: { default: true }
										});
									}
									$$renderer.push(`<!--]-->`);
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]-->`);
							}
							$$renderer.push(`<!--]--> `);
							Dropdown_menu_item($$renderer, {
								class: "cursor-pointer",
								onclick: () => goto("/download"),
								children: ($$renderer) => {
									$$renderer.push(`<!---->Download desktop app…`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!---->`);
						},
						$$slots: { default: true }
					});
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----></div> <div class="ml-auto flex shrink-0 items-center gap-2">`);
			CloudSyncPill($$renderer, {});
			$$renderer.push(`<!----> <a href="/download"${attr_class(`inline-flex size-8 items-center justify-center border-2 no-underline ${stringify(desktopConnected() ? "border-emerald-600 bg-emerald-100 text-emerald-800 dark:border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200" : "border-muted-foreground/50 bg-muted/40 text-muted-foreground hover:border-foreground/40 hover:bg-muted/60")}`)}${attr("title", desktopStatusTitle())}${attr("aria-label", desktopStatusTitle())}>`);
			Monitor($$renderer, {
				class: "size-4",
				"aria-hidden": "true"
			});
			$$renderer.push(`<!----></a> `);
			Button($$renderer, {
				type: "button",
				variant: "outline",
				size: "icon",
				class: "size-8",
				onclick: toggleDarkMode,
				"aria-label": dark ? "Switch to light mode" : "Switch to dark mode",
				children: ($$renderer) => {
					if (dark) {
						$$renderer.push("<!--[0-->");
						Sun($$renderer, { class: "size-4" });
					} else {
						$$renderer.push("<!--[-1-->");
						Moon($$renderer, { class: "size-4" });
					}
					$$renderer.push(`<!--]-->`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----> `);
			if (store_get($$store_subs ??= {}, "$page", page).data?.isAdmin) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<a href="/admin/access" class="border-foreground/40 text-muted-foreground hover:border-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 border-2 px-2 text-xs font-semibold uppercase tracking-wider no-underline" title="Admin: access requests">`);
				Shield($$renderer, {
					class: "size-3.5",
					"aria-hidden": "true"
				});
				$$renderer.push(`<!----> Admin</a>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (store_get($$store_subs ??= {}, "$userStore", userStore)) {
				$$renderer.push("<!--[0-->");
				const initial = (store_get($$store_subs ??= {}, "$userStore", userStore).name?.[0] ?? store_get($$store_subs ??= {}, "$userStore", userStore).email?.[0] ?? "?").toUpperCase();
				Dropdown_menu($$renderer, {
					children: ($$renderer) => {
						{
							function child($$renderer, { props }) {
								$$renderer.push(`<button${attributes({
									type: "button",
									class: "border-foreground bg-background hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center overflow-hidden border-2",
									title: store_get($$store_subs ??= {}, "$userStore", userStore).name ?? store_get($$store_subs ??= {}, "$userStore", userStore).email ?? "Account",
									"aria-label": "Account menu",
									...props
								}, "svelte-1r2sgmv")}>`);
								if (store_get($$store_subs ??= {}, "$userStore", userStore).avatarUrl) {
									$$renderer.push("<!--[0-->");
									$$renderer.push(`<img${attr("src", store_get($$store_subs ??= {}, "$userStore", userStore).avatarUrl)} alt="" class="size-full object-cover" referrerpolicy="no-referrer"/>`);
								} else {
									$$renderer.push("<!--[-1-->");
									$$renderer.push(`<span class="text-xs font-black">${escape_html(initial)}</span>`);
								}
								$$renderer.push(`<!--]--></button>`);
							}
							Dropdown_menu_trigger($$renderer, {
								child,
								$$slots: { child: true }
							});
						}
						$$renderer.push(`<!----> `);
						Dropdown_menu_content($$renderer, {
							align: "end",
							class: "min-w-[12rem]",
							children: ($$renderer) => {
								$$renderer.push(`<div class="px-2 pt-1 pb-1.5 text-[11px] leading-tight"><div class="truncate font-semibold">${escape_html(store_get($$store_subs ??= {}, "$userStore", userStore).name ?? store_get($$store_subs ??= {}, "$userStore", userStore).email ?? "Signed in")}</div> `);
								if (store_get($$store_subs ??= {}, "$userStore", userStore).name && store_get($$store_subs ??= {}, "$userStore", userStore).email) {
									$$renderer.push("<!--[0-->");
									$$renderer.push(`<div class="text-muted-foreground truncate">${escape_html(store_get($$store_subs ??= {}, "$userStore", userStore).email)}</div>`);
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--></div> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => goto("/account"),
									children: ($$renderer) => {
										$$renderer.push(`<!---->Account settings`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => void onSignOut(),
									children: ($$renderer) => {
										$$renderer.push(`<!---->Sign out`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!---->`);
							},
							$$slots: { default: true }
						});
						$$renderer.push(`<!---->`);
					},
					$$slots: { default: true }
				});
			} else {
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<a href="/login" class="border-foreground/40 text-muted-foreground hover:border-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 border-2 px-2 text-xs font-semibold uppercase tracking-wider no-underline" title="Sign in">`);
				Log_in($$renderer, {
					class: "size-3.5",
					"aria-hidden": "true"
				});
				$$renderer.push(`<!----> Sign in</a>`);
			}
			$$renderer.push(`<!--]--> `);
			if (!isInProjectMode()) {
				$$renderer.push("<!--[0-->");
				Button($$renderer, {
					type: "button",
					variant: "outline",
					size: "sm",
					class: "h-8",
					onclick: () => goto("/set"),
					title: "Experimental: export Ableton Live set",
					children: ($$renderer) => {
						$$renderer.push(`<!---->Set ⚗`);
					},
					$$slots: { default: true }
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div> `);
			if (menuError) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<p class="text-destructive w-full max-w-md truncate text-xs sm:w-auto" role="status">${escape_html(menuError)}</p>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (menuStatus && !menuError) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<p class="text-muted-foreground w-full max-w-md truncate text-xs sm:w-auto" role="status">${escape_html(menuStatus)}</p>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <input type="file" class="sr-only" accept=".smap,.json,application/json" aria-label="Import song bundle"/></header> `);
			Dialog($$renderer, {
				get open() {
					return debugOpen;
				},
				set open($$value) {
					debugOpen = $$value;
					$$settled = false;
				},
				children: ($$renderer) => {
					Dialog_content($$renderer, {
						class: "flex max-h-[85vh] w-full max-w-[min(56rem,calc(100%-2rem))] flex-col gap-3 p-4 sm:max-w-[min(56rem,calc(100%-2rem))]",
						showCloseButton: true,
						children: ($$renderer) => {
							Dialog_header($$renderer, {
								class: "",
								children: ($$renderer) => {
									Dialog_title($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Project JSON`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----> `);
									Dialog_description($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Live song map and audio session metadata. Audio bytes are not shown here.`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!---->`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> <pre class="border-foreground/10 bg-muted/20 text-foreground/90 max-h-[min(60vh,32rem)] overflow-auto rounded-lg border p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">${escape_html(debugJsonText())}</pre>`);
						},
						$$slots: { default: true }
					});
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----> `);
			NewProjectDialog($$renderer, {
				onCreated: () => refreshRecents(),
				get open() {
					return newProjectDialogOpen;
				},
				set open($$value) {
					newProjectDialogOpen = $$value;
					$$settled = false;
				}
			});
			$$renderer.push(`<!----> `);
			Dialog($$renderer, {
				get open() {
					return hydrationImportOpen;
				},
				set open($$value) {
					hydrationImportOpen = $$value;
					$$settled = false;
				},
				children: ($$renderer) => {
					Dialog_content($$renderer, {
						class: "flex max-h-[85vh] w-full max-w-[min(40rem,calc(100%-2rem))] flex-col gap-3 p-4 sm:max-w-[min(40rem,calc(100%-2rem))]",
						showCloseButton: true,
						children: ($$renderer) => {
							Dialog_header($$renderer, {
								children: ($$renderer) => {
									Dialog_title($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Hydration package imported`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----> `);
									Dialog_description($$renderer, {
										children: ($$renderer) => {
											$$renderer.push("<!--[-1-->");
											$$renderer.push(`<!--]-->`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!---->`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> `);
							$$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]-->`);
						},
						$$slots: { default: true }
					});
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!---->`);
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
//#region src/lib/components/ProjectContextBar.svelte
function ProjectContextBar($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		/**
		* Persistent context bar under the AppMenuBar showing which project is
		* currently loaded + a one-click way back to the project view. Visible
		* only when a project is open and we aren't already on `/project`.
		*
		* Replaces the smaller chip that used to live inside the menubar — the
		* full bar is impossible to miss and gives the back action top-level
		* priority instead of burying it in a dropdown.
		*/
		let isInProjectMode = derived(() => store_get($$store_subs ??= {}, "$projectStore", project).data !== null);
		let onProjectRoute = derived(() => store_get($$store_subs ??= {}, "$page", page).route?.id === "/project");
		let visible = derived(() => isInProjectMode() && !onProjectRoute());
		let projectName = derived(() => store_get($$store_subs ??= {}, "$projectStore", project).data?.name?.trim() || "project");
		/** When on /edit, show the song title for extra context. */
		let songTitle = derived(() => {
			const id = store_get($$store_subs ??= {}, "$page", page).route?.id;
			if (id !== "/edit" && id !== "/set") return null;
			return store_get($$store_subs ??= {}, "$songMap", songMap)?.metadata.title?.trim() || null;
		});
		if (visible()) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="bg-foreground text-background flex h-11 items-center gap-3 px-3 text-sm" role="navigation" aria-label="Project context"><button type="button" class="text-background hover:bg-background/10 -my-1 inline-flex shrink-0 items-center gap-1.5 px-2 py-1 text-sm font-semibold transition-colors"${attr("aria-label", `Back to project ${stringify(projectName())}`)}>`);
			Arrow_left($$renderer, {
				class: "size-4 shrink-0",
				"aria-hidden": "true"
			});
			$$renderer.push(`<!----> <span>Back to project</span></button> <span class="bg-background/30 h-5 w-px shrink-0" aria-hidden="true"></span> <div class="flex min-w-0 flex-1 items-center gap-2">`);
			Folder_open($$renderer, {
				class: "size-4 shrink-0 opacity-70",
				"aria-hidden": "true"
			});
			$$renderer.push(`<!----> <span class="truncate font-semibold tracking-tight">${escape_html(projectName())}</span> `);
			if (songTitle()) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<span class="opacity-50" aria-hidden="true">/</span> <span class="text-background/80 truncate font-mono text-xs">${escape_html(songTitle())}</span>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
//#region src/lib/components/ConflictResolutionDialog.svelte
function ConflictResolutionDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		/**
		* Phase 8 — cloud sync conflict resolver.
		*
		* Listens to `cloudConflict`. When it's non-null, renders a modal
		* listing every disputed field from `mergeForConflict`. The user
		* picks per row (default: theirs / cloud), then clicks Apply.
		*
		* Apply pushes the resolved SongMap back with the cloud's revision
		* as the new clientBaseRevision and writes the result to the local
		* songMap store + project autosave so the disk copy converges too.
		*/
		let decisions = /* @__PURE__ */ new Map();
		let pushing = false;
		let pushError = "";
		const open = derived(() => store_get($$store_subs ??= {}, "$cloudConflict", cloudConflict) !== null);
		function describe(v) {
			if (v === null || v === void 0 || v === "") return "—";
			if (typeof v === "string") return v.length > 40 ? v.slice(0, 37) + "…" : v;
			if (typeof v === "number" || typeof v === "boolean") return String(v);
			try {
				const j = JSON.stringify(v);
				return j.length > 60 ? j.slice(0, 57) + "…" : j;
			} catch {
				return "[object]";
			}
		}
		function dismiss() {
			cloudConflict.set(null);
			decisions = /* @__PURE__ */ new Map();
			pushError = "";
		}
		/**
		* "Take theirs" shortcut — apply the cloud state wholesale to local
		* without per-row picking. Updates the in-memory songMap; the
		* autosave will write it to disk and stop the 409 loop.
		*/
		function takeTheirs() {
			const c = store_get($$store_subs ??= {}, "$cloudConflict", cloudConflict);
			if (!c) return;
			songMap.set(c.report.merged);
			const proj = get(project);
			if (proj.data?.cloud && proj.osPath) {
				const next = {
					...proj.data,
					cloud: {
						...proj.data.cloud,
						lastSyncedRevision: c.remoteRevision,
						pendingChanges: 0
					},
					songs: proj.data.songs.map((s) => s.id === c.localSongId ? {
						...s,
						lastSyncedRevision: c.remoteRevision
					} : s)
				};
				project.set({
					...proj,
					data: next
				});
			}
			dismiss();
		}
		/**
		* Apply per-row decisions + push. Defaults still "cloud wins" for
		* rows the user didn't touch.
		*
		* Re-snapshots `songMapStore` at apply time so any edits the user
		* made while the dialog was open survive the resolution. Without
		* this, `applyConflictDecisions(c.report, …)` would push a stale
		* SongMap (the one snapshotted when the 409 fired) and silently
		* lose every in-flight edit on `songMapStore.set(resolved)`.
		*
		* Strategy: merge the user's current local against the remote, then
		* carry their per-row decisions forward by path. New conflicts that
		* appeared post-409 default to cloud (same as initial behaviour) —
		* the dialog won't re-open to surface them, which is fine for v1.
		*/
		async function applyAndPush() {
			const c = store_get($$store_subs ??= {}, "$cloudConflict", cloudConflict);
			if (!c) return;
			pushing = true;
			pushError = "";
			try {
				const resolved = applyConflictDecisions(mergeForConflict(get(songMap) ?? c.local, c.remote), decisions);
				const proj = get(project);
				const entry = proj.data?.songs.find((s) => s.id === c.localSongId);
				const sortOrder = proj.data?.songs.findIndex((s) => s.id === c.localSongId) ?? -1;
				const r = await pushCloudSong(c.cloudProjectId, c.cloudSongId, resolved, sortOrder >= 0 ? sortOrder : 0, !!entry?.hidden, c.remoteRevision);
				if (!r.ok) {
					if ("conflict" in r && r.conflict) pushError = "Server moved again. Closing this dialog will re-fire with the new state.";
					else pushError = ("error" in r ? r.error : "Push failed") || "Push failed";
					return;
				}
				songMap.set(resolved);
				if (proj.data?.cloud && proj.osPath) {
					const next = {
						...proj.data,
						cloud: {
							...proj.data.cloud,
							lastSyncedRevision: r.revision,
							lastPushedAt: (/* @__PURE__ */ new Date()).toISOString(),
							pendingChanges: 0
						},
						songs: proj.data.songs.map((s) => s.id === c.localSongId ? {
							...s,
							lastSyncedRevision: r.revision
						} : s)
					};
					project.set({
						...proj,
						data: next
					});
				}
				dismiss();
			} finally {
				pushing = false;
			}
		}
		Dialog($$renderer, {
			open: open(),
			onOpenChange: (v) => {
				if (!v) dismiss();
			},
			children: ($$renderer) => {
				Dialog_content($$renderer, {
					class: "max-w-2xl max-h-[85vh] flex flex-col gap-3 p-4",
					children: ($$renderer) => {
						Dialog_header($$renderer, {
							children: ($$renderer) => {
								Dialog_title($$renderer, {
									class: "flex items-center gap-2",
									children: ($$renderer) => {
										Triangle_alert($$renderer, {
											class: "text-amber-600 dark:text-amber-400 size-5",
											"aria-hidden": "true"
										});
										$$renderer.push(`<!----> Remote changes since your last sync`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Dialog_description($$renderer, {
									children: ($$renderer) => {
										$$renderer.push(`<!---->Someone else updated this song while you were editing. Pick
        which version to keep for each row — the cloud version is
        selected by default.`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!---->`);
							},
							$$slots: { default: true }
						});
						$$renderer.push(`<!----> `);
						if (store_get($$store_subs ??= {}, "$cloudConflict", cloudConflict)) {
							$$renderer.push("<!--[0-->");
							const c = store_get($$store_subs ??= {}, "$cloudConflict", cloudConflict);
							if (c.report.conflicts.length === 0) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<p class="text-muted-foreground text-sm">No field-level conflicts — your edits don't overlap with the
          remote ones. Click <span class="font-semibold">Apply</span> to push the merged result.</p>`);
							} else {
								$$renderer.push("<!--[-1-->");
								$$renderer.push(`<ul class="border-foreground/20 divide-foreground/10 max-h-[55vh] overflow-auto divide-y border-2 text-sm"><!--[-->`);
								const each_array = ensure_array_like(c.report.conflicts);
								for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
									let conflict = each_array[$$index];
									const choice = decisions.get(conflict.path) ?? "theirs";
									$$renderer.push(`<li class="px-3 py-2"><div class="flex items-start justify-between gap-3"><div class="min-w-0 flex-1"><div class="flex items-center gap-2 text-xs"><span class="font-semibold uppercase tracking-wider">${escape_html(conflict.label)}</span> `);
									if (conflict.severity === "dangerous") {
										$$renderer.push("<!--[0-->");
										$$renderer.push(`<span class="text-amber-700 dark:text-amber-300 text-[10px] font-bold uppercase tracking-wider">dangerous</span>`);
									} else $$renderer.push("<!--[-1-->");
									$$renderer.push(`<!--]--></div> <dl class="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[11px] font-mono"><dt class="text-muted-foreground">Yours</dt> <dd class="break-all">${escape_html(describe(conflict.mine))}</dd> <dt class="text-muted-foreground">Theirs</dt> <dd class="break-all">${escape_html(describe(conflict.theirs))}</dd></dl></div> <div class="flex shrink-0 gap-1"><button type="button"${attr_class(`border-2 px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${stringify(choice === "mine" ? "border-foreground bg-foreground text-background" : "border-foreground/30 hover:border-foreground")}`)}>Keep mine</button> <button type="button"${attr_class(`border-2 px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${stringify(choice === "theirs" ? "border-foreground bg-foreground text-background" : "border-foreground/30 hover:border-foreground")}`)}>Take theirs</button></div></div></li>`);
								}
								$$renderer.push(`<!--]--></ul>`);
							}
							$$renderer.push(`<!--]--> `);
							if (pushError) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<p class="text-destructive text-xs">${escape_html(pushError)}</p>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Dialog_footer($$renderer, {
								class: "gap-2",
								children: ($$renderer) => {
									Button($$renderer, {
										class: "",
										variant: "outline",
										disabled: pushing,
										onclick: takeTheirs,
										children: ($$renderer) => {
											$$renderer.push(`<!---->Take theirs (all)`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----> `);
									Button($$renderer, {
										class: "gap-2",
										disabled: pushing,
										onclick: () => void applyAndPush(),
										children: ($$renderer) => {
											Check($$renderer, {
												class: "size-4",
												"aria-hidden": "true"
											});
											$$renderer.push(`<!----> ${escape_html(pushing ? "Pushing…" : "Apply")}`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!---->`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!---->`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]-->`);
					},
					$$slots: { default: true }
				});
			},
			$$slots: { default: true }
		});
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
//#region src/routes/+layout.svelte
function _layout($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let { data } = $$props;
		function isAnalyzed(sm) {
			if (!sm) return false;
			return sm.metadata.analyzed ?? sm.timeline.bars.length > 0;
		}
		onDestroy(() => {});
		beforeNavigate((nav) => {
			if (!nav.to) return;
			if (nav.to.url.pathname !== "/") return;
			if (nav.to.url.searchParams.has("project")) return;
			const sm = get(songMap);
			if (!sm) return;
			if (isAnalyzed(sm)) {
				nav.cancel();
				goto("/edit", { replaceState: true });
			}
		});
		let bareRouteIds = [
			"/download",
			"/welcome",
			"/login",
			"/pending"
		];
		let onBareRoute = derived(() => bareRouteIds.includes(store_get($$store_subs ??= {}, "$page", page).route?.id ?? ""));
		let showChrome = derived(() => !onBareRoute());
		derived(() => store_get($$store_subs ??= {}, "$projectStore", project).data !== null && store_get($$store_subs ??= {}, "$page", page).route?.id !== "/project");
		head("12qhfyh", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>BarBro</title>`);
			});
			$$renderer.push(`<meta name="description" content="BarBro — bar-first songs, beats, and cues."/>`);
		});
		$$renderer.push(`<div class="app-frame bg-background font-sans svelte-12qhfyh">`);
		if (showChrome()) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="shrink-0">`);
			AppMenuBar($$renderer, {});
			$$renderer.push(`<!----> `);
			ProjectContextBar($$renderer, {});
			$$renderer.push(`<!----></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="app-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-x-none"><!--[-->`);
		slot($$renderer, $$props, "default", {}, null);
		$$renderer.push(`<!--]--></div> `);
		ConflictResolutionDialog($$renderer, {});
		$$renderer.push(`<!----></div>`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
export { _layout as default };
