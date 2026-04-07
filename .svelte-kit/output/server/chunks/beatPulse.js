import { C as getContext, D as clsx$1, F as derived$1, I as get, R as writable, d as bind_props, f as derived, m as ensure_array_like, p as element, u as attributes, v as spread_props } from "./internal.js";
import "./exports.js";
import { a as validateSongMap, r as sortBeatsByTime } from "./timelineEdit.js";
import "./client.js";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { tv } from "tailwind-variants";
//#region src/lib/utils.js
function cn(...inputs) {
	return twMerge(clsx(inputs));
}
//#endregion
//#region src/lib/components/ui/button/button.svelte
var buttonVariants = tv({
	base: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium focus-visible:ring-3 active:not-aria-[haspopup]:translate-y-px aria-invalid:ring-3 [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	variants: {
		variant: {
			default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
			outline: "border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground",
			secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
			ghost: "hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground",
			destructive: "bg-destructive/10 hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/20 text-destructive focus-visible:border-destructive/40 dark:hover:bg-destructive/30",
			link: "text-primary underline-offset-4 hover:underline"
		},
		size: {
			default: "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
			xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
			sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
			lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
			icon: "size-8",
			"icon-xs": "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
			"icon-sm": "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
			"icon-lg": "size-9"
		}
	},
	defaultVariants: {
		variant: "default",
		size: "default"
	}
});
function Button($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { class: className, variant = "default", size = "default", ref = null, href = void 0, type = "button", disabled = void 0, children, $$slots, $$events, ...restProps } = $$props;
		if (href) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<a${attributes({
				"data-slot": "button",
				class: clsx$1(cn(buttonVariants({
					variant,
					size
				}), className)),
				href: disabled ? void 0 : href,
				"aria-disabled": disabled,
				role: disabled ? "link" : void 0,
				tabindex: disabled ? -1 : void 0,
				...restProps
			})}>`);
			children?.($$renderer);
			$$renderer.push(`<!----></a>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<button${attributes({
				"data-slot": "button",
				class: clsx$1(cn(buttonVariants({
					variant,
					size
				}), className)),
				type,
				disabled,
				...restProps
			})}>`);
			children?.($$renderer);
			$$renderer.push(`<!----></button>`);
		}
		$$renderer.push(`<!--]-->`);
		bind_props($$props, { ref });
	});
}
//#endregion
//#region node_modules/@lucide/svelte/dist/defaultAttributes.js
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
var defaultAttributes = {
	xmlns: "http://www.w3.org/2000/svg",
	width: 24,
	height: 24,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	"stroke-width": 2,
	"stroke-linecap": "round",
	"stroke-linejoin": "round"
};
//#endregion
//#region node_modules/@lucide/svelte/dist/utils/hasA11yProp.js
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
/**
* Check if a component has an accessibility prop
*
* @param {object} props
* @returns {boolean} Whether the component has an accessibility prop
*/
var hasA11yProp = (props) => {
	for (const prop in props) if (prop.startsWith("aria-") || prop === "role" || prop === "title") return true;
	return false;
};
//#endregion
//#region node_modules/@lucide/svelte/dist/context.js
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
var LucideContext = Symbol("lucide-context");
var getLucideContext = () => getContext(LucideContext);
//#endregion
//#region node_modules/@lucide/svelte/dist/Icon.svelte
function Icon($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const globalProps = getLucideContext() ?? {};
		const { name, color = globalProps.color ?? "currentColor", size = globalProps.size ?? 24, strokeWidth = globalProps.strokeWidth ?? 2, absoluteStrokeWidth = globalProps.absoluteStrokeWidth ?? false, iconNode = [], children, $$slots, $$events, ...props } = $$props;
		const calculatedStrokeWidth = derived(() => absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth);
		$$renderer.push(`<svg${attributes({
			...defaultAttributes,
			...!children && !hasA11yProp(props) && { "aria-hidden": "true" },
			...props,
			width: size,
			height: size,
			stroke: color,
			"stroke-width": calculatedStrokeWidth(),
			class: clsx$1([
				"lucide-icon lucide",
				globalProps.class,
				name && `lucide-${name}`,
				props.class
			])
		}, void 0, void 0, void 0, 3)}><!--[-->`);
		const each_array = ensure_array_like(iconNode);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let [tag, attrs] = each_array[$$index];
			element($$renderer, tag, () => {
				$$renderer.push(`${attributes({ ...attrs }, void 0, void 0, void 0, 3)}`);
			});
		}
		$$renderer.push(`<!--]-->`);
		children?.($$renderer);
		$$renderer.push(`<!----></svg>`);
	});
}
/** MIME type for downloaded `.smap` files. */
var SMAP_BLOB_TYPE = "application/vnd.barbro.smap";
/** Magic bytes at file start (ASCII "SMAP"). */
var MAGIC = new Uint8Array([
	83,
	77,
	65,
	80
]);
/** Deep-sort object keys so `JSON.stringify` is stable for round-trip byte identity. Arrays keep order. */
function sortKeysDeep(x) {
	if (x === void 0) return void 0;
	if (x === null || typeof x !== "object") return x;
	if (Array.isArray(x)) return x.map(sortKeysDeep);
	const o = x;
	const out = {};
	for (const k of Object.keys(o).sort()) {
		const v = o[k];
		if (v === void 0) continue;
		const inner = sortKeysDeep(v);
		if (inner !== void 0) out[k] = inner;
	}
	return out;
}
/**
* Serialize `SongProject` to UTF-8 bytes deterministically (same logical project → same bytes).
* Ensures save → load → save yields an identical `.smap` when data is unchanged.
*/
function serializeProjectToUtf8(project) {
	const sorted = sortKeysDeep(project);
	return new TextEncoder().encode(JSON.stringify(sorted));
}
/**
* Build the canonical JSON project envelope from in-memory state.
*/
function songProjectFromRestorableState(state) {
	return {
		projectFormatVersion: 1,
		songMap: state.songMap
	};
}
/**
* Whether we should write an audio chunk: only a **non-empty** `Blob`.
* `undefined`, missing, or `size === 0` → no audio chunk (`hasAudio = false`, `audioLength = 0`).
*/
function shouldWriteAudioChunk(audioBlob) {
	return audioBlob !== void 0 && audioBlob.size > 0;
}
/**
* Encode one `.smap` file: fixed header + UTF-8 JSON chunk + optional raw audio chunk.
*/
async function encodeSmapFile(data) {
	if (data.project.projectFormatVersion !== 1) throw new Error(`Unsupported SongProject format version: ${data.project.projectFormatVersion}`);
	const jsonBytes = serializeProjectToUtf8(data.project);
	let audioBytes = null;
	if (shouldWriteAudioChunk(data.audioBlob)) audioBytes = new Uint8Array(await data.audioBlob.arrayBuffer());
	const hasAudio = audioBytes !== null && audioBytes.byteLength > 0;
	const flags = hasAudio ? 1 : 0;
	const jsonLen = BigInt(jsonBytes.byteLength);
	const audioLen = hasAudio && audioBytes ? BigInt(audioBytes.byteLength) : 0n;
	const header = /* @__PURE__ */ new ArrayBuffer(28);
	const view = new DataView(header);
	new Uint8Array(header, 0, 4).set(MAGIC);
	view.setUint32(4, 1, true);
	view.setUint32(8, flags, true);
	view.setBigUint64(12, jsonLen, true);
	view.setBigUint64(20, audioLen, true);
	const total = 28 + jsonBytes.byteLength + (audioBytes ? audioBytes.byteLength : 0);
	const out = new Uint8Array(total);
	out.set(new Uint8Array(header), 0);
	out.set(jsonBytes, 28);
	if (audioBytes) out.set(audioBytes, 28 + jsonBytes.byteLength);
	return new Blob([out], { type: SMAP_BLOB_TYPE });
}
//#endregion
//#region src/lib/songmap/persist.ts
/**
* Encode full restorable state as a single binary `.smap` file (see `smapFile.ts`).
*/
async function exportRestorableStateAsSmapBlob(state) {
	return encodeSmapFile({
		project: songProjectFromRestorableState(state),
		audioBlob: state.audioBlob ?? void 0
	});
}
/** Browser download for a `Blob` (e.g. `.smap`). */
function downloadBlob(blob, filename) {
	if (typeof document === "undefined") return;
	const a = document.createElement("a");
	const url = URL.createObjectURL(blob);
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
/** Safe single-segment filename stem from song title. */
function safeExportBasename(title) {
	return (title.trim() || "song").replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 80) || "song";
}
//#endregion
//#region src/lib/songmap/session.ts
/**
* After timeline/metadata edits, keep `map.audio` aligned with the live trim/file in `audioSession`
* so exported JSON and DB payloads stay consistent with what the user hears.
*/
function mergeAudioReferenceFromSession(map, session) {
	if (!session.file) return map;
	const duration = Math.max(0, session.endSec - session.startSec);
	const audio = {
		fileName: session.name,
		mimeType: session.file.type || map.audio?.mimeType,
		durationSec: duration,
		trim: {
			startSec: session.startSec,
			endSec: session.endSec
		},
		source: map.audio?.source ?? "upload",
		sha256: map.audio?.sha256
	};
	return {
		...map,
		audio
	};
}
function restorableSongState(songMap, audioBlob, songId) {
	return {
		songMap,
		audioBlob,
		songId
	};
}
//#endregion
//#region src/lib/stores/audioSession.ts
var audioSession = writable({
	file: null,
	name: "",
	startSec: 0,
	endSec: 0
});
//#endregion
//#region src/lib/songmap/harmonyEdit.ts
/** Half-open [startSec, endSec) for the beat in timeline order. */
function beatHarmonySpan(beat, allBeatsSorted, barsById) {
	const barEnd = barsById.get(beat.barId)?.endSec ?? beat.timeSec + .25;
	const idx = allBeatsSorted.findIndex((b) => b.id === beat.id);
	const next = idx >= 0 && idx + 1 < allBeatsSorted.length ? allBeatsSorted[idx + 1] : null;
	let endSec = barEnd;
	if (next && next.timeSec > beat.timeSec) endSec = Math.min(next.timeSec, barEnd);
	if (!(endSec > beat.timeSec)) endSec = Math.min(beat.timeSec + .02, barEnd);
	return {
		startSec: beat.timeSec,
		endSec
	};
}
/**
* Replace or insert exactly one harmony row for `beatId`, removing any prior row for that beat.
*/
function upsertHarmonyAtBeat(map, beatId, chord, newId) {
	const beat = map.timeline.beats.find((b) => b.id === beatId);
	if (!beat) return {
		ok: false,
		error: "Unknown beat"
	};
	if (!map.timeline.bars.find((b) => b.id === beat.barId)) return {
		ok: false,
		error: "Unknown bar for beat"
	};
	const { startSec, endSec } = beatHarmonySpan(beat, sortBeatsByTime(map.timeline.beats), new Map(map.timeline.bars.map((b) => [b.id, b])));
	if (!(endSec > startSec)) return {
		ok: false,
		error: "Invalid harmony span"
	};
	const filtered = map.harmony.filter((h) => h.beatId !== beatId);
	const next = {
		id: newId(),
		barId: beat.barId,
		beatId,
		startSec,
		endSec,
		chord,
		beatAnchor: { indexInBar: beat.indexInBar }
	};
	return {
		ok: true,
		map: {
			...map,
			harmony: [...filtered, next]
		}
	};
}
//#endregion
//#region src/lib/songmap/sectionEdit.ts
function ok(map) {
	return {
		ok: true,
		map
	};
}
function fail(error) {
	return {
		ok: false,
		error
	};
}
/** All kinds for pickers (order = common song flow). */
var SECTION_KIND_OPTIONS = [
	{
		kind: "intro",
		label: "Intro"
	},
	{
		kind: "verse",
		label: "Verse"
	},
	{
		kind: "preChorus",
		label: "Pre-chorus"
	},
	{
		kind: "chorus",
		label: "Chorus"
	},
	{
		kind: "bridge",
		label: "Bridge"
	},
	{
		kind: "solo",
		label: "Solo"
	},
	{
		kind: "outro",
		label: "Outro"
	},
	{
		kind: "custom",
		label: "Custom"
	}
];
function defaultSectionLabel(kind) {
	return SECTION_KIND_OPTIONS.find((o) => o.kind === kind)?.label ?? kind;
}
function rangesOverlap(a0, a1, b0, b1) {
	return !(a1 < b0 || b1 < a0);
}
/**
* Assigns a section to an inclusive bar index range. Drops existing sections that overlap
* the range, then appends the new section.
*/
function setSectionForBarRange(map, startBarIndex, endBarIndex, kind, idFactory) {
	const n = map.timeline.bars.length;
	if (n === 0) return fail("No bars in timeline");
	const a = Math.max(0, Math.min(startBarIndex, endBarIndex));
	const b = Math.min(n - 1, Math.max(startBarIndex, endBarIndex));
	if (a > b) return fail("Invalid bar range");
	const filtered = map.sections.filter((s) => {
		return !rangesOverlap(s.barRange.startBarIndex, s.barRange.endBarIndex, a, b);
	});
	const section = {
		id: idFactory(),
		kind,
		label: defaultSectionLabel(kind),
		barRange: {
			startBarIndex: a,
			endBarIndex: b
		}
	};
	return ok({
		...map,
		sections: [...filtered, section]
	});
}
//#endregion
//#region src/lib/stores/songMap.ts
/**
* In-memory durable song document (bars, beats, harmony, …). Playable bytes live in `audioSession`;
* after each successful patch we merge trim/file info into `map.audio` when a file is loaded.
* Full snapshot: `RestorableSongState` + `hydrateRestorableSong`.
*/
var songMap = writable(null);
function clearSongMap() {
	songMap.set(null);
}
/**
* Apply an immutable update to the current map. On validation failure the store is unchanged.
*/
function patchSongMap(updater) {
	let result = {
		ok: false,
		errors: ["No song map loaded"]
	};
	songMap.update((sm) => {
		if (!sm) return sm;
		let next = updater(sm);
		const sess = get(audioSession);
		if (sess.file) next = mergeAudioReferenceFromSession(next, sess);
		const v = validateSongMap(next);
		if (!v.ok) {
			result = {
				ok: false,
				errors: v.errors
			};
			return sm;
		}
		result = { ok: true };
		const now = (/* @__PURE__ */ new Date()).toISOString();
		return {
			...next,
			metadata: {
				...next.metadata,
				updatedAt: now
			}
		};
	});
	return result;
}
//#endregion
//#region src/lib/stores/restorableSong.ts
/** True when the in-memory editor has a loaded song + audio clip. */
function hasActiveSongSession() {
	return get(songMap) !== null && get(audioSession).file !== null;
}
/** Clears song document + audio session (same as closing the project in memory). */
function clearFullAppSongState() {
	clearSongMap();
	audioSession.set({
		file: null,
		name: "",
		startSec: 0,
		endSec: 0
	});
}
//#endregion
//#region node_modules/@lucide/svelte/dist/icons/music.svelte
function Music($$renderer, $$props) {
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
			{ name: "music" },
			props,
			{
				iconNode: [
					["path", { "d": "M9 18V5l12-2v13" }],
					["circle", {
						"cx": "6",
						"cy": "18",
						"r": "3"
					}],
					["circle", {
						"cx": "18",
						"cy": "16",
						"r": "3"
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
var uiAnimations = writable({
	beatPulse: {
		n: 0,
		accent: false
	},
	blobOrbit: { n: 0 },
	analyzingSpin: false
});
//#endregion
//#region src/lib/stores/beatPulse.ts
/**
* Re-exports `uiAnimations` plus a derived `beatPulse` store for legacy imports.
* Prefer importing from `$lib/stores/uiAnimations` in new code.
*/
/** Same `{ n, accent }` shape as before — mirrors `uiAnimations.beatPulse`. */
var beatPulse = derived$1(uiAnimations, ($u) => $u.beatPulse);
//#endregion
export { cn as _, hasActiveSongSession as a, setSectionForBarRange as c, restorableSongState as d, downloadBlob as f, Button as g, Icon as h, clearFullAppSongState as i, upsertHarmonyAtBeat as l, safeExportBasename as m, uiAnimations as n, patchSongMap as o, exportRestorableStateAsSmapBlob as p, Music as r, songMap as s, beatPulse as t, audioSession as u };
