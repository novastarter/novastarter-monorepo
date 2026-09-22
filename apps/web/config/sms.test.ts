/**
 * Tests of `config/sms`: the driver of the `default` location follows `SMS_DRIVER` and `NODE_ENV`, and production
 * refuses to boot without an explicit driver.
 */
import { describe, expect, test } from 'vitest';
import { envSchema } from '../env';
import { smsConfig } from './sms';

/**
 * The parsed variables the config reads, from raw overrides over the schema defaults.
 *
 * @param overrides - Raw variables over the defaults.
 * @returns The parsed variables.
 */
const env = (overrides: Record<string, string> = {}) => envSchema.parse({ NODE_ENV: 'test', ...overrides });

describe('smsConfig', () => {
	test('Defaults to the console driver outside production', () => {
		// 1. Without SMS_DRIVER in test, the location rides the console driver, so a fresh clone reads its one-time
		//    codes in the terminal — and the sender comes from SMS_FROM
		const config = smsConfig(env({ SMS_FROM: 'Acme' }));

		expect(config.location.driver).toBe('console');
		expect(config.routes.from).toBe('Acme');
	});

	test('Takes the driver from SMS_DRIVER', () => {
		// 1. An explicit driver wins over the environment-dependent default
		const config = smsConfig(env({ SMS_DRIVER: 'console' }));

		expect(config.location.driver).toBe('console');
	});

	test('Refuses to boot in production without SMS_DRIVER', () => {
		// 1. The silent console default must not reach production: boot fails loudly instead of logging every code
		expect(() => smsConfig(env({ NODE_ENV: 'production' }))).toThrowError(/SMS_DRIVER is required in production/);
	});

	test('Accepts an explicit console driver in production', () => {
		// 1. Logging instead of delivering stays possible where it is a deliberate choice, named in the configuration
		const config = smsConfig(env({ NODE_ENV: 'production', SMS_DRIVER: 'console' }));

		expect(config.location.driver).toBe('console');
	});
});
