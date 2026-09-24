/**
 * Tests of the package entry point: what a consumer importing `@novastarter/payments-driver-lemonsqueezy` reaches —
 * the driver, its config type and the refusal error every public method documents `@throws` for.
 */
import { describe, expect, test } from 'vitest';
import { LemonSqueezyApiError as ApiErrorFromLib } from './lib/api.js';
import { PaymentsDriverLemonSqueezy as DriverFromLib } from './lib/driver.js';
import * as entry from './index.js';
import { LemonSqueezyApiError, PaymentsDriverLemonSqueezy } from './index.js';

describe('package entry point', () => {
	test('Re-exports the driver by name only', () => {
		// The symbol has one name everywhere.
		expect(PaymentsDriverLemonSqueezy).toBe(DriverFromLib);

		expect('default' in entry).toBe(false);
	});

	test('Re-exports the refusal error the public methods document', () => {
		// A refusal thrown by any method is classified with the exported binding, and its prototype chain carries
		// `status` and `errors`.
		expect(LemonSqueezyApiError).toBe(ApiErrorFromLib);

		const refusal = new LemonSqueezyApiError(401, [{ status: '401', title: 'Unauthenticated' }]);

		expect(refusal).toBeInstanceOf(Error);
		expect(refusal.status).toBe(401);
	});
});
