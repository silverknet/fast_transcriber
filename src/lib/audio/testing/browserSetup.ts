/**
 * Setup for the browser test project.
 *
 * Mounting a real app component drags in SvelteKit's `$env/dynamic/public`,
 * whose virtual module reads `process.env`. That does not exist in a browser, so
 * the import throws before any test runs. Vitest's browser mode is not
 * SvelteKit's runtime, so the shim belongs here rather than in app code.
 */
const g = globalThis as unknown as { process?: { env: Record<string, string> } }
g.process ??= { env: {} }
g.process.env ??= {}

export {}
