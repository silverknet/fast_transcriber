import * as server from '../entries/pages/account/_page.server.ts.js';

export const index = 3;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/account/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/account/+page.server.ts";
export const imports = ["_app/immutable/nodes/3.CGNnRhFK.js","_app/immutable/chunks/Breok6b0.js","_app/immutable/chunks/CaycKCMS.js","_app/immutable/chunks/5CimxwSM.js","_app/immutable/chunks/BVEOzTpX.js","_app/immutable/chunks/BEpJScLU2.js","_app/immutable/chunks/DZMilnc4.js"];
export const stylesheets = [];
export const fonts = [];
