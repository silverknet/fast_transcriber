import netlify from '@sveltejs/adapter-netlify'
import node from '@sveltejs/adapter-node'

/**
 * TWO build targets, one codebase.
 *
 * - **netlify** (default) — the hosted app.
 * - **node** — the GIG BUILD. SvelteKit's own server runs on the player's
 *   machine, so the app keeps working with no internet at the venue. The
 *   desktop app mounts its `handler` on the loopback server it already runs.
 *
 * Selected with `BARBRO_ADAPTER=node`, so the hosted deploy cannot pick it up
 * by accident — Netlify never sets that variable.
 */
const useNode = process.env.BARBRO_ADAPTER === 'node'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // Netlify Functions runtime (Node). The `pg` driver in
    // src/lib/server/db/pool.ts is a plain Node TCP client — keep us on the
    // standard functions runtime (not Edge), where outbound TCP works.
    adapter: useNode ? node({ out: 'build-node' }) : netlify(),
    alias: {
      $lib: './src/lib',
    },
  },
}

export default config
