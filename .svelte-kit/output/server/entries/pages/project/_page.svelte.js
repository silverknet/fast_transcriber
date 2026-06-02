import "../../../chunks/index-server.js";
import { A as escape_html, O as attr, a as derived, h as unsubscribe_stores, i as bind_props, m as stringify, p as store_get, s as ensure_array_like, t as attr_class } from "../../../chunks/server.js";
import "../../../chunks/index-server2.js";
import { l as readSmapJsonOnly, o as safeExportBasename, t as downloadBlob } from "../../../chunks/persist.js";
import "../../../chunks/client.js";
import { C as writeProjectSongAsset, D as project, K as sortBeatsByTime, M as songMap, W as songStartBeat, Z as effectiveCountInBeats, _ as getProjectWavInfoBatch, b as transcodeProjectAudioToWav, l as metadataLiteFromSongMap, m as selectBestStemSet, p as removeSongFromProject, s as importSmapToProject, v as readProjectSong, w as getExportableSongs, x as writeProjectAsset, y as readProjectSongAsset } from "../../../chunks/commit.js";
import { v as Button } from "../../../chunks/desktopBridge.js";
import { _ as Dialog_footer, g as Dialog_header, h as Dialog_content, i as fetchCloudSongAsSmap, m as Dialog_description, v as Dialog_title, y as Dialog } from "../../../chunks/cloud.js";
import "../../../chunks/Icon.js";
import "../../../chunks/desktopCompanionStatus.js";
import "../../../chunks/stores.js";
import { o as STEM_TRACKS, s as generateAbletonProjectSetXml, t as gzipString } from "../../../chunks/gzip.js";
import { t as renderCueTrackWavBlob } from "../../../chunks/renderCueTrack.js";
import "../../../chunks/refresh-cw.js";
import { t as audioBufferToWavBlob } from "../../../chunks/trimAudio.js";
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
//#region src/lib/components/CopyFromCloudDialog.svelte
function CopyFromCloudDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { open = false } = $$props;
		let cloudSongs = [];
		let copyingId = null;
		let copyError = "";
		let copiedIds = /* @__PURE__ */ new Set();
		async function onCopy(item) {
			if (copyingId) return;
			copyingId = item.id;
			copyError = "";
			try {
				const dl = await fetchCloudSongAsSmap(item.id);
				if (!dl.ok) {
					copyError = dl.error;
					return;
				}
				const meta = metadataLiteFromSongMap((await readSmapJsonOnly(dl.blob)).songMap);
				await importSmapToProject(dl.blob, meta);
				copiedIds = new Set(copiedIds).add(item.id);
			} catch (e) {
				copyError = e instanceof Error ? e.message : "Copy failed";
			} finally {
				copyingId = null;
			}
		}
		function formatDate(iso) {
			const d = new Date(iso);
			const diffDays = Math.floor(((/* @__PURE__ */ new Date()).getTime() - d.getTime()) / 864e5);
			if (diffDays === 0) return "Today · " + d.toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit"
			});
			if (diffDays === 1) return "Yesterday";
			if (diffDays < 7) return d.toLocaleDateString([], { weekday: "long" });
			return d.toLocaleDateString([], {
				month: "short",
				day: "numeric",
				year: "numeric"
			});
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
						class: "flex max-h-[80vh] w-full max-w-lg flex-col gap-4 p-5",
						showCloseButton: true,
						children: ($$renderer) => {
							Dialog_header($$renderer, {
								children: ($$renderer) => {
									Dialog_title($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Copy song from cloud`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----> `);
									Dialog_description($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Each copy becomes a new file inside this project. Edits to the copy do not affect the cloud
        original.`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!---->`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> `);
							if (cloudSongs.length === 0) {
								$$renderer.push("<!--[2-->");
								$$renderer.push(`<p class="text-muted-foreground py-6 text-center text-sm">No cloud songs found.</p>`);
							} else {
								$$renderer.push("<!--[-1-->");
								if (copyError) {
									$$renderer.push("<!--[0-->");
									$$renderer.push(`<p class="text-destructive text-sm" role="status">${escape_html(copyError)}</p>`);
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--> <ul class="flex flex-col gap-2 overflow-y-auto"><!--[-->`);
								const each_array = ensure_array_like(cloudSongs);
								for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
									let item = each_array[$$index];
									const busy = copyingId === item.id;
									const done = copiedIds.has(item.id);
									const disabled = !item.hasSongMap || busy || copyingId !== null && copyingId !== item.id;
									$$renderer.push(`<li class="border-foreground/15 bg-muted/30 flex items-center justify-between gap-3 rounded-lg border p-3"><div class="min-w-0 flex-1"><p class="truncate font-medium">${escape_html(item.name)}</p> <p class="text-muted-foreground mt-0.5 text-xs">${escape_html(item.hasSongMap ? formatDate(item.updatedAt) : "No saved content yet")}</p></div> <div class="flex shrink-0 gap-2">`);
									Button($$renderer, {
										class: "",
										variant: done ? "outline" : "default",
										size: "sm",
										disabled,
										onclick: () => void onCopy(item),
										children: ($$renderer) => {
											$$renderer.push(`<!---->${escape_html(busy ? "Copying…" : done ? "Copied" : "Copy")}`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----></div></li>`);
								}
								$$renderer.push(`<!--]--></ul>`);
							}
							$$renderer.push(`<!--]-->`);
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
/** Compute timings for one song. Throws on missing/invalid trim. */
function songTimings(sm) {
	const trim = sm.audio?.trim;
	if (!trim || !(trim.endSec > trim.startSec)) throw new Error("Song has no valid audio.trim");
	const bpm = sm.metadata.bpm && sm.metadata.bpm > 0 ? sm.metadata.bpm : 120;
	const bars = [...sm.timeline.bars].sort((a, b) => a.index - b.index);
	const sortedBeats = sortBeatsByTime(sm.timeline.beats);
	const startBeat = songStartBeat(sm);
	const firstDownbeatOriginalSec = startBeat?.timeSec ?? trim.startSec;
	const startBar = startBeat ? bars.find((b) => b.id === startBeat.barId) : void 0;
	const beatDurationSec = startBar && startBar.beatCount > 0 ? (startBar.endSec - startBar.startSec) / startBar.beatCount : 60 / bpm;
	const countInBeats = effectiveCountInBeats(sm);
	const countInDurationSec = countInBeats * beatDurationSec;
	const firstBeat = sortedBeats.find((b) => b.timeSec >= trim.startSec - 1e-9);
	const firstBeatSongTimeSec = firstBeat ? Math.max(0, firstBeat.timeSec - trim.startSec) : 0;
	return {
		bpm,
		trimStartSec: trim.startSec,
		trimEndSec: trim.endSec,
		songDurationSec: trim.endSec - trim.startSec,
		firstBeatSongTimeSec,
		firstDownbeatOriginalSec,
		beatDurationSec,
		countInBeats,
		countInDurationSec
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
		let removeDialogOpen = false;
		let removeTarget = null;
		let exportDialogOpen = false;
		let exportTarget = null;
		let copyFromCloudOpen = false;
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
			CopyFromCloudDialog($$renderer, {
				get open() {
					return copyFromCloudOpen;
				},
				set open($$value) {
					copyFromCloudOpen = $$value;
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
