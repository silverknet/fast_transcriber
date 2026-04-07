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
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
})
