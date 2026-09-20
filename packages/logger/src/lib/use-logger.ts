import type { Bus } from '@novastarter/memory';
import type { Logger } from 'pino';
import { createLogger } from './create-logger.js';
import { LogsStream, type PrettyType } from './logs-stream.js';

/**
 * Memoized logger and bus streams, held at module level so each is built once per process.
 *
 * Wrapped in an object rather than exported as bare bindings, so tests can reset them in place instead of reloading
 * the module.
 *
 * @internal
 * @defaultValue Everything empty until first use.
 */
export const _cache: {
	logger: Logger<never> | undefined;
	logsStream: LogsStream | undefined;
	httpLogsStream: LogsStream | undefined;
} = { logger: undefined, logsStream: undefined, httpLogsStream: undefined };

/**
 * Make a logger the process-wide one.
 *
 * What the application calls at start-up with the logger it built from its configuration; until then
 * {@link useLogger} answers with a default one. Registering twice replaces the logger for every later caller.
 *
 * @param logger - The logger every `useLogger()` call answers with from now on.
 * @example
 * ```ts
 * registerLogger(createLogger({ level: env['LOG_LEVEL'] as string, style: resolveLogStyle(env) }));
 * ```
 */
export const registerLogger = (logger: Logger<never>): void => {
	// 1. Replace rather than merge: the application's logger carries its own streams and level
	_cache.logger = logger;
};

/**
 * Return the process-wide logger.
 *
 * The one given to {@link registerLogger}; before any registration, a default logger — `info`, raw JSON lines — is
 * built on the first call and kept, so a package can log during start-up without waiting for the application.
 *
 * @returns The same pino logger on every call, so callers may hold on to it.
 *
 * @example
 * ```ts
 * const logger = useLogger();
 * logger.info('Server started');
 * ```
 */
export const useLogger = (): Logger<never> => {
	// 1. Reuse the registered or built logger — configuring pino on every call would open a new stream each time
	if (_cache.logger) {
		return _cache.logger;
	}

	// 2. Nothing registered yet: a default logger, safe for a collector, until the application registers its own
	_cache.logger = createLogger();

	return _cache.logger;
};

/**
 * Return the bus stream for application logs, building it on first use.
 *
 * @param pretty - `true` publishes level, time and message; `false` publishes the raw line.
 * @param messenger - Bus the lines are published on.
 * @returns The same stream on every call.
 */
export const getLogsStream = (pretty: boolean, messenger: Bus): LogsStream => {
	if (_cache.logsStream) {
		return _cache.logsStream;
	}

	const shape: PrettyType = pretty ? 'basic' : false;
	_cache.logsStream = new LogsStream(shape, messenger);

	return _cache.logsStream;
};

/**
 * Return the bus stream for HTTP logs, building it on first use.
 *
 * @param pretty - `true` folds the request into one message; `false` publishes the raw line.
 * @param messenger - Bus the lines are published on.
 * @returns The same stream on every call.
 */
export const getHttpLogsStream = (pretty: boolean, messenger: Bus): LogsStream => {
	if (_cache.httpLogsStream) {
		return _cache.httpLogsStream;
	}

	const shape: PrettyType = pretty ? 'http' : false;
	_cache.httpLogsStream = new LogsStream(shape, messenger);

	return _cache.httpLogsStream;
};
