/**
 * Tests of the package entry point: what a consumer importing `@novastarter/payments-driver-lemonsqueezy` reaches —
 * the driver, its config type and the refusal error every public method documents `@throws` for.
 */
import { describe, expect, test } from 'vitest';
import { LemonSqueezyApiError as ApiErrorFromLib } from './lib/api.js';
import PaymentsDriverLemonSqueezyDefault, { LemonSqueezyApiError, PaymentsDriverLemonSqueezy } from './index.js';

describe('package entry point', () => {
	test('Re-exports the driver as the named and the default binding', () => {
		// 1. Both spellings reach the same class, so a consumer can pick either without getting a different driver
		expect(PaymentsDriverLemonSqueezy).toBe(PaymentsDriverLemonSqueezyDefault);
	});

	test('Re-exports the refusal error the public methods document', () => {
		// 1. The error is the driver's own class, not a copy: a refusal thrown by any method is classified with the
		//    exported binding, and its prototype chain carries `status` and `errors`
		expect(LemonSqueezyApiError).toBe(ApiErrorFromLib);

		const refusal = new LemonSqueezyApiError(401, [{ status: '401', title: 'Unauthenticated' }]);

		expect(refusal).toBeInstanceOf(Error);
		expect(refusal.status).toBe(401);
	});
});
