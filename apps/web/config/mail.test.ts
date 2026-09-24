/**
 * Tests of `config/mail`: the driver of the `default` location follows `MAIL_DRIVER` and `NODE_ENV`, and production
 * refuses to boot without an explicit driver.
 */
import { InvalidConfigError } from '@novastarter/errors';
import { describe, expect, test } from 'vitest';
import { envSchema } from '../env';
import { mailConfig } from './mail';

/**
 * The parsed variables the config reads, from raw overrides over the schema defaults.
 *
 * @param overrides - Raw variables over the defaults.
 * @returns The parsed variables.
 */
const env = (overrides: Record<string, string> = {}) => envSchema.parse({ NODE_ENV: 'test', ...overrides });

describe('mailConfig', () => {
	test('Defaults to the console driver outside production', () => {
		// Without MAIL_DRIVER in test, the location rides the console driver, so a fresh clone reads its mail in the
		// terminal — and the sender comes from MAIL_FROM
		const config = mailConfig(env({ MAIL_FROM: 'no-reply@acme.test' }));

		expect(config.location.driver).toBe('console');
		expect(config.routes.from).toBe('no-reply@acme.test');
	});

	test('Takes the driver from MAIL_DRIVER', () => {
		// An explicit driver wins over the environment-dependent default
		const config = mailConfig(env({ MAIL_DRIVER: 'sendmail' }));

		expect(config.location.driver).toBe('sendmail');
	});

	test('Refuses to boot in production without MAIL_DRIVER', () => {
		// The silent console default must not reach production: boot fails loudly instead of logging every message
		expect(() => mailConfig(env({ NODE_ENV: 'production' }))).toThrowError(/MAIL_DRIVER is required in production/);
		expect(() => mailConfig(env({ NODE_ENV: 'production' }))).toThrowError(InvalidConfigError);
	});

	test('Accepts an explicit console driver in production', () => {
		// Logging instead of delivering stays possible where it is a deliberate choice, named in the configuration
		const config = mailConfig(env({ NODE_ENV: 'production', MAIL_DRIVER: 'console' }));

		expect(config.location.driver).toBe('console');
	});
});
