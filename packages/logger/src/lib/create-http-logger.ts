import type { IncomingMessage } from 'node:http';
import { URL } from 'node:url';
import type { Logger, SerializedRequest } from 'pino';
import { type HttpLogger, type Options, pinoHttp, stdSerializers } from 'pino-http';
import { redactQuery } from '../utils/redact-query.js';

/**
 * Options of {@link createHttpLogger}.
 */
export interface CreateHttpLoggerOptions {
	/** Logger the request lines are written through; the process logger, normally, so both share streams and level. */
	logger: Logger<never>;
	/** Paths the request logger stays quiet about, health checks for example; matched on the pathname alone. When `http.autoLogging` is given too, its other settings are kept and only its `ignore` is replaced. */
	ignorePaths?: string[] | undefined;
	/**
	 * Further pino-http options, merged over the ones built here; its `serializers` are merged too, and the query token
	 * is redacted after a `req` serializer of the caller's has run.
	 */
	http?: Options | undefined;
}

/**
 * Remove the query token from the URL of a serialised request.
 *
 * Runs after every other request serializer, so the token cannot survive in a URL the caller's serializer rewrote.
 *
 * @param output - What the request serializer produced; left alone when it carries no string URL.
 * @returns The same object, its URL redacted.
 * @internal
 */
const redactUrl = (output: SerializedRequest): SerializedRequest => {
	// 1. A caller's serializer may drop the URL or return something else entirely; only a string URL is rewritten
	if (typeof output?.url === 'string') {
		output.url = redactQuery(output.url);
	}

	return output;
};

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
	// 1. The caller's serializers are taken apart from the other options: they are merged by key below, where a plain
	//    spread would let the map built here replace them wholesale
	const { serializers: callerSerializers = {}, ...httpOptions }: Options = { ...options.http };

	// 2. Ignored paths are matched on the pathname only, so a query string cannot un-silence them. The built `ignore`
	//    is layered over the caller's own `autoLogging` rather than replacing it wholesale; a boolean `autoLogging`
	//    carries no settings, so only an object is spread
	if (options.ignorePaths?.length) {
		const ignorePathsSet = new Set(options.ignorePaths);
		const callerAutoLogging = typeof httpOptions.autoLogging === 'object' ? httpOptions.autoLogging : undefined;

		httpOptions.autoLogging = {
			...callerAutoLogging,
			ignore: (req) => {
				// 1. A request without a target cannot match a path; it is logged like any other
				if (!req.url) return false;

				try {
					// 2. A base is required for a relative path; only the pathname is read, so its value is irrelevant
					const { pathname } = new URL(req.url, 'http://example.com/');
					return ignorePathsSet.has(pathname);
				} catch {
					// 3. Node's parser accepts targets such as `//` that are no valid URL; pino-http calls this hook
					//    unprotected inside the middleware, so a throw here would take the server down on one crafted
					//    request. Such a request is logged rather than silenced
					return false;
				}
			},
		};
	}

	// 3. pino-http wraps every custom serializer unless told not to: the `req` serializer then receives the request
	//    already serialised, and the raw message only with `wrapSerializers: false`
	const wrapped = httpOptions.wrapSerializers !== false;
	const callerReq = callerSerializers['req'];

	// 4. The request serializer runs last, so the token is gone from the URL before any stream sees it
	return pinoHttp({
		logger: options.logger.child({}),
		...httpOptions,
		serializers: {
			...callerSerializers,
			req(request: IncomingMessage | SerializedRequest): SerializedRequest {
				// 1. The caller's serializer gets what pino-http would have handed it without this package
				if (callerReq) {
					return redactUrl(callerReq(request));
				}

				// 2. A request pino-http already serialised is kept as is, since serialising it again would lose the
				//    remote address; only the raw message needs the standard serializer
				return redactUrl(wrapped ? (request as SerializedRequest) : stdSerializers.req(request as IncomingMessage));
			},
		},
	});
};
