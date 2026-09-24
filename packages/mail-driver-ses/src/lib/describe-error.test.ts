/**
 * Tests of `describe-error`: how what the SDK or nodemailer throws becomes the error the driver raises.
 */
import { describe, expect, test } from 'vitest';
import { describeError } from './describe-error.js';

describe('describeError', () => {
	test('Names the provider and keeps the original error as the cause', () => {
		// Wrapped, not replaced, so the cause keeps the details SES or the transport answered
		const refusal = new Error('Message rejected: Email address is not verified.');

		expect(describeError(refusal)).toMatchObject({
			message: 'SES: Message rejected: Email address is not verified.',
			cause: refusal,
		});

		// A thrown non-error is still described rather than crashing the description
		expect(describeError('boom')).toMatchObject({ message: 'SES: boom', cause: 'boom' });
	});
});
