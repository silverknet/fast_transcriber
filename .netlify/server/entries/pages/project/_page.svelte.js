import "../../../chunks/index-server.js";
import { A as escape_html, O as attr, a as derived, f as spread_props, h as unsubscribe_stores, i as bind_props, m as stringify, p as store_get, s as ensure_array_like, t as attr_class } from "../../../chunks/server.js";
import "../../../chunks/index-server2.js";
import { n as goto } from "../../../chunks/client.js";
import "../../../chunks/navigation.js";
import { t as Button } from "../../../chunks/button.js";
import { a as Dialog_title, i as Dialog_footer, n as Dialog_content, o as Dialog, r as Dialog_header, t as Dialog_description } from "../../../chunks/dialog.js";
import { a as disableCloudProject, i as createCloudProject, o as getCloudProjectManifest, p as NewProjectDialog, s as joinCloudProject, u as listPendingInvites } from "../../../chunks/folder-open.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { t as X } from "../../../chunks/x.js";
import { m as pickFolderViaDesktop, t as STEM_PRESET_PRIORITY } from "../../../chunks/desktopBridge.js";
import { $ as downloadBlob, O as songMap, d as removeSongFromProject, f as selectBestStemSet, rt as getExportableSongs, tt as safeExportBasename, u as refreshProjectInfo, y as project } from "../../../chunks/commit.js";
import { a as readSmapJsonOnly } from "../../../chunks/smapFile.js";
import { a as readProjectSong, d as writeProjectAsset, i as getProjectWavInfoBatch, m as writeProjectSongAsset, o as readProjectSongAsset, u as transcodeProjectAudioToWav } from "../../../chunks/desktopProjectFs2.js";
import { t as page } from "../../../chunks/stores.js";
import { t as desktopCompanionStatus } from "../../../chunks/desktopCompanionStatus.js";
import { n as StemSplitter, o as STEM_TRACKS, s as generateAbletonProjectSetXml, t as gzipString } from "../../../chunks/gzip.js";
import "../../../chunks/download.js";
import { t as renderCueTrackWavBlob } from "../../../chunks/renderCueTrack.js";
import "../../../chunks/music-4.js";
import "../../../chunks/refresh-cw.js";
import "../../../chunks/sparkles.js";
import "../../../chunks/upload.js";
import { t as User_plus } from "../../../chunks/user-plus.js";
import { t as songPlaybackPlan } from "../../../chunks/playbackPlan.js";
import { t as audioBufferToWavBlob } from "../../../chunks/trimAudio.js";
//#region node_modules/@lucide/svelte/dist/icons/cloud.svelte
function Cloud($$renderer, $$props) {
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
			{ name: "cloud" },
			props,
			{
				iconNode: [["path", { "d": "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" }]],
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
//#region node_modules/@lucide/svelte/dist/icons/trash-2.svelte
function Trash_2($$renderer, $$props) {
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
			{ name: "trash-2" },
			props,
			{
				iconNode: [
					["path", { "d": "M10 11v6" }],
					["path", { "d": "M14 11v6" }],
					["path", { "d": "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
					["path", { "d": "M3 6h18" }],
					["path", { "d": "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }]
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
//#region src/lib/components/RemoveSongDialog.svelte
function RemoveSongDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { open = false, songTitle, onConfirm } = $$props;
		let deleteFiles = false;
		function cancel() {
			open = false;
		}
		function confirm() {
			const flag = deleteFiles;
			open = false;
			onConfirm(flag);
		}
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			Dialog($$renderer, {
				get open() {
					return open;
				},
				set open($$value) {
					open = $$value;
					$$settled = false;
				},
				children: ($$renderer) => {
					Dialog_content($$renderer, {
						class: "max-w-md",
						children: ($$renderer) => {
							Dialog_header($$renderer, {
								children: ($$renderer) => {
									Dialog_title($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Remove from project`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----> `);
									Dialog_description($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->This removes <span class="font-medium">${escape_html(songTitle)}</span> from the setlist. The song files
        will stay on disk unless you choose to delete them.`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!---->`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> <label class="border-foreground/30 mt-2 flex cursor-pointer items-center gap-2 border-2 p-3 text-sm"><input type="checkbox" class="size-4"${attr("checked", deleteFiles, true)}/> <span>Also delete this song's files from disk</span></label> `);
							Dialog_footer($$renderer, {
								class: "",
								children: ($$renderer) => {
									Button($$renderer, {
										class: "",
										variant: "outline",
										onclick: cancel,
										children: ($$renderer) => {
											$$renderer.push(`<!---->Cancel`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----> `);
									Button($$renderer, {
										class: "",
										onclick: confirm,
										children: ($$renderer) => {
											$$renderer.push(`<!---->${escape_html("Remove")}`);
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
				},
				$$slots: { default: true }
			});
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		bind_props($$props, { open });
	});
}
//#endregion
//#region src/lib/audio/mixBackingTrack.ts
/**
* Offline mix of any combination of stems + cue track into a single WAV.
*
* Each selected blob is decoded, channel-aligned (mono sources are
* duplicated to stereo when stereo sources are present), and summed at a
* common sample rate (44.1 kHz). Result is peak-normalized below clipping
* and rendered to a 16-bit WAV Blob ready for download.
*
* Time alignment: every source starts at t=0 of the output. Stems from
* Demucs and the BarBro cue track both begin at the original song's t=0
* frame (the cue track has its own preamble baked in, but stems do not).
* If a future caller needs trim/prelude alignment, pass an `offsetSec` per
* source — for v1 we sum at t=0.
*/
var TARGET_SAMPLE_RATE = 44100;
/** Linear-interpolation resample of a single channel to a new length + rate. */
function linearResample(src, srcRate, destRate) {
	if (srcRate === destRate) return src;
	const destLen = Math.max(1, Math.round(src.length / srcRate * destRate));
	const out = new Float32Array(destLen);
	for (let j = 0; j < destLen; j++) {
		const srcPos = j / destRate * srcRate;
		const i = Math.floor(srcPos);
		const frac = srcPos - i;
		const s0 = src[i] ?? 0;
		const s1 = src[Math.min(i + 1, src.length - 1)] ?? 0;
		out[j] = (1 - frac) * s0 + frac * s1;
	}
	return out;
}
/** Number of output channels: 2 if any source is stereo, else 1. */
function deriveChannelCount(bufs) {
	return bufs.some((b) => b.numberOfChannels >= 2) ? 2 : 1;
}
/** Pull `channelIndex` from a buffer; if mono and channelIndex=1, return ch 0. */
function getChannel(buf, channelIndex) {
	if (buf.numberOfChannels === 0) return new Float32Array(0);
	const ix = Math.min(channelIndex, buf.numberOfChannels - 1);
	return buf.getChannelData(ix);
}
/**
* Mix the given sources into a single WAV at 44.1 kHz. Returns the encoded
* blob ready for download. Throws if no sources are provided or none decode.
*/
async function mixBackingTrack(sources) {
	if (sources.length === 0) throw new Error("No sources selected");
	const ac = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
	try {
		const decoded = [];
		const failures = [];
		for (const src of sources) try {
			const buf = await ac.decodeAudioData(await src.blob.arrayBuffer());
			decoded.push({
				src,
				buf
			});
		} catch (e) {
			failures.push(`${src.label}: ${e instanceof Error ? e.message : "decode failed"}`);
		}
		if (decoded.length === 0) throw new Error(`Could not decode any source. ${failures.join("; ")}`);
		const channels = deriveChannelCount(decoded.map((d) => d.buf));
		let maxFrames = 0;
		for (const { src, buf } of decoded) {
			const offset = Math.max(0, Math.round((src.offsetSec ?? 0) * TARGET_SAMPLE_RATE));
			const lenAtTarget = Math.round(buf.length / buf.sampleRate * TARGET_SAMPLE_RATE);
			maxFrames = Math.max(maxFrames, offset + lenAtTarget);
		}
		const out = [];
		for (let c = 0; c < channels; c++) out.push(new Float32Array(maxFrames));
		for (const { src, buf } of decoded) {
			const offset = Math.max(0, Math.round((src.offsetSec ?? 0) * TARGET_SAMPLE_RATE));
			const gain = src.gain ?? 1;
			for (let c = 0; c < channels; c++) {
				const resampled = linearResample(getChannel(buf, c), buf.sampleRate, TARGET_SAMPLE_RATE);
				const dst = out[c];
				const copyLen = Math.min(resampled.length, dst.length - offset);
				for (let i = 0; i < copyLen; i++) dst[offset + i] += resampled[i] * gain;
			}
		}
		let peak = 0;
		for (const ch of out) for (let i = 0; i < ch.length; i++) {
			const a = Math.abs(ch[i]);
			if (a > peak) peak = a;
		}
		if (peak > .98) {
			const scale = .98 / peak;
			for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] *= scale;
		}
		const outBuf = ac.createBuffer(channels, maxFrames, TARGET_SAMPLE_RATE);
		for (let c = 0; c < channels; c++) outBuf.copyToChannel(out[c], c, 0);
		return audioBufferToWavBlob(outBuf);
	} finally {
		await ac.close().catch(() => {});
	}
}
//#endregion
//#region src/lib/components/ExportBackingTrackDialog.svelte
function ExportBackingTrackDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* "Export backing track" dialog: pick which audio assets to mix and
		* download as a single WAV. Sources come from the project's per-song
		* metadata cache (stems on disk, cue track presence).
		*
		* The mix runs client-side via [`mixBackingTrack`](../audio/mixBackingTrack.ts).
		* Bytes are fetched from the desktop sidecar's `/native/project/song/asset/read`
		* endpoint — no audio bytes are shipped from the web side.
		*/
		let { open = false, projectPath, songFolder, songTitle, metadata, songMap } = $$props;
		/** Current SongMap — required to derive click track if no file exists. */
		/**
		* Stem slot name → disk filename. Filenames come from `stemsOnDisk`
		* (basenames of WAVs in `<song>/stems/`). We map a known set of stem
		* filenames to display labels — anything else shows under "Other files".
		*/
		const KNOWN_STEMS = {
			"vocals.wav": "Vocals",
			"drums.wav": "Drums",
			"bass.wav": "Bass",
			"other.wav": "Other",
			"guitar.wav": "Guitar",
			"fx.wav": "FX"
		};
		/** Stable key for the checkbox + state. */
		/** Stable key for the checkbox + state. */
		/** Human label. */
		/** Short description (under the label). */
		/** Returns the audio blob, fetching from disk or rendering on-the-fly. */
		function fetchFromDisk(subpath) {
			return async () => {
				if (!projectPath || !songFolder) return null;
				const r = await readProjectSongAsset(projectPath, songFolder, subpath);
				return r.ok ? r.blob : null;
			};
		}
		let stemOpts = derived(() => {
			const list = [];
			const best = selectBestStemSet(metadata);
			if (!best) return list;
			for (const f of best.files) {
				const label = KNOWN_STEMS[f.toLowerCase()] ?? f.replace(/\.[^.]+$/, "");
				const subpath = `${best.pathPrefix}${f}`;
				list.push({
					key: `stem:${f}`,
					label: `${label} · ${best.preset}`,
					hint: subpath,
					fetch: fetchFromDisk(subpath)
				});
			}
			return list;
		});
		let cueOpt = derived(() => metadata?.hasCueTrack ? {
			key: "cue",
			label: "Cue track",
			hint: "cue/cue-track.wav · spoken count-in + section labels",
			fetch: fetchFromDisk("cue/cue-track.wav")
		} : null);
		/**
		* Click track is always available for a song with beats — synthesised
		* from `songMap.timeline.beats` if the user hasn't generated a disk file.
		*/
		let clickOpt = derived(() => {
			if (!songMap || songMap.timeline.beats.length === 0) return null;
			if (metadata?.hasClickTrack) return {
				key: "click",
				label: "Click track",
				hint: "cue/click-track.wav · clicks only",
				fetch: fetchFromDisk("cue/click-track.wav")
			};
			return {
				key: "click",
				label: "Click track",
				hint: "synthesised from beats",
				fetch: async () => {
					try {
						return (await renderCueTrackWavBlob(songMap, {
							includeSpeech: false,
							includeClicks: true
						})).blob;
					} catch {
						return null;
					}
				}
			};
		});
		let allOpts = derived(() => [
			...stemOpts(),
			...cueOpt() ? [cueOpt()] : [],
			...clickOpt() ? [clickOpt()] : []
		]);
		/** Checked set; reset to "all" each time the dialog opens. */
		let checked = {};
		let status = "idle";
		let statusMsg = "";
		let selectedCount = derived(() => allOpts().filter((o) => checked[o.key]).length);
		let canExport = derived(() => selectedCount() > 0 && projectPath !== null && songFolder !== null && status !== "mixing");
		function cancel() {
			if (status === "mixing") return;
			open = false;
		}
		async function runExport() {
			if (!projectPath || !songFolder) return;
			const picked = allOpts().filter((o) => checked[o.key]);
			if (picked.length === 0) return;
			status = "mixing";
			statusMsg = `Fetching ${picked.length} source${picked.length === 1 ? "" : "s"}…`;
			try {
				const sources = [];
				const failed = [];
				for (const opt of picked) {
					const blob = await opt.fetch();
					if (!blob) {
						failed.push(opt.label);
						continue;
					}
					sources.push({
						label: opt.label,
						blob
					});
				}
				if (sources.length === 0) {
					status = "error";
					statusMsg = `Could not fetch any source. ${failed.join("; ")}`;
					return;
				}
				statusMsg = "Mixing…";
				const blob = await mixBackingTrack(sources);
				const labelParts = picked.map((o) => o.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")).join("+");
				const filename = `${safeExportBasename(songTitle)}-${labelParts || "backing"}.wav`;
				downloadBlob(blob, filename);
				status = "done";
				statusMsg = failed.length > 0 ? `Downloaded ${filename}. ${failed.length} source(s) skipped.` : `Downloaded ${filename}`;
				open = false;
			} catch (e) {
				status = "error";
				statusMsg = e instanceof Error ? e.message : "Export failed";
			}
		}
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			Dialog($$renderer, {
				get open() {
					return open;
				},
				set open($$value) {
					open = $$value;
					$$settled = false;
				},
				children: ($$renderer) => {
					Dialog_content($$renderer, {
						class: "max-w-md",
						children: ($$renderer) => {
							Dialog_header($$renderer, {
								children: ($$renderer) => {
									Dialog_title($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Export backing track`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----> `);
									Dialog_description($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Mix selected audio for <span class="font-medium">${escape_html(songTitle)}</span> into a single WAV download.`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!---->`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> `);
							if (allOpts().length === 0) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<p class="text-muted-foreground py-4 text-sm">No audio assets available yet. Run the stem splitter or render a cue track in Edit, then try again.</p>`);
							} else {
								$$renderer.push("<!--[-1-->");
								$$renderer.push(`<ul class="mt-2 flex flex-col gap-1"><!--[-->`);
								const each_array = ensure_array_like(allOpts());
								for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
									let opt = each_array[$$index];
									$$renderer.push(`<li><label class="border-foreground/20 hover:border-foreground/50 flex cursor-pointer items-center gap-2 border-2 px-3 py-2 text-sm"><input type="checkbox" class="size-4"${attr("checked", checked[opt.key], true)}/> <span class="flex-1">${escape_html(opt.label)}</span> <span class="text-muted-foreground font-mono text-[11px]">${escape_html(opt.hint)}</span></label></li>`);
								}
								$$renderer.push(`<!--]--></ul> <p class="text-muted-foreground mt-1 text-xs">${escape_html(selectedCount())} selected · output is 44.1 kHz, peak-normalized.</p>`);
							}
							$$renderer.push(`<!--]--> `);
							if (statusMsg) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<p${attr_class(`text-xs ${stringify(status === "error" ? "text-destructive" : status === "done" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}`)} role="status">${escape_html(statusMsg)}</p>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Dialog_footer($$renderer, {
								class: "",
								children: ($$renderer) => {
									Button($$renderer, {
										class: "",
										variant: "outline",
										onclick: cancel,
										disabled: status === "mixing",
										children: ($$renderer) => {
											$$renderer.push(`<!---->Cancel`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----> `);
									Button($$renderer, {
										class: "",
										onclick: () => void runExport(),
										disabled: !canExport(),
										children: ($$renderer) => {
											$$renderer.push(`<!---->${escape_html(status === "mixing" ? "Mixing…" : `Download (${selectedCount()})`)}`);
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
				},
				$$slots: { default: true }
			});
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		bind_props($$props, { open });
	});
}
//#endregion
//#region src/lib/components/SetlistExportDialog.svelte
function SetlistExportDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* Pre-export preview for the project-level Ableton setlist .als.
		*
		* Minimal: one row per song, an OK/blocker badge, and a single
		* Export button. The click track always renders fresh during export
		* (no per-song toggle needed); cue tracks are deferred.
		*/
		let { open = false, preflight, status, message, onConfirm, onClose } = $$props;
		const generating = derived(() => status === "generating");
		const done = derived(() => status === "done");
		const error = derived(() => status === "error");
		const readyCount = derived(() => preflight ? preflight.songs.filter((s) => !s.blocker).length : 0);
		const totalCount = derived(() => preflight?.songs.length ?? 0);
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			Dialog($$renderer, {
				onOpenChange: (v) => {
					if (!v) onClose();
				},
				get open() {
					return open;
				},
				set open($$value) {
					open = $$value;
					$$settled = false;
				},
				children: ($$renderer) => {
					Dialog_content($$renderer, {
						class: "max-w-xl",
						children: ($$renderer) => {
							Dialog_header($$renderer, {
								children: ($$renderer) => {
									Dialog_title($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Export setlist .als`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----> `);
									Dialog_description($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->One Ableton Live 12 set with five stem rows and a click row, one scene per
        song. Click WAVs are re-rendered on every export to stay in sync with the
        current SongMap.`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!---->`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> `);
							if (preflight) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<div class="max-h-[50vh] overflow-y-auto border-foreground/20 border-2"><ul class="divide-y divide-foreground/10 text-xs font-mono"><!--[-->`);
								const each_array = ensure_array_like(preflight.songs);
								for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
									let song = each_array[$$index];
									$$renderer.push(`<li class="flex items-center gap-3 px-3 py-1.5"><span class="text-foreground/90 min-w-0 flex-1 truncate">${escape_html(song.title)}</span> <span class="text-muted-foreground shrink-0 text-[10px] tabular-nums">${escape_html(song.stemCount)}/5 stems</span> `);
									if (song.blocker) {
										$$renderer.push("<!--[0-->");
										$$renderer.push(`<span class="text-destructive shrink-0 text-[11px]"${attr("title", song.blocker)}>${escape_html(song.blocker)}</span>`);
									} else {
										$$renderer.push("<!--[-1-->");
										$$renderer.push(`<span class="text-emerald-600 dark:text-emerald-400 shrink-0 text-[11px]">Ready</span>`);
									}
									$$renderer.push(`<!--]--></li>`);
								}
								$$renderer.push(`<!--]--></ul></div> <p class="text-muted-foreground text-xs">${escape_html(readyCount())} of ${escape_html(totalCount())} song${escape_html(totalCount() === 1 ? "" : "s")} ready. `);
								if (!preflight.ok) {
									$$renderer.push("<!--[0-->");
									$$renderer.push(`Fix the blockers above before exporting.`);
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--></p>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							if (message) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<p${attr_class(`text-xs ${stringify(error() ? "text-destructive" : done() ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}`)} role="status">${escape_html(message)}</p>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> `);
							Dialog_footer($$renderer, {
								class: "",
								children: ($$renderer) => {
									Button($$renderer, {
										class: "",
										variant: "outline",
										disabled: generating(),
										onclick: onClose,
										children: ($$renderer) => {
											$$renderer.push(`<!---->${escape_html(done() ? "Close" : "Cancel")}`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----> `);
									if (!done()) {
										$$renderer.push("<!--[0-->");
										Button($$renderer, {
											class: "",
											disabled: !preflight?.ok || generating(),
											onclick: onConfirm,
											children: ($$renderer) => {
												$$renderer.push(`<!---->${escape_html(generating() ? "Generating…" : "Export .als")}`);
											},
											$$slots: { default: true }
										});
									} else $$renderer.push("<!--[-1-->");
									$$renderer.push(`<!--]-->`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!---->`);
						},
						$$slots: { default: true }
					});
				},
				$$slots: { default: true }
			});
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		bind_props($$props, { open });
	});
}
//#endregion
//#region src/lib/components/StemsDialog.svelte
function StemsDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		/**
		* "Stems" dialog: hosts the [`StemSplitter`](./StemSplitter.svelte) for the
		* currently loaded project song. Replaces the old expandable in-row panel
		* so it stops fighting drag-and-drop in the project list.
		*
		* Parent (`routes/project/+page.svelte`) loads the song into the editor
		* (`loadProjectSongIntoEditor`) before flipping `open` so `$songMap` is the
		* songMap for `entry.id` by the time we render the splitter.
		*
		* Audio path resolution: v2 songs store playable audio at
		* `<song>/<songMap.audio.originalPath>` (typically `audio/<filename>`).
		* The `.smap` itself no longer carries an audio chunk, so we must hand
		* the sidecar that file path — not the `.smap` path.
		*
		* Layout: the DialogHeader (with title + close button) stays fixed at the
		* top; the body scrolls inside a capped-height wrapper so the splitter's
		* progress + log can grow without spilling off the viewport.
		*/
		const DEMUCS_STEMS = [
			"vocals",
			"drums",
			"bass",
			"other"
		];
		let { open = false, entry } = $$props;
		/** Target song; null when the dialog is dormant. */
		/** True when the global songMap store holds the song we were asked to render. */
		const isThisSongActive = derived(() => !!entry && store_get($$store_subs ??= {}, "$projectStore", project).editingMode === "project-song" && store_get($$store_subs ??= {}, "$projectStore", project).activeSongId === entry.id);
		const projectOsPath = derived(() => store_get($$store_subs ??= {}, "$projectStore", project).osPath);
		const audioRel = derived(() => store_get($$store_subs ??= {}, "$songMap", songMap)?.audio?.originalPath ?? null);
		/**
		* Absolute OS path to the playable audio file. v2 layout: `audio/<filename>`
		* under the song folder. Null until the song is loaded AND the SongMap
		* actually records an `audio.originalPath` (legacy / web-only smaps don't).
		*/
		const inputPath = derived(() => isThisSongActive() && projectOsPath() && entry && audioRel() ? `${projectOsPath()}/${entry.folder}/${audioRel()}` : null);
		const outputDir = derived(() => projectOsPath() && entry ? `${projectOsPath()}/${entry.folder}/stems` : null);
		const inputLabel = derived(() => store_get($$store_subs ??= {}, "$songMap", songMap)?.audio?.fileName ?? audioRel() ?? null);
		const songTitle = derived(() => entry && store_get($$store_subs ??= {}, "$projectStore", project).metadataByFolder[entry.folder]?.title || entry?.folder || "song");
		/**
		* For each Demucs stem, the highest-quality preset slug it currently exists
		* at on disk (or null if missing). Walks `stemsByPreset` in priority order
		* so the first hit wins.
		*/
		const currentQualityByStem = derived(() => {
			const out = {};
			if (!entry) return out;
			const sets = store_get($$store_subs ??= {}, "$projectStore", project).metadataByFolder[entry.folder]?.stemsByPreset;
			if (!sets) return out;
			for (const slug of STEM_PRESET_PRIORITY) {
				const files = sets[slug];
				if (!files) continue;
				for (const filename of files) {
					const base = filename.toLowerCase().replace(/\.[^.]+$/, "");
					if (DEMUCS_STEMS.includes(base) && !out[base]) out[base] = slug;
				}
			}
			return out;
		});
		async function onJobDone() {
			await refreshProjectInfo();
		}
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			Dialog($$renderer, {
				get open() {
					return open;
				},
				set open($$value) {
					open = $$value;
					$$settled = false;
				},
				children: ($$renderer) => {
					Dialog_content($$renderer, {
						class: "max-w-xl max-h-[90vh] flex flex-col gap-0 overflow-hidden p-0",
						children: ($$renderer) => {
							Dialog_header($$renderer, {
								class: "border-foreground/20 shrink-0 border-b px-4 pt-4 pb-3",
								children: ($$renderer) => {
									Dialog_title($$renderer, {
										class: "pr-8 truncate",
										children: ($$renderer) => {
											$$renderer.push(`<!---->Stems — ${escape_html(songTitle())}`);
										},
										$$slots: { default: true }
									});
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4">`);
							if (!entry) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<p class="text-muted-foreground text-sm">No song selected.</p>`);
							} else if (!isThisSongActive()) {
								$$renderer.push("<!--[1-->");
								$$renderer.push(`<p class="text-muted-foreground text-sm">Loading song…</p>`);
							} else if (!projectOsPath() || !store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).reachable) {
								$$renderer.push("<!--[2-->");
								$$renderer.push(`<p class="text-amber-700 dark:text-amber-300 text-sm">Stems need the BarBro desktop client to be running. Start the desktop
          app to manage stems for this song.</p>`);
							} else if (!inputPath()) {
								$$renderer.push("<!--[3-->");
								$$renderer.push(`<p class="text-amber-700 dark:text-amber-300 text-sm">This song's <code class="font-mono">.smap</code> doesn't reference a playable
          audio file on disk yet. Open the song in Edit and use the relink banner
          to point it at the source, then try again.</p>`);
							} else {
								$$renderer.push("<!--[-1-->");
								StemSplitter($$renderer, {
									songId: entry.id,
									inputPath: inputPath(),
									outputDir: outputDir(),
									inputLabel: inputLabel(),
									currentQualityByStem: currentQualityByStem(),
									desktopReachable: store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).reachable,
									finalizeJob: onJobDone,
									chromeless: true
								});
							}
							$$renderer.push(`<!--]--></div>`);
						},
						$$slots: { default: true }
					});
				},
				$$slots: { default: true }
			});
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		if ($$store_subs) unsubscribe_stores($$store_subs);
		bind_props($$props, { open });
	});
}
//#endregion
//#region src/lib/components/ShareProjectDialog.svelte
function ShareProjectDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		/**
		* Project sharing dialog — the prominent "Share" entrypoint on the
		* project page header. Combines what was scattered before:
		*
		*   - Enable cloud sync (if not already enabled)
		*   - Members list with role pills
		*   - Invite form (email + role) with friendly "pending" feedback
		*   - Pending invites with revoke
		*   - Disable cloud sync (destructive footer)
		*
		* Pending invites bridge the "invitee hasn't signed up yet" gap: the
		* `POST /members` endpoint quietly creates a `cloud_pending_invites`
		* row when it can't find the email's auth user, and the
		* access-gate hook auto-promotes those rows to memberships on the
		* invitee's first sign-in.
		*/
		let { open = false } = $$props;
		const proj = derived(() => store_get($$store_subs ??= {}, "$project", project).data);
		const cloud = derived(() => proj()?.cloud ?? null);
		const userId = derived(() => store_get($$store_subs ??= {}, "$page", page).data?.user?.id ?? null);
		let busy = false;
		let errorMsg = "";
		let infoMsg = "";
		let confirmDisable = false;
		let members = [];
		let pending = [];
		let inviteEmail = "";
		let inviteRole = "editor";
		const isOwner = derived(() => {
			if (!cloud() || !userId()) return false;
			return members.some((m) => m.user_id === userId() && m.role === "owner");
		});
		async function refresh() {
			if (!cloud()) {
				members = [];
				pending = [];
				return;
			}
			const [m, p] = await Promise.all([getCloudProjectManifest(cloud().projectId), listPendingInvites(cloud().projectId)]);
			members = m?.members ?? [];
			pending = p;
		}
		async function onEnable() {
			busy = true;
			errorMsg = "";
			infoMsg = "";
			const r = await createCloudProject();
			busy = false;
			if (!r.ok) errorMsg = r.error;
			else refresh();
		}
		async function onDisable() {
			confirmDisable = false;
			busy = true;
			errorMsg = "";
			const r = await disableCloudProject({ deleteRemote: isOwner() });
			busy = false;
			if (!r.ok) errorMsg = r.error;
			else open = false;
		}
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			Dialog($$renderer, {
				get open() {
					return open;
				},
				set open($$value) {
					open = $$value;
					$$settled = false;
				},
				children: ($$renderer) => {
					Dialog_content($$renderer, {
						class: "max-w-lg",
						children: ($$renderer) => {
							Dialog_header($$renderer, {
								class: "",
								children: ($$renderer) => {
									Dialog_title($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Share project`);
										},
										$$slots: { default: true }
									});
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> `);
							if (!cloud()) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<p class="text-sm text-muted-foreground">Cloud sync isn't enabled for this project yet. Enable it to invite
        collaborators — the project syncs to Supabase so changes show up on
        their machine.</p> `);
								Dialog_footer($$renderer, {
									class: "",
									children: ($$renderer) => {
										Button($$renderer, {
											class: "",
											variant: "outline",
											onclick: () => open = false,
											children: ($$renderer) => {
												$$renderer.push(`<!---->Cancel`);
											},
											$$slots: { default: true }
										});
										$$renderer.push(`<!----> `);
										Button($$renderer, {
											class: "gap-2",
											onclick: () => void onEnable(),
											disabled: busy,
											children: ($$renderer) => {
												Cloud($$renderer, {
													class: "size-4",
													"aria-hidden": "true"
												});
												$$renderer.push(`<!----> ${escape_html(busy ? "Enabling…" : "Enable cloud sync")}`);
											},
											$$slots: { default: true }
										});
										$$renderer.push(`<!---->`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!---->`);
							} else {
								$$renderer.push("<!--[-1-->");
								$$renderer.push(`<div class="space-y-4"><div class="space-y-2"><h3 class="text-muted-foreground text-xs font-bold uppercase tracking-wider">Members (${escape_html(members.length)})</h3> <ul class="border-foreground/20 divide-foreground/10 divide-y border text-xs"><!--[-->`);
								const each_array = ensure_array_like(members);
								for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
									let m = each_array[$$index];
									$$renderer.push(`<li class="flex items-center justify-between gap-3 px-2 py-1.5"><span class="truncate font-mono">${escape_html(m.user_id === userId() ? "you" : `${m.user_id.slice(0, 8)}…`)}</span> <span class="text-muted-foreground text-[10px] uppercase">${escape_html(m.role)}</span></li>`);
								}
								$$renderer.push(`<!--]--></ul></div> `);
								if (isOwner()) {
									$$renderer.push("<!--[0-->");
									$$renderer.push(`<form class="space-y-2"><h3 class="text-muted-foreground text-xs font-bold uppercase tracking-wider">Invite by email</h3> <div class="flex flex-wrap items-end gap-2"><input type="email"${attr("value", inviteEmail)} placeholder="collaborator@example.com" class="border-foreground/30 bg-background min-w-0 flex-1 border-2 px-2 py-1 text-sm focus:border-foreground focus:outline-none"/> `);
									$$renderer.select({
										value: inviteRole,
										class: "border-foreground/30 bg-background border-2 px-2 py-1 text-sm focus:border-foreground focus:outline-none"
									}, ($$renderer) => {
										$$renderer.option({ value: "editor" }, ($$renderer) => {
											$$renderer.push(`editor`);
										});
										$$renderer.option({ value: "owner" }, ($$renderer) => {
											$$renderer.push(`owner`);
										});
									});
									$$renderer.push(` `);
									Button($$renderer, {
										type: "submit",
										size: "sm",
										class: "h-9 gap-1",
										disabled: busy || !inviteEmail.trim(),
										children: ($$renderer) => {
											User_plus($$renderer, {
												class: "size-3.5",
												"aria-hidden": "true"
											});
											$$renderer.push(`<!----> Invite`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----></div> <p class="text-muted-foreground text-[11px]">If they don't have an account yet, the invite waits and shows up when they first sign in.</p></form>`);
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--> `);
								if (isOwner() && pending.length > 0) {
									$$renderer.push("<!--[0-->");
									$$renderer.push(`<div class="space-y-2"><h3 class="text-muted-foreground text-xs font-bold uppercase tracking-wider">Pending invites (${escape_html(pending.length)})</h3> <ul class="border-foreground/20 divide-foreground/10 divide-y border text-xs"><!--[-->`);
									const each_array_1 = ensure_array_like(pending);
									for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
										let inv = each_array_1[$$index_1];
										$$renderer.push(`<li class="flex items-center justify-between gap-3 px-2 py-1.5"><span class="truncate">${escape_html(inv.invited_email)}</span> <span class="text-muted-foreground text-[10px] uppercase">${escape_html(inv.role)}</span> <button type="button" class="text-muted-foreground hover:text-destructive" title="Revoke invite"${attr("disabled", busy, true)} aria-label="Revoke invite">`);
										X($$renderer, {
											class: "size-3.5",
											"aria-hidden": "true"
										});
										$$renderer.push(`<!----></button></li>`);
									}
									$$renderer.push(`<!--]--></ul></div>`);
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--></div> `);
								if (errorMsg) {
									$$renderer.push("<!--[0-->");
									$$renderer.push(`<p class="text-destructive text-xs" role="status">${escape_html(errorMsg)}</p>`);
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--> `);
								if (infoMsg) {
									$$renderer.push("<!--[0-->");
									$$renderer.push(`<p class="text-emerald-600 dark:text-emerald-400 text-xs" role="status">${escape_html(infoMsg)}</p>`);
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--> `);
								Dialog_footer($$renderer, {
									class: "flex-wrap gap-2",
									children: ($$renderer) => {
										Button($$renderer, {
											variant: "outline",
											class: "text-destructive hover:text-destructive mr-auto gap-1",
											onclick: () => confirmDisable = true,
											disabled: busy,
											children: ($$renderer) => {
												Trash_2($$renderer, {
													class: "size-3.5",
													"aria-hidden": "true"
												});
												$$renderer.push(`<!----> Disable cloud sync`);
											},
											$$slots: { default: true }
										});
										$$renderer.push(`<!----> `);
										Button($$renderer, {
											class: "",
											variant: "outline",
											onclick: () => open = false,
											children: ($$renderer) => {
												$$renderer.push(`<!---->Close`);
											},
											$$slots: { default: true }
										});
										$$renderer.push(`<!---->`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!---->`);
							}
							$$renderer.push(`<!--]-->`);
						},
						$$slots: { default: true }
					});
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----> `);
			Dialog($$renderer, {
				get open() {
					return confirmDisable;
				},
				set open($$value) {
					confirmDisable = $$value;
					$$settled = false;
				},
				children: ($$renderer) => {
					Dialog_content($$renderer, {
						class: "max-w-md",
						children: ($$renderer) => {
							Dialog_header($$renderer, {
								class: "",
								children: ($$renderer) => {
									Dialog_title($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Disable collaboration?`);
										},
										$$slots: { default: true }
									});
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> `);
							if (isOwner()) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<p class="text-sm">You're the owner. Disabling deletes the cloud project for everyone —
        members lose access, sync history is gone. Local files on disk are untouched.</p>`);
							} else {
								$$renderer.push("<!--[-1-->");
								$$renderer.push(`<p class="text-sm">Removes this project's cloud link on your machine. The cloud project
        stays — other members keep using it. Local files on disk are untouched.</p>`);
							}
							$$renderer.push(`<!--]--> `);
							Dialog_footer($$renderer, {
								class: "",
								children: ($$renderer) => {
									Button($$renderer, {
										class: "",
										variant: "outline",
										onclick: () => confirmDisable = false,
										children: ($$renderer) => {
											$$renderer.push(`<!---->Cancel`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----> `);
									Button($$renderer, {
										class: "text-destructive",
										variant: "outline",
										onclick: () => void onDisable(),
										children: ($$renderer) => {
											$$renderer.push(`<!---->Disable`);
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
		bind_props($$props, { open });
	});
}
//#endregion
//#region src/lib/components/NewSongDialog.svelte
function NewSongDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* "Add song" dialog — owns the title input + the two-way branch:
		*
		*   1. **Add empty** — commits a title-only stub `.smap` into the active
		*      project and stays here. Audio + analysis happen later when the
		*      user opens the song in the editor.
		*   2. **Open in editor** — primes the editor's SongMap with the title
		*      then navigates to `/?project=1`, which auto-restores the title
		*      from the store and runs the normal upload + analyze flow.
		*
		* Both paths use the same title field, so the user only types it once.
		*/
		let { open = false, onCreated } = $$props;
		/** Fires after a successful "Add empty" commit. */
		let title = "";
		let busy = false;
		let error = "";
		function cancel() {
			open = false;
		}
		async function addEmpty() {
			title.trim();
			error = "Give the song a title first.";
		}
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			Dialog($$renderer, {
				get open() {
					return open;
				},
				set open($$value) {
					open = $$value;
					$$settled = false;
				},
				children: ($$renderer) => {
					Dialog_content($$renderer, {
						class: "max-w-md",
						children: ($$renderer) => {
							Dialog_header($$renderer, {
								class: "",
								children: ($$renderer) => {
									Dialog_title($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Add song`);
										},
										$$slots: { default: true }
									});
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> <form class="flex flex-col gap-4"><label class="flex flex-col gap-1.5 text-xs"><span class="text-muted-foreground uppercase tracking-wider">Title</span> <input type="text"${attr("value", title)} placeholder="Untitled" class="border-foreground/30 bg-background w-full border-2 px-3 py-2 text-sm focus:border-foreground focus:outline-none"/></label> `);
							if (error) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<p class="text-destructive text-xs" role="status">${escape_html(error)}</p>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> <div class="space-y-2"><p class="text-muted-foreground text-[11px]">Open in editor to upload audio and analyze right away, or add an
          empty placeholder and fill it in later.</p> <div class="flex flex-wrap justify-end gap-2">`);
							Button($$renderer, {
								type: "button",
								class: "",
								variant: "outline",
								onclick: cancel,
								disabled: busy,
								children: ($$renderer) => {
									$$renderer.push(`<!---->Cancel`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> `);
							Button($$renderer, {
								type: "button",
								class: "",
								variant: "outline",
								onclick: () => void addEmpty(),
								disabled: !title.trim(),
								children: ($$renderer) => {
									$$renderer.push(`<!---->${escape_html("Add empty")}`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> `);
							Button($$renderer, {
								class: "",
								type: "submit",
								disabled: !title.trim(),
								children: ($$renderer) => {
									$$renderer.push(`<!---->Open in editor`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----></div></div></form>`);
						},
						$$slots: { default: true }
					});
				},
				$$slots: { default: true }
			});
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		bind_props($$props, { open });
	});
}
//#endregion
//#region src/lib/components/RenameSongDialog.svelte
function RenameSongDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* Rename a song in the active project. Edits `metadata.title` inside the
		* song's `.smap` via `renameSongInProject`. The folder slug stays as-is
		* so stem refs / cloud links / audio paths don't break.
		*/
		let { open = false, songId, currentTitle } = $$props;
		let title = "";
		let busy = false;
		function cancel() {
			open = false;
		}
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			Dialog($$renderer, {
				get open() {
					return open;
				},
				set open($$value) {
					open = $$value;
					$$settled = false;
				},
				children: ($$renderer) => {
					Dialog_content($$renderer, {
						class: "max-w-md",
						children: ($$renderer) => {
							Dialog_header($$renderer, {
								class: "",
								children: ($$renderer) => {
									Dialog_title($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Rename song`);
										},
										$$slots: { default: true }
									});
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> <form class="flex flex-col gap-4"><label class="flex flex-col gap-1.5 text-xs"><span class="text-muted-foreground uppercase tracking-wider">Title</span> <input type="text"${attr("value", title)} placeholder="Untitled" class="border-foreground/30 bg-background w-full border-2 px-3 py-2 text-sm focus:border-foreground focus:outline-none"/></label> `);
							$$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> <div class="flex justify-end gap-2">`);
							Button($$renderer, {
								type: "button",
								class: "",
								variant: "outline",
								onclick: cancel,
								disabled: busy,
								children: ($$renderer) => {
									$$renderer.push(`<!---->Cancel`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> `);
							Button($$renderer, {
								class: "",
								type: "submit",
								disabled: !title.trim(),
								children: ($$renderer) => {
									$$renderer.push(`<!---->${escape_html("Save")}`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----></div></form>`);
						},
						$$slots: { default: true }
					});
				},
				$$slots: { default: true }
			});
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		bind_props($$props, { open });
	});
}
//#endregion
//#region src/lib/components/JoinCloudProjectDialog.svelte
function JoinCloudProjectDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* Join a cloud project on this machine. Opens with a preselected
		* cloud project meta (passed as `cloudProject`); the user picks a
		* parent folder on disk and clicks Join. The dialog handles the
		* download + materialize flow via `joinCloudProject`, then navigates
		* to `/project`.
		*
		* Identical UX rhythm to `NewProjectDialog`: dialog opens first, native
		* picker is triggered from a button inside, errors land inline.
		*/
		let { open = false, cloudProject, onJoined } = $$props;
		/** The target. Required when open=true; ignored otherwise. */
		let parentPath = null;
		let busy = false;
		let error = "";
		async function pickFolder() {
			error = "";
			const pick = await pickFolderViaDesktop({ title: "Pick the folder that will contain the joined project" });
			if (!pick.ok) {
				if ("cancelled" in pick) return;
				error = pick.error ?? "Could not open picker";
				return;
			}
			parentPath = pick.path;
		}
		async function join() {
			error = "";
			if (!cloudProject) {
				error = "No project selected.";
				return;
			}
			if (!parentPath) {
				error = "Choose a folder first.";
				return;
			}
			busy = true;
			try {
				const r = await joinCloudProject(cloudProject.id, parentPath);
				if (!r.ok) {
					error = r.error;
					return;
				}
				open = false;
				onJoined?.();
				await goto("/project");
			} catch (e) {
				error = e instanceof Error ? e.message : "Join failed";
			} finally {
				busy = false;
			}
		}
		function cancel() {
			if (busy) return;
			open = false;
		}
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			Dialog($$renderer, {
				get open() {
					return open;
				},
				set open($$value) {
					open = $$value;
					$$settled = false;
				},
				children: ($$renderer) => {
					Dialog_content($$renderer, {
						class: "max-w-md",
						children: ($$renderer) => {
							Dialog_header($$renderer, {
								class: "",
								children: ($$renderer) => {
									Dialog_title($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Join shared project`);
										},
										$$slots: { default: true }
									});
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> <div class="space-y-4">`);
							if (cloudProject) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<div class="border-foreground/20 border-2 px-3 py-2"><p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Project</p> <p class="truncate font-mono text-sm">${escape_html(cloudProject.name)}</p> <p class="text-muted-foreground font-mono text-[11px]">rev ${escape_html(cloudProject.revision)}</p></div>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> <div class="flex flex-col gap-1.5 text-xs"><span class="text-muted-foreground uppercase tracking-wider">Folder</span> <div class="flex items-center gap-2">`);
							Button($$renderer, {
								type: "button",
								class: "",
								variant: "outline",
								size: "sm",
								onclick: () => void pickFolder(),
								disabled: busy,
								children: ($$renderer) => {
									$$renderer.push(`<!---->${escape_html(parentPath ? "Change…" : "Choose folder…")}`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> `);
							if (parentPath) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<span class="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11px]"${attr("title", parentPath)}>${escape_html(parentPath)}</span>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--></div> `);
							if (parentPath) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<span class="text-muted-foreground text-[11px]">A subfolder will be created here. Audio files don't sync — you'll see "missing audio"
            for each song until you relink or import an audio pack.</span>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--></div> `);
							if (error) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<p class="text-destructive text-xs" role="status">${escape_html(error)}</p>`);
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--> <div class="flex justify-end gap-2">`);
							Button($$renderer, {
								type: "button",
								class: "",
								variant: "outline",
								onclick: cancel,
								disabled: busy,
								children: ($$renderer) => {
									$$renderer.push(`<!---->Cancel`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> `);
							Button($$renderer, {
								class: "",
								type: "button",
								onclick: () => void join(),
								disabled: busy || !parentPath || !cloudProject,
								children: ($$renderer) => {
									$$renderer.push(`<!---->${escape_html(busy ? "Joining…" : "Join")}`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----></div></div>`);
						},
						$$slots: { default: true }
					});
				},
				$$slots: { default: true }
			});
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		bind_props($$props, { open });
	});
}
//#endregion
//#region src/lib/export/setlist/timings.ts
/**
* Compute timings for one song.
*
* Now a thin projection of `songPlaybackPlan(sm)` — same numbers,
* Ableton-shaped subset. Kept as `songTimings(sm)` so the orchestrator,
* clipPlayRange helpers, and existing tests stay untouched while the
* editor's live playback layer migrates onto the same plan.
*
* Throws on missing/invalid trim (matching old behaviour). The plan
* itself returns null in that case; Ableton callers want the throw.
*/
function songTimings(sm) {
	const plan = songPlaybackPlan(sm);
	if (!plan) throw new Error("Song has no valid audio.trim");
	return {
		bpm: plan.bpm,
		trimStartSec: plan.trimStartSec,
		trimEndSec: plan.trimEndSec,
		songDurationSec: plan.songDurationSec,
		firstBeatSongTimeSec: plan.firstBeatSongTimeSec,
		firstDownbeatOriginalSec: plan.firstDownbeatOriginalSec,
		beatDurationSec: plan.beatDurationSec,
		countInBeats: plan.countInBeats,
		countInDurationSec: plan.countInDurationSec
	};
}
/**
* Play range for a stem clip.
*
*   playStart = max(0, firstDownbeatOriginalSec − countInDurationSec)
*   playEnd   = min(trimEndSec, stemDurationSec)
*
* When there's no count-in (`countInDurationSec === 0`), the stem starts
* at the first downbeat — preserving lockstep with the click. When there
* IS a count-in, the stem rewinds by `countInDurationSec`, playing whatever
* lead-in audio is there (silence, drum riff, pickup) while the click ticks
* the count.
*
* The clamp at 0 protects songs whose audio starts at or near the downbeat
* (insufficient lead-in for the requested count-in); they'll get a partial
* count-in head with stems starting at sample 0.
*/
function stemPlayRange(t, stemDurationSec) {
	const idealStart = t.firstDownbeatOriginalSec - t.countInDurationSec;
	const playStartSec = Math.max(0, Math.min(stemDurationSec, idealStart));
	return {
		playStartSec,
		playEndSec: Math.max(playStartSec, Math.min(t.trimEndSec, stemDurationSec))
	};
}
/**
* Play range for the click clip given the click WAV's actual layout.
*
* Inputs:
*   - `clickWavDurationSec` — total duration of the click WAV on disk.
*   - `clickWavPreludeOffsetSec` — `preludeSec + prependSec` from the render;
*     marks where `trim.startSec` lands inside the WAV. (Read this from
*     the SongMap's `clickTrackExport.preludeOffsetSec`.)
*
* Maths:
*   - `clickWavFirstDownbeatSec = preludeOffsetSec + (firstDownbeat − trimStart)`
*     is where bar 1 beat 1 lives on the click WAV.
*   - Subtract `countInDurationSec` to land on the first count-in click;
*     that's our playStart inside the WAV.
*   - Play to the end of the WAV (covers count-in + the entire song's clicks).
*/
function clickPlayRange(t, clickWavDurationSec, clickWavPreludeOffsetSec) {
	const idealStart = clickWavPreludeOffsetSec + (t.firstDownbeatOriginalSec - t.trimStartSec) - t.countInDurationSec;
	return {
		playStartSec: Math.max(0, Math.min(clickWavDurationSec, idealStart)),
		playEndSec: clickWavDurationSec
	};
}
//#endregion
//#region src/lib/export/setlist/clickRender.ts
/**
* Setlist click WAV rendering.
*
* Single render path shared between the in-app mixer and the Ableton
* setlist export: clicks only, no speech, count-in head + song-aligned
* clicks. Lives at `cue/click-track.wav` (one file, one source of truth).
* The mixer reads it from disk; the Ableton orchestrator (re-)renders it
* before assembling the .als so the export is always fresh.
*
* `preludeOffsetSec` (= the position of `trim.startSec` inside the WAV)
* is returned to callers so they can compute clip play ranges via
* `clickPlayRange` in `timings.ts`.
*/
/** Relative path under a song folder for the click WAV. */
var CLICK_TRACK_SUBPATH = "cue/click-track.wav";
async function renderClickTrackBlob(sm) {
	const result = await renderCueTrackWavBlob(sm, {
		includeClicks: true,
		includeSpeech: false
	});
	return {
		blob: result.blob,
		preludeOffsetSec: result.preludeOffsetSec
	};
}
//#endregion
//#region src/lib/export/setlist/orchestrator.ts
/**
* Project setlist .als export orchestrator.
*
* Pipeline:
*   1. For each exportable song: load song.smap → compute timings →
*      resolve stem paths → render the song-aligned click WAV.
*   2. Batch-query the sidecar for WAV durations/sizes/sample-rates.
*   3. Build `ProjectSongExportInput` per song using the resolved play
*      ranges (delegated to `timings.ts`).
*   4. Mark the project root as an Ableton Project folder.
*   5. Generate the .als XML, gzip, write at project root.
*
* Cue tracks are NOT included in V1. The architecture leaves room for
* them: every song's `SongTimings` already has a `preRollSec` field,
* which will gate the future cue track's leading speech window when
* we add it.
*/
/**
* Build + gzip + write the project setlist .als. Always re-renders the
* setlist click WAV for every song (sub-second cost; eliminates a whole
* class of staleness bugs).
*/
async function exportProjectSetAls(args) {
	const { projectPath, project, metadataByFolder, filename } = args;
	const exportable = getExportableSongs(project);
	if (exportable.length === 0) return {
		ok: false,
		error: "No songs to export (project has none, or all are hidden)."
	};
	const planned = [];
	const wavRequests = [];
	for (const entry of exportable) {
		const meta = metadataByFolder[entry.folder];
		if (!meta) return {
			ok: false,
			error: `Missing metadata for "${entry.folder}". Refresh the project.`
		};
		const sm = await loadSongMap(projectPath, entry, meta.title);
		if ("error" in sm) return {
			ok: false,
			error: sm.error
		};
		const timings = (() => {
			try {
				return songTimings(sm.songMap);
			} catch (e) {
				return { error: `Could not compute timings for "${meta.title}": ${msg(e)}` };
			}
		})();
		if ("error" in timings) return {
			ok: false,
			error: timings.error
		};
		const stemSubpaths = resolveStemSubpaths(meta);
		if (stemSubpaths.size === 0) return {
			ok: false,
			error: `"${meta.title}" has no stems on disk. Split stems first.`
		};
		for (const [trackName, sub] of stemSubpaths) {
			if (!sub.toLowerCase().endsWith(".mp3")) continue;
			const wavSub = sub.replace(/\.mp3$/i, ".wav");
			const tres = await transcodeProjectAudioToWav(projectPath, entry.folder, sub, wavSub);
			if (!tres.ok) return {
				ok: false,
				error: `Could not transcode ${sub} for "${meta.title}": ${tres.error}`
			};
			stemSubpaths.set(trackName, wavSub);
		}
		for (const sub of stemSubpaths.values()) wavRequests.push({
			songFolder: entry.folder,
			subpath: sub
		});
		const clickRes = await renderAndWriteClick(projectPath, entry.folder, sm.songMap, meta.title);
		if ("error" in clickRes) return {
			ok: false,
			error: clickRes.error
		};
		wavRequests.push({
			songFolder: entry.folder,
			subpath: CLICK_TRACK_SUBPATH
		});
		planned.push({
			entry,
			meta,
			sm: sm.songMap,
			timings,
			stemSubpaths,
			clickPreludeOffsetSec: clickRes.preludeOffsetSec
		});
	}
	const batchRes = await getProjectWavInfoBatch(projectPath, wavRequests);
	if (!batchRes.ok) return {
		ok: false,
		error: batchRes.error
	};
	const infoByKey = /* @__PURE__ */ new Map();
	for (const item of batchRes.items) infoByKey.set(`${item.songFolder}::${item.subpath}`, item);
	const lookup = (songFolder, subpath) => infoByKey.get(`${songFolder}::${subpath}`);
	const songs = [];
	for (const p of planned) {
		const mixByKey = new Map((p.sm.mixState?.tracks ?? []).map((t) => [t.key, t]));
		const stems = /* @__PURE__ */ new Map();
		for (const [trackName, sub] of p.stemSubpaths) {
			const info = lookup(p.entry.folder, sub);
			if (!info || "error" in info) return {
				ok: false,
				error: `Missing WAV info for ${p.entry.folder}/${sub}: ${info && "error" in info ? info.error : "not found"}`
			};
			const range = stemPlayRange(p.timings, info.durationSec);
			const mix = mixByKey.get(`stem:${basename(sub)}`);
			stems.set(trackName, {
				fileName: basename(sub),
				relativePath: `${p.entry.folder}/${sub}`,
				absolutePath: `${projectPath}/${p.entry.folder}/${sub}`,
				durationSec: info.durationSec,
				sampleRate: info.sampleRate,
				fileSize: info.fileSize,
				playStartSec: range.playStartSec,
				playEndSec: range.playEndSec,
				volume: mix?.volume,
				muted: mix?.muted
			});
		}
		const clickInfo = lookup(p.entry.folder, CLICK_TRACK_SUBPATH);
		if (!clickInfo || "error" in clickInfo) return {
			ok: false,
			error: `Missing WAV info for ${p.entry.folder}/${CLICK_TRACK_SUBPATH}`
		};
		const clickRange = clickPlayRange(p.timings, clickInfo.durationSec, p.clickPreludeOffsetSec);
		const clickMix = mixByKey.get("click");
		const click = {
			fileName: basename(CLICK_TRACK_SUBPATH),
			relativePath: `${p.entry.folder}/${CLICK_TRACK_SUBPATH}`,
			absolutePath: `${projectPath}/${p.entry.folder}/${CLICK_TRACK_SUBPATH}`,
			durationSec: clickInfo.durationSec,
			sampleRate: clickInfo.sampleRate,
			fileSize: clickInfo.fileSize,
			playStartSec: clickRange.playStartSec,
			playEndSec: clickRange.playEndSec,
			volume: clickMix?.volume,
			muted: clickMix?.muted
		};
		songs.push({
			title: p.meta.title,
			bpm: p.timings.bpm,
			stems,
			click
		});
	}
	const markerRes = await writeProjectAsset(projectPath, "Ableton Project Info/.barbro-marker", new TextEncoder().encode("BarBro Ableton project marker\n"));
	if (!markerRes.ok) return {
		ok: false,
		error: `Could not create Ableton Project Info marker: ${markerRes.error}`
	};
	const xml = generateAbletonProjectSetXml({
		projectTitle: project.name,
		songs
	});
	const blob = await gzipString(xml);
	const buf = new Uint8Array(await blob.arrayBuffer());
	const writeRes = await writeProjectAsset(projectPath, filename, buf);
	if (!writeRes.ok) return {
		ok: false,
		error: writeRes.error
	};
	return {
		ok: true,
		subpath: filename,
		xmlBytes: xml.length,
		alsBytes: buf.byteLength
	};
}
async function loadSongMap(projectPath, entry, title) {
	const res = await readProjectSong(projectPath, entry.folder);
	if (!res.ok) return { error: `Could not read song.smap for "${title}": ${res.error}` };
	try {
		return { songMap: (await readSmapJsonOnly(new Blob([new Uint8Array(res.bytes).buffer]))).songMap };
	} catch (e) {
		return { error: `Could not parse song.smap for "${title}": ${msg(e)}` };
	}
}
async function renderAndWriteClick(projectPath, songFolder, sm, title) {
	let blob;
	let preludeOffsetSec;
	try {
		const result = await renderClickTrackBlob(sm);
		blob = result.blob;
		preludeOffsetSec = result.preludeOffsetSec;
	} catch (e) {
		return { error: `Could not render click track for "${title}": ${msg(e)}` };
	}
	const writeRes = await writeProjectSongAsset(projectPath, songFolder, CLICK_TRACK_SUBPATH, new Uint8Array(await blob.arrayBuffer()));
	if (!writeRes.ok) return { error: `Could not write click track for "${title}": ${writeRes.error}` };
	return {
		ok: true,
		preludeOffsetSec
	};
}
/** Map a song's stemRefs (or scanned stem files) into track-name → subpath. */
function resolveStemSubpaths(meta) {
	const out = /* @__PURE__ */ new Map();
	const stemRefs = meta.stemRefs ?? {};
	for (const track of STEM_TRACKS) {
		const sub = stemRefs[track.name];
		if (sub) out.set(track.name, sub);
	}
	if (out.size > 0) return out;
	const best = selectBestStemSet(meta);
	if (!best) return out;
	for (const fname of best.files) {
		const slot = stemNameFromFilename(fname);
		if (!slot || out.has(slot)) continue;
		out.set(slot, `${best.pathPrefix}${fname}`);
	}
	return out;
}
function stemNameFromFilename(filename) {
	return {
		drums: "Drums",
		bass: "Bass",
		vocals: "Vocals",
		guitar: "Guitar",
		other: "Guitar",
		fx: "FX"
	}[filename.replace(/\.[^.]+$/, "").toLowerCase()] ?? null;
}
function basename(p) {
	const ix = p.lastIndexOf("/");
	return ix === -1 ? p : p.slice(ix + 1);
}
function msg(e) {
	return e instanceof Error ? e.message : String(e);
}
//#endregion
//#region node_modules/svelte-dnd-action/dist/index.mjs
function _defineProperty(obj, key, value) {
	if (key in obj) Object.defineProperty(obj, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true
	});
	else obj[key] = value;
	return obj;
}
var printDebug = function printDebug() {};
/**
* Resets the cache that allows for smarter "would be index" resolution. Should be called after every drag operation
*/
function resetIndexesCache() {
	printDebug(function() {
		return "resetting indexes cache";
	});
}
resetIndexesCache();
_defineProperty({}, Object.freeze({ USE_COMPUTED_STYLE_INSTEAD_OF_BOUNDING_RECT: "USE_COMPUTED_STYLE_INSTEAD_OF_BOUNDING_RECT" }).USE_COMPUTED_STYLE_INSTEAD_OF_BOUNDING_RECT, false);
var _ID_TO_INSTRUCTION;
var INSTRUCTION_IDs$1 = {
	DND_ZONE_ACTIVE: "dnd-zone-active",
	DND_ZONE_DRAG_DISABLED: "dnd-zone-drag-disabled"
};
_ID_TO_INSTRUCTION = {}, _defineProperty(_ID_TO_INSTRUCTION, INSTRUCTION_IDs$1.DND_ZONE_ACTIVE, "Tab to one the items and press space-bar or enter to start dragging it"), _defineProperty(_ID_TO_INSTRUCTION, INSTRUCTION_IDs$1.DND_ZONE_DRAG_DISABLED, "This is a disabled drag and drop list");
function createStore(initialValue) {
	var _val = initialValue;
	var subs = /* @__PURE__ */ new Set();
	return {
		get: function get() {
			return _val;
		},
		set: function set(newVal) {
			_val = newVal;
			Array.from(subs).forEach(function(cb) {
				return cb(_val);
			});
		},
		subscribe: function subscribe(cb) {
			subs.add(cb);
			cb(_val);
		},
		unsubscribe: function unsubscribe(cb) {
			subs["delete"](cb);
		}
	};
}
createStore(true);
createStore(false);
//#endregion
//#region src/routes/project/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let newProjectDialogOpen = false;
		let joinDialogOpen = false;
		let joinTarget = null;
		let shareDialogOpen = false;
		function refreshRecents() {}
		let removeDialogOpen = false;
		let removeTarget = null;
		let exportDialogOpen = false;
		let exportTarget = null;
		let stemsDialogOpen = false;
		let stemsTarget = null;
		/** Setlist .als export state. */
		let setlistExportStatus = "idle";
		let setlistExportMsg = "";
		let setlistPreflight = null;
		let setlistExportOpen = false;
		async function runSetlistExport() {
			const proj = store_get($$store_subs ??= {}, "$project", project).data;
			const osPath = store_get($$store_subs ??= {}, "$project", project).osPath;
			if (!proj || !osPath) {
				setlistExportStatus = "error";
				setlistExportMsg = "Project path unavailable.";
				return;
			}
			setlistExportStatus = "generating";
			setlistExportMsg = "Building setlist .als…";
			const filename = `${safeExportBasename(proj.name)}.als`;
			const res = await exportProjectSetAls({
				projectPath: osPath,
				project: proj,
				metadataByFolder: store_get($$store_subs ??= {}, "$project", project).metadataByFolder,
				filename
			});
			if (res.ok) {
				setlistExportStatus = "done";
				setlistExportMsg = `Wrote ${filename} (${(res.alsBytes / 1024).toFixed(1)} KB) to the project folder.`;
			} else {
				setlistExportStatus = "error";
				setlistExportMsg = res.error;
			}
		}
		function closeSetlistExport() {
			if (setlistExportStatus === "generating") return;
			setlistExportOpen = false;
		}
		async function onRemoveConfirmed(deleteFiles) {
			if (!removeTarget) return;
			const id = removeTarget.id;
			removeTarget = null;
			try {
				const r = await removeSongFromProject(id, { deleteFiles });
				if (deleteFiles && !r.filesRemoved);
			} catch (e) {
				e instanceof Error && e.message;
			}
		}
		let newSongDialogOpen = false;
		let renameSongDialogOpen = false;
		let renameSongTarget = null;
		async function onSongAdded() {
			await refreshProjectInfo().catch(() => {});
		}
		derived(() => store_get($$store_subs ??= {}, "$project", project).data?.songs ?? []);
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			$$renderer.push(`<main class="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-12 sm:px-6">`);
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<p class="text-muted-foreground text-sm">Restoring project…</p>`);
			$$renderer.push(`<!--]--></main> `);
			RemoveSongDialog($$renderer, {
				songTitle: removeTarget?.title ?? "",
				onConfirm: onRemoveConfirmed,
				get open() {
					return removeDialogOpen;
				},
				set open($$value) {
					removeDialogOpen = $$value;
					$$settled = false;
				}
			});
			$$renderer.push(`<!----> `);
			ExportBackingTrackDialog($$renderer, {
				projectPath: store_get($$store_subs ??= {}, "$project", project).osPath,
				songFolder: exportTarget?.folder ?? null,
				songTitle: exportTarget?.title ?? "",
				metadata: void 0,
				songMap: store_get($$store_subs ??= {}, "$songMap", songMap),
				get open() {
					return exportDialogOpen;
				},
				set open($$value) {
					exportDialogOpen = $$value;
					$$settled = false;
				}
			});
			$$renderer.push(`<!----> `);
			StemsDialog($$renderer, {
				entry: stemsTarget,
				get open() {
					return stemsDialogOpen;
				},
				set open($$value) {
					stemsDialogOpen = $$value;
					$$settled = false;
				}
			});
			$$renderer.push(`<!----> `);
			NewProjectDialog($$renderer, {
				onCreated: refreshRecents,
				get open() {
					return newProjectDialogOpen;
				},
				set open($$value) {
					newProjectDialogOpen = $$value;
					$$settled = false;
				}
			});
			$$renderer.push(`<!----> `);
			NewSongDialog($$renderer, {
				onCreated: onSongAdded,
				get open() {
					return newSongDialogOpen;
				},
				set open($$value) {
					newSongDialogOpen = $$value;
					$$settled = false;
				}
			});
			$$renderer.push(`<!----> `);
			RenameSongDialog($$renderer, {
				songId: renameSongTarget?.id ?? null,
				currentTitle: renameSongTarget?.title ?? "",
				get open() {
					return renameSongDialogOpen;
				},
				set open($$value) {
					renameSongDialogOpen = $$value;
					$$settled = false;
				}
			});
			$$renderer.push(`<!----> `);
			JoinCloudProjectDialog($$renderer, {
				cloudProject: joinTarget,
				onJoined: refreshRecents,
				get open() {
					return joinDialogOpen;
				},
				set open($$value) {
					joinDialogOpen = $$value;
					$$settled = false;
				}
			});
			$$renderer.push(`<!----> `);
			ShareProjectDialog($$renderer, {
				get open() {
					return shareDialogOpen;
				},
				set open($$value) {
					shareDialogOpen = $$value;
					$$settled = false;
				}
			});
			$$renderer.push(`<!----> `);
			SetlistExportDialog($$renderer, {
				preflight: setlistPreflight,
				status: setlistExportStatus,
				message: setlistExportMsg,
				onConfirm: () => void runSetlistExport(),
				onClose: closeSetlistExport,
				get open() {
					return setlistExportOpen;
				},
				set open($$value) {
					setlistExportOpen = $$value;
					$$settled = false;
				}
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
export { _page as default };
