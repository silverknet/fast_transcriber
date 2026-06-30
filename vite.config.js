import { defineConfig } from 'vite'
import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
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
        test: {
          name: 'browser',
          include: ['src/**/*.browser.{test,spec}.ts'],
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
