/**
 * Tests of `utils/singleton`: one instance per accessor, resettable.
 */
import { expect, test, vi } from 'vitest';
import { singleton } from './singleton.js';

test('Builds on the first call only and answers with the same instance afterwards', () => {
	// 1. Making the accessor builds nothing; the first call does, and every later call reuses that result
	const build = vi.fn(() => ({ id: Math.random() }));
	const use = singleton(build);

	expect(build).not.toHaveBeenCalled();

	const first = use();

	expect(build).toHaveBeenCalledOnce();
	expect(use()).toBe(first);
	expect(build).toHaveBeenCalledOnce();
});

test('Builds a fresh instance after reset()', () => {
	// 1. `reset()` forgets the instance, so the builder runs again on the next call
	const build = vi.fn(() => ({ id: Math.random() }));
	const use = singleton(build);

	const first = use();
	use.reset();

	expect(use()).not.toBe(first);
	expect(build).toHaveBeenCalledTimes(2);
});

test('Keeps one instance per accessor', () => {
	// 1. Two accessors hold two instances, and resetting one leaves the other in place
	const a = singleton(() => ({}));
	const b = singleton(() => ({}));

	expect(a()).not.toBe(b());
	a.reset();
	expect(b()).toBe(b());
});
