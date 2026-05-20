import "../../../chunks/index-server.js";
import { A as escape_html, O as attr, a as derived, c as head, s as ensure_array_like } from "../../../chunks/server.js";
import { t as Button } from "../../../chunks/button.js";
import { t as DESKTOP_ARTIFACT_KEYS } from "../../../chunks/downloadsManifest.js";
//#endregion
//#region src/routes/download/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		let detectedKey = null;
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
				$$renderer.push(`<title>Download BarBro Desktop</title>`);
			});
		});
		$$renderer.push(`<main class="mx-auto max-w-2xl px-4 py-10 sm:px-6"><h1 class="mb-2 text-2xl font-black tracking-tight">BarBro Desktop</h1> <p class="text-muted-foreground mb-8 text-sm leading-relaxed">Install the companion app for local beat detection and filesystem workflows. Pick the build that matches your
    machine — we detect macOS vs Windows and Apple silicon vs Intel when possible.</p> `);
		if (data.manifestError) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="border-destructive text-destructive mb-6 border-2 bg-rose-50 px-4 py-3 text-sm dark:bg-rose-950/40" role="alert">Could not load download manifest: ${escape_html(data.manifestError)}</div>`);
		} else if (data.manifest) {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<p class="text-muted-foreground mb-4 text-xs uppercase tracking-wider">Manifest v${escape_html(data.manifest.version)} `);
			if (data.manifestSource === "remote") {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`· remote`);
			} else if (data.manifestSource === "static") {
				$$renderer.push("<!--[1-->");
				$$renderer.push(`· bundled list`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></p> `);
			if (recommended()) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<section class="border-foreground brutalist-shadow bg-background mb-8 border-2 p-4 sm:p-5" aria-labelledby="rec-heading"><h2 id="rec-heading" class="mb-2 text-xs font-bold tracking-wide uppercase">Recommended for this device</h2> <p class="mb-3 font-semibold">${escape_html(recommended().label)}</p> `);
				if (recommended().url) {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<a${attr("href", recommended().url)} class="border-foreground bg-foreground text-background inline-flex items-center justify-center border-2 px-4 py-2 text-sm font-bold no-underline hover:opacity-90">Download</a>`);
				} else {
					$$renderer.push("<!--[-1-->");
					$$renderer.push(`<p class="text-muted-foreground text-sm">No installer URL configured yet for this platform.</p>`);
				}
				$$renderer.push(`<!--]--></section>`);
			} else if (detectedKey === null) {
				$$renderer.push("<!--[1-->");
				$$renderer.push(`<p class="text-muted-foreground mb-6 text-sm">Could not detect your OS/arch — use the list below.</p>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <section class="border-foreground border-2" aria-labelledby="all-heading"><h2 id="all-heading" class="border-foreground border-b-2 px-4 py-2 text-xs font-bold tracking-wide uppercase">All platforms</h2> <ul class="divide-foreground/20 divide-y-2"><!--[-->`);
			const each_array = ensure_array_like(rows(data.manifest));
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let row = each_array[$$index];
				$$renderer.push(`<li class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><span class="font-medium">${escape_html(row.label)}</span> `);
				if (row.recommended) {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<span class="text-muted-foreground ml-2 text-xs">(detected)</span>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> <div class="text-muted-foreground font-mono text-[11px]">${escape_html(row.key)}</div></div> `);
				if (row.url) {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<a${attr("href", row.url)} class="border-foreground text-foreground shrink-0 self-start border-2 px-3 py-1.5 text-xs font-semibold no-underline hover:bg-foreground/5 sm:self-center">Download</a>`);
				} else {
					$$renderer.push("<!--[-1-->");
					$$renderer.push(`<span class="text-muted-foreground text-xs">Coming soon</span>`);
				}
				$$renderer.push(`<!--]--></li>`);
			}
			$$renderer.push(`<!--]--></ul></section>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<p class="text-muted-foreground text-sm">No manifest available.</p>`);
		}
		$$renderer.push(`<!--]--> <div class="mt-10 border-foreground/30 border-t pt-6"><p class="text-muted-foreground mb-3 text-xs leading-relaxed"><strong class="text-foreground">Deploy:</strong> set <code class="bg-muted px-1">PUBLIC_DESKTOP_MANIFEST_URL</code> to an HTTPS JSON file with the same shape as <code class="bg-muted px-1">/desktop-downloads.json</code>. CI can publish installers anywhere (GitHub Releases, R2,
      etc.) and point that URL at the latest manifest.</p> `);
		Button($$renderer, {
			variant: "outline",
			size: "sm",
			class: "h-8",
			href: "/",
			children: ($$renderer) => {
				$$renderer.push(`<!---->Back to BarBro`);
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----></div></main>`);
	});
}
//#endregion
export { _page as default };
