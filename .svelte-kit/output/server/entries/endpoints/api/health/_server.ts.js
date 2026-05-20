import { t as getPgPool } from "../../../../chunks/pool2.js";
import { json } from "@sveltejs/kit";
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
