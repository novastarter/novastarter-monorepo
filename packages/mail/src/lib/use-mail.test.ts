/**
 * Tests of `mail/lib/use-mail`: one manager per process, resettable through `_cache`.
 *
 * `@novastarter/logger` is mocked, since the console driver resolves the application logger when it is built.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MailManager } from './mail-manager.js';
import { _cache, useMail } from './use-mail.js';

vi.mock('@novastarter/logger');

afterEach(() => {
	_cache.mail = undefined;
});

describe('useMail', () => {
	test('Creates a manager on first use and hands the same one out afterwards', () => {
		// 1. Nothing is built until asked, so a process that never sends mail never constructs a manager
		expect(_cache.mail).toBeUndefined();

		const manager = useMail();

		expect(manager).toBeInstanceOf(MailManager);
		expect(_cache.mail).toBe(manager);

		// 2. Every later call returns the cached instance, so registrations made at start-up are visible everywhere
		expect(useMail()).toBe(manager);
	});
});
