/**
 * Tests of `logger/lib/create-logger`.
 *
 * `pino` and `pino-pretty` are mocked, so these check which streams and options reach pino for given options rather
 * than any real output.
 */
import { pino } from 'pino';
import { build as pinoPretty } from 'pino-pretty';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildLevelFormatters, buildRedactOptions, createLogger, getLoggerLevelValue } from './create-logger.js';
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

	test('Resolves a custom level passed next to the name', () => {
		expect(getLoggerLevelValue('notice', { notice: 35 })).toBe(35);
	});
});

describe('buildRedactOptions', () => {
	test('Redacts the built-in paths with the default censor when the caller passes nothing', () => {
		expect(buildRedactOptions(undefined)).toStrictEqual({
			paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'req.query.access_token'],
			censor: expect.any(String),
		});
	});

	test('Adds the paths of the array form to the built-in ones', () => {
		// 1. A repeated built-in path is not listed twice
		expect(buildRedactOptions(['password', 'req.headers.cookie'])).toStrictEqual({
			paths: [
				'req.headers.authorization',
				'req.headers.cookie',
				'res.headers["set-cookie"]',
				'req.query.access_token',
				'password',
			],
			censor: expect.any(String),
		});
	});

	test('Keeps the censor and remove of the object form next to the built-in paths', () => {
		expect(buildRedactOptions({ paths: ['password'], censor: '***', remove: true })).toStrictEqual({
			paths: [
				'req.headers.authorization',
				'req.headers.cookie',
				'res.headers["set-cookie"]',
				'req.query.access_token',
				'password',
			],
			censor: '***',
			remove: true,
		});
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

	test('Throws on an unknown logsStream level instead of building a logger that writes nothing', () => {
		// 1. pino's multistream resolves an unknown level name to `undefined` and then drops every line, the console
		//    stream included, so the factory must fail at start-up, as loud as pino's own `unknown level` error
		expect(() => createLogger({ logsStream: { stream: {} as LogsStream, level: 'nope' } })).toThrow(
			'unknown level nope',
		);

		expect(pino).not.toHaveBeenCalled();
	});

	test('Hands the multistream the custom levels, so it does not drop every line of a custom level', () => {
		// 1. Without `levels` the multistream resolves `notice` to `undefined` and writes nothing, not even errors
		createLogger({ level: 'notice', pino: { customLevels: { notice: 35 } } });

		expect(pino.multistream).toHaveBeenCalledWith([{ level: 'notice', stream: process.stdout }], {
			levels: expect.objectContaining({ notice: 35, info: 30 }),
		});
	});

	test('Accepts a custom logsStream level and lowers the logger level to match it', () => {
		const stream = {} as LogsStream;

		createLogger({ logsStream: { stream, level: 'verbose' }, pino: { customLevels: { verbose: 25 } } });

		expect(pino).toHaveBeenCalledWith(expect.objectContaining({ level: 'verbose' }), [
			{ level: 'info', stream: process.stdout },
			{ level: 'verbose', stream },
		]);
	});

	test('Keeps the built-in redaction when the caller passes its own redact paths', () => {
		// 1. lodash merges arrays index by index; the caller's list must add to the credentials, not overwrite them
		createLogger({ pino: { redact: { paths: ['password'] } } });

		expect(pino).toHaveBeenCalledWith(
			expect.objectContaining({
				redact: {
					paths: [
						'req.headers.authorization',
						'req.headers.cookie',
						'res.headers["set-cookie"]',
						'req.query.access_token',
						'password',
					],
					censor: expect.any(String),
				},
			}),
			expect.anything(),
		);
	});

	test('Keeps the built-in redaction and the censor when the caller passes the array form', () => {
		createLogger({ pino: { redact: ['password'] } });

		expect(pino).toHaveBeenCalledWith(
			expect.objectContaining({
				redact: {
					paths: expect.arrayContaining(['req.headers.authorization', 'password']),
					censor: expect.any(String),
				},
			}),
			expect.anything(),
		);
	});

	test('Merges the pino options and the level map in', () => {
		createLogger({ pino: { name: 'api' }, levels: { info: 'INFO' } });

		expect(pino).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'api', formatters: { level: expect.any(Function) } }),
			expect.anything(),
		);
	});
});
