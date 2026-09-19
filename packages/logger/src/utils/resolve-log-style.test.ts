import { describe, expect, test } from 'vitest';
import { resolveLogStyle } from './resolve-log-style.js';

describe('resolveLogStyle', () => {
	test('takes LOG_STYLE when it names a style', () => {
		expect(resolveLogStyle({ LOG_STYLE: 'raw' })).toBe('raw');
		expect(resolveLogStyle({ LOG_STYLE: ' Pretty ', NODE_ENV: 'production' })).toBe('pretty');
	});

	test('writes JSON lines in production and pretty lines elsewhere when nothing is set', () => {
		expect(resolveLogStyle({ NODE_ENV: 'production' })).toBe('raw');
		expect(resolveLogStyle({ NODE_ENV: 'development' })).toBe('pretty');
		expect(resolveLogStyle({})).toBe('pretty');
		expect(resolveLogStyle({ LOG_STYLE: 'fancy', NODE_ENV: 'production' })).toBe('raw');
	});
});
