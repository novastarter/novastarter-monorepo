import { expect, test } from 'vitest';
import { messageConstructor, ResourceRestrictedError } from './resource-restricted.js';

test('Constructs message', () => {
	expect(messageConstructor({ category: 'sso' })).toMatchInlineSnapshot('"Resource "sso" is restricted."');
});

test('Carries the code, the status and the category', () => {
	const error = new ResourceRestrictedError({ category: 'sso' });

	expect(error.code).toBe('RESOURCE_RESTRICTED');
	expect(error.status).toBe(403);
	expect(error.extensions).toStrictEqual({ category: 'sso' });
});
