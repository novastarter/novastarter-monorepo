import type { IncomingMessage } from 'node:http';
import { URL } from 'node:url';
import { REDACTED_TEXT } from '@novastarter/constants';
import { getConfigFromEnv, useEnv } from '@novastarter/env';
import { merge } from 'lodash-es';
import { type LoggerOptions, pino } from 'pino';
import { type AutoLoggingOptions, type HttpLogger, pinoHttp, stdSerializers } from 'pino-http';
import { httpPrintFactory } from 'pino-http-print';
import { redactQuery } from '../utils/redact-query.js';
import { resolveLogStyle } from '../utils/resolve-log-style.js';
import { buildLevelFormatters, type CreateLoggerOptions, getLoggerLevelValue } from './create-logger.js';

/**
 * Build the request logger from the environment.
 *
 * Produces one line per request with method, path, status and duration. `LOGGER_HTTP_*` is merged into the pino-http
 * options, `LOG_HTTP_IGNORE_PATHS` silences noisy paths such as health checks, and tokens in the query string are
 * redacted before the line is written. The result is a plain `(req, res, next?)` handler, so it mounts on any Node
 * HTTP server or framework.
 *
 * @param options - Extra destinations for the lines.
 * @returns A configured pino-http middleware.
 */
export const createHttpLogger = (options: CreateLoggerOptions = {}): HttpLogger => {
	const env = useEnv();

	// 1. Two env families: `LOGGER_HTTP*` drives pino-http, `LOGGER_*` the pino instance underneath
	const httpLoggerEnvConfig = getConfigFromEnv('LOGGER_HTTP', { omitPrefix: 'LOGGER_HTTP_LOGGER' });
	const loggerEnvConfig = getConfigFromEnv('LOGGER_', { omitPrefix: 'LOGGER_HTTP' });

	const httpLoggerOptions: LoggerOptions = {
		level: (env['LOG_LEVEL'] as string) || 'info',
		redact: {
			paths: ['req.headers.authorization', 'req.headers.cookie'],
			censor: REDACTED_TEXT,
		},
	};

	// 2. Raw lines and bus streams carry the full response headers, so the session cookie has to be hidden as well
	if (resolveLogStyle(env) === 'raw' || options.logsStream) {
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

	// 3. Custom level names, same mapping as the application logger
	const formatters = buildLevelFormatters(loggerEnvConfig);

	if (formatters) {
		httpLoggerOptions.formatters = formatters;
	}

	// 4. Ignored paths are matched on the pathname only, so a query string cannot un-silence them
	if (env['LOG_HTTP_IGNORE_PATHS']) {
		const ignorePathsSet = new Set(env['LOG_HTTP_IGNORE_PATHS'] as string);

		httpLoggerEnvConfig['autoLogging'] = {
			ignore: (req) => {
				if (!req.url) return false;
				const { pathname } = new URL(req.url, 'http://example.com/');
				return ignorePathsSet.has(pathname);
			},
		} as AutoLoggingOptions;
	}

	const mergedHttpOptions = merge(httpLoggerOptions, loggerEnvConfig);
	const streams = [];

	// 5. Console: a one-line request printer for humans, raw JSON lines for log collectors
	if (resolveLogStyle(env) !== 'raw') {
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

	// 6. An extra stream may ask for a lower level than the console; the logger level has to drop to satisfy it
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

	// 7. The request serializer runs last, so the token is gone from the URL before any stream sees it
	return pinoHttp({
		logger: pino(mergedHttpOptions, pino.multistream(streams)),
		...httpLoggerEnvConfig,
		serializers: {
			req(request: IncomingMessage) {
				const output = stdSerializers.req(request);
				output.url = redactQuery(output.url);
				return output;
			},
		},
	});
};
