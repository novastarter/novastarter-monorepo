/**
 * Tests of `payments/lib/use-payments`: one manager per process, resettable through `_cache`.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { PaymentsManager } from './payments-manager.js';
import { _cache, usePayments } from './use-payments.js';

afterEach(() => {
	_cache.payments = undefined;
});

describe('usePayments', () => {
	test('Creates a manager on first use and hands the same one out afterwards', () => {
		// 1. Nothing is built until asked, so an app without billing never constructs a manager
		expect(_cache.payments).toBeUndefined();

		const manager = usePayments();

		expect(manager).toBeInstanceOf(PaymentsManager);
		expect(_cache.payments).toBe(manager);

		// 2. Every later call returns the cached instance, so registrations made at start-up are visible everywhere
		expect(usePayments()).toBe(manager);
	});
});
