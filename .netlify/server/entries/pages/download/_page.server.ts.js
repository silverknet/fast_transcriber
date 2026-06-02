import { r as public_env } from "../../../chunks/shared-server.js";
import { n as parseDesktopDownloadsManifest } from "../../../chunks/downloadsManifest.js";
//#region src/routes/download/+page.server.ts
async function load({ fetch, url }) {
	const remote = public_env.PUBLIC_DESKTOP_MANIFEST_URL?.trim();
	const targets = [];
	if (remote) targets.push({
		label: "remote manifest",
		href: remote
	});
	targets.push({
		label: "static",
		href: new URL("/desktop-downloads.json", url).href
	});
	let lastErr = null;
	for (const t of targets) try {
		const res = await fetch(t.href, { cache: "no-store" });
		if (!res.ok) {
			lastErr = `${t.label}: HTTP ${res.status}`;
			continue;
		}
		const manifest = parseDesktopDownloadsManifest(await res.json());
		if (!manifest) {
			lastErr = `${t.label}: invalid manifest JSON`;
			continue;
		}
		return {
			manifest,
			manifestSource: remote && t.label === "remote manifest" ? "remote" : "static",
			manifestError: null
		};
	} catch (e) {
		lastErr = `${t.label}: ${e instanceof Error ? e.message : String(e)}`;
	}
	return {
		manifest: null,
		manifestSource: null,
		manifestError: lastErr
	};
}
//#endregion
export { load };
