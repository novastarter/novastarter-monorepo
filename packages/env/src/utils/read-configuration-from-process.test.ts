/**
 * Tests of `env/utils/read-configuration-from-process`.
 */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { readConfigurationFromProcess } from './read-configuration-from-process.js';

/** Copy of the real environment, restored after each test so the mutation cannot leak outside the file. */
const envBackup = { ...process.env };

beforeEach(() => {
	// An empty environment, so a variable from the developer's shell cannot leak into the assertions
	process.env = {};
});

afterEach(() => {
	// The real environment comes back, so the rest of the suite runs against it
	process.env = envBackup;
});

test('Returns shallow copy of process.env', () => {
	// A copy, so the configuration can be merged without the merge writing into the live environment
	const env = { TEST: 'foo' };
	process.env = env;

	expect(readConfigurationFromProcess()).toEqual({ TEST: 'foo' });
	expect(readConfigurationFromProcess()).not.toBe(env);
});
