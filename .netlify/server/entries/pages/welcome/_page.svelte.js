import { c as head, f as spread_props, m as stringify, n as attr_style, s as ensure_array_like } from "../../../chunks/server.js";
import { t as Button } from "../../../chunks/button.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { t as Arrow_right } from "../../../chunks/arrow-right.js";
import { t as Music_4 } from "../../../chunks/music-4.js";
import { t as Sparkles } from "../../../chunks/sparkles.js";
//#region node_modules/@lucide/svelte/dist/icons/mic-vocal.svelte
function Mic_vocal($$renderer, $$props) {
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
			{ name: "mic-vocal" },
			props,
			{
				iconNode: [
					["path", { "d": "m11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12" }],
					["path", { "d": "M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5" }],
					["circle", {
						"cx": "16",
						"cy": "7",
						"r": "5"
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
//#region src/routes/welcome/+page.svelte
function _page($$renderer) {
	const WORDS = Array.from({ length: 12 });
	const BANNER_COLOR = "#ffcec2";
	head("1m5shf", $$renderer, ($$renderer) => {
		$$renderer.title(($$renderer) => {
			$$renderer.push(`<title>BarBro</title>`);
		});
	});
	$$renderer.push(`<main class="relative isolate min-h-dvh overflow-clip"><div class="pointer-events-none absolute inset-0 -z-10 opacity-[0.06] dark:opacity-[0.08]" aria-hidden="true" style="background-image: linear-gradient(to right, currentColor 1px, transparent 1px); background-size: min(8vw, 96px) 100%;"></div>  <div class="pointer-events-none absolute -bottom-[10%] -top-[10%] left-[12%] z-0 hidden w-24 rotate-[-3deg] sm:flex md:left-[20%] md:w-28"${attr_style(`--banner: ${stringify(BANNER_COLOR)};`)} aria-hidden="true"><div class="text-background flex-1 overflow-hidden" style="background-color: var(--banner);"><div class="marquee-up font-display flex flex-col items-center font-black italic uppercase leading-none text-[2.25rem] md:text-[3.7rem] svelte-1m5shf"><!--[-->`);
	const each_array = ensure_array_like(WORDS);
	for (let i = 0, $$length = each_array.length; i < $$length; i++) {
		each_array[i];
		$$renderer.push(`<span class="rotate-text svelte-1m5shf">BarBro</span>`);
	}
	$$renderer.push(`<!--]--> <!--[-->`);
	const each_array_1 = ensure_array_like(WORDS);
	for (let i = 0, $$length = each_array_1.length; i < $$length; i++) {
		each_array_1[i];
		$$renderer.push(`<span class="rotate-text svelte-1m5shf">BarBro</span>`);
	}
	$$renderer.push(`<!--]--></div></div> <div class="flex-1 overflow-hidden"><div class="marquee-down font-display flex flex-col items-center font-black italic uppercase leading-none text-[2.25rem] md:text-[3.7rem] svelte-1m5shf" style="color: var(--banner);"><!--[-->`);
	const each_array_2 = ensure_array_like(WORDS);
	for (let i = 0, $$length = each_array_2.length; i < $$length; i++) {
		each_array_2[i];
		$$renderer.push(`<span class="rotate-text svelte-1m5shf">BarBro</span>`);
	}
	$$renderer.push(`<!--]--> <!--[-->`);
	const each_array_3 = ensure_array_like(WORDS);
	for (let i = 0, $$length = each_array_3.length; i < $$length; i++) {
		each_array_3[i];
		$$renderer.push(`<span class="rotate-text svelte-1m5shf">BarBro</span>`);
	}
	$$renderer.push(`<!--]--></div></div> <div class="text-background flex-1 overflow-hidden" style="background-color: var(--banner);"><div class="marquee-up font-display flex flex-col items-center font-black italic uppercase leading-none text-[2.25rem] md:text-[3.7rem] svelte-1m5shf"><!--[-->`);
	const each_array_4 = ensure_array_like(WORDS);
	for (let i = 0, $$length = each_array_4.length; i < $$length; i++) {
		each_array_4[i];
		$$renderer.push(`<span class="rotate-text svelte-1m5shf">BarBro</span>`);
	}
	$$renderer.push(`<!--]--> <!--[-->`);
	const each_array_5 = ensure_array_like(WORDS);
	for (let i = 0, $$length = each_array_5.length; i < $$length; i++) {
		each_array_5[i];
		$$renderer.push(`<span class="rotate-text svelte-1m5shf">BarBro</span>`);
	}
	$$renderer.push(`<!--]--></div></div></div> <section class="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16 sm:mx-0 sm:ml-[calc(12%+12rem)] sm:w-[40vw] sm:py-24 md:ml-[calc(20%+14rem)]"><div class="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em]"><span class="welcome-logo inline-flex border-foreground border-2 rounded-[var(--radius)] px-2 py-1 svelte-1m5shf"><span class="welcome-logo-bar svelte-1m5shf">BAR</span> <span class="welcome-logo-bro svelte-1m5shf">BRO</span></span> <span class="text-muted-foreground">invite-only beta</span></div> <div class="space-y-6"><h1 class="font-display text-[clamp(2.5rem,8vw,5.5rem)] font-black leading-[0.95] tracking-tight">Your set in one place.</h1> <p class="text-muted-foreground max-w-xl text-lg sm:text-xl">Like your grandma but also does stem splitting.</p> <div class="flex flex-wrap items-center gap-3 pt-2">`);
	Button($$renderer, {
		class: "brutalist-shadow h-11 gap-2 px-5 text-sm",
		onclick: () => window.location.href = "/login",
		children: ($$renderer) => {
			$$renderer.push(`<!---->Sign in `);
			Arrow_right($$renderer, {
				class: "size-4",
				"aria-hidden": "true"
			});
			$$renderer.push(`<!---->`);
		},
		$$slots: { default: true }
	});
	$$renderer.push(`<!----> `);
	Button($$renderer, {
		variant: "outline",
		class: "h-11 px-5 text-sm",
		onclick: () => window.location.href = "/login?next=/pending",
		children: ($$renderer) => {
			$$renderer.push(`<!---->Request invite`);
		},
		$$slots: { default: true }
	});
	$$renderer.push(`<!----></div></div> <div class="grid gap-4 lg:grid-cols-3"><div class="border-foreground brutalist-shadow-sm border-2 p-5 space-y-2 bg-background">`);
	Music_4($$renderer, {
		class: "size-5",
		"aria-hidden": "true"
	});
	$$renderer.push(`<!----> <h2 class="text-sm font-bold uppercase tracking-wider">Beats &amp; bars</h2> <p class="text-muted-foreground text-xs">Detect, edit, lock everything to the grid.</p></div> <div class="border-foreground brutalist-shadow-sm border-2 p-5 space-y-2 bg-background">`);
	Sparkles($$renderer, {
		class: "size-5",
		"aria-hidden": "true"
	});
	$$renderer.push(`<!----> <h2 class="text-sm font-bold uppercase tracking-wider">Stems</h2> <p class="text-muted-foreground text-xs">Vocals, drums, bass, other. Local Demucs.</p></div> <div class="border-foreground brutalist-shadow-sm border-2 p-5 space-y-2 bg-background">`);
	Mic_vocal($$renderer, {
		class: "size-5",
		"aria-hidden": "true"
	});
	$$renderer.push(`<!----> <h2 class="text-sm font-bold uppercase tracking-wider">Cues &amp; click</h2> <p class="text-muted-foreground text-xs">Spoken count-ins. Click track. Ableton export.</p></div></div> <footer class="border-foreground/20 mt-8 border-t pt-4 text-xs text-muted-foreground">Built for live performers.</footer></section></main>`);
}
//#endregion
export { _page as default };
