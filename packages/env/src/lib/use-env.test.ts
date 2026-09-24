/**
 * Tests of `env/lib/use-env`.
 *
 * `./create-env.js` is mocked, so these exercise the memoization alone.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createEnv } from './create-env.js';
import { useEnv } from './use-env.js';

vi.mock('./create-env.js');

afterEach(() => {
	vi.resetAllMocks();

	useEnv.reset();
});

describe('useEnv', () => {
	test('Returns the cached env if it exists', () => {
		// The first call builds; the second answers with the same object without building again
		const mockEnv = {};
		vi.mocked(createEnv).mockReturnValue(mockEnv);

		const first = useEnv();

		expect(useEnv()).toBe(first);
		expect(createEnv).toHaveBeenCalledOnce();
	});

	test('Creates the env on first use, passing the options along', () => {
		// The options of the first call reach the builder; a later call without options gets the same object
		const mockEnv = {};
		vi.mocked(createEnv).mockReturnValue(mockEnv);

		const env = useEnv({ fileVariables: ['DB_PASSWORD'] });

		expect(env).toBe(mockEnv);
		expect(createEnv).toHaveBeenCalledWith({ fileVariables: ['DB_PASSWORD'] });
		expect(useEnv()).toBe(mockEnv);
		expect(createEnv).toHaveBeenCalledOnce();
	});
});
