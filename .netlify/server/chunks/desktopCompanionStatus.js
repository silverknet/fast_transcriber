import { F as writable } from "./server.js";
import "./index-server2.js";
//#region src/lib/stores/desktopCompanionStatus.ts
var desktopCompanionStatus = writable({
	reachable: false,
	version: null,
	versionStatus: "unknown",
	lastCheckedAt: null,
	lastError: null,
	pythonHealth: "unknown",
	brokenChecks: [],
	setup: null
});
//#endregion
export { desktopCompanionStatus as t };
