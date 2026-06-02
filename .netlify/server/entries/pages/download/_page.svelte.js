import "../../../chunks/index-server.js";
import { A as escape_html, O as attr, a as derived, c as head, m as stringify, s as ensure_array_like } from "../../../chunks/server.js";
import "../../../chunks/desktopCompanionStatus.js";
import "../../../chunks/desktopBeacon.js";
import { t as Refresh_cw } from "../../../chunks/refresh-cw.js";
import { t as DESKTOP_ARTIFACT_KEYS } from "../../../chunks/downloadsManifest.js";
//#endregion
//#region src/routes/download/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
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
		$$renderer.push(`<main class="mx-auto max-w-2xl px-4 py-16 sm:px-6"><h1 class="mb-3 text-3xl font-black tracking-tight sm:text-4xl">BarBro Desktop isn't running.</h1> <p class="text-muted-foreground mb-10 text-base">Launch it from your Applications folder, then come back here.</p> <button type="button"${attr("disabled", checking, true)} class="border-foreground brutalist-shadow bg-foreground text-background inline-flex items-center justify-center gap-2 border-2 px-6 py-3 text-base font-bold no-underline hover:opacity-90 disabled:opacity-50">`);
		Refresh_cw($$renderer, {
			class: `size-4 ${stringify("")}`,
			"aria-hidden": "true"
		});
		$$renderer.push(`<!----> ${escape_html("I've started it — check again")}</button> <div class="border-foreground/30 mt-12 border-t pt-8"><h2 class="mb-2 text-sm font-bold tracking-wide uppercase">Don't have it yet?</h2> `);
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
		if (data.manifest) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<details class="mt-4"><summary class="text-muted-foreground hover:text-foreground cursor-pointer text-xs uppercase tracking-wider select-none">Other platforms</summary> <ul class="border-foreground mt-3 border-2 divide-foreground/20 divide-y-2"><!--[-->`);
			const each_array = ensure_array_like(rows(data.manifest));
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let row = each_array[$$index];
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
		$$renderer.push(`<!--]--></div></main>`);
	});
}
//#endregion
export { _page as default };
