import * as server from '../entries/pages/_page.server.ts.js';

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/+page.server.ts";
export const imports = ["_app/immutable/nodes/2.BeXNMfhZ.js","_app/immutable/chunks/C0VcY4m8.js","_app/immutable/chunks/CaycKCMS.js","_app/immutable/chunks/5CimxwSM.js","_app/immutable/chunks/BfKCCuky.js","_app/immutable/chunks/Dmzj4uKr.js","_app/immutable/chunks/Breok6b0.js","_app/immutable/chunks/BVEOzTpX.js","_app/immutable/chunks/bhy1g1Zf.js","_app/immutable/chunks/Bc4u-iLU.js","_app/immutable/chunks/Bmt5dsvb2.js","_app/immutable/chunks/DZMilnc4.js","_app/immutable/chunks/DLAqoTqi.js","_app/immutable/chunks/T3UsACoX.js","_app/immutable/chunks/rCFD1qRp.js","_app/immutable/chunks/CZGWmqne.js","_app/immutable/chunks/D0-hFO3n.js","_app/immutable/chunks/Bf3aVOOB2.js","_app/immutable/chunks/C00jALGa2.js","_app/immutable/chunks/BdUyUOyB2.js","_app/immutable/chunks/nQi2qmWu.js","_app/immutable/chunks/e6WLyxUV.js","_app/immutable/chunks/fk1ELE282.js"];
export const stylesheets = [];
export const fonts = [];
