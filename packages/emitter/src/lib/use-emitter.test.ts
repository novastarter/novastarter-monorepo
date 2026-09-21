/**
 * Tests of `emitter/lib/use-emitter`: one emitter per process, resettable.
 *
 * `./emitter.js` is mocked, so these exercise the accessor alone.
 */
import { afterEach, expect, test, vi } from 'vitest';
import { Emitter } from './emitter.js';
import { useEmitter } from './use-emitter.js';

vi.mock('./emitter.js');

afterEach(() => {
	vi.resetAllMocks();
	useEmitter.reset();
});

test('Builds the emitter on first use and hands the same one out afterwards', () => {
	const emitter = useEmitter();

	expect(Emitter).toHaveBeenCalledOnce();
	expect(useEmitter()).toBe(emitter);
	expect(Emitter).toHaveBeenCalledOnce();
});

test('Builds a fresh emitter after reset()', () => {
	const first = useEmitter();
	useEmitter.reset();

	expect(useEmitter()).not.toBe(first);
	expect(Emitter).toHaveBeenCalledTimes(2);
});
