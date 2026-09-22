/**
 * Tests of `emitter/lib/use-emitter`: one emitter per process, resettable.
 *
 * `./emitter.js` is mocked, so these exercise the accessor alone.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Emitter } from './emitter.js';
import { useEmitter } from './use-emitter.js';

vi.mock('./emitter.js');

afterEach(() => {
	// 1. The singleton is rebuilt by the next test, so nothing may carry over
	vi.resetAllMocks();
	useEmitter.reset();
});

describe('useEmitter', () => {
	test('Builds the emitter on first use and hands the same one out afterwards', () => {
		// 1. Built once, handed out forever: the emitter keeps its listeners between calls
		const emitter = useEmitter();

		expect(Emitter).toHaveBeenCalledOnce();
		expect(useEmitter()).toBe(emitter);
		expect(Emitter).toHaveBeenCalledOnce();
	});

	test('Builds a fresh emitter after reset()', () => {
		// 1. After a reset the next call builds a fresh emitter — new listeners, no residue of the old
		const first = useEmitter();
		useEmitter.reset();

		expect(useEmitter()).not.toBe(first);
		expect(Emitter).toHaveBeenCalledTimes(2);
	});
});
