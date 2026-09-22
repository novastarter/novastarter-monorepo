/**
 * Tests of `memory/utils/with-namespace`.
 */
import { expect, test } from 'vitest';
import { withNamespace } from './with-namespace.js';

test('Prepends given key with given namespace', () => {
	// 1. `:` is the separator Redis tooling groups keys by, so the namespace has to come first, before it
	expect(withNamespace('key', 'namespace')).toBe('namespace:key');
});
