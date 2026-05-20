import { F as writable } from "./server.js";
import "./index-server2.js";
//#region src/lib/stores/desktopCompanionStatus.ts
var desktopCompanionStatus = writable({
	reachable: false,
	version: null,
	lastCheckedAt: null,
	lastError: null
});
//#endregion
export { desktopCompanionStatus as t };
