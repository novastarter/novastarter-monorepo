/**
 * Tests of `describe-error`: how what the SDK throws becomes the error the driver raises.
 */
import { describe, expect, test } from 'vitest';
import { describeError } from './describe-error.js';

describe('describeError', () => {
	test('Names the provider and keeps the SDK error as the cause', () => {
		const refusal = Object.assign(new Error('Unauthorized'), { statusCode: 401 });

		expect(describeError(refusal)).toMatchObject({
			message: 'Mailjet: Unauthorized',
			cause: refusal,
		});

		expect(describeError('boom')).toMatchObject({ message: 'Mailjet: boom', cause: 'boom' });
	});
});
