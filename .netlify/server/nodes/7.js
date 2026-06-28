import * as server from '../entries/pages/download/_page.server.ts.js';

export const index = 7;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/download/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/download/+page.server.ts";
export const imports = ["_app/immutable/nodes/7.DK0DX6Br.js","_app/immutable/chunks/C0VcY4m8.js","_app/immutable/chunks/CaycKCMS.js","_app/immutable/chunks/5CimxwSM.js","_app/immutable/chunks/BfKCCuky.js","_app/immutable/chunks/bhy1g1Zf.js","_app/immutable/chunks/Breok6b0.js","_app/immutable/chunks/BVEOzTpX.js","_app/immutable/chunks/CokyF8Wt.js","_app/immutable/chunks/BlFqxwZ-2.js","_app/immutable/chunks/BU9M1knf2.js","_app/immutable/chunks/DJvZE5dS2.js","_app/immutable/chunks/DaKcBhbX2.js","_app/immutable/chunks/nQi2qmWu.js","_app/immutable/chunks/rCFD1qRp.js","_app/immutable/chunks/BOiphEEN2.js","_app/immutable/chunks/4TtYQFMk.js"];
export const stylesheets = [];
export const fonts = [];
