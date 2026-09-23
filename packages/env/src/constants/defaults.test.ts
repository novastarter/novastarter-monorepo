/**
 * Tests of `env/constants/defaults`.
 */
import { expect, expectTypeOf, test } from 'vitest';
import type { Env } from '../types/env.js';
import { DEFAULTS } from './defaults.js';

test('Keeps CONFIG_PATH relative, so the working directory at lookup time decides', () => {
	// 1. The default is the conventional dotenv name, resolved lazily by getConfigPath; resolving it here at import
	//    time would freeze the directory of the first import and ignore a later chdir
	expect(DEFAULTS['CONFIG_PATH']).toBe('.env');
});

test('Is typed as the parsed configuration', () => {
	// 1. Defaults are values of the same map the environment is parsed into, so the two types must line up exactly
	expectTypeOf(DEFAULTS).toEqualTypeOf<Env>();
});
