/**
 * Tests of `env/utils/get-config-path`.
 */
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DEFAULTS } from '../constants/defaults.js';
import { getConfigPath } from './get-config-path.js';

vi.mock('node:path');

/** Copy of the real environment, restored after each test so the mutation cannot leak outside the file. */
const envBackup = { ...process.env };

beforeEach(() => {
	// 1. An empty environment, so a CONFIG_PATH from the developer's shell cannot leak into the assertions
	process.env = {};
	vi.mocked(resolve).mockReturnValue('test-resolved-path');
});

afterEach(() => {
	// 1. Mocks are cleared so the next test starts clean, then the real environment comes back
	vi.clearAllMocks();
	process.env = envBackup;
});

test('Resolves configured CONFIG_PATH from env', () => {
	// 1. The variable wins over the default, and the path it names is resolved as given
	process.env['CONFIG_PATH'] = 'test-config-path';
	const res = getConfigPath();
	expect(resolve).toHaveBeenCalledWith('test-config-path');
	expect(res).toBe('test-resolved-path');
});

test('Resolves configured CONFIG_PATH from defaults if it does not exist in env', () => {
	// 1. An unset variable falls back to the package default, so the lookup works with no configuration at all
	process.env['CONFIG_PATH'] = undefined;
	const res = getConfigPath();
	expect(resolve).toHaveBeenCalledWith(DEFAULTS['CONFIG_PATH']);
	expect(res).toBe('test-resolved-path');
});
