import { json } from "@sveltejs/kit";
//#region src/routes/api/health/+server.ts
function GET() {
	return json({
		ok: true,
		ts: (/* @__PURE__ */ new Date()).toISOString()
	});
}
//#endregion
export { GET };
