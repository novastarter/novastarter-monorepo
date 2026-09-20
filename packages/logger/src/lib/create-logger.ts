import { REDACTED_TEXT } from '@novastarter/constants';
import { merge } from 'lodash-es';
import { type Logger, type LoggerOptions, pino } from 'pino';
import { build as pinoPretty } from 'pino-pretty';
import type { LogStyle } from '../utils/resolve-log-style.js';
import type { LogsStream } from './logs-stream.js';

/**
 * Extra destination for the log lines, on top of the console.
 *
 * Used to publish logs on the message bus (see {@link LogsStream}); `level` lets the stream receive more than the
 * console does.
 */
export interface LogStreamTarget {
	/** Stream every line is written to. */
	stream: LogsStream;
	/** Lowest level the stream receives, defaults to the logger level. */
	level?: string;
}

/**
 * Options of {@link createLogger}: everything the application decides, read from its own configuration.
 */
export interface CreateLoggerOptions {
	/**
	 * Lowest level written: `fatal`, `error`, `warn`, `info`, `debug`, `trace`.
	 *
	 * @defaultValue `info`
	 */
	level?: string | undefined;
	/**
	 * Console output: `pretty` for a terminal, `raw` JSON lines for a log collector; see `resolveLogStyle()`.
	 *
	 * @defaultValue `raw`
	 */
	style?: LogStyle | undefined;
	/**
	 * Level names mapped to a `severity` field, for collectors (Google Cloud Logging among them) that read one
	 * instead of pino's numeric level: `{ warn: 'WARNING' }`.
	 */
	levels?: Record<string, string> | undefined;
	/** Further pino options, merged over the ones built here; `{ name: 'api' }` for example. */
	pino?: LoggerOptions | undefined;
	/** Extra destination for the log lines. */
	logsStream?: LogStreamTarget | undefined;
}

/**
 * Paths redacted in every line: the credentials of a request, the session cookie of a response and a token in the
 * query string.
 *
 * @defaultValue `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`,
 * `req.query.access_token`
 */
export const REDACTED_PATHS: readonly string[] = [
	'req.headers.authorization',
	'req.headers.cookie',
	'res.headers["set-cookie"]',
	'req.query.access_token',
];

/**
 * Numeric value of a pino level name, falling back to `info` for unknown names.
 *
 * @param level - Level name such as `debug`.
 * @returns The pino numeric level.
 */
export const getLoggerLevelValue = (level: string): number => {
	return pino.levels.values[level] || pino.levels.values['info']!;
};

/**
 * Turn a label-to-severity map into a pino level formatter.
 *
 * @param levels - Level names mapped to the severity a collector expects; unknown names get `info`.
 * @returns Formatters to merge into the pino options, or `undefined` when no map is given.
 */
export const buildLevelFormatters = (
	levels: Record<string, string> | undefined,
): LoggerOptions['formatters'] | undefined => {
	// 1. Nothing to map: pino's own numeric level stays
	if (!levels) {
		return undefined;
	}

	// 2. The formatter adds `severity` next to the numeric level rather than replacing it, so collectors that read
	//    either field keep working
	return {
		level(label: string, number: any) {
			return {
				severity: levels[label] || 'info',
				level: number,
			};
		},
	};
};

/**
 * Build the application logger.
 *
 * `level` sets the level, `style` picks pretty console output or JSON lines, `pino` is merged into the pino options
 * verbatim and `levels` remaps level names to a `severity` field. The {@link REDACTED_PATHS} are always redacted. The
 * application passes what it read from its configuration: `createLogger({ level: env['LOG_LEVEL'] })`.
 *
 * @param options - Level, style, pino options and extra destinations.
 * @returns A configured pino logger.
 */
export const createLogger = (options: CreateLoggerOptions = {}): Logger<never> => {
	// 1. Secrets are redacted before any stream sees the line: the credentials of a request, the session cookie of
	//    a response and a token in the query string — the request logger is a child of this logger, so its lines go
	//    through the same list
	const pinoOptions: LoggerOptions = {
		level: options.level || 'info',
		redact: {
			paths: [...REDACTED_PATHS],
			censor: REDACTED_TEXT,
		},
	};

	// 2. Custom level names are turned into a formatter, then the caller's pino options are merged in
	const formatters = buildLevelFormatters(options.levels);

	if (formatters) {
		pinoOptions.formatters = formatters;
	}

	const mergedOptions = merge(pinoOptions, options.pino ?? {});
	const streams = [];

	// 3. Console: pretty for humans, raw JSON lines for log collectors — raw unless asked, since a collector chokes
	//    on a pretty line while a person merely reads JSON
	if (options.style === 'pretty') {
		streams.push({
			level: mergedOptions.level!,
			stream: pinoPretty({
				ignore: 'hostname,pid',
				sync: true,
			}),
		});
	} else {
		streams.push({ level: mergedOptions.level!, stream: process.stdout });
	}

	// 4. An extra stream may ask for a lower level than the console; the logger level has to drop to satisfy it
	if (options.logsStream) {
		const streamLevel = options.logsStream.level ?? mergedOptions.level!;

		if (getLoggerLevelValue(streamLevel) < getLoggerLevelValue(mergedOptions.level!)) {
			mergedOptions.level = streamLevel;
		}

		streams.push({
			level: streamLevel,
			stream: options.logsStream.stream,
		});
	}

	return pino(mergedOptions, pino.multistream(streams));
};
