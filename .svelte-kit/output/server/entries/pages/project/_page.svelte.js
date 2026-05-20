import "../../../chunks/index-server.js";
import { A as escape_html, O as attr, a as derived, h as unsubscribe_stores, i as bind_props, m as stringify, p as store_get, s as ensure_array_like, t as attr_class } from "../../../chunks/server.js";
import "../../../chunks/index-server2.js";
import { o as safeExportBasename, t as downloadBlob, u as readSmapJsonOnly } from "../../../chunks/persist.js";
import "../../../chunks/client.js";
import { D as songMap, S as project, h as selectBestStemSet, l as metadataLiteFromSongMap, m as removeSongFromProject, s as importSmapToProject, v as readProjectSongAsset } from "../../../chunks/commit.js";
import { t as Button } from "../../../chunks/button.js";
import { _ as Dialog_title, g as Dialog_footer, h as Dialog_header, i as fetchCloudSongAsSmap, m as Dialog_content, p as Dialog_description, v as Dialog } from "../../../chunks/cloud.js";
import "../../../chunks/Icon.js";
import "../../../chunks/desktopCompanionStatus.js";
import "../../../chunks/desktopBridge.js";
import "../../../chunks/stores.js";
import "../../../chunks/StemSplitter.js";
import { t as renderCueTrackWavBlob } from "../../../chunks/renderCueTrack.js";
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
//#region src/routes/project/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let removeDialogOpen = false;
		let removeTarget = null;
		let exportDialogOpen = false;
		let exportTarget = null;
		let copyFromCloudOpen = false;
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
			$$renderer.push(`<main class="relative z-10 mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">`);
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
