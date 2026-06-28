import "../../../chunks/index-server.js";
import { A as escape_html, O as attr, a as derived, c as head, h as unsubscribe_stores, m as stringify, n as attr_style, p as store_get, s as ensure_array_like } from "../../../chunks/server.js";
import "../../../chunks/navigation.js";
import { t as Check } from "../../../chunks/check.js";
import "../../../chunks/desktopBeacon.js";
import { t as desktopCompanionStatus } from "../../../chunks/desktopCompanionStatus.js";
import { t as Arrow_right } from "../../../chunks/arrow-right.js";
import { t as Download } from "../../../chunks/download.js";
import { t as Loader_circle } from "../../../chunks/loader-circle.js";
import { t as Refresh_cw } from "../../../chunks/refresh-cw.js";
import { t as Triangle_alert } from "../../../chunks/triangle-alert.js";
import { t as DESKTOP_ARTIFACT_KEYS } from "../../../chunks/downloadsManifest.js";
//#endregion
//#region src/routes/download/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		const reachable = derived(() => store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).reachable);
		const version = derived(() => store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).version);
		const versionStatus = derived(() => store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).versionStatus);
		const pythonHealth = derived(() => store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).pythonHealth);
		const brokenChecks = derived(() => store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).brokenChecks);
		const setup = derived(() => store_get($$store_subs ??= {}, "$desktopCompanionStatus", desktopCompanionStatus).setup);
		let { data } = $$props;
		let detectedKey = null;
		let checking = false;
		let recommended = derived(() => {
			data.manifest;
			return null;
		});
		function rows(m) {
			if (!m) return [];
			return DESKTOP_ARTIFACT_KEYS.map((key) => {
				const row = m.artifacts[key];
				return {
					key,
					label: row?.label ?? key,
					url: row?.url?.trim() ?? "",
					recommended: detectedKey === key
				};
			});
		}
		head("fw0qxd", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>Start BarBro Desktop</title>`);
			});
		});
		$$renderer.push(`<main class="mx-auto max-w-2xl px-4 py-16 sm:px-6">`);
		if (reachable() && pythonHealth() === "installing") {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<h1 class="mb-6 flex items-center gap-3 text-3xl font-black tracking-tight sm:text-4xl">`);
			Loader_circle($$renderer, {
				class: "size-8 shrink-0 animate-spin",
				"aria-hidden": "true"
			});
			$$renderer.push(`<!----> Getting things ready.</h1> `);
			if (setup()) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<div class="border-foreground/30 mb-6 border-2 p-4"><div class="mb-3 flex items-center justify-between gap-2"><span class="text-xs font-bold uppercase tracking-wider">Overall</span> <span class="font-mono text-xs tabular-nums">${escape_html(setup().overall)}%</span></div> <div class="border-foreground/30 bg-background relative h-3 w-full border"><div class="bg-foreground absolute inset-y-0 left-0 transition-[width] duration-300"${attr_style(`width: ${stringify(setup().overall)}%`)}></div></div> <ul class="mt-4 space-y-2 text-xs"><!--[-->`);
				const each_array = ensure_array_like(setup().stages);
				for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
					let s = each_array[$$index];
					$$renderer.push(`<li class="flex items-center justify-between gap-2"><span class="font-mono uppercase tracking-wider">${escape_html(s.name)}</span> <span class="text-muted-foreground min-w-0 flex-1 truncate text-right text-[11px]">`);
					if (s.status === "done") {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`✓ ready`);
					} else if (s.status === "error") {
						$$renderer.push("<!--[1-->");
						$$renderer.push(`⛔ ${escape_html(s.error ?? "failed")}`);
					} else if (s.status === "skipped") {
						$$renderer.push("<!--[2-->");
						$$renderer.push(`skipped (heavy — install on demand)`);
					} else if (s.status === "running") {
						$$renderer.push("<!--[3-->");
						$$renderer.push(`${escape_html(s.label ?? "working…")} (${escape_html(s.progress ?? 0)}%)`);
					} else {
						$$renderer.push("<!--[-1-->");
						$$renderer.push(`waiting…`);
					}
					$$renderer.push(`<!--]--></span></li>`);
				}
				$$renderer.push(`<!--]--></ul></div>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <button type="button"${attr("disabled", checking, true)} class="border-foreground bg-background text-foreground inline-flex items-center justify-center gap-2 border-2 px-4 py-2 text-sm font-bold no-underline hover:bg-foreground/5 disabled:opacity-50">`);
			Refresh_cw($$renderer, {
				class: `size-3.5 ${stringify("")}`,
				"aria-hidden": "true"
			});
			$$renderer.push(`<!----> Refresh status</button>`);
		} else if (reachable() && versionStatus() === "outdated") {
			$$renderer.push("<!--[2-->");
			$$renderer.push(`<h1 class="mb-3 flex items-center gap-3 text-3xl font-black tracking-tight sm:text-4xl">`);
			Download($$renderer, {
				class: "size-8 shrink-0",
				"aria-hidden": "true"
			});
			$$renderer.push(`<!----> BarBro Desktop needs an update.</h1> <p class="text-muted-foreground mb-6 text-base">Update to keep using BarBro.</p> <ol class="border-foreground/30 mb-8 list-decimal border-2 pl-8 pr-4 py-4 text-sm marker:font-bold"><li class="py-1">Quit BarBro Desktop. Right-click its icon in the Dock, then choose <span class="font-semibold">Quit</span>.</li> <li class="py-1">Download the new version below and open the file.</li> <li class="py-1">Drag BarBro Desktop into <span class="font-semibold">Applications</span>. When asked, click <span class="font-semibold">Replace</span>.</li> <li class="py-1">Open the new BarBro Desktop from Applications, then come back here.</li></ol> <div class="flex flex-col gap-3 sm:flex-row sm:items-center">`);
			if (data.manifest && recommended() && recommended().url) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<a${attr("href", recommended().url)} class="border-foreground brutalist-shadow bg-foreground text-background inline-flex items-center justify-center gap-2 border-2 px-6 py-3 text-base font-bold no-underline hover:opacity-90">`);
				Download($$renderer, {
					class: "size-4",
					"aria-hidden": "true"
				});
				$$renderer.push(`<!----> Download for ${escape_html(recommended().label)}</a>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <button type="button"${attr("disabled", checking, true)} class="border-foreground bg-background text-foreground inline-flex items-center justify-center gap-2 border-2 px-4 py-3 text-sm font-bold no-underline hover:bg-foreground/5 disabled:opacity-50">`);
			Refresh_cw($$renderer, {
				class: `size-3.5 ${stringify("")}`,
				"aria-hidden": "true"
			});
			$$renderer.push(`<!----> ${escape_html("I've updated — check again")}</button></div>`);
		} else if (reachable() && pythonHealth() === "broken") {
			$$renderer.push("<!--[3-->");
			$$renderer.push(`<h1 class="mb-3 flex items-center gap-3 text-3xl font-black tracking-tight sm:text-4xl">`);
			Triangle_alert($$renderer, {
				class: "text-amber-600 dark:text-amber-400 size-8 shrink-0",
				"aria-hidden": "true"
			});
			$$renderer.push(`<!----> BarBro Desktop is broken.</h1> <p class="text-muted-foreground mb-6 text-base">The desktop client is running but its analysis engine is missing
      Python dependencies. Reinstall the latest BarBro Desktop build to fix.</p> `);
			if (brokenChecks().length > 0) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<ul class="border-foreground/30 mb-8 border-2 divide-foreground/15 divide-y text-xs"><!--[-->`);
				const each_array_1 = ensure_array_like(brokenChecks());
				for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
					let c = each_array_1[$$index_1];
					$$renderer.push(`<li class="px-3 py-2"><p class="font-mono font-semibold uppercase tracking-wider">${escape_html(c.name)}</p> <p class="text-muted-foreground mt-0.5 break-all font-mono text-[11px]">${escape_html(c.error ?? "unknown error")}</p></li>`);
				}
				$$renderer.push(`<!--]--></ul>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <button type="button"${attr("disabled", checking, true)} class="border-foreground brutalist-shadow bg-foreground text-background inline-flex items-center justify-center gap-2 border-2 px-6 py-3 text-base font-bold no-underline hover:opacity-90 disabled:opacity-50">`);
			Refresh_cw($$renderer, {
				class: `size-4 ${stringify("")}`,
				"aria-hidden": "true"
			});
			$$renderer.push(`<!----> ${escape_html("Check again")}</button>`);
		} else if (reachable()) {
			$$renderer.push("<!--[4-->");
			$$renderer.push(`<h1 class="mb-3 flex items-center gap-3 text-3xl font-black tracking-tight sm:text-4xl">`);
			Check($$renderer, {
				class: "text-emerald-600 dark:text-emerald-400 size-8 shrink-0",
				"aria-hidden": "true"
			});
			$$renderer.push(`<!----> BarBro Desktop is running.</h1> <p class="text-muted-foreground mb-10 text-base">Connected${escape_html(version() ? ` (v${version()})` : "")}. You're good to go.</p> <button type="button" class="border-foreground brutalist-shadow bg-foreground text-background inline-flex items-center justify-center gap-2 border-2 px-6 py-3 text-base font-bold no-underline hover:opacity-90">Continue to BarBro `);
			Arrow_right($$renderer, {
				class: "size-4",
				"aria-hidden": "true"
			});
			$$renderer.push(`<!----></button>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<h1 class="mb-3 text-3xl font-black tracking-tight sm:text-4xl">BarBro Desktop isn't running.</h1> <p class="text-muted-foreground mb-10 text-base">Launch it from your Applications folder, then come back here.</p> <button type="button"${attr("disabled", checking, true)} class="border-foreground brutalist-shadow bg-foreground text-background inline-flex items-center justify-center gap-2 border-2 px-6 py-3 text-base font-bold no-underline hover:opacity-90 disabled:opacity-50">`);
			Refresh_cw($$renderer, {
				class: `size-4 ${stringify("")}`,
				"aria-hidden": "true"
			});
			$$renderer.push(`<!----> ${escape_html("I've started it — check again")}</button>`);
		}
		$$renderer.push(`<!--]--> `);
		if (!(reachable() && versionStatus() === "outdated")) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="border-foreground/30 mt-12 border-t pt-8"><h2 class="mb-2 text-sm font-bold tracking-wide uppercase">Don't have it yet?</h2> `);
			if (data.manifest && recommended() && recommended().url) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<p class="text-muted-foreground mb-3 text-sm">Download the build for ${escape_html(recommended().label)}, install, then come back here.</p> <a${attr("href", recommended().url)} class="border-foreground inline-flex items-center justify-center border-2 px-4 py-2 text-sm font-bold no-underline hover:bg-foreground/5">Download for ${escape_html(recommended().label)}</a>`);
			} else if (data.manifest && recommended() && !recommended().url) {
				$$renderer.push("<!--[1-->");
				$$renderer.push(`<p class="text-muted-foreground text-sm">No installer published yet for ${escape_html(recommended().label)}. See the other-platforms list below.</p>`);
			} else if (data.manifest && detectedKey === null) {
				$$renderer.push("<!--[2-->");
				$$renderer.push(`<p class="text-muted-foreground text-sm">Couldn't detect your platform automatically. Pick from the list below.</p>`);
			} else if (data.manifestError) {
				$$renderer.push("<!--[3-->");
				$$renderer.push(`<p class="text-destructive text-sm" role="alert">Couldn't load the download list: ${escape_html(data.manifestError)}</p>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (recommended()?.key?.startsWith("darwin")) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<div class="border-foreground/30 mt-6 border-2 p-4 text-sm"><p class="mb-3 text-xs font-bold uppercase tracking-wider">First time opening on macOS?</p> <ol class="list-decimal space-y-1.5 pl-5"><li>Open BarBro Desktop. macOS will block it — close the warning.</li> <li>Open <span class="font-semibold">System Settings → Privacy &amp; Security</span>.</li> <li>Scroll down. Click <span class="font-semibold">Open Anyway</span> next to BarBro Desktop.</li> <li>Confirm by clicking <span class="font-semibold">Open Anyway</span> again.</li></ol></div>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (data.manifest) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<details class="mt-4"><summary class="text-muted-foreground hover:text-foreground cursor-pointer text-xs uppercase tracking-wider select-none">Other platforms</summary> <ul class="border-foreground mt-3 border-2 divide-foreground/20 divide-y-2"><!--[-->`);
				const each_array_2 = ensure_array_like(rows(data.manifest));
				for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
					let row = each_array_2[$$index_2];
					$$renderer.push(`<li class="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"><div><span class="font-medium text-sm">${escape_html(row.label)}</span> `);
					if (row.recommended) {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<span class="text-muted-foreground ml-2 text-xs">(your machine)</span>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--></div> `);
					if (row.url) {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<a${attr("href", row.url)} class="border-foreground text-foreground shrink-0 self-start border-2 px-3 py-1 text-xs font-semibold no-underline hover:bg-foreground/5 sm:self-center">Download</a>`);
					} else {
						$$renderer.push("<!--[-1-->");
						$$renderer.push(`<span class="text-muted-foreground text-xs">Coming soon</span>`);
					}
					$$renderer.push(`<!--]--></li>`);
				}
				$$renderer.push(`<!--]--></ul></details>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></main>`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
export { _page as default };
