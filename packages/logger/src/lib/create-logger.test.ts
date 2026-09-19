/**
 * Tests of `logger/lib/create-logger`.
 *
 * `@novastarter/env`, `pino` and `pino-pretty` are mocked, so these check which streams and options reach pino for a
 * given environment rather than any real output.
 */
import { getConfigFromEnv, useEnv } from '@novastarter/env';
import { pino } from 'pino';
import { build as pinoPretty } from 'pino-pretty';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildLevelFormatters, createLogger, getLoggerLevelValue } from './create-logger.js';
import type { LogsStream } from './logs-stream.js';

vi.mock('@novastarter/env');
vi.mock('pino-pretty');

vi.mock('pino', async (importOriginal) => {
	const original = await importOriginal<typeof import('pino')>();

	const mocked = vi.fn(() => ({ info: vi.fn() }));
	Object.assign(mocked, { levels: original.pino.levels, multistream: vi.fn((streams) => streams) });

	return { pino: mocked };
});

const prettyStream = { pretty: true };

beforeEach(() => {
	vi.mocked(useEnv).mockReturnValue({});
	vi.mocked(getConfigFromEnv).mockReturnValue({});
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
		expect(buildLevelFormatters({})).toBeUndefined();
	});

	test('Maps labels to severity and removes the levels entry', () => {
		const config = { levels: ['info:INFO', ' warn : WARNING '] };

		const formatters = buildLevelFormatters(config);

		expect(config).toStrictEqual({});
		expect(formatters?.level?.('warn', 40)).toStrictEqual({ severity: 'WARNING', level: 40 });
		expect(formatters?.level?.('error', 50)).toStrictEqual({ severity: 'info', level: 50 });
	});
});

describe('createLogger', () => {
	test('Uses the pretty console stream by default', () => {
		createLogger();

		expect(pinoPretty).toHaveBeenCalledWith({ ignore: 'hostname,pid', sync: true });

		expect(pino).toHaveBeenCalledWith(expect.objectContaining({ level: 'info' }), [
			{ level: 'info', stream: prettyStream },
		]);
	});

	test('Writes raw lines to stdout when LOG_STYLE is raw', () => {
		vi.mocked(useEnv).mockReturnValue({ LOG_STYLE: 'raw', LOG_LEVEL: 'debug' });

		createLogger();

		expect(pinoPretty).not.toHaveBeenCalled();

		expect(pino).toHaveBeenCalledWith(expect.objectContaining({ level: 'debug' }), [
			{ level: 'debug', stream: process.stdout },
		]);
	});

	test('Redacts authorization and cookie headers', () => {
		createLogger();

		expect(pino).toHaveBeenCalledWith(
			expect.objectContaining({
				redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], censor: expect.any(String) },
			}),
			expect.anything(),
		);
	});

	test('Adds the logs stream and lowers the logger level to match it', () => {
		const stream = {} as LogsStream;

		createLogger({ logsStream: { stream, level: 'trace' } });

		expect(pino).toHaveBeenCalledWith(expect.objectContaining({ level: 'trace' }), [
			{ level: 'info', stream: prettyStream },
			{ level: 'trace', stream },
		]);
	});

	test('Merges LOGGER_* options into pino', () => {
		vi.mocked(getConfigFromEnv).mockReturnValue({ name: 'api', levels: ['info:INFO'] });

		createLogger();

		expect(getConfigFromEnv).toHaveBeenCalledWith('LOGGER_', { omitPrefix: 'LOGGER_HTTP' });

		expect(pino).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'api', formatters: { level: expect.any(Function) } }),
			expect.anything(),
		);
	});
});
