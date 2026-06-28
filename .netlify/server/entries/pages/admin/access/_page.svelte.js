import { A as escape_html, O as attr, a as derived, c as head, s as ensure_array_like } from "../../../../chunks/server.js";
import { t as Button } from "../../../../chunks/button.js";
import { t as X } from "../../../../chunks/x.js";
import { t as Check } from "../../../../chunks/check.js";
import { t as User_plus } from "../../../../chunks/user-plus.js";
import "../../../../chunks/forms.js";
//#region src/routes/admin/access/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* Admin UI — list pending/granted/denied requests, plus a pre-invite
		* form to grant an email before that user has even signed up.
		*
		* Grouped by status with pending on top so unreviewed requests are
		* always in view. Each row has a one-click approve/deny.
		*/
		let { data, form } = $$props;
		const grouped = derived(() => {
			return {
				pending: data.rows.filter((r) => r.status === "pending"),
				granted: data.rows.filter((r) => r.status === "granted"),
				denied: data.rows.filter((r) => r.status === "denied")
			};
		});
		function group($$renderer, title, rows, emptyHint) {
			$$renderer.push(`<section class="space-y-3"><h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">${escape_html(title)} (${escape_html(rows.length)})</h2> `);
			if (rows.length === 0) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<p class="border-foreground/30 border-2 border-dashed p-3 text-xs text-muted-foreground">${escape_html(emptyHint)}</p>`);
			} else {
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<ul class="flex flex-col gap-2"><!--[-->`);
				const each_array = ensure_array_like(rows);
				for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
					let row = each_array[$$index];
					$$renderer.push(`<li class="border-foreground border-2 p-3"><div class="flex flex-wrap items-center gap-3"><div class="min-w-0 flex-1"><p class="truncate font-mono text-sm">${escape_html(row.email)}</p> <p class="text-muted-foreground mt-0.5 text-[11px] font-mono">${escape_html(row.user_id ? "linked · " : "unlinked · ")}
                    ${escape_html(row.source === "auth" ? "auth-only · " : "")}
                    ${escape_html(new Date(row.requested_at).toLocaleString())}</p> `);
					if (row.note) {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<p class="text-muted-foreground mt-1 text-xs">"${escape_html(row.note)}"</p>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--></div> <div class="flex shrink-0 gap-2">`);
					if (row.status !== "granted") {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<form method="POST" action="?/approve"><input type="hidden" name="id"${attr("value", row.id ?? "")}/> <input type="hidden" name="email"${attr("value", row.email)}/> <input type="hidden" name="user_id"${attr("value", row.user_id ?? "")}/> `);
						Button($$renderer, {
							type: "submit",
							size: "sm",
							class: "gap-1",
							children: ($$renderer) => {
								Check($$renderer, {
									class: "size-3.5",
									"aria-hidden": "true"
								});
								$$renderer.push(`<!----> Approve`);
							},
							$$slots: { default: true }
						});
						$$renderer.push(`<!----></form>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					if (row.status !== "denied") {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<form method="POST" action="?/deny"><input type="hidden" name="id"${attr("value", row.id ?? "")}/> <input type="hidden" name="email"${attr("value", row.email)}/> <input type="hidden" name="user_id"${attr("value", row.user_id ?? "")}/> `);
						Button($$renderer, {
							type: "submit",
							variant: "outline",
							size: "sm",
							class: "gap-1",
							children: ($$renderer) => {
								X($$renderer, {
									class: "size-3.5",
									"aria-hidden": "true"
								});
								$$renderer.push(`<!----> Deny`);
							},
							$$slots: { default: true }
						});
						$$renderer.push(`<!----></form>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--></div></div></li>`);
				}
				$$renderer.push(`<!--]--></ul>`);
			}
			$$renderer.push(`<!--]--></section>`);
		}
		head("9lhxub", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>Admin · Access · BarBro</title>`);
			});
		});
		$$renderer.push(`<main class="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6"><header class="border-foreground border-b-2 pb-4"><h1 class="text-3xl font-black tracking-tight">Access requests</h1> <p class="text-muted-foreground mt-2 text-sm">Approve people who've requested access, or pre-invite by email before they sign up.</p></header> `);
		if (form?.error) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<p class="text-destructive text-sm" role="status">${escape_html(form.error)}</p>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (data.error) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<p class="text-destructive text-sm" role="status">${escape_html(data.error)}</p>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (form?.ok) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<p class="text-emerald-600 dark:text-emerald-400 text-sm" role="status">`);
			if (form.action === "invite") {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`Invited ${escape_html(form.email)}.`);
			} else if (form.action === "approve") {
				$$renderer.push("<!--[1-->");
				$$renderer.push(`Approved.`);
			} else if (form.action === "deny") {
				$$renderer.push("<!--[2-->");
				$$renderer.push(`Denied.`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></p>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <section class="border-foreground border-2 p-4 space-y-3"><h2 class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">`);
		User_plus($$renderer, {
			class: "size-4",
			"aria-hidden": "true"
		});
		$$renderer.push(`<!----> Pre-invite by email</h2> <form method="POST" action="?/invite" class="flex flex-wrap items-end gap-3"><label class="flex min-w-0 flex-1 flex-col gap-1 text-xs"><span class="text-muted-foreground">Email</span> <input name="email" type="email" required="" placeholder="user@example.com" class="border-foreground/30 bg-background w-full border-2 px-3 py-2 text-sm focus:border-foreground focus:outline-none"/></label> <label class="flex min-w-0 flex-1 flex-col gap-1 text-xs"><span class="text-muted-foreground">Note (optional)</span> <input name="note" type="text" placeholder="why / from where" class="border-foreground/30 bg-background w-full border-2 px-3 py-2 text-sm focus:border-foreground focus:outline-none"/></label> `);
		Button($$renderer, {
			type: "submit",
			class: "h-10 gap-2",
			children: ($$renderer) => {
				User_plus($$renderer, {
					class: "size-4",
					"aria-hidden": "true"
				});
				$$renderer.push(`<!----> Invite`);
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----></form></section>  `);
		group($$renderer, "Pending", grouped().pending, "No pending requests. Pre-invite an email above to get someone started.");
		$$renderer.push(`<!----> `);
		group($$renderer, "Granted", grouped().granted, "No one has access yet.");
		$$renderer.push(`<!----> `);
		group($$renderer, "Denied", grouped().denied, "No denied requests.");
		$$renderer.push(`<!----></main>`);
	});
}
//#endregion
export { _page as default };
