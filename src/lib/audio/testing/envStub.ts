/**
 * Stand-in for SvelteKit's `$env/dynamic/*` in the browser test project.
 *
 * The real virtual module reads a `__sveltekit_*` global that only the
 * SvelteKit runtime defines, so importing any component that touches it throws
 * before a single test runs. Nothing under test reads real env values.
 */
export const env: Record<string, string> = {}
