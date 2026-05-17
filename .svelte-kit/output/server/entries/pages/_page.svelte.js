import "../../chunks/index-server.js";
import { A as escape_html, O as attr, a as derived, f as spread_props, h as unsubscribe_stores } from "../../chunks/server.js";
import "../../chunks/index-server2.js";
import "../../chunks/timelineEdit.js";
import "../../chunks/persist.js";
import "../../chunks/client.js";
import "../../chunks/commit.js";
import { t as Button } from "../../chunks/button.js";
import { t as Icon } from "../../chunks/Icon.js";
import { n as Music } from "../../chunks/arrow-left.js";
import "../../chunks/stores.js";
import "../../chunks/analyzingState.js";
import "../../chunks/WaveformPlayer.js";
//#region node_modules/@lucide/svelte/dist/icons/upload.svelte
function Upload($$renderer, $$props) {
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
			{ name: "upload" },
			props,
			{
				iconNode: [
					["path", { "d": "M12 3v12" }],
					["path", { "d": "m17 8-5-5-5 5" }],
					["path", { "d": "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }]
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
			$$renderer.push(`<!----></div> <h1 class="text-4xl font-black tracking-tight md:text-5xl">BarBro</h1> <p class="text-muted-foreground max-w-md text-pretty text-sm leading-relaxed">`);
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
