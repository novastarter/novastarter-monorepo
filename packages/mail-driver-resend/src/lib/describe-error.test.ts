/**
 * Tests of `describe-error`: how the SDK's failure value becomes the error the driver raises.
 */
import { describe, expect, test } from 'vitest';
import { describeError } from './describe-error.js';

describe('describeError', () => {
	test('Names the provider with the failure name and message, keeping the value as the cause', () => {
		// The SDK's failure value is an object naming the refusal in `name` and `message`; the value stays reachable as
		// the cause so its status code survives
		const failure = { name: 'invalid_from_address', message: 'Verify the domain', statusCode: 422 };

		expect(describeError(failure)).toMatchObject({
			message: 'Resend: invalid_from_address: Verify the domain',
			cause: failure,
		});

		// A failure shaped otherwise is described as text, never dropped or read as `undefined`
		expect(describeError('boom')).toMatchObject({ message: 'Resend: boom', cause: 'boom' });
	});
});
