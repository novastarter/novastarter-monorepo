/**
 * Tests of `logger/utils/resolve-log-style`.
 */
import { describe, expect, test } from 'vitest';
import { resolveLogStyle } from './resolve-log-style.js';

describe('resolveLogStyle', () => {
	test('takes LOG_STYLE when it names a style', () => {
		// 1. A valid `LOG_STYLE` wins over the environment, surrounding whitespace included
		expect(resolveLogStyle({ LOG_STYLE: 'raw' })).toBe('raw');
		expect(resolveLogStyle({ LOG_STYLE: ' Pretty ', NODE_ENV: 'production' })).toBe('pretty');
	});

	test('writes JSON lines in production and pretty lines elsewhere when nothing is set', () => {
		// 1. Production writes JSON lines for log aggregators; anywhere else a human reads the output
		expect(resolveLogStyle({ NODE_ENV: 'production' })).toBe('raw');
		expect(resolveLogStyle({ NODE_ENV: 'development' })).toBe('pretty');
		expect(resolveLogStyle({})).toBe('pretty');

		// 2. A `LOG_STYLE` that names nothing falls back to the same environment rule
		expect(resolveLogStyle({ LOG_STYLE: 'fancy', NODE_ENV: 'production' })).toBe('raw');
	});
});
