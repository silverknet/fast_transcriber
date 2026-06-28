import { A as escape_html, O as attr, c as head, h as unsubscribe_stores, p as store_get } from "../../../chunks/server.js";
import { t as Button } from "../../../chunks/button.js";
import { s as fetchDesktopTtsHelloWorldWav, y as setupPiperTtsDeps } from "../../../chunks/desktopBridge.js";
import { t as desktopCompanionStatus } from "../../../chunks/desktopCompanionStatus.js";
//#region src/routes/texttospeech/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		/**
		* Debug: Piper TTS via desktop sidecar (`GET /native/tts/hello-world`).
		* Requires `npm run dev` in `desktop/` and a one-time POST setup from this page.
		*/
		let statusMsg = "";
		let setupLog = [];
		let setupRunning = false;
		let audioUrl = null;
		async function refreshStatus() {
			statusMsg = "Desktop sidecar offline — run `cd desktop && npm run dev`.";
		}
		async function runSetup() {
			if (setupRunning) return;
			setupRunning = true;
			setupLog = [];
			const r = await setupPiperTtsDeps((ev) => {
				if (ev.type === "log") setupLog = [...setupLog.slice(-120), ev.msg];
				else if (ev.type === "progress") setupLog = [...setupLog.slice(-120), `${ev.label} (${ev.overall}%)`];
				else if (ev.type === "error") setupLog = [...setupLog.slice(-120), `Error: ${ev.msg}`];
				else if (ev.type === "done") setupLog = [...setupLog.slice(-120), `Done: ${ev.venvPython}`];
			});
			setupRunning = false;
			if (!r.ok) setupLog = [...setupLog, r.error];
			await refreshStatus();
		}
		async function playHelloWorld() {
			if (audioUrl) {
				URL.revokeObjectURL(audioUrl);
				audioUrl = null;
			}
			const r = await fetchDesktopTtsHelloWorldWav();
			if (!r.ok) {
				statusMsg = r.error;
				return;
			}
			audioUrl = URL.createObjectURL(r.blob);
			await refreshStatus();
		}
		head("jbbgc1", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>TTS debug — BarBro</title>`);
			});
		});
		$$renderer.push(`<main class="relative z-10 mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-6 px-4 py-16 sm:px-6"><header class="border-foreground border-b-2 pb-4"><h1 class="text-2xl font-bold tracking-tight">Text-to-speech (debug)</h1> <p class="text-muted-foreground mt-1 text-sm">Piper runs in the <strong class="text-foreground">desktop</strong> app only. This page calls loopback <code class="text-xs">/native/tts/hello-world</code> and plays the returned WAV.</p></header> <section class="border-foreground space-y-3 border-2 p-4"><p class="text-sm" role="status">${escape_html(statusMsg || "…")}</p> <div class="flex flex-wrap gap-2">`);
		Button($$renderer, {
			class: "",
			disabled: !store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).reachable || setupRunning,
			onclick: () => void runSetup(),
			children: ($$renderer) => {
				$$renderer.push(`<!---->${escape_html(setupRunning ? "Installing…" : "Install Piper (desktop)")}`);
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----> `);
		Button($$renderer, {
			class: "",
			variant: "outline",
			disabled: !store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).reachable,
			onclick: () => void playHelloWorld(),
			children: ($$renderer) => {
				$$renderer.push(`<!---->Play “Hello world”`);
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----> `);
		Button($$renderer, {
			class: "",
			variant: "outline",
			onclick: () => void refreshStatus(),
			children: ($$renderer) => {
				$$renderer.push(`<!---->Refresh status`);
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----></div></section> `);
		if (setupLog.length > 0) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<details class="border-foreground/30 border" open=""><summary class="text-muted-foreground cursor-pointer px-3 py-2 text-xs font-medium">Setup log</summary> <pre class="border-foreground/10 bg-muted/30 max-h-48 overflow-auto border-t p-3 font-mono text-[10px] leading-snug whitespace-pre-wrap">${escape_html(setupLog.join("\n"))}</pre></details>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (audioUrl) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<section class="border-foreground border-2 p-4"><p class="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">Playback</p> <audio class="w-full" controls=""${attr("src", audioUrl)}></audio></section>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></main>`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
export { _page as default };
