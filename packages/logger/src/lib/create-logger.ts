import { REDACTED_TEXT } from '@novastarter/constants';
import { getConfigFromEnv, useEnv } from '@novastarter/env';
import { toArray } from '@novastarter/utils';
import { merge } from 'lodash-es';
import { type Logger, type LoggerOptions, pino } from 'pino';
import { build as pinoPretty } from 'pino-pretty';
import { resolveLogStyle } from '../utils/resolve-log-style.js';
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
 * Options of {@link createLogger}.
 */
export interface CreateLoggerOptions {
	/** Extra destination for the log lines. */
	logsStream?: LogStreamTarget;
}

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
 * Map the `LOGGER_LEVELS` variable (`label:severity,…`) onto a pino level formatter.
 *
 * Some log collectors (Google Cloud Logging among them) read a `severity` field instead of pino's numeric level, and
 * this is how the mapping is configured without code.
 *
 * @param loggerEnvConfig - Config collected from `LOGGER_*`, its `levels` entry is consumed and removed.
 * @returns Formatters to merge into the pino options, or `undefined` when no custom levels are set.
 */
export const buildLevelFormatters = (loggerEnvConfig: Record<string, any>): LoggerOptions['formatters'] | undefined => {
	if (!loggerEnvConfig['levels']) {
		return undefined;
	}

	// 1. Each entry is `label:severity`; whitespace around either side is tolerated
	const customLogLevels: { [key: string]: string } = {};

	for (const el of toArray(loggerEnvConfig['levels'])) {
		const key_val = el.split(':');
		customLogLevels[key_val[0].trim()] = key_val[1].trim();
	}

	// 2. The entry is removed, so the remaining config can be merged into pino as is
	delete loggerEnvConfig['levels'];

	return {
		level(label: string, number: any) {
			return {
				severity: customLogLevels[label] || 'info',
				level: number,
			};
		},
	};
};

/**
 * Build the application logger from the environment.
 *
 * `LOG_LEVEL` sets the level, `LOG_STYLE` picks pretty console output or JSON lines (`raw` — the default in
 * production, see `resolveLogStyle()`), `LOGGER_*` is merged into the pino options verbatim and `LOGGER_LEVELS`
 * remaps level names to a `severity` field. Authorization and cookie headers are always redacted.
 *
 * @param options - Extra destinations for the lines.
 * @returns A configured pino logger.
 */
export const createLogger = (options: CreateLoggerOptions = {}): Logger<never> => {
	const env = useEnv();

	// 1. Secrets are redacted before any stream sees the line
	const pinoOptions: LoggerOptions = {
		level: (env['LOG_LEVEL'] as string) || 'info',
		redact: {
			paths: ['req.headers.authorization', 'req.headers.cookie'],
			censor: REDACTED_TEXT,
		},
	};

	// 2. `LOGGER_HTTP*` belongs to the HTTP logger and is left out here
	const loggerEnvConfig = getConfigFromEnv('LOGGER_', { omitPrefix: 'LOGGER_HTTP' });

	// 3. Custom level names are turned into a formatter, then the rest of the env config is merged in
	const formatters = buildLevelFormatters(loggerEnvConfig);

	if (formatters) {
		pinoOptions.formatters = formatters;
	}

	const mergedOptions = merge(pinoOptions, loggerEnvConfig);
	const streams = [];

	// 4. Console: pretty for humans, raw JSON lines for log collectors
	if (resolveLogStyle(env) !== 'raw') {
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

	// 5. An extra stream may ask for a lower level than the console; the logger level has to drop to satisfy it
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
