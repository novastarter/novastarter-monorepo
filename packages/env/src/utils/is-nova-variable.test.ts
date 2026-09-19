import { expect, test, vi } from 'vitest';
import { isNovaVariable } from './is-nova-variable.js';

vi.mock('../constants/nova-variables.js', () => ({
	NOVA_VARIABLES_REGEX: [/TEST_.*/],
}));

test('Returns false if variable matches none of the regexes', () => {
	expect(isNovaVariable('NO')).toBe(false);
});

test('Returns true if variable matches one or more of the regexes', () => {
	expect(isNovaVariable('TEST_123')).toBe(true);
});

test('Checks against original name if variable is suffixed with _FILE', () => {
	expect(isNovaVariable('NO_FILE')).toBe(false);
	expect(isNovaVariable('TEST_123_FILE')).toBe(true);
});
