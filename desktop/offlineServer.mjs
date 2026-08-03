/**
 * The OFFLINE SERVER — SvelteKit, hosted on the player's own machine.
 *
 * Runs the `adapter-node` build so the app works with no internet at the venue.
 * The Electron app normally mounts the same bundle in-process; this entry point
 * is for running it standalone — `npm run offline`, and the pre-flight.
 *
 * ## What it guarantees
 *
 * `BARBRO_OFFLINE=1` and the ABSENCE of `PUBLIC_SUPABASE_*`. Both are set here
 * rather than assumed, because the whole no-login design rests on them: with the
 * flag, `hooks.server.ts` serves a local user; without cloud config, there is no
 * client to construct and so nothing that can present a sign-in. Deleting the
 * keys matters most when running from a source checkout whose shell already has
 * them exported — otherwise this standalone path would behave differently from
 * the packaged app, which is exactly the kind of two-behaviours bug that only
 * shows up at a venue.
 *
 * ## Why the rejection handler is not optional
 *
 * With no supervisor and no operator — just a musician on stage — an unhandled
 * rejection terminating the process is the worst possible default. On a public
 * server crashing loudly is right; here staying up with a logged warning is
 * strictly better than a dead app between songs.
 *
 * The handlers are deliberately scoped to this entry point. They change nothing
 * about the hosted deployment.
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

process.env.BARBRO_OFFLINE = '1'
for (const key of ['PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_ANON_KEY']) {
  delete process.env[key]
}

process.on('unhandledRejection', (reason) => {
  console.warn('[offline] unhandled rejection (continuing):', reason?.message ?? reason)
})

process.on('uncaughtException', (err) => {
  console.warn('[offline] uncaught exception (continuing):', err?.message ?? err)
})

const entry = process.env.BARBRO_OFFLINE_BUILD ?? resolve(here, '..', 'build-node', 'index.js')
await import(entry)
