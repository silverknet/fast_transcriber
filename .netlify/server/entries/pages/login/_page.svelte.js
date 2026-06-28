import { A as escape_html, O as attr, c as head } from "../../../chunks/server.js";
import { t as Button } from "../../../chunks/button.js";
import { t as Mail } from "../../../chunks/mail.js";
import "../../../chunks/forms.js";
//#region src/routes/login/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* `/login` page — Google OAuth primary, magic link fallback.
		*
		* The Google action returns the OAuth URL; we redirect via
		* `window.location` so popup-blocker rules don't fire and so the
		* Electron shell can intercept the navigation when running on desktop
		* (where it forwards to the system browser per the locked Phase 1
		* decision in the plan).
		*/
		let { data, form } = $$props;
		let busy = false;
		head("1x05zx6", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>Sign in · BarBro</title>`);
			});
		});
		$$renderer.push(`<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12"><h1 class="text-3xl font-black tracking-tight">Sign in to BarBro</h1> `);
		if (data.isSignedIn) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<p class="text-sm">You're already signed in.</p> <a class="underline"${attr("href", data.next)}>Continue</a>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<form method="POST" action="?/google">`);
			Button($$renderer, {
				type: "submit",
				class: "w-full gap-2",
				disabled: busy,
				children: ($$renderer) => {
					$$renderer.push(`<svg viewBox="0 0 48 48" aria-hidden="true" class="size-4"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-23.3-4 12 12 0 0 1 19.6-9.3l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.3-.4-3.5z"></path><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"></path><path fill="#4CAF50" d="M24 44a20 20 0 0 0 13.5-5.2l-6.2-5.3A12 12 0 0 1 12.8 28l-6.5 5A20 20 0 0 0 24 44z"></path><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4 5.5l6.1 5.2c-.4.4 6.6-4.8 6.6-14.7 0-1.2-.1-2.3-.4-3.5z"></path></svg> Continue with Google`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----></form> <div class="text-muted-foreground flex items-center gap-3 text-xs"><div class="border-foreground/20 flex-1 border-t"></div> or <div class="border-foreground/20 flex-1 border-t"></div></div> <form method="POST" action="?/magic" class="flex flex-col gap-3"><label class="flex flex-col gap-1.5 text-sm"><span class="text-muted-foreground text-xs">Email</span> <input name="email" type="email" required="" autocomplete="email" placeholder="you@example.com"${attr("value", form?.email ?? "")} class="border-foreground/30 bg-background w-full border-2 px-3 py-2 text-sm focus:border-foreground focus:outline-none"${attr("disabled", busy, true)}/></label> `);
			Button($$renderer, {
				type: "submit",
				variant: "outline",
				class: "gap-2",
				disabled: busy,
				children: ($$renderer) => {
					Mail($$renderer, {
						class: "size-4",
						"aria-hidden": "true"
					});
					$$renderer.push(`<!----> Email me a magic link`);
				},
				$$slots: { default: true }
			});
			$$renderer.push(`<!----></form> `);
			if (form?.error) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<p class="text-destructive text-sm" role="status">${escape_html(form.error)}</p>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			if (form?.magicSent) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<p class="text-emerald-600 dark:text-emerald-400 text-sm" role="status">Check your inbox at <span class="font-mono">${escape_html(form.email)}</span> for a sign-in link.</p>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]-->`);
		}
		$$renderer.push(`<!--]--></main>`);
	});
}
//#endregion
export { _page as default };
