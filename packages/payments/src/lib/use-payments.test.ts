/**
 * Tests of `payments/lib/use-payments`: one manager per process, resettable.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { PaymentsManager } from './payments-manager.js';
import { usePayments } from './use-payments.js';

afterEach(() => {
	usePayments.reset();
});

describe('usePayments', () => {
	test('Creates a manager on first use and hands the same one out afterwards', () => {
		// Every later call returns the cached instance, so registrations made at start-up are visible everywhere.
		const manager = usePayments();

		expect(manager).toBeInstanceOf(PaymentsManager);
		expect(usePayments()).toBe(manager);

		// `reset()` drops the instance, so the next test starts from an empty manager.
		usePayments.reset();
		expect(usePayments()).not.toBe(manager);
	});
});
