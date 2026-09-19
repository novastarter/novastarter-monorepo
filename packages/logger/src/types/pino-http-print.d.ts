/**
 * Typings for `pino-http-print`, which ships none.
 *
 * Only the factory the request logger uses is declared, following the JSDoc in the package's `index.js`; the CLI
 * transport it also exports is left out.
 */
declare module 'pino-http-print' {
	import type { Transform, Writable } from 'node:stream';
	import type { PrettyOptions } from 'pino-pretty';

	/**
	 * Options of {@link httpPrintFactory}.
	 */
	export interface HttpPrintOptions {
		/** Print every line, not only the HTTP ones; the others go through `pino-pretty`. */
		all?: boolean;
		/** Color the output; by default follows terminal support. */
		colorize?: boolean;
		/** `true` prints a readable timestamp, a string is passed to `pino-pretty` as its `translateTime` option. */
		translateTime?: boolean | string;
		/** Print the path only, without scheme and host. */
		relativeUrl?: boolean;
		/** Silently drop lines that do not parse as JSON. */
		lax?: boolean;
	}

	/**
	 * Build a stream factory that prints pino-http lines as one readable line per request.
	 *
	 * @param options - How the HTTP lines are formatted.
	 * @param prettyOptions - Forwarded to `pino-pretty` for the non-HTTP lines when `all` is set.
	 * @returns A factory: given a writable (default `process.stdout`), it returns the stream pino writes into.
	 */
	export function httpPrintFactory(
		options?: HttpPrintOptions,
		prettyOptions?: PrettyOptions,
	): (stream?: Writable) => Transform;
}
