/**
 * Tests of `env/constants/defaults`.
 */
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { expect, expectTypeOf, test } from 'vitest';
import type { Env } from '../types/env.js';
import { DEFAULTS } from './defaults.js';

test('Points CONFIG_PATH at .env in the working directory', () => {
	// 1. The fallback is the conventional dotenv location, resolved so a change of working directory cannot break
	//    the lookup later
	expect(DEFAULTS['CONFIG_PATH']).toBe(resolve(cwd(), '.env'));
});

test('Is typed as the parsed configuration', () => {
	// 1. Defaults are values of the same map the environment is parsed into, so the two types must line up exactly
	expectTypeOf(DEFAULTS).toEqualTypeOf<Env>();
});
