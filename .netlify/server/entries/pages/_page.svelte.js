import "../../chunks/index-server.js";
import { A as escape_html, O as attr, a as derived, h as unsubscribe_stores } from "../../chunks/server.js";
import "../../chunks/index-server2.js";
import "../../chunks/client.js";
import "../../chunks/navigation.js";
import { t as Button } from "../../chunks/button.js";
import "../../chunks/commit.js";
import "../../chunks/stores.js";
import "../../chunks/arrow-left.js";
import { r as Music } from "../../chunks/WaveformPlayer.js";
import { t as Upload } from "../../chunks/upload.js";
import "../../chunks/analyzingState.js";
//#region src/routes/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		const accept = "audio/mpeg,audio/wav,audio/x-wav,audio/wave,audio/flac,.mp3,.wav,.flac";
		let fileInput = void 0;
		let projectName = "";
		function openPicker() {
			fileInput?.click();
		}
		derived(() => false);
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			$$renderer.push(`<main class="relative z-10 mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-10 px-6 py-16">`);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <div class="flex flex-col items-center gap-3 text-center"><div class="brutalist-shadow-sm border-foreground bg-muted text-foreground inline-flex size-16 items-center justify-center border-2" aria-hidden="true">`);
			Music($$renderer, {
				class: "size-9",
				strokeWidth: 1.75
			});
			$$renderer.push(`<!----></div> <h1 class="font-display text-4xl font-black tracking-tight md:text-5xl">BarBro</h1> <p class="text-muted-foreground max-w-md text-pretty text-sm leading-relaxed">`);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`Import audio, set your region, and open in the editor with beats detected.`);
			$$renderer.push(`<!--]--></p></div> <input type="file" class="sr-only"${attr("accept", accept)}/> <div class="brutalist-shadow border-foreground bg-background w-full max-w-xl border-2 p-6 md:p-8"><div class="flex flex-col items-stretch gap-6"><div class="flex flex-col gap-1.5"><label for="project-name" class="text-xs font-semibold uppercase tracking-wide">Project name</label> <input id="project-name" type="text" class="border-foreground bg-background text-foreground w-full border-2 px-3 py-2 text-sm focus:outline-none" placeholder="Untitled"${attr("value", projectName)}/></div> `);
			Button($$renderer, {
				type: "button",
				variant: "secondary",
				size: "lg",
				class: "w-full gap-2 sm:w-auto sm:self-center",
				onclick: openPicker,
				children: ($$renderer) => {
					Upload($$renderer, {
						class: "size-4",
						"aria-hidden": "true"
					});
					$$renderer.push(`<!----> ${escape_html("Upload audio")}`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----> <p class="text-muted-foreground text-center text-xs">MP3 or WAV · max length ${escape_html(Math.floor(600 / 60))} minutes</p> `);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div></div></main>`);
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
