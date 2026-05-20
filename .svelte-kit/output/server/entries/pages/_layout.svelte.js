import { r as onDestroy } from "../../chunks/index-server.js";
import { A as escape_html, F as writable, N as get, O as attr, a as derived, c as head, d as slot, f as spread_props, h as unsubscribe_stores, i as bind_props, k as clsx, m as stringify, p as store_get, s as ensure_array_like, t as attr_class } from "../../chunks/server.js";
import "../../chunks/index-server2.js";
import { n as exportRestorableStateAsSmapBlob } from "../../chunks/persist.js";
import { n as goto, t as beforeNavigate } from "../../chunks/client.js";
import { B as restorableSongState, C as clearFullAppSongState, D as songMap, S as project, a as createProjectOnDisk, b as closeProject, d as openProjectByPath, l as metadataLiteFromSongMap, o as dropRecentProjectPath, r as clearLastProjectPath, x as patchMetadataForFolder, y as writeProjectSong, z as audioSession } from "../../chunks/commit.js";
import { t as Button } from "../../chunks/button.js";
import { _ as Dialog_title, a as getCurrentProject, d as Dropdown_menu_content, f as Dropdown_menu, h as Dialog_header, l as Dropdown_menu_trigger, m as Dialog_content, n as Chevron_down, o as loadCloudProject, p as Dialog_description, r as deleteCloudProject, s as saveCloudProject, t as Cloud, u as Dropdown_menu_item, v as Dialog } from "../../chunks/cloud.js";
import { t as Icon } from "../../chunks/Icon.js";
import "../../chunks/iterate.js";
import { t as desktopCompanionStatus } from "../../chunks/desktopCompanionStatus.js";
import { u as pickFolderViaDesktop } from "../../chunks/desktopBridge.js";
import { n as Music, t as Arrow_left } from "../../chunks/arrow-left.js";
import { t as page } from "../../chunks/stores.js";
import "../../chunks/analyzingState.js";
//#region src/lib/stores/serverAutosaveStatus.ts
var serverAutosaveStatus = writable({
	enabled: false,
	saving: false,
	lastCheckedAt: null,
	lastSavedAt: null,
	lastError: null,
	sessionId: null
});
//#endregion
//#region src/lib/components/LoadProjectDialog.svelte
function LoadProjectDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { open = false } = $$props;
		let projects = [];
		let autosave = null;
		let error = "";
		let loadingId = null;
		let deletingId = null;
		async function onLoad(id) {
			loadingId = id;
			error = "";
			const r = await loadCloudProject(id);
			loadingId = null;
			if (!r.ok) {
				error = r.error ?? "Failed to load project";
				return;
			}
			open = false;
			await goto("/edit");
		}
		async function onDelete(id) {
			deletingId = id;
			error = "";
			const r = await deleteCloudProject(id);
			deletingId = null;
			if (!r.ok) {
				error = r.error ?? "Failed to delete project";
				return;
			}
			projects = projects.filter((p) => p.id !== id);
		}
		function formatDate(iso) {
			const d = new Date(iso);
			const diffMs = (/* @__PURE__ */ new Date()).getTime() - d.getTime();
			const diffDays = Math.floor(diffMs / 864e5);
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
		let hasAnything = derived(() => autosave !== null || projects.length > 0);
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
											$$renderer.push(`<!---->Load from Cloud`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----> `);
									Dialog_description($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Choose a saved project to open.`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!---->`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> `);
							if (error) {
								$$renderer.push("<!--[1-->");
								$$renderer.push(`<p class="text-destructive text-sm">${escape_html(error)}</p>`);
							} else if (!hasAnything()) {
								$$renderer.push("<!--[2-->");
								$$renderer.push(`<p class="text-muted-foreground py-6 text-center text-sm">No cloud projects yet. Use <strong>File → Save to cloud</strong> to save your first project.</p>`);
							} else {
								$$renderer.push("<!--[-1-->");
								$$renderer.push(`<ul class="flex flex-col gap-2 overflow-y-auto">`);
								$$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--> <!--[-->`);
								const each_array = ensure_array_like(projects);
								for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
									let project = each_array[$$index];
									$$renderer.push(`<li class="border-foreground/15 bg-muted/30 flex items-center justify-between gap-3 rounded-lg border p-3"><div class="min-w-0 flex-1"><p class="truncate font-medium">${escape_html(project.name)}</p> <p class="text-muted-foreground mt-0.5 text-xs">${escape_html(formatDate(project.updatedAt))}</p></div> <div class="flex shrink-0 gap-2">`);
									Button($$renderer, {
										class: "",
										variant: "default",
										size: "sm",
										disabled: loadingId === project.id || deletingId === project.id,
										onclick: () => void onLoad(project.id),
										children: ($$renderer) => {
											$$renderer.push(`<!---->${escape_html(loadingId === project.id ? "Loading…" : "Load")}`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----> `);
									Button($$renderer, {
										variant: "outline",
										size: "sm",
										class: "text-destructive hover:text-destructive",
										disabled: deletingId === project.id || loadingId === project.id,
										onclick: () => void onDelete(project.id),
										children: ($$renderer) => {
											$$renderer.push(`<!---->${escape_html(deletingId === project.id ? "…" : "Delete")}`);
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
var STAFF_LINE_GAP = 1.8;
STAFF_LINE_GAP * 4;
STAFF_LINE_GAP * 2.4;
//#endregion
//#region node_modules/@lucide/svelte/dist/icons/monitor.svelte
function Monitor($$renderer, $$props) {
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
			{ name: "monitor" },
			props,
			{
				iconNode: [
					["rect", {
						"width": "20",
						"height": "14",
						"x": "2",
						"y": "3",
						"rx": "2"
					}],
					["line", {
						"x1": "8",
						"x2": "16",
						"y1": "21",
						"y2": "21"
					}],
					["line", {
						"x1": "12",
						"x2": "12",
						"y1": "17",
						"y2": "21"
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
//#region node_modules/@lucide/svelte/dist/icons/moon.svelte
function Moon($$renderer, $$props) {
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
			{ name: "moon" },
			props,
			{
				iconNode: [["path", { "d": "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" }]],
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
//#region node_modules/@lucide/svelte/dist/icons/sun.svelte
function Sun($$renderer, $$props) {
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
			{ name: "sun" },
			props,
			{
				iconNode: [
					["circle", {
						"cx": "12",
						"cy": "12",
						"r": "4"
					}],
					["path", { "d": "M12 2v2" }],
					["path", { "d": "M12 20v2" }],
					["path", { "d": "m4.93 4.93 1.41 1.41" }],
					["path", { "d": "m17.66 17.66 1.41 1.41" }],
					["path", { "d": "M2 12h2" }],
					["path", { "d": "M20 12h2" }],
					["path", { "d": "m6.34 17.66-1.41 1.41" }],
					["path", { "d": "m19.07 4.93-1.41 1.41" }]
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
//#region src/lib/components/AppMenuBar.svelte
function AppMenuBar($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		/**
		* App menu: shadcn dropdowns (File / Edit / View) + debug JSON dialog.
		*/
		let dark = false;
		function toggleDarkMode() {
			dark = !dark;
			document.documentElement.classList.toggle("dark", dark);
			try {
				localStorage.setItem("barbro-theme", dark ? "dark" : "light");
			} catch {}
		}
		let menuError = "";
		let loadProjectDialogOpen = false;
		let importInput = void 0;
		let debugOpen = false;
		let cloudConnected = derived(() => store_get($$store_subs ??= {}, "$serverAutosaveStatus", serverAutosaveStatus).enabled && !store_get($$store_subs ??= {}, "$serverAutosaveStatus", serverAutosaveStatus).lastError);
		let lastCheckedLabel = derived(() => store_get($$store_subs ??= {}, "$serverAutosaveStatus", serverAutosaveStatus).lastCheckedAt ? store_get($$store_subs ??= {}, "$serverAutosaveStatus", serverAutosaveStatus).lastCheckedAt.slice(11, 19) : "--:--:--");
		let lastSavedLabel = derived(() => store_get($$store_subs ??= {}, "$serverAutosaveStatus", serverAutosaveStatus).lastSavedAt ? store_get($$store_subs ??= {}, "$serverAutosaveStatus", serverAutosaveStatus).lastSavedAt.slice(11, 19) : "--:--:--");
		let currentProjectName = derived(() => {
			return null;
		});
		let cloudStatusTitle = derived(() => {
			const times = ` · checked ${lastCheckedLabel()} · saved ${lastSavedLabel()}`;
			if (store_get($$store_subs ??= {}, "$serverAutosaveStatus", serverAutosaveStatus).saving) return `Cloud: saving…${times}`;
			if (cloudConnected()) return `Cloud: connected${times}`;
			return `Cloud: disconnected${store_get($$store_subs ??= {}, "$serverAutosaveStatus", serverAutosaveStatus).lastError ? ` (${store_get($$store_subs ??= {}, "$serverAutosaveStatus", serverAutosaveStatus).lastError})` : ""}${times}`;
		});
		let desktopConnected = derived(() => store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).reachable);
		let desktopCheckedLabel = derived(() => store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).lastCheckedAt ? store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).lastCheckedAt.slice(11, 19) : "--:--:--");
		let desktopStatusTitle = derived(() => {
			const ping = ` · ping ${desktopCheckedLabel()}`;
			if (desktopConnected()) {
				const v = store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).version;
				return v ? `Desktop app: connected (v${v})${ping}` : `Desktop app: connected${ping}`;
			}
			return `Desktop app: not running${store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).lastError ? ` (${store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).lastError})` : ""}${ping}`;
		});
		const debugJsonText = derived(() => {
			const sm = store_get($$store_subs ??= {}, "$songMap", songMap);
			const sess = store_get($$store_subs ??= {}, "$audioSession", audioSession);
			const payload = {
				songMap: sm,
				audioSession: {
					name: sess.name,
					startSec: sess.startSec,
					endSec: sess.endSec,
					file: sess.file ? {
						name: sess.file.name,
						size: sess.file.size,
						type: sess.file.type
					} : null
				}
			};
			return JSON.stringify(payload, null, 2);
		});
		async function onExportFull() {
			menuError = "";
		}
		async function onExportMusicXml() {
			menuError = "";
		}
		async function onExportPdf() {
			menuError = "";
		}
		async function onSaveToServer() {
			menuError = "";
			const r = await saveCloudProject(getCurrentProject()?.id);
			if (!r.ok) menuError = r.error ?? "Cloud save failed";
		}
		function onRestoreFromServer() {
			menuError = "";
			loadProjectDialogOpen = true;
		}
		/**
		* Project mode is desktop-only. The sidecar's native picker returns the
		* absolute OS path, and that path is the project's canonical identity —
		* the web app never touches the filesystem directly for project I/O.
		*/
		async function onNewProject() {
			menuError = "";
			if (!store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).reachable) {
				menuError = "Desktop client unreachable — install/start BarBro desktop to manage projects.";
				return;
			}
			const pick = await pickFolderViaDesktop({ title: "Pick the folder that will contain the new project" });
			if (!pick.ok) {
				if ("cancelled" in pick) return;
				menuError = pick.error ?? "Could not open picker";
				return;
			}
			const name = window.prompt(`Project name (a new folder will be created inside the chosen location):`, "Untitled Project");
			if (name === null) return;
			try {
				await createProjectOnDisk(pick.path, name);
				refreshRecents();
				await goto("/project");
			} catch (e) {
				menuError = e instanceof Error ? e.message : "Could not create project";
			}
		}
		async function onOpenProject() {
			menuError = "";
			if (!store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).reachable) {
				menuError = "Desktop client unreachable — install/start BarBro desktop to manage projects.";
				return;
			}
			const pick = await pickFolderViaDesktop({ title: "Open a BarBro project folder" });
			if (!pick.ok) {
				if ("cancelled" in pick) return;
				menuError = pick.error ?? "Could not open picker";
				return;
			}
			try {
				await openProjectByPath(pick.path);
				refreshRecents();
				await goto("/project");
			} catch (e) {
				menuError = e instanceof Error ? e.message : "Could not open project";
			}
		}
		async function onBackToProject() {
			await goto("/project");
		}
		let recentProjects = [];
		function refreshRecents() {}
		async function onOpenRecent(entry) {
			menuError = "";
			if (!store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).reachable) {
				menuError = "Desktop client unreachable — start BarBro desktop and try again.";
				return;
			}
			try {
				await openProjectByPath(entry.path);
				refreshRecents();
				await goto("/project");
			} catch (e) {
				dropRecentProjectPath(entry.path);
				refreshRecents();
				menuError = e instanceof Error ? e.message : `Could not open "${entry.label}"`;
			}
		}
		/** Project open on disk (manifest + folder handle). */
		let isInProjectMode = derived(() => store_get($$store_subs ??= {}, "$projectStore", project).data !== null);
		/**
		* Logo target: in project mode the project view is home; otherwise fall
		* back to the song editor if a song's loaded, else the import page.
		*/
		let logoHref = derived(() => isInProjectMode() ? "/project" : store_get($$store_subs ??= {}, "$songMap", songMap) && store_get($$store_subs ??= {}, "$audioSession", audioSession).file ? "/edit" : "/");
		let logoAria = derived(() => isInProjectMode() ? `BarBro — back to project ${store_get($$store_subs ??= {}, "$projectStore", project).data?.name ?? ""}` : store_get($$store_subs ??= {}, "$songMap", songMap) && store_get($$store_subs ??= {}, "$audioSession", audioSession).file ? "BarBro — back to editor" : "BarBro — import audio");
		async function onCloseProject() {
			menuError = "";
			closeProject();
			clearFullAppSongState();
			clearLastProjectPath();
			await goto("/", { replaceState: true });
		}
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			$$renderer.push(`<header class="bg-background border-foreground fixed top-0 right-0 left-0 z-50 flex flex-wrap items-center gap-2 border-b-2 px-3 py-1.5 text-sm" aria-label="Application" data-app-menu=""><a${attr("href", logoHref())} class="text-foreground hover:text-foreground flex shrink-0 items-center gap-2 py-1 pr-2 transition-colors"${attr("aria-label", logoAria())}><span class="bg-muted text-foreground inline-flex size-8 items-center justify-center border-2 border-foreground" aria-hidden="true">`);
			Music($$renderer, {
				class: "size-4",
				strokeWidth: 2
			});
			$$renderer.push(`<!----></span> <span class="hidden font-semibold tracking-tight sm:inline">BarBro</span></a> <div class="flex flex-1 flex-wrap items-center gap-1.5">`);
			Dropdown_menu($$renderer, {
				children: ($$renderer) => {
					{
						function child($$renderer, { props }) {
							Button($$renderer, spread_props([
								{
									variant: "outline",
									size: "sm",
									class: "h-8 gap-1 px-2.5"
								},
								props,
								{
									children: ($$renderer) => {
										$$renderer.push(`<!---->File `);
										Chevron_down($$renderer, {
											class: "size-3.5 opacity-60",
											"aria-hidden": "true"
										});
										$$renderer.push(`<!---->`);
									},
									$$slots: { default: true }
								}
							]));
						}
						Dropdown_menu_trigger($$renderer, {
							child,
							$$slots: { child: true }
						});
					}
					$$renderer.push(`<!----> `);
					Dropdown_menu_content($$renderer, {
						align: "start",
						class: "min-w-[12rem]",
						children: ($$renderer) => {
							if (isInProjectMode()) {
								$$renderer.push("<!--[0-->");
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: onBackToProject,
									children: ($$renderer) => {
										$$renderer.push(`<!---->Back to Project`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => {
										onExportFull();
									},
									children: ($$renderer) => {
										$$renderer.push(`<!---->Save current song (.smap)…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => {
										onExportMusicXml();
									},
									children: ($$renderer) => {
										$$renderer.push(`<!---->Export as lead sheet (.musicxml)…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => {
										onExportPdf();
									},
									children: ($$renderer) => {
										$$renderer.push(`<!---->Export as PDF…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> <div class="bg-foreground/15 my-1 h-px" role="separator"></div> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => {
										onSaveToServer();
									},
									children: ($$renderer) => {
										$$renderer.push(`<!---->${escape_html(currentProjectName() ? `Save to cloud — "${currentProjectName()}"` : "Save current song to cloud")}`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> <div class="bg-foreground/15 my-1 h-px" role="separator"></div> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => void onCloseProject(),
									children: ($$renderer) => {
										$$renderer.push(`<!---->Close Project`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!---->`);
							} else {
								$$renderer.push("<!--[-1-->");
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => {
										onExportFull();
									},
									children: ($$renderer) => {
										$$renderer.push(`<!---->Save Song (.smap)…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => {
										importInput?.click();
									},
									children: ($$renderer) => {
										$$renderer.push(`<!---->Open Song (.smap)…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => {
										onExportMusicXml();
									},
									children: ($$renderer) => {
										$$renderer.push(`<!---->Export as lead sheet (.musicxml)…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => {
										onExportPdf();
									},
									children: ($$renderer) => {
										$$renderer.push(`<!---->Export as PDF…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> <div class="bg-foreground/15 my-1 h-px" role="separator"></div> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: onNewProject,
									children: ($$renderer) => {
										$$renderer.push(`<!---->New Project…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: onOpenProject,
									children: ($$renderer) => {
										$$renderer.push(`<!---->Open Project…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								if (recentProjects.length > 0) {
									$$renderer.push("<!--[0-->");
									$$renderer.push(`<div class="text-muted-foreground px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider">Recent</div> <!--[-->`);
									const each_array = ensure_array_like(recentProjects);
									for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
										let r = each_array[$$index];
										Dropdown_menu_item($$renderer, {
											class: "cursor-pointer",
											onclick: () => void onOpenRecent(r),
											children: ($$renderer) => {
												$$renderer.push(`<div class="flex w-full min-w-0 flex-col gap-0"><span class="truncate font-medium">${escape_html(r.label)}</span> <span class="text-muted-foreground truncate font-mono text-[10px]">${escape_html(r.path)}</span></div>`);
											},
											$$slots: { default: true }
										});
									}
									$$renderer.push(`<!--]-->`);
								} else $$renderer.push("<!--[-1-->");
								$$renderer.push(`<!--]--> <div class="bg-foreground/15 my-1 h-px" role="separator"></div> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: () => {
										onSaveToServer();
									},
									children: ($$renderer) => {
										$$renderer.push(`<!---->${escape_html(currentProjectName() ? `Save to cloud — "${currentProjectName()}"` : "Save to cloud")}`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!----> `);
								Dropdown_menu_item($$renderer, {
									class: "cursor-pointer",
									onclick: onRestoreFromServer,
									children: ($$renderer) => {
										$$renderer.push(`<!---->Load from cloud…`);
									},
									$$slots: { default: true }
								});
								$$renderer.push(`<!---->`);
							}
							$$renderer.push(`<!--]--> `);
							Dropdown_menu_item($$renderer, {
								class: "cursor-pointer",
								onclick: () => goto("/download"),
								children: ($$renderer) => {
									$$renderer.push(`<!---->Download desktop app…`);
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
			$$renderer.push(`<!----> `);
			Dropdown_menu($$renderer, {
				children: ($$renderer) => {
					{
						function child($$renderer, { props }) {
							Button($$renderer, spread_props([
								{
									variant: "outline",
									size: "sm",
									class: "h-8 gap-1 px-2.5"
								},
								props,
								{
									children: ($$renderer) => {
										$$renderer.push(`<!---->Edit `);
										Chevron_down($$renderer, {
											class: "size-3.5 opacity-60",
											"aria-hidden": "true"
										});
										$$renderer.push(`<!---->`);
									},
									$$slots: { default: true }
								}
							]));
						}
						Dropdown_menu_trigger($$renderer, {
							child,
							$$slots: { child: true }
						});
					}
					$$renderer.push(`<!----> `);
					Dropdown_menu_content($$renderer, {
						align: "start",
						class: "min-w-[10rem]",
						children: ($$renderer) => {
							Dropdown_menu_item($$renderer, {
								class: "cursor-not-allowed opacity-50",
								disabled: true,
								children: ($$renderer) => {
									$$renderer.push(`<!---->Undo (coming soon)`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> `);
							Dropdown_menu_item($$renderer, {
								class: "cursor-not-allowed opacity-50",
								disabled: true,
								children: ($$renderer) => {
									$$renderer.push(`<!---->Redo (coming soon)`);
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
			$$renderer.push(`<!----> `);
			Dropdown_menu($$renderer, {
				children: ($$renderer) => {
					{
						function child($$renderer, { props }) {
							Button($$renderer, spread_props([
								{
									variant: "outline",
									size: "sm",
									class: "h-8 gap-1 px-2.5"
								},
								props,
								{
									children: ($$renderer) => {
										$$renderer.push(`<!---->View `);
										Chevron_down($$renderer, {
											class: "size-3.5 opacity-60",
											"aria-hidden": "true"
										});
										$$renderer.push(`<!---->`);
									},
									$$slots: { default: true }
								}
							]));
						}
						Dropdown_menu_trigger($$renderer, {
							child,
							$$slots: { child: true }
						});
					}
					$$renderer.push(`<!----> `);
					Dropdown_menu_content($$renderer, {
						align: "start",
						class: "min-w-[10rem]",
						children: ($$renderer) => {
							Dropdown_menu_item($$renderer, {
								class: "cursor-not-allowed opacity-50",
								disabled: true,
								children: ($$renderer) => {
									$$renderer.push(`<!---->Zoom controls (coming soon)`);
								},
								$$slots: { default: true }
							});
						},
						$$slots: { default: true }
					});
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----></div> <div class="ml-auto flex shrink-0 items-center gap-2"><a href="/download"${attr_class(`inline-flex size-8 items-center justify-center border-2 no-underline ${stringify(desktopConnected() ? "border-emerald-600 bg-emerald-100 text-emerald-800 dark:border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200" : "border-muted-foreground/50 bg-muted/40 text-muted-foreground hover:border-foreground/40 hover:bg-muted/60")}`)}${attr("title", desktopStatusTitle())}${attr("aria-label", desktopStatusTitle())}>`);
			Monitor($$renderer, {
				class: "size-4",
				"aria-hidden": "true"
			});
			$$renderer.push(`<!----></a> <span${attr_class(`inline-flex size-8 items-center justify-center border-2 ${stringify(cloudConnected() ? "border-emerald-600 bg-emerald-100 text-emerald-800 dark:border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200" : "border-rose-600 bg-rose-100 text-rose-800 dark:border-rose-300 dark:bg-rose-950 dark:text-rose-200")} ${stringify(store_get($$store_subs ??= {}, "$serverAutosaveStatus", serverAutosaveStatus).saving ? "animate-pulse" : "")}`)}${attr("title", cloudStatusTitle())}${attr("aria-label", cloudStatusTitle())}>`);
			Cloud($$renderer, {
				class: "size-4",
				"aria-hidden": "true"
			});
			$$renderer.push(`<!----></span> `);
			Button($$renderer, {
				type: "button",
				variant: "outline",
				size: "icon",
				class: "size-8",
				onclick: toggleDarkMode,
				"aria-label": dark ? "Switch to light mode" : "Switch to dark mode",
				children: ($$renderer) => {
					if (dark) {
						$$renderer.push("<!--[0-->");
						Sun($$renderer, { class: "size-4" });
					} else {
						$$renderer.push("<!--[-1-->");
						Moon($$renderer, { class: "size-4" });
					}
					$$renderer.push(`<!--]-->`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----> `);
			Button($$renderer, {
				type: "button",
				variant: "outline",
				size: "sm",
				class: "h-8",
				onclick: () => {
					debugOpen = true;
				},
				children: ($$renderer) => {
					$$renderer.push(`<!---->Inspect JSON`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----> `);
			if (!isInProjectMode()) {
				$$renderer.push("<!--[0-->");
				Button($$renderer, {
					type: "button",
					variant: "outline",
					size: "sm",
					class: "h-8",
					onclick: () => goto("/set"),
					title: "Experimental: export Ableton Live set",
					children: ($$renderer) => {
						$$renderer.push(`<!---->Set ⚗`);
					},
					$$slots: { default: true }
				});
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div> `);
			if (menuError) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<p class="text-destructive w-full max-w-md truncate text-xs sm:w-auto" role="status">${escape_html(menuError)}</p>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <input type="file" class="sr-only" accept=".smap,.json,application/json" aria-label="Import song bundle"/></header> `);
			LoadProjectDialog($$renderer, {
				get open() {
					return loadProjectDialogOpen;
				},
				set open($$value) {
					loadProjectDialogOpen = $$value;
					$$settled = false;
				}
			});
			$$renderer.push(`<!----> `);
			Dialog($$renderer, {
				get open() {
					return debugOpen;
				},
				set open($$value) {
					debugOpen = $$value;
					$$settled = false;
				},
				children: ($$renderer) => {
					Dialog_content($$renderer, {
						class: "flex max-h-[85vh] w-full max-w-[min(56rem,calc(100%-2rem))] flex-col gap-3 p-4 sm:max-w-[min(56rem,calc(100%-2rem))]",
						showCloseButton: true,
						children: ($$renderer) => {
							Dialog_header($$renderer, {
								children: ($$renderer) => {
									Dialog_title($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Project JSON`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!----> `);
									Dialog_description($$renderer, {
										children: ($$renderer) => {
											$$renderer.push(`<!---->Live song map and audio session metadata. Audio bytes are not shown here.`);
										},
										$$slots: { default: true }
									});
									$$renderer.push(`<!---->`);
								},
								$$slots: { default: true }
							});
							$$renderer.push(`<!----> <pre class="border-foreground/10 bg-muted/20 text-foreground/90 max-h-[min(60vh,32rem)] overflow-auto rounded-lg border p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">${escape_html(debugJsonText())}</pre>`);
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
	});
}
//#endregion
//#region node_modules/@lucide/svelte/dist/icons/folder-open.svelte
function Folder_open($$renderer, $$props) {
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
			{ name: "folder-open" },
			props,
			{
				iconNode: [["path", { "d": "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" }]],
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
//#region src/lib/components/ProjectContextBar.svelte
function ProjectContextBar($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		/**
		* Persistent context bar under the AppMenuBar showing which project is
		* currently loaded + a one-click way back to the project view. Visible
		* only when a project is open and we aren't already on `/project`.
		*
		* Replaces the smaller chip that used to live inside the menubar — the
		* full bar is impossible to miss and gives the back action top-level
		* priority instead of burying it in a dropdown.
		*/
		let isInProjectMode = derived(() => store_get($$store_subs ??= {}, "$projectStore", project).data !== null);
		let onProjectRoute = derived(() => store_get($$store_subs ??= {}, "$page", page).route?.id === "/project");
		let visible = derived(() => isInProjectMode() && !onProjectRoute());
		let projectName = derived(() => store_get($$store_subs ??= {}, "$projectStore", project).data?.name?.trim() || "project");
		/** When on /edit, show the song title for extra context. */
		let songTitle = derived(() => {
			const id = store_get($$store_subs ??= {}, "$page", page).route?.id;
			if (id !== "/edit" && id !== "/set") return null;
			return store_get($$store_subs ??= {}, "$songMap", songMap)?.metadata.title?.trim() || null;
		});
		async function backToProject() {
			await goto("/project");
		}
		if (visible()) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="border-foreground bg-foreground text-background fixed top-12 right-0 left-0 z-40 flex flex-wrap items-center gap-3 border-b-2 px-3 py-1.5 text-sm" role="navigation" aria-label="Project context">`);
			Button($$renderer, {
				variant: "secondary",
				size: "sm",
				class: "h-8 shrink-0 gap-1.5 px-2.5",
				onclick: () => void backToProject(),
				"aria-label": `Back to project ${stringify(projectName())}`,
				children: ($$renderer) => {
					Arrow_left($$renderer, {
						class: "size-4",
						"aria-hidden": "true"
					});
					$$renderer.push(`<!----> Back to project`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----> <div class="flex min-w-0 flex-1 items-center gap-2">`);
			Folder_open($$renderer, {
				class: "size-4 shrink-0 opacity-70",
				"aria-hidden": "true"
			});
			$$renderer.push(`<!----> <span class="truncate font-semibold tracking-tight">${escape_html(projectName())}</span> `);
			if (songTitle()) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<span class="opacity-50" aria-hidden="true">/</span> <span class="text-background/80 truncate font-mono text-xs">${escape_html(songTitle())}</span>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
//#region src/lib/client/projectAutosave.ts
/**
* Project song auto-save: subscribes to the songMap store and writes
* `song.smap` to the project folder via the desktop sidecar when **all**
* of the following hold:
*
* 1. A project is open (`project.osPath` non-null)
* 2. `project.activeSongFolder` is non-null
* 3. `project.activeSongId` is non-null
* 4. `project.editingMode === 'project-song'`
* 5. Current route is `/edit` (read from `$page.route.id`)
* 6. The desktop companion is reachable (sidecar ping succeeded)
* 7. **Manifest invariant**: there exists an entry `e` in the manifest with
*    `e.folder === activeSongFolder` AND `e.id === activeSongId`
*
* Any failure of these guards aborts the write — no exception leaks. The
* `id` mismatch in (7) catches the case where the manifest changed
* underneath us (entry removed, replaced, path-edited).
*
* The manifest itself is NOT rewritten by autosave. Manifest changes only
* happen in response to structural edits (add/remove/hide/reorder/rename).
*/
var DEBOUNCE_MS = 1500;
var debounceTimer = null;
var writing = false;
var pendingWhileWriting = false;
async function tryWriteOnce() {
	const snap = get(project);
	const sm = get(songMap);
	if (!sm) return;
	if (!snap.data || !snap.osPath) return;
	if (!snap.activeSongFolder || !snap.activeSongId) return;
	if (snap.editingMode !== "project-song") return;
	if (get(page)?.route?.id !== "/edit") return;
	if (!snap.data.songs.find((e) => e.folder === snap.activeSongFolder && e.id === snap.activeSongId)) return;
	if (!get(desktopCompanionStatus).reachable) return;
	const state = restorableSongState(sm, get(audioSession).file ?? null);
	let blob;
	try {
		blob = await exportRestorableStateAsSmapBlob(state);
	} catch {
		return;
	}
	const bytes = new Uint8Array(await blob.arrayBuffer());
	if (!(await writeProjectSong(snap.osPath, snap.activeSongFolder, bytes)).ok) return;
	patchMetadataForFolder(snap.activeSongFolder, metadataLiteFromSongMap(sm));
}
function schedule() {
	if (debounceTimer) clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		if (writing) {
			pendingWhileWriting = true;
			return;
		}
		writing = true;
		tryWriteOnce().catch(() => {}).finally(() => {
			writing = false;
			if (pendingWhileWriting) {
				pendingWhileWriting = false;
				schedule();
			}
		});
	}, DEBOUNCE_MS);
}
//#endregion
//#region src/routes/+layout.svelte
function _layout($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let { data } = $$props;
		function isAnalyzed(sm) {
			if (!sm) return false;
			return sm.metadata.analyzed ?? sm.timeline.bars.length > 0;
		}
		onDestroy(() => {});
		beforeNavigate((nav) => {
			if (!nav.to) return;
			if (nav.to.url.pathname !== "/") return;
			if (nav.to.url.searchParams.has("project")) return;
			const sm = get(songMap);
			if (!sm) return;
			if (isAnalyzed(sm)) {
				nav.cancel();
				goto("/edit", { replaceState: true });
			}
		});
		let showProjectBar = derived(() => store_get($$store_subs ??= {}, "$projectStore", project).data !== null && store_get($$store_subs ??= {}, "$page", page).route?.id !== "/project");
		head("12qhfyh", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>BarBro</title>`);
			});
			$$renderer.push(`<meta name="description" content="BarBro — bar-first songs, beats, and cues."/>`);
		});
		$$renderer.push(`<div class="relative min-h-dvh overflow-x-hidden overscroll-x-none font-sans"><div class="relative z-30">`);
		AppMenuBar($$renderer, {});
		$$renderer.push(`<!----> `);
		ProjectContextBar($$renderer, {});
		$$renderer.push(`<!----></div> <div${attr_class(clsx(showProjectBar() ? "pt-[5.25rem]" : "pt-12"))}>`);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <!--[-->`);
		slot($$renderer, $$props, "default", {}, null);
		$$renderer.push(`<!--]--></div></div>`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
export { _layout as default };
