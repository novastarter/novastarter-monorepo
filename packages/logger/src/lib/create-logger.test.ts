/**
 * Tests of `logger/lib/create-logger`.
 *
 * `pino` and `pino-pretty` are mocked, so these check which streams and options reach pino for given options rather
 * than any real output.
 */
import { pino } from 'pino';
import { build as pinoPretty } from 'pino-pretty';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildLevelFormatters, createLogger, getLoggerLevelValue } from './create-logger.js';
import type { LogsStream } from './logs-stream.js';

vi.mock('pino-pretty');

vi.mock('pino', async (importOriginal) => {
	const original = await importOriginal<typeof import('pino')>();

	const mocked = vi.fn(() => ({ info: vi.fn() }));
	Object.assign(mocked, { levels: original.pino.levels, multistream: vi.fn((streams) => streams) });

	return { pino: mocked };
});

const prettyStream = { pretty: true };

beforeEach(() => {
	vi.mocked(pinoPretty).mockReturnValue(prettyStream as any);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('getLoggerLevelValue', () => {
	test('Returns the numeric value of a known level', () => {
		expect(getLoggerLevelValue('debug')).toBe(20);
	});

	test('Falls back to info for an unknown level', () => {
		expect(getLoggerLevelValue('nope')).toBe(30);
	});
});

describe('buildLevelFormatters', () => {
	test('Returns undefined without custom levels', () => {
		expect(buildLevelFormatters(undefined)).toBeUndefined();
	});

	test('Maps labels to severity, info for the unmapped ones', () => {
		const formatters = buildLevelFormatters({ info: 'INFO', warn: 'WARNING' });

		expect(formatters?.level?.('warn', 40)).toStrictEqual({ severity: 'WARNING', level: 40 });
		expect(formatters?.level?.('error', 50)).toStrictEqual({ severity: 'info', level: 50 });
	});
});

describe('createLogger', () => {
	test('Writes raw lines to stdout at info by default', () => {
		createLogger();

		expect(pinoPretty).not.toHaveBeenCalled();

		expect(pino).toHaveBeenCalledWith(expect.objectContaining({ level: 'info' }), [
			{ level: 'info', stream: process.stdout },
		]);
	});

	test('Uses the pretty console stream and the given level when asked', () => {
		createLogger({ style: 'pretty', level: 'debug' });

		expect(pinoPretty).toHaveBeenCalledWith({ ignore: 'hostname,pid', sync: true });

		expect(pino).toHaveBeenCalledWith(expect.objectContaining({ level: 'debug' }), [
			{ level: 'debug', stream: prettyStream },
		]);
	});

	test('Redacts credentials, the session cookie and query tokens', () => {
		createLogger();

		expect(pino).toHaveBeenCalledWith(
			expect.objectContaining({
				redact: {
					paths: [
						'req.headers.authorization',
						'req.headers.cookie',
						'res.headers["set-cookie"]',
						'req.query.access_token',
					],
					censor: expect.any(String),
				},
			}),
			expect.anything(),
		);
	});

	test('Adds the logs stream and lowers the logger level to match it', () => {
		const stream = {} as LogsStream;

		createLogger({ logsStream: { stream, level: 'trace' } });

		expect(pino).toHaveBeenCalledWith(expect.objectContaining({ level: 'trace' }), [
			{ level: 'info', stream: process.stdout },
			{ level: 'trace', stream },
		]);
	});

	test('Merges the pino options and the level map in', () => {
		createLogger({ pino: { name: 'api' }, levels: { info: 'INFO' } });

		expect(pino).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'api', formatters: { level: expect.any(Function) } }),
			expect.anything(),
		);
	});
});
