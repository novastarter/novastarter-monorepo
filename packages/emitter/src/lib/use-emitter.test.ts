/**
 * Tests of `emitter/lib/use-emitter`.
 *
 * `./emitter.js` is mocked, so these exercise the memoization alone.
 */
import { afterEach, expect, test, vi } from 'vitest';
import { Emitter } from './emitter.js';
import { _cache, useEmitter } from './use-emitter.js';

vi.mock('./emitter.js');

afterEach(() => {
	vi.resetAllMocks();

	_cache.emitter = undefined;
});

test('Returns cached emitter if exists', () => {
	_cache.emitter = {} as Emitter;

	expect(useEmitter()).toBe(_cache.emitter);
	expect(Emitter).not.toHaveBeenCalled();
});

test('Creates new cached emitter if not exists', () => {
	const emitter = useEmitter();

	expect(Emitter).toHaveBeenCalledOnce();
	expect(_cache.emitter).toBe(emitter);
	expect(useEmitter()).toBe(emitter);
});
