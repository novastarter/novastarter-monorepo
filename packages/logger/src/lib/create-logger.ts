import { REDACTED_TEXT } from '@novastarter/constants';
import { InvalidConfigError } from '@novastarter/errors';
import { merge } from 'lodash-es';
import { type Logger, type LoggerOptions, pino, type redactOptions } from 'pino';
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
	 * Lowest level written: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or a level declared in
	 * `pino.customLevels`.
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
	/**
	 * Further pino options, merged over the ones built here; `{ name: 'api' }` for example. A `redact` of its own adds
	 * paths to {@link REDACTED_PATHS} rather than replacing them.
	 */
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
 * Map of every level name the logger knows to its numeric value: pino's built-in levels plus the caller's custom ones.
 *
 * pino's multistream and the checks in {@link createLogger} both resolve level names through this map, so a level
 * declared in `pino.customLevels` is honoured everywhere pino itself accepts it.
 *
 * @param customLevels - The caller's `pino.customLevels`, or nothing.
 * @returns Level names mapped to their numeric values.
 * @internal
 */
const buildLevelValues = (customLevels: Record<string, number> | undefined): Record<string, number> => {
	// Custom levels are spread last, so one that reuses a built-in name wins, as it does in pino.
	return { ...pino.levels.values, ...customLevels };
};

/**
 * Numeric value of a pino level name, falling back to `info` for unknown names.
 *
 * @param level - Level name such as `debug`.
 * @param customLevels - The caller's `pino.customLevels`, looked up next to pino's built-in levels.
 * @returns The pino numeric level.
 */
export const getLoggerLevelValue = (level: string, customLevels?: Record<string, number>): number => {
	// An unknown name falls back to info rather than `undefined`, so a typo in a level can never disable logging.
	return buildLevelValues(customLevels)[level] || pino.levels.values['info']!;
};

/**
 * Redaction settings that always include {@link REDACTED_PATHS}, whatever the caller's `pino.redact` says.
 *
 * pino accepts either a list of paths or `{ paths, censor, remove }`; the caller's paths are added to the built-in
 * ones and its `censor` and `remove` are kept, so a caller can extend the list but never shrink it.
 *
 * @param redact - The caller's `pino.redact`, in either form pino accepts, or nothing.
 * @returns The redact options handed to pino.
 */
export const buildRedactOptions = (redact: LoggerOptions['redact']): redactOptions => {
	// Both forms pino accepts are brought to the object form, so one merge covers them.
	const caller = Array.isArray(redact) ? { paths: redact } : redact;

	// Duplicates are dropped, so a caller repeating a built-in path costs nothing; the caller's censor wins, since it
	// applies to the whole list in pino anyway.
	return {
		...caller,
		paths: [...new Set([...REDACTED_PATHS, ...(caller?.paths ?? [])])],
		censor: caller?.censor ?? REDACTED_TEXT,
	};
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
	if (!levels) {
		return undefined;
	}

	// `severity` goes next to the numeric level rather than replacing it, so collectors that read either field keep
	// working.
	return {
		level(label: string, number: number) {
			// Unmapped labels get `info`, so a collector never sees a line without severity.
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
 * @throws InvalidConfigError when `logsStream.level` is not a level of the logger.
 */
export const createLogger = (options: CreateLoggerOptions = {}): Logger<never> => {
	// These come first, so the caller's pino options are merged over them and win.
	const pinoOptions: LoggerOptions = {
		level: options.level || 'info',
	};

	const formatters = buildLevelFormatters(options.levels);

	if (formatters) {
		pinoOptions.formatters = formatters;
	}

	const mergedOptions = merge(pinoOptions, options.pino ?? {});

	// The request logger is a child of this logger, so its lines go through the same list. Set after the merge on
	// purpose: lodash merges arrays index by index, so a caller's `redact.paths` would otherwise overwrite the built-in
	// credentials one by one.
	mergedOptions.redact = buildRedactOptions(options.pino?.redact);

	const streams = [];

	// Without the caller's custom levels the multistream maps a custom level to `undefined` and silently drops every
	// line.
	const levelValues = buildLevelValues(mergedOptions.customLevels);

	// Raw unless asked, since a collector chokes on a pretty line while a person merely reads JSON.
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

	// An extra stream may ask for a lower level than the console; the logger level has to drop to satisfy it.
	if (options.logsStream) {
		const streamLevel = options.logsStream.level ?? mergedOptions.level!;

		// pino's multistream resolves an unknown level name to `undefined` and then writes nothing anywhere, the
		// console stream included, so a typo in the configured level must fail at start-up, as loud as pino's own
		// `unknown level` error for a bad top-level level.
		if (levelValues[streamLevel] === undefined) {
			throw new InvalidConfigError({
				reason: `The logger logsStream has an unknown level "${streamLevel}"; use one of the logger's levels`,
			});
		}

		// Compared through the numeric values, so the logger level drops only when the stream really asks for a lower
		// one.
		if (
			getLoggerLevelValue(streamLevel, mergedOptions.customLevels) <
			getLoggerLevelValue(mergedOptions.level!, mergedOptions.customLevels)
		) {
			mergedOptions.level = streamLevel;
		}

		streams.push({
			level: streamLevel,
			stream: options.logsStream.stream,
		});
	}

	// The multistream gets the same level map, so it routes lines of a custom level instead of dropping them.
	return pino(mergedOptions, pino.multistream(streams, { levels: levelValues }));
};
