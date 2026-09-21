/**
 * Tests of `mail/lib/use-mail`: one manager per process, resettable.
 *
 * `@novastarter/logger` is mocked, since the console driver resolves the application logger when it is built.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MailManager } from './mail-manager.js';
import { useMail } from './use-mail.js';

vi.mock('@novastarter/logger');

afterEach(() => {
	useMail.reset();
});

describe('useMail', () => {
	test('Creates a manager on first use and hands the same one out afterwards', () => {
		// 1. Every later call returns the cached instance, so registrations made at start-up are visible everywhere
		const manager = useMail();

		expect(manager).toBeInstanceOf(MailManager);
		expect(useMail()).toBe(manager);

		// 2. `reset()` drops it, so the next test starts from a manager with only the built-in drivers
		useMail.reset();
		expect(useMail()).not.toBe(manager);
	});
});
