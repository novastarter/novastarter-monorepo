import { beforeEach, expect, test, vi } from 'vitest';
import { useEnv } from '../lib/use-env.js';
import { getConfigFromEnv } from './get-config-from-env.js';

vi.mock('../lib/use-env.js');

beforeEach(() => {
	vi.mocked(useEnv).mockReturnValue({
		LOGGER_NAME: 'api',
		LOGGER_LEVEL: 'debug',
		LOGGER_HTTP_AUTO_LOGGING: false,
		LOGGER_HTTP_LOGGER_NAME: 'http',
		DB_POOL__MIN: 2,
		DB_POOL__MAX: 10,
		DB_CLIENT: 'pg',
		PORT: 8055,
	});
});

test('Collects the variables under the prefix as camelCase keys', () => {
	expect(getConfigFromEnv('LOGGER_')).toStrictEqual({
		name: 'api',
		level: 'debug',
		httpAutoLogging: false,
		httpLoggerName: 'http',
	});
});

test('Matches the prefix regardless of case', () => {
	expect(getConfigFromEnv('logger_')).toStrictEqual(getConfigFromEnv('LOGGER_'));
});

test('Returns an empty object when nothing matches', () => {
	expect(getConfigFromEnv('CACHE_')).toStrictEqual({});
});

test('Leaves out the variables under omitPrefix', () => {
	expect(getConfigFromEnv('LOGGER_', { omitPrefix: 'LOGGER_HTTP' })).toStrictEqual({ name: 'api', level: 'debug' });
	expect(getConfigFromEnv('LOGGER_HTTP', { omitPrefix: 'LOGGER_HTTP_LOGGER' })).toStrictEqual({ autoLogging: false });
});

test('Leaves out the variables named in omitKey', () => {
	expect(getConfigFromEnv('LOGGER_', { omitKey: ['LOGGER_NAME', 'LOGGER_HTTP_AUTO_LOGGING'] })).toStrictEqual({
		level: 'debug',
		httpLoggerName: 'http',
	});
});

test('Nests the value on a double underscore', () => {
	expect(getConfigFromEnv('DB_')).toStrictEqual({ pool: { min: 2, max: 10 }, client: 'pg' });
});

test('Keeps the name lowercased with the underscore type', () => {
	expect(getConfigFromEnv('LOGGER_HTTP_', { type: 'underscore' })).toStrictEqual({
		auto_logging: false,
		logger_name: 'http',
	});
});
