import adapter from '@sveltejs/adapter-netlify'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // Netlify Functions runtime (Node). The `pg` driver in
    // src/lib/server/db/pool.ts is a plain Node TCP client — keep us on the
    // standard functions runtime (not Edge), where outbound TCP works.
    adapter: adapter(),
    alias: {
      $lib: './src/lib',
    },
  },
}

export default config
