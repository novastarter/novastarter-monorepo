import type { IncomingMessage } from 'node:http';
import { URL } from 'node:url';
import type { Logger } from 'pino';
import { type AutoLoggingOptions, type HttpLogger, type Options, pinoHttp, stdSerializers } from 'pino-http';
import { redactQuery } from '../utils/redact-query.js';

/**
 * Options of {@link createHttpLogger}.
 */
export interface CreateHttpLoggerOptions {
	/** Logger the request lines are written through; the process logger, normally, so both share streams and level. */
	logger: Logger<never>;
	/** Paths the request logger stays quiet about, health checks for example; matched on the pathname alone. */
	ignorePaths?: string[] | undefined;
	/** Further pino-http options, merged over the ones built here. */
	http?: Options | undefined;
}

/**
 * Build the request logger on top of an existing logger.
 *
 * Produces one line per request with method, path, status and duration, written as a child of the given logger, so
 * the request lines share its level, streams and redaction with everything else the process logs — the way
 * `pino-http` is meant to be mounted. `ignorePaths` silences noisy paths such as health checks, `http` is merged into
 * the pino-http options, and tokens in the query string are redacted before the line is written. The result is a
 * plain `(req, res, next?)` handler, so it mounts on any Node HTTP server or framework.
 *
 * @param options - Logger, ignored paths and pino-http options.
 * @returns A configured pino-http middleware.
 */
export const createHttpLogger = (options: CreateHttpLoggerOptions): HttpLogger => {
	const httpOptions: Options = { ...options.http };

	// 1. Ignored paths are matched on the pathname only, so a query string cannot un-silence them
	if (options.ignorePaths?.length) {
		const ignorePathsSet = new Set(options.ignorePaths);

		httpOptions.autoLogging = {
			ignore: (req) => {
				if (!req.url) return false;
				const { pathname } = new URL(req.url, 'http://example.com/');
				return ignorePathsSet.has(pathname);
			},
		} as AutoLoggingOptions;
	}

	// 2. The request serializer runs last, so the token is gone from the URL before any stream sees it
	return pinoHttp({
		logger: options.logger.child({}),
		...httpOptions,
		serializers: {
			req(request: IncomingMessage) {
				const output = stdSerializers.req(request);
				output.url = redactQuery(output.url);
				return output;
			},
		},
	});
};
