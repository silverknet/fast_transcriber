import { F as writable } from "./server.js";
import "./index-server2.js";
//#region src/lib/stores/analyzingState.ts
var analyzingState = writable(null);
//#endregion
export { analyzingState as t };
