import { A as escape_html, O as attr, a as derived, c as head, f as spread_props, m as stringify, s as ensure_array_like, t as attr_class } from "../../../chunks/server.js";
import { t as Button } from "../../../chunks/button.js";
import { t as Icon } from "../../../chunks/Icon.js";
import { t as Log_out } from "../../../chunks/log-out.js";
//#region node_modules/@lucide/svelte/dist/icons/folder-git-2.svelte
function Folder_git_2($$renderer, $$props) {
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
			{ name: "folder-git-2" },
			props,
			{
				iconNode: [
					["path", { "d": "M18 19a5 5 0 0 1-5-5v8" }],
					["path", { "d": "M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" }],
					["circle", {
						"cx": "13",
						"cy": "12",
						"r": "2"
					}],
					["circle", {
						"cx": "20",
						"cy": "19",
						"r": "2"
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
//#region node_modules/@lucide/svelte/dist/icons/users.svelte
function Users($$renderer, $$props) {
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
			{ name: "users" },
			props,
			{
				iconNode: [
					["path", { "d": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
					["path", { "d": "M16 3.128a4 4 0 0 1 0 7.744" }],
					["path", { "d": "M22 21v-2a4 4 0 0 0-3-3.87" }],
					["circle", {
						"cx": "9",
						"cy": "7",
						"r": "4"
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
//#region src/routes/account/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* `/account` — simple signed-in shell.
		*
		* Today: shows who you are + sign-out. Tomorrow (Phase 4+): lists shared
		* cloud projects + outgoing/incoming invites + member management. Built
		* as a single page so the future collab sections drop in as new
		* <section>s without route restructuring.
		*
		* Signed-out users never see this — `+page.server.ts` redirects them to
		* `/login?next=/account`.
		*/
		let { data } = $$props;
		const u = derived(() => data.accountUser);
		const initial = derived(() => (u().name?.[0] ?? u().email?.[0] ?? "?").toUpperCase());
		head("8i5vi8", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>Account · BarBro</title>`);
			});
		});
		$$renderer.push(`<main class="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6"><header class="border-foreground border-b-2 pb-4"><h1 class="text-3xl font-black tracking-tight">Account</h1></header> <section class="border-foreground border-2 p-4 space-y-4"><div class="flex items-center gap-4">`);
		if (u().avatarUrl) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<img${attr("src", u().avatarUrl)} alt="" class="border-foreground size-12 shrink-0 border-2 object-cover" referrerpolicy="no-referrer"/>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<div class="border-foreground bg-muted text-foreground flex size-12 shrink-0 items-center justify-center border-2 text-lg font-black" aria-hidden="true">${escape_html(initial())}</div>`);
		}
		$$renderer.push(`<!--]--> <div class="min-w-0 flex-1"><p class="truncate font-semibold">${escape_html(u().name ?? u().email ?? "Signed in")}</p> `);
		if (u().email && u().name) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<p class="text-muted-foreground truncate text-xs">${escape_html(u().email)}</p>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div></div> <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs"><dt class="text-muted-foreground">Signed in via</dt> <dd class="font-mono">${escape_html(u().provider)}</dd> <dt class="text-muted-foreground">Account created</dt> <dd class="font-mono">${escape_html(new Date(u().createdAt).toLocaleString())}</dd> <dt class="text-muted-foreground">User ID</dt> <dd class="text-foreground/60 truncate font-mono">${escape_html(u().id)}</dd></dl> <form method="POST" action="/logout">`);
		Button($$renderer, {
			type: "submit",
			variant: "outline",
			size: "sm",
			class: "gap-2",
			children: ($$renderer) => {
				Log_out($$renderer, {
					class: "size-4",
					"aria-hidden": "true"
				});
				$$renderer.push(`<!----> Sign out`);
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----></form></section> <section class="border-foreground border-2 p-4 space-y-3"><h2 class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">`);
		Folder_git_2($$renderer, {
			class: "size-4",
			"aria-hidden": "true"
		});
		$$renderer.push(`<!----> Shared projects (${escape_html(data.cloudProjects.length)})</h2> `);
		if (data.cloudProjects.length === 0) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<p class="text-muted-foreground text-sm">You haven't enabled collaboration on any project yet. Open a project and click <span class="font-semibold">Enable Collaboration</span> to start syncing.</p>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<ul class="border-foreground/20 border divide-foreground/10 divide-y"><!--[-->`);
			const each_array = ensure_array_like(data.cloudProjects);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let p = each_array[$$index];
				$$renderer.push(`<li class="flex items-center justify-between gap-3 px-3 py-2"><div class="min-w-0 flex-1"><p class="truncate font-semibold text-sm">${escape_html(p.name)}</p> <p class="text-muted-foreground text-[11px] font-mono">rev ${escape_html(p.revision)} · updated ${escape_html(new Date(p.updatedAt).toLocaleString())}</p></div> <span${attr_class(`text-[10px] font-bold uppercase tracking-wider ${stringify(p.isOwner ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}`)}>${escape_html(p.isOwner ? "owner" : "editor")}</span></li>`);
			}
			$$renderer.push(`<!--]--></ul> <p class="text-muted-foreground text-[11px]">To open a shared project, use File → Open Project from a machine with its folder
        on disk. (Phase 6 will add an "Open from cloud" flow that creates a fresh local
        folder and pulls metadata down.)</p>`);
		}
		$$renderer.push(`<!--]--></section> <section class="border-foreground/40 border-2 border-dashed p-4 space-y-2"><h2 class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">`);
		Users($$renderer, {
			class: "size-4",
			"aria-hidden": "true"
		});
		$$renderer.push(`<!----> Collaborators</h2> <p class="text-muted-foreground text-sm">You aren't collaborating with anyone yet. Invites you receive will appear here.</p></section></main>`);
	});
}
//#endregion
export { _page as default };
