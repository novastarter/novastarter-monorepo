/**
 * Tests of `describe-error`: how what the SDK throws becomes the error the driver raises.
 */
import { describe, expect, test } from 'vitest';
import { rethrowMailgunError } from './describe-error.js';

describe('rethrowMailgunError', () => {
	test('Names the provider and keeps the SDK error as the cause', () => {
		const refusal = Object.assign(new Error('Forbidden'), { status: 401, details: 'Invalid private key' });

		expect(() => rethrowMailgunError(refusal)).toThrowError(
			expect.objectContaining({ message: 'Mailgun: Forbidden', cause: refusal }),
		);

		expect(() => rethrowMailgunError('boom')).toThrowError(
			expect.objectContaining({ message: 'Mailgun: boom', cause: 'boom' }),
		);
	});
});
