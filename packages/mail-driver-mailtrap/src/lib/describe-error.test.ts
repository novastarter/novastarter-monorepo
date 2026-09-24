/**
 * Tests of `describe-error`: how what the SDK throws becomes the error the driver raises.
 */
import { describe, expect, test } from 'vitest';
import { describeError } from './describe-error.js';

describe('describeError', () => {
	test('Names the provider and keeps the SDK error as the cause', () => {
		// Wrapped, not replaced, so the cause keeps Mailtrap's error list
		const refusal = new Error("'to' address is required");

		expect(describeError(refusal)).toMatchObject({
			message: "Mailtrap: 'to' address is required",
			cause: refusal,
		});

		// A thrown non-error is still described rather than crashing the description
		expect(describeError('boom')).toMatchObject({ message: 'Mailtrap: boom', cause: 'boom' });
	});
});
