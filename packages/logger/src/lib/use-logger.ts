import { type Singleton, singleton } from '@novastarter/utils';
import type { Logger } from 'pino';
import { createLogger } from './create-logger.js';
import { type LogsBus, LogsStream } from './logs-stream.js';

/**
 * Return the process-wide logger.
 *
 * The one given to {@link registerLogger}; before any registration, a default logger — `info`, raw JSON lines — is
 * built on the first call and kept, so a package can log during start-up without waiting for the application.
 *
 * @returns The same pino logger on every call, so callers may hold on to it; `useLogger.reset()` drops it, for tests.
 * @example
 * ```ts
 * const logger = useLogger();
 * logger.info('Server started');
 * ```
 */
export const useLogger: Singleton<Logger<never>> = singleton(() => createLogger());

/**
 * Make a logger the process-wide one.
 *
 * What the application calls at start-up with the logger it built from its configuration; until then
 * {@link useLogger} answers with a default one. Registering twice replaces the logger for every later caller.
 *
 * @param logger - The logger every `useLogger()` call answers with from now on.
 * @example
 * ```ts
 * registerLogger(createLogger({
 * 	level: env['LOG_LEVEL'] as string,
 * 	style: resolveLogStyle(env),
 * }));
 * ```
 */
export const registerLogger = (logger: Logger<never>): void => {
	// Replace rather than merge: the application's logger carries its own streams and level.
	useLogger.replace(logger);
};

/**
 * Return the bus stream for application logs, building it on first use.
 *
 * The arguments belong to the first call: one stream serves the process, so its shape and bus are decided once, and a
 * later call passes none — one with arguments throws. The first call has to pass them: without a bus there is no
 * stream to build, and the call is refused rather than a stream that fails on its first line handed out.
 *
 * @param pretty - `true` publishes level, time and message; `false` publishes the raw line.
 * @param messenger - Bus the lines are published on.
 * @returns The same stream on every call; `useLogsStream.reset()` drops it, for tests.
 * @throws Error when the first call passes no bus, or a later call passes arguments.
 */
export const useLogsStream: Singleton<LogsStream, [pretty: boolean, messenger: LogsBus]> = singleton(
	(pretty?: boolean, messenger?: LogsBus) =>
		new LogsStream(pretty ? 'basic' : false, requireBus('useLogsStream', messenger)),
);

/**
 * Return the bus stream for HTTP logs, building it on first use.
 *
 * The arguments belong to the first call, like {@link useLogsStream}; a later call passes none.
 *
 * @param pretty - `true` folds the request into one message; `false` publishes the raw line.
 * @param messenger - Bus the lines are published on.
 * @returns The same stream on every call; `useHttpLogsStream.reset()` drops it, for tests.
 * @throws Error when the first call passes no bus, or a later call passes arguments.
 */
export const useHttpLogsStream: Singleton<LogsStream, [pretty: boolean, messenger: LogsBus]> = singleton(
	(pretty?: boolean, messenger?: LogsBus) =>
		new LogsStream(pretty ? 'http' : false, requireBus('useHttpLogsStream', messenger)),
);

/**
 * The bus a stream is built on, or a clear error when the building call left it out.
 *
 * The accessor's type lets any call pass no arguments, since only the first one builds; a first call without them
 * would otherwise build a stream over `undefined` and fail on the first log line, far from the cause.
 *
 * @param name - The accessor, for the message.
 * @param messenger - What the building call passed.
 * @returns The bus.
 * @throws Error when no bus was passed.
 * @internal
 */
const requireBus = (name: string, messenger: LogsBus | undefined): LogsBus => {
	// This check turns a late `TypeError` inside pino into an error at the call that forgot the arguments.
	if (!messenger) {
		throw new Error(`@novastarter/logger: ${name}: the first call builds the stream and needs (pretty, messenger)`);
	}

	return messenger;
};
