import type { IncomingMessage } from 'node:http';
import { URL } from 'node:url';
import { REDACTED_TEXT } from '@novastarter/constants';
import { merge } from 'lodash-es';
import { type LoggerOptions, pino } from 'pino';
import { type AutoLoggingOptions, type HttpLogger, type Options, pinoHttp, stdSerializers } from 'pino-http';
import { httpPrintFactory } from 'pino-http-print';
import { redactQuery } from '../utils/redact-query.js';
import { buildLevelFormatters, type CreateLoggerOptions, getLoggerLevelValue } from './create-logger.js';

/**
 * Options of {@link createHttpLogger}: those of {@link createLogger} plus the request-logging ones.
 */
export interface CreateHttpLoggerOptions extends CreateLoggerOptions {
	/** Paths the request logger stays quiet about, health checks for example; matched on the pathname alone. */
	ignorePaths?: string[] | undefined;
	/** Further pino-http options, merged over the ones built here. */
	http?: Options | undefined;
}

/**
 * Build the request logger.
 *
 * Produces one line per request with method, path, status and duration. `http` is merged into the pino-http options,
 * `ignorePaths` silences noisy paths such as health checks, and tokens in the query string are redacted before the
 * line is written. The result is a plain `(req, res, next?)` handler, so it mounts on any Node HTTP server or
 * framework.
 *
 * @param options - Level, style, ignored paths, pino and pino-http options, extra destinations.
 * @returns A configured pino-http middleware.
 */
export const createHttpLogger = (options: CreateHttpLoggerOptions = {}): HttpLogger => {
	const httpLoggerOptions: LoggerOptions = {
		level: options.level || 'info',
		redact: {
			paths: ['req.headers.authorization', 'req.headers.cookie'],
			censor: REDACTED_TEXT,
		},
	};

	// 1. Raw lines and bus streams carry the full response headers, so the session cookie has to be hidden as well
	if (options.style !== 'pretty' || options.logsStream) {
		httpLoggerOptions.redact = {
			paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers', 'req.query.access_token'],
			censor: (value, pathParts) => {
				const path = pathParts.join('.');

				if (path === 'res.headers') {
					if ('set-cookie' in value) {
						value['set-cookie'] = REDACTED_TEXT;
					}

					return value;
				}

				return REDACTED_TEXT;
			},
		};
	}

	// 2. Custom level names, same mapping as the application logger
	const formatters = buildLevelFormatters(options.levels);

	if (formatters) {
		httpLoggerOptions.formatters = formatters;
	}

	// 3. Ignored paths are matched on the pathname only, so a query string cannot un-silence them
	const httpOptions: Options = { ...options.http };

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

	const mergedHttpOptions = merge(httpLoggerOptions, options.pino ?? {});
	const streams = [];

	// 4. Console: a one-line request printer for humans, raw JSON lines for log collectors
	if (options.style === 'pretty') {
		const pinoHttpPretty = httpPrintFactory(
			{
				all: true,
				translateTime: 'SYS:HH:MM:ss',
				relativeUrl: true,
			},
			{
				ignore: 'hostname,pid',
				sync: true,
			},
		);

		streams.push({ level: mergedHttpOptions.level!, stream: pinoHttpPretty(process.stdout) });
	} else {
		streams.push({ level: mergedHttpOptions.level!, stream: process.stdout });
	}

	// 5. An extra stream may ask for a lower level than the console; the logger level has to drop to satisfy it
	if (options.logsStream) {
		const streamLevel = options.logsStream.level ?? mergedHttpOptions.level!;

		if (getLoggerLevelValue(streamLevel) < getLoggerLevelValue(mergedHttpOptions.level!)) {
			mergedHttpOptions.level = streamLevel;
		}

		streams.push({
			level: streamLevel,
			stream: options.logsStream.stream,
		});
	}

	// 6. The request serializer runs last, so the token is gone from the URL before any stream sees it
	return pinoHttp({
		logger: pino(mergedHttpOptions, pino.multistream(streams)),
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
