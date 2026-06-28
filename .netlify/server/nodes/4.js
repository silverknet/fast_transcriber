import * as server from '../entries/pages/admin/access/_page.server.ts.js';

export const index = 4;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/admin/access/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/admin/access/+page.server.ts";
export const imports = ["_app/immutable/nodes/4.B1ZzUe0C.js","_app/immutable/chunks/CokyF8Wt.js","_app/immutable/chunks/Breok6b0.js","_app/immutable/chunks/CaycKCMS.js","_app/immutable/chunks/5CimxwSM.js","_app/immutable/chunks/BVEOzTpX.js","_app/immutable/chunks/BtS0SmMH2.js","_app/immutable/chunks/DiX8Dc7V.js","_app/immutable/chunks/BHBKASSr2.js","_app/immutable/chunks/C0VcY4m8.js","_app/immutable/chunks/BfKCCuky.js","_app/immutable/chunks/nQi2qmWu.js","_app/immutable/chunks/DZMilnc4.js"];
export const stylesheets = [];
export const fonts = [];
