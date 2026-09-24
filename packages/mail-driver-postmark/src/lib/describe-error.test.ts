/**
 * Tests of `describe-error`: how what the SDK throws becomes the error the driver raises.
 */
import { describe, expect, test } from 'vitest';
import { describeError } from './describe-error.js';

describe('describeError', () => {
	test('Names the provider and keeps the SDK error as the cause', () => {
		// Wrapped, not replaced, so the cause keeps the code and status the SDK answered
		const refusal = Object.assign(new Error('Inactive recipient'), { code: 406, statusCode: 422 });

		expect(describeError(refusal)).toMatchObject({
			message: 'Postmark: Inactive recipient',
			cause: refusal,
		});

		// A thrown non-error is still described rather than crashing the description
		expect(describeError('boom')).toMatchObject({ message: 'Postmark: boom', cause: 'boom' });
	});
});
