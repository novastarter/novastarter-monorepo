/**
 * Tests of `logger/lib/use-logger`.
 *
 * `./create-logger.js` and `./logs-stream.js` are mocked, so these exercise the memoization alone.
 */
import type { Logger } from 'pino';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createLogger } from './create-logger.js';
import { type LogsBus, LogsStream } from './logs-stream.js';
import { registerLogger, useHttpLogsStream, useLogger, useLogsStream } from './use-logger.js';

vi.mock('./create-logger.js');
vi.mock('./logs-stream.js');

const messenger = { publish: vi.fn() } as unknown as LogsBus;

afterEach(() => {
	vi.resetAllMocks();

	useLogger.reset();
	useLogsStream.reset();
	useHttpLogsStream.reset();
});

describe('useLogger', () => {
	test('Creates a default logger once if none is registered', () => {
		// 1. The first call builds the default logger; every later call answers with it
		const mockLogger = {} as Logger<never>;
		vi.mocked(createLogger).mockReturnValue(mockLogger);

		expect(useLogger()).toBe(mockLogger);
		expect(useLogger()).toBe(mockLogger);
		expect(createLogger).toHaveBeenCalledOnce();
		expect(createLogger).toHaveBeenCalledWith();
	});

	test('Answers with the registered logger, replacing the default one', () => {
		// 1. A registration after the default was built wins, and the default is not rebuilt
		vi.mocked(createLogger).mockReturnValue({} as Logger<never>);
		const registered = {} as Logger<never>;

		useLogger();
		registerLogger(registered);

		expect(useLogger()).toBe(registered);
		expect(createLogger).toHaveBeenCalledTimes(1);
	});

	test('Answers with the registered logger without building a default one', () => {
		// 1. Registered before any use: the default logger is never built
		const registered = {} as Logger<never>;

		registerLogger(registered);

		expect(useLogger()).toBe(registered);
		expect(createLogger).not.toHaveBeenCalled();
	});
});

describe('useLogsStream', () => {
	test('Creates a basic logs stream once and refuses arguments afterwards', () => {
		// 1. The first call decides the shape and the bus; a later call without arguments answers with the stream
		const first = useLogsStream(true, messenger);
		const second = useLogsStream();

		expect(LogsStream).toHaveBeenCalledTimes(1);
		expect(LogsStream).toHaveBeenCalledWith('basic', messenger);
		expect(second).toBe(first);

		// 2. Arguments that would have no say are refused, not ignored
		expect(() => useLogsStream(false, messenger)).toThrow('singleton: the instance exists already');
	});

	test('Refuses a first call without the bus instead of building a stream that fails on its first line', () => {
		expect(() => useLogsStream()).toThrow(
			'useLogsStream: the first call builds the stream and needs (pretty, messenger)',
		);

		expect(() => useHttpLogsStream()).toThrow('useHttpLogsStream: the first call builds the stream');
		expect(LogsStream).not.toHaveBeenCalled();
	});
});

describe('useHttpLogsStream', () => {
	test('Creates a http logs stream once, raw when not pretty', () => {
		const first = useHttpLogsStream(false, messenger);
		const second = useHttpLogsStream();

		expect(LogsStream).toHaveBeenCalledTimes(1);
		expect(LogsStream).toHaveBeenCalledWith(false, messenger);
		expect(second).toBe(first);
	});
});
