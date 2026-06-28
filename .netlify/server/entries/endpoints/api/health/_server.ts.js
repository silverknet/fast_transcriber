import { n as private_env } from "../../../../chunks/shared-server.js";
import { json } from "@sveltejs/kit";
import pg from "pg";
//#region src/lib/server/db/pool.ts
var pool;
/**
* Lazy pg pool. `undefined` = not checked yet; `null` = no `DATABASE_URL`
* (the app falls back to "DB not configured" responses in route handlers).
*
* Prod target = Supabase via the **Transaction pooler** (host
* `aws-…-pooler.supabase.com`, port `6543`). Reasons it matters:
*
*  - **`max: 1`** — every Netlify Function invocation runs in its own
*    Lambda container with its own `pg.Pool`. Hundreds of concurrent
*    invocations × `max: 8` would blow past Supabase's connection ceiling
*    instantly. With the pgbouncer in front we only need one socket per
*    Function; pgbouncer multiplexes them onto the real Postgres.
*  - **No named prepared statements** — pgbouncer transaction mode breaks
*    them. All call sites in `*.repo.ts` use `pool.query(text, values)`
*    (unnamed), so we're already compatible. Don't introduce
*    `pool.query({ name, text, values })` without re-evaluating this.
*  - **SSL is honored from the URL** — Supabase URLs include
*    `?sslmode=require`; `pg` reads that and enables TLS with the system
*    trust store. We don't need to pass an explicit `ssl: {...}` option.
*/
function getPgPool() {
	if (pool !== void 0) return pool;
	const url = private_env.DATABASE_URL ?? process.env.DATABASE_URL;
	if (!url?.trim()) {
		pool = null;
		return null;
	}
	pool = new pg.Pool({
		connectionString: url,
		max: 1,
		idleTimeoutMillis: 3e4,
		connectionTimeoutMillis: 1e4
	});
	return pool;
}
//#endregion
//#region src/routes/api/health/+server.ts
async function GET() {
	const pool = getPgPool();
	let database = "off";
	if (pool) try {
		await pool.query("SELECT 1");
		database = "ok";
	} catch {
		database = "error";
	}
	return json({
		ok: true,
		ts: (/* @__PURE__ */ new Date()).toISOString(),
		database
	});
}
//#endregion
export { GET };
