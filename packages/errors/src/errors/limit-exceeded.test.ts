import { expect, test } from 'vitest';
import { LimitExceededError, messageConstructor } from './limit-exceeded.js';

test('Constructs message', () => {
	expect(messageConstructor({ category: 'seats' })).toMatchInlineSnapshot('"Limit exceeded for "seats"."');
});

test('Carries the code, the status and the category', () => {
	const error = new LimitExceededError({ category: 'seats' });

	expect(error.code).toBe('LIMIT_EXCEEDED');
	expect(error.status).toBe(403);
	expect(error.extensions).toStrictEqual({ category: 'seats' });
});
