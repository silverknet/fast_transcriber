import { F as writable } from "./server.js";
import "./index-server2.js";
var uiAnimations = writable({
	beatPulse: {
		n: 0,
		accent: false
	},
	blobOrbit: { n: 0 },
	analyzingSpin: false
});
function setAnalyzingSpin(active) {
	uiAnimations.update((s) => ({
		...s,
		analyzingSpin: active
	}));
}
//#endregion
export { uiAnimations as n, setAnalyzingSpin as t };
