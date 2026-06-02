import "../../../chunks/index-server.js";
import { A as escape_html, a as derived, h as unsubscribe_stores, p as store_get, s as ensure_array_like } from "../../../chunks/server.js";
import "../../../chunks/index-server2.js";
import "../../../chunks/persist.js";
import { N as songMap } from "../../../chunks/commit.js";
import { d as pickFolderViaDesktop, v as Button } from "../../../chunks/desktopBridge.js";
import { t as desktopCompanionStatus } from "../../../chunks/desktopCompanionStatus.js";
import { n as StemSplitter, o as STEM_TRACKS } from "../../../chunks/gzip.js";
//#endregion
//#region src/routes/set/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let folderStatus = "none";
		let folderFiles = [];
		let stems = /* @__PURE__ */ new Map();
		async function assignStem(stemName, relativePath) {}
		/**
		* Known aliases per slot — covers common stem splitter output names.
		* First alias listed is the canonical/recommended name.
		*/
		const STEM_ALIASES = {
			Drums: [
				"drums",
				"drum",
				"kit",
				"percussion",
				"perc",
				"beat"
			],
			Bass: ["bass"],
			Guitar: [
				"guitar",
				"guitars",
				"gtr",
				"keys",
				"piano",
				"synth",
				"melodics",
				"other",
				"no_vocals"
			],
			Vocals: [
				"vocals",
				"vocal",
				"vox",
				"voice",
				"lead",
				"lead_vocals"
			],
			FX: [
				"fx",
				"effects",
				"sfx",
				"other",
				"extras",
				"pads"
			]
		};
		/** Match a folder file to a stem slot using the alias table. */
		function autoMatch(stemName) {
			const aliases = STEM_ALIASES[stemName] ?? [stemName.toLowerCase()];
			return folderFiles.find((f) => {
				const base = f.replace(/^.*\//, "").replace(/\.[^.]+$/, "").toLowerCase();
				return aliases.some((a) => base === a || base.startsWith(a + "_") || base.endsWith("_" + a));
			});
		}
		/** Canonical filename for a stem slot (e.g. "Drums" → "stems/drums.wav"). */
		function canonicalName(stemName) {
			return `stems/${STEM_ALIASES[stemName]?.[0] ?? stemName.toLowerCase()}.wav`;
		}
		let standaloneOsPath = null;
		let osPathPickError = "";
		async function pickStandaloneOsPath() {
			osPathPickError = "";
			const r = await pickFolderViaDesktop({ title: "Locate the stems folder on disk" });
			if (!r.ok) {
				if (!("cancelled" in r) || !r.cancelled) osPathPickError = "error" in r ? r.error : "Could not pick folder";
				return;
			}
			standaloneOsPath = r.path;
		}
		/**
		* Standalone-mode inputPath: there's no .smap on disk for unbound songs,
		* so the user would need to first save the song into the picked folder
		* for stems to work. For now we expect `song.smap` to live at the root
		* of the picked OS path; the legacy "Save Song (.smap)" flow needs to
		* be aligned with that. Until that's wired, splits won't work in /set
		* without a manual .smap in place.
		*/
		const standaloneInputPath = derived(() => standaloneOsPath ? `${standaloneOsPath}/song.smap` : null);
		const standaloneOutputDir = derived(() => standaloneOsPath ? `${standaloneOsPath}/stems` : null);
		/**
		* In standalone /set mode the sidecar wrote the stems directly into
		* `<standaloneOsPath>/stems/<filename>` (path-based flow — no audio
		* bytes over HTTP). The web side only needs to refresh the in-memory
		* folder listing + the .smap stemRefs.
		*/
		async function finalizeStemsForStandaloneSet(job) {}
		let status = "idle";
		async function exportAbletonSet() {}
		const smSnap = derived(() => store_get($$store_subs ??= {}, "$songMap", songMap));
		const bpm = derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			if (!sm) return null;
			if (sm.metadata.bpm && sm.metadata.bpm > 0) return sm.metadata.bpm;
			const bar = sm.timeline.bars[0];
			if (!bar || bar.beatCount <= 0) return null;
			const dur = bar.endSec - bar.startSec;
			return dur > 0 ? Math.round(bar.beatCount / dur * 60 * 100) / 100 : null;
		});
		function fmtDur(sec) {
			return `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, "0")}`;
		}
		$$renderer.push(`<main class="relative z-10 flex min-h-dvh w-full flex-col gap-6 px-4 py-16 sm:px-6 md:px-8 md:py-20"><div class="mx-auto w-full max-w-2xl space-y-6"><div class="border-foreground border-b-2 pb-4"><h1 class="text-2xl font-bold tracking-tight">Set</h1> <p class="text-muted-foreground mt-1 text-xs">Ableton Live 12 · experimental</p></div> `);
		if (!smSnap()) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="border-foreground bg-muted border-2 p-4"><p class="text-sm">No song loaded. Open a project in the <a href="/edit" class="underline underline-offset-2">editor</a> first.</p></div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<section class="border-foreground border-2 p-4 space-y-2"><h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Song</h2> <dl class="text-sm space-y-1 font-mono"><div class="flex justify-between gap-4"><dt class="text-muted-foreground">Title</dt> <dd>${escape_html(smSnap().metadata.title)}</dd></div> <div class="flex justify-between gap-4"><dt class="text-muted-foreground">BPM</dt> <dd>${escape_html(bpm() != null ? bpm().toFixed(2) : "—")}</dd></div> <div class="flex justify-between gap-4"><dt class="text-muted-foreground">Bars / Sections</dt> <dd>${escape_html(smSnap().timeline.bars.length)} bars · ${escape_html(smSnap().sections.length)} sections</dd></div></dl></section> <section class="border-foreground border-2 p-4 space-y-3"><h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Project Folder</h2> `);
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<p class="text-muted-foreground text-xs">File System Access API not available in this browser. Use Chrome or Edge for folder integration.</p>`);
			$$renderer.push(`<!--]--></section> `);
			if (!standaloneOsPath && store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).reachable) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<section class="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20 border-2 px-4 py-3 space-y-2"><p class="text-xs"><span class="font-semibold">Stems need a disk path.</span> The desktop sidecar reads/writes the project folder directly. Locate it once.</p> `);
				Button($$renderer, {
					class: "",
					variant: "default",
					size: "sm",
					onclick: () => void pickStandaloneOsPath(),
					children: ($$renderer) => {
						$$renderer.push(`<!---->Locate folder on disk…`);
					},
					$$slots: { default: true }
				});
				$$renderer.push(`<!----> `);
				if (osPathPickError) {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<p class="text-destructive text-xs" role="status">${escape_html(osPathPickError)}</p>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></section>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			StemSplitter($$renderer, {
				songId: "standalone",
				inputPath: standaloneInputPath(),
				outputDir: standaloneOutputDir(),
				inputLabel: null,
				desktopReachable: store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).reachable,
				finalizeJob: (job) => finalizeStemsForStandaloneSet(job)
			});
			$$renderer.push(`<!----> <section class="border-foreground border-2 p-4 space-y-3"><h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Stems</h2> <ul class="space-y-2"><!--[-->`);
			const each_array = ensure_array_like(STEM_TRACKS);
			for (let $$index_1 = 0, $$length = each_array.length; $$index_1 < $$length; $$index_1++) {
				let track = each_array[$$index_1];
				const loaded = stems.get(track.name);
				const savedRef = smSnap().stemRefs?.[track.name];
				const suggested = !loaded && folderStatus === "ready" ? autoMatch(track.name) : void 0;
				$$renderer.push(`<li class="border-foreground border px-3 py-2"><div class="flex items-center gap-3 text-sm"><span class="w-16 shrink-0 font-medium">${escape_html(track.name)}</span> `);
				if (loaded) {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<span class="text-foreground/80 min-w-0 flex-1 truncate font-mono text-xs">${escape_html(loaded.clip.relativePath)}</span> <span class="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">${escape_html(fmtDur(loaded.clip.durationSec))}</span> <button type="button" class="text-muted-foreground hover:text-destructive text-xs shrink-0">✕</button>`);
				} else if (savedRef && folderStatus !== "ready") {
					$$renderer.push("<!--[1-->");
					$$renderer.push(`<span class="text-muted-foreground/60 font-mono text-xs flex-1">${escape_html(savedRef)}</span> <span class="text-amber-500 text-xs shrink-0">not found</span>`);
				} else if (folderStatus === "ready") {
					$$renderer.push("<!--[2-->");
					$$renderer.select({
						class: "border-foreground/30 bg-background text-foreground flex-1 border px-2 py-0.5 font-mono text-xs",
						onchange: (e) => {
							const v = e.currentTarget.value;
							if (v) assignStem(track.name, v);
						},
						value: ""
					}, ($$renderer) => {
						$$renderer.option({ value: "" }, ($$renderer) => {
							$$renderer.push(`— assign from folder —`);
						});
						if (suggested) {
							$$renderer.push("<!--[0-->");
							$$renderer.option({ value: suggested }, ($$renderer) => {
								$$renderer.push(`⚡ ${escape_html(suggested)}`);
							});
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--><!--[-->`);
						const each_array_1 = ensure_array_like(folderFiles);
						for (let $$index = 0, $$length = each_array_1.length; $$index < $$length; $$index++) {
							let f = each_array_1[$$index];
							if (f !== suggested) {
								$$renderer.push("<!--[0-->");
								$$renderer.option({ value: f }, ($$renderer) => {
									$$renderer.push(`${escape_html(f)}`);
								});
							} else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]-->`);
						}
						$$renderer.push(`<!--]-->`);
					});
				} else {
					$$renderer.push("<!--[-1-->");
					$$renderer.push(`<span class="text-muted-foreground/50 font-mono text-xs flex-1">${escape_html(canonicalName(track.name))}</span>`);
				}
				$$renderer.push(`<!--]--></div></li>`);
			}
			$$renderer.push(`<!--]--></ul> `);
			if (stems.size > 0) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<p class="text-muted-foreground text-xs">${escape_html(stems.size)} of ${escape_html(STEM_TRACKS.length)} stems loaded</p>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></section> `);
			if (smSnap().sections.length > 0) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<section class="border-foreground border-2 p-4 space-y-2"><h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sections → Locators</h2> <ul class="text-sm space-y-1 font-mono"><!--[-->`);
				const each_array_2 = ensure_array_like(smSnap().sections);
				for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
					let s = each_array_2[$$index_2];
					$$renderer.push(`<li class="flex gap-3"><span class="text-muted-foreground w-24 shrink-0">bar ${escape_html(s.barRange.startBarIndex)}–${escape_html(s.barRange.endBarIndex)}</span> <span>${escape_html(s.label)}</span> <span class="text-muted-foreground ml-auto text-xs">${escape_html(s.kind)}</span></li>`);
				}
				$$renderer.push(`<!--]--></ul></section>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <section class="border-foreground border-2 p-4 space-y-3"><h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Export</h2> <div class="flex flex-wrap gap-3 items-center">`);
			Button($$renderer, {
				class: "",
				onclick: () => void exportAbletonSet(),
				disabled: status === "generating",
				children: ($$renderer) => {
					$$renderer.push(`<!---->${escape_html(status === "generating" ? "Generating…" : "Download .als")}`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----> `);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div> `);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></section> `);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]-->`);
		}
		$$renderer.push(`<!--]--></div></main>`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
export { _page as default };
