/**
 * Tests of `mail/lib/mail-manager` on managers built by hand; the process-wide one is `use-mail.test.ts`'s.
 *
 * `@novastarter/logger` is mocked, since the console driver resolves the application logger when it is built.
 */
import { type Logger, useLogger } from '@novastarter/logger';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MailDriverConsole } from './drivers/console.js';
import { MailManager } from './mail-manager.js';

vi.mock('@novastarter/logger');

// The test driver joins the driver map the way a driver package does, so its registrations type-check
declare module './mail-manager.js' {
	interface MailDrivers {
		'test-driver': Record<string, unknown>;
	}
}

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue({ info: vi.fn() } as unknown as Logger);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('MailManager', () => {
	test('Registers the built-in drivers on construction and builds a location on first use', () => {
		const manager = new MailManager();

		expect([...manager['drivers'].keys()]).toStrictEqual(['console', 'file', 'sendmail', 'smtp']);

		manager.registerLocation('default', {
			driver: 'console',
			options: {},
		});

		expect(manager.instantiated().size).toBe(0);
		expect(manager.location('default')).toBeInstanceOf(MailDriverConsole);
		expect(manager.location('default')).toBe(manager.location('default'));
	});

	test('Passes the location options to a registered driver class', () => {
		const manager = new MailManager();
		const mockDriver = vi.fn();

		// A bare mock stands in for a vendor driver class, recording how the manager calls `new Driver(...)`
		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('main', {
			driver: 'test-driver',
			options: {
				apiKey: 'k',
			},
		});

		manager.location('main');

		expect(mockDriver).toHaveBeenCalledExactlyOnceWith({ apiKey: 'k' });
	});

	test('Holds the routes the application registers, replacing them on a second call', () => {
		const manager = new MailManager();

		expect(manager.routes()).toStrictEqual({});

		manager.registerRoutes({ from: 'a@acme.test', transactional: ['main'] });
		manager.registerRoutes({ from: 'b@acme.test' });

		expect(manager.routes()).toStrictEqual({ from: 'b@acme.test' });
	});
});
