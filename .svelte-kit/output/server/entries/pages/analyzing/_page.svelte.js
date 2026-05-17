import "../../../chunks/index-server.js";
import { A as escape_html, N as get, h as unsubscribe_stores } from "../../../chunks/server.js";
import "../../../chunks/index-server2.js";
import { i as mergeAnalysisIntoSongMap } from "../../../chunks/timelineEdit.js";
import { t as beatsToSongMap } from "../../../chunks/beatsToSongMap.js";
import { n as goto } from "../../../chunks/client.js";
import { D as songMap, T as patchSongMap } from "../../../chunks/commit.js";
import { t as Button } from "../../../chunks/button.js";
import { t as desktopCompanionStatus } from "../../../chunks/desktopCompanionStatus.js";
import { r as analyzeDownbeatsViaDesktop } from "../../../chunks/desktopBridge.js";
import "../../../chunks/stores.js";
import { t as analyzingState } from "../../../chunks/analyzingState.js";
import { t as setAnalyzingSpin } from "../../../chunks/uiAnimations.js";
import { n as trimAudioFileToWav } from "../../../chunks/trimAudio.js";
//#region src/routes/analyzing/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let status = "running";
		let errorMsg = "";
		async function run() {
			const state = get(analyzingState);
			const sm = get(songMap);
			if (!state || !sm?.audio) {
				await goto("/");
				return;
			}
			const trim = sm.audio.trim;
			setAnalyzingSpin(true);
			try {
				const { file: trimmedWav } = await trimAudioFileToWav(state.hqFile, trim.startSec, trim.endSec);
				let analyzedSongMap = null;
				if (get(desktopCompanionStatus).reachable) {
					const r = await analyzeDownbeatsViaDesktop(trimmedWav);
					if (r.ok) try {
						analyzedSongMap = beatsToSongMap({
							filename: trimmedWav.name,
							durationSec: Math.max(0, trim.endSec - trim.startSec),
							mimeType: trimmedWav.type || "audio/wav",
							beats: r.beats
						});
					} catch (e) {
						console.warn("[analyze] desktop beatsToSongMap failed, falling back to server:", e);
					}
					else console.warn("[analyze] desktop analyze failed, falling back to server:", r.error);
				}
				if (!analyzedSongMap) {
					const form = new FormData();
					form.set("file", trimmedWav, trimmedWav.name);
					const res = await fetch("/api/analyze", {
						method: "POST",
						body: form
					});
					let data;
					try {
						data = await res.json();
					} catch {
						throw new Error("Invalid response from server");
					}
					if (!res.ok || !data.ok) throw new Error(data.ok === false ? data.error : "Analysis failed");
					analyzedSongMap = data.songMap;
				}
				const fragment = {
					bars: analyzedSongMap.timeline.bars,
					beats: analyzedSongMap.timeline.beats,
					bpm: analyzedSongMap.metadata.bpm
				};
				const patched = patchSongMap((current) => {
					const merged = mergeAnalysisIntoSongMap(current, fragment);
					return {
						...merged,
						metadata: {
							...merged.metadata,
							...fragment.bpm !== void 0 ? { bpm: fragment.bpm } : {},
							analyzed: true
						}
					};
				});
				if (!patched.ok) throw new Error(patched.errors.join("; "));
				analyzingState.set(null);
				status = "done";
				await goto("/edit");
			} catch (e) {
				errorMsg = e instanceof Error ? e.message : "Analysis failed. Please try again.";
				status = "error";
			} finally {
				setAnalyzingSpin(false);
			}
		}
		async function retry() {
			status = "running";
			errorMsg = "";
			await run();
		}
		function cancel() {
			analyzingState.set(null);
			goto("/");
		}
		$$renderer.push(`<canvas class="fixed inset-0 -z-10 h-full w-full pointer-events-none" aria-hidden="true"></canvas> <main class="relative z-10 mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-8 px-6 py-16">`);
		if (status === "running") {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="flex flex-col items-center gap-6 text-center"><div class="border-muted-foreground/30 border-t-foreground/80 size-16 animate-spin rounded-full border-4"></div> <div class="flex flex-col gap-2"><h1 class="text-2xl font-black tracking-tight">Analyzing</h1> <p class="text-muted-foreground text-sm">Detecting beats and bars from your audio. This takes a few seconds.</p></div></div>`);
		} else if (status === "error") {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<div class="brutalist-shadow border-foreground bg-background w-full max-w-md border-2 p-8 text-center"><h1 class="mb-3 text-xl font-black">Analysis failed</h1> <p class="text-muted-foreground mb-6 text-sm">${escape_html(errorMsg)}</p> <div class="flex justify-center gap-3">`);
			Button($$renderer, {
				class: "",
				variant: "default",
				onclick: retry,
				children: ($$renderer) => {
					$$renderer.push(`<!---->Try again`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----> `);
			Button($$renderer, {
				class: "",
				variant: "outline",
				onclick: cancel,
				children: ($$renderer) => {
					$$renderer.push(`<!---->Back to import`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></main>`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
export { _page as default };
