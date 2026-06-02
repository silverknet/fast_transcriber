import './shims.js';
import { Server } from './server/index.js';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import process from 'node:process';
import 'node:buffer';
import 'node:crypto';

/**
 * Converts a file on disk to a readable stream
 * @param {string} file
 * @returns {ReadableStream}
 * @since 2.4.0
 */
function createReadableStream(file) {
	return /** @type {ReadableStream} */ (Readable.toWeb(createReadStream(file)));
}

/**
 * @param {import('@sveltejs/kit').SSRManifest} manifest
 * @returns {(request: Request, context: import('@netlify/functions').Context) => Promise<Response>}
 */
function init(manifest) {
	const server = new Server(manifest);

	/** @type {Promise<void> | null} */
	let init_promise = server.init({
		env: /** @type {Record<string, string>} */ (process.env),
		read: (file) => createReadableStream(`.netlify/server/${file}`)
	});

	return async (request, context) => {
		if (init_promise !== null) {
			await init_promise;
			init_promise = null;
		}

		return server.respond(request, {
			platform: { context },
			getClientAddress() {
				return context.ip;
			}
		});
	};
}

export { init };
