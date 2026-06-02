import * as server from '../entries/pages/download/_page.server.ts.js';

export const index = 4;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/download/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/download/+page.server.ts";
export const imports = ["_app/immutable/nodes/4.BI4Booso.js","_app/immutable/chunks/Dxm7iWfv.js","_app/immutable/chunks/DIWbNcP-.js","_app/immutable/chunks/Dg0BMDbX.js","_app/immutable/chunks/DMpSmtiB.js","_app/immutable/chunks/D9FQP20W.js","_app/immutable/chunks/DVDsG2iN.js","_app/immutable/chunks/Bx89C4Yp.js","_app/immutable/chunks/DUgX7ckJ.js"];
export const stylesheets = [];
export const fonts = [];
