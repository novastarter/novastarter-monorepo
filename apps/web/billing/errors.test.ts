/**
 * Tests of `billing/errors`: the two entitlement errors built on `createError()` of `@novastarter/errors`.
 */
import { isNovastarterError } from '@novastarter/errors';
import { describe, expect, test } from 'vitest';
import { LimitExceededError, limitExceededMessage, ResourceRestrictedError, resourceRestrictedMessage } from './errors';

describe('LimitExceededError', () => {
	test('Constructs message', () => {
		expect(limitExceededMessage({ category: 'seats' })).toMatchInlineSnapshot('"Limit exceeded for "seats"."');
	});

	test('Carries the code, the status and the category', () => {
		const error = new LimitExceededError({ category: 'seats' });

		expect(error.code).toBe('LIMIT_EXCEEDED');
		expect(error.status).toBe(403);
		expect(error.extensions).toStrictEqual({ category: 'seats' });
		expect(isNovastarterError(error)).toBe(true);
	});
});

describe('ResourceRestrictedError', () => {
	test('Constructs message', () => {
		expect(resourceRestrictedMessage({ category: 'sso' })).toMatchInlineSnapshot('"Resource "sso" is restricted."');
	});

	test('Carries the code, the status and the category', () => {
		const error = new ResourceRestrictedError({ category: 'sso' });

		expect(error.code).toBe('RESOURCE_RESTRICTED');
		expect(error.status).toBe(403);
		expect(error.extensions).toStrictEqual({ category: 'sso' });
		expect(isNovastarterError(error)).toBe(true);
	});
});
