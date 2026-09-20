/**
 * Tests of `logger/lib/use-logger`.
 *
 * `./create-logger.js` and `./logs-stream.js` are mocked, so these exercise the memoization alone.
 */
import type { Logger } from 'pino';
import { afterEach, expect, test, vi } from 'vitest';
import { createLogger } from './create-logger.js';
import { type LogsBus, LogsStream } from './logs-stream.js';
import { _cache, getHttpLogsStream, getLogsStream, registerLogger, useLogger } from './use-logger.js';

vi.mock('./create-logger.js');
vi.mock('./logs-stream.js');

const messenger = { publish: vi.fn() } as unknown as LogsBus;

afterEach(() => {
	vi.resetAllMocks();

	_cache.logger = undefined;
	_cache.logsStream = undefined;
	_cache.httpLogsStream = undefined;
});

test('Returns cached logger if exists', () => {
	_cache.logger = {} as Logger<never>;

	expect(useLogger()).toBe(_cache.logger);
	expect(createLogger).not.toHaveBeenCalled();
});

test('Creates a default logger if none is registered', () => {
	const mockLogger = {} as Logger<never>;
	vi.mocked(createLogger).mockReturnValue(mockLogger);

	expect(useLogger()).toBe(mockLogger);
	expect(createLogger).toHaveBeenCalledWith();
	expect(_cache.logger).toBe(mockLogger);
});

test('Answers with the registered logger, replacing the default one', () => {
	vi.mocked(createLogger).mockReturnValue({} as Logger<never>);
	const registered = {} as Logger<never>;

	useLogger();
	registerLogger(registered);

	expect(useLogger()).toBe(registered);
	expect(createLogger).toHaveBeenCalledTimes(1);
});

test('Creates a basic logs stream once', () => {
	const first = getLogsStream(true, messenger);
	const second = getLogsStream(false, messenger);

	expect(LogsStream).toHaveBeenCalledTimes(1);
	expect(LogsStream).toHaveBeenCalledWith('basic', messenger);
	expect(second).toBe(first);
});

test('Creates a http logs stream once, raw when not pretty', () => {
	const first = getHttpLogsStream(false, messenger);
	const second = getHttpLogsStream(true, messenger);

	expect(LogsStream).toHaveBeenCalledTimes(1);
	expect(LogsStream).toHaveBeenCalledWith(false, messenger);
	expect(second).toBe(first);
});
