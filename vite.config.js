import { defineConfig } from 'vite'
import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'

/**
 * Tailwind, but blind to Svelte virtual STYLE modules coming out of
 * `node_modules`.
 *
 * `bits-ui` ships unbundled `.svelte` files. They can't be pre-bundled (esbuild
 * has no `.svelte` loader), so Vite serves them raw and `vite-plugin-svelte`
 * compiles them on the fly. For two of them it reports "failed to load virtual
 * css module", Vite falls back to the file's own source, and that JavaScript
 * reaches Tailwind as if it were CSS — which fails with `Invalid declaration:
 * boxWith, mergeProps` and takes the whole module graph down with it.
 *
 * These modules are third-party component styles; Tailwind has no business
 * generating utilities from them either way. Skipping them lets components that
 * import `bits-ui` mount in the browser test project, which is what makes the
 * mixer testable at all.
 */
function tailwindSkippingVendorSvelteCss() {
  const isVendorSvelteStyle = (id) =>
    id.includes('node_modules') && id.includes('svelte&type=style')
  return tailwindcss().map((plugin) => {
    if (!plugin?.transform) return plugin
    const handler =
      typeof plugin.transform === 'function' ? plugin.transform : plugin.transform.handler
    const wrapped = function (code, id, options) {
      if (isVendorSvelteStyle(id)) return null
      return handler.call(this, code, id, options)
    }
    return {
      ...plugin,
      transform:
        typeof plugin.transform === 'function'
          ? wrapped
          : { ...plugin.transform, handler: wrapped },
    }
  })
}

export default defineConfig({
  plugins: [tailwindSkippingVendorSvelteCss(), sveltekit()],
  server: {
    port: 5173,
    strictPort: false,
  },
  // Pre-bundle UI deps so the dev server does not thrash on first import / HMR.
  optimizeDeps: {
    include: ['clsx', 'tailwind-merge', 'tailwind-variants'],
  },
  test: {
    // Two projects so the 300+ unit tests stay fast (node, no jsdom),
    // and browser tests opt-in via `npm run test:browser`. Browser
    // tests run real `<audio>` + real `AudioContext` so they catch
    // the class of bugs (effect graph ordering, audio event timing,
    // gesture-gated AudioContext resume) that mocks can't.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          // The audio device is a process-wide singleton; give each test a
          // fresh one so per-file AudioContext stubs are actually observed.
          setupFiles: ['src/lib/audio/testing/resetAudioDevice.ts'],
          include: ['src/**/*.{test,spec}.ts'],
          exclude: ['src/**/*.browser.{test,spec}.ts'],
        },
      },
      {
        extends: true,
        // Several UI deps (`bits-ui`, `@lucide/svelte`) ship unbundled
        // `.svelte` files that the browser optimizer's esbuild step
        // can't load. The controller tests don't touch UI; exclude
        // them so the optimizer doesn't get dragged through every
        // icon file in the tree.
        optimizeDeps: {
          exclude: ['bits-ui', '@lucide/svelte'],
        },
        // SvelteKit's dynamic-env virtual modules need its runtime globals,
        // which vitest's browser mode does not provide.
        resolve: {
          alias: {
            '$env/dynamic/public': new URL(
              './src/lib/audio/testing/envStub.ts',
              import.meta.url,
            ).pathname,
            '$env/dynamic/private': new URL(
              './src/lib/audio/testing/envStub.ts',
              import.meta.url,
            ).pathname,
          },
        },
        test: {
          name: 'browser',
          include: ['src/**/*.browser.{test,spec}.ts'],
          // Shims SvelteKit runtime globals, and resets the shared audio device.
          setupFiles: [
            'src/lib/audio/testing/browserSetup.ts',
            'src/lib/audio/testing/resetAudioDevice.ts',
          ],
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            instances: [
              {
                browser: 'chromium',
                // Disable the autoplay gate so `<audio>.play()` resolves
                // without a prior user gesture. The Playback tests need
                // this to exercise the real play/pause/timeupdate
                // lifecycle without an artificial click prelude.
                launch: { args: ['--autoplay-policy=no-user-gesture-required'] },
              },
            ],
          },
        },
      },
    ],
  },
})
