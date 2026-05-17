import { n as private_env } from "./shared-server.js";
import pg from "pg";
//#region src/lib/server/db/pool.ts
var pool;
/** `undefined` = not checked yet; `null` = no `DATABASE_URL`. */
function getPgPool() {
	if (pool !== void 0) return pool;
	const url = private_env.DATABASE_URL ?? process.env.DATABASE_URL;
	if (!url?.trim()) {
		pool = null;
		return null;
	}
	pool = new pg.Pool({
		connectionString: url,
		max: 8,
		idleTimeoutMillis: 3e4,
		connectionTimeoutMillis: 1e4
	});
	return pool;
}
function isDatabaseConfigured() {
	return getPgPool() !== null;
}
//#endregion
export { isDatabaseConfigured as n, getPgPool as t };
