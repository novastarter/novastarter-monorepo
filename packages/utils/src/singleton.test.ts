/**
 * Tests of `utils/singleton`: one instance per accessor, built from the first call's arguments, replaceable and
 * resettable.
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

test('Hands the arguments of the first call to the builder and ignores those of later calls', () => {
	// 1. The first call decides what is built; a later call with other arguments answers with the same instance
	const build = vi.fn((options?: { name: string }) => ({ name: options?.name ?? 'none' }));
	const use = singleton(build);

	const first = use({ name: 'first' });

	expect(first).toEqual({ name: 'first' });
	expect(use({ name: 'second' })).toBe(first);
	expect(use()).toBe(first);
	expect(build).toHaveBeenCalledOnce();
	expect(build).toHaveBeenCalledWith({ name: 'first' });
});

test('Answers with the replaced instance without ever running the builder', () => {
	// 1. `replace()` before any call: the builder never runs, the given instance is what every call answers with
	const build = vi.fn(() => ({ id: 'built' }));
	const use = singleton(build);
	const own = { id: 'own' };

	use.replace(own);

	expect(use()).toBe(own);
	expect(build).not.toHaveBeenCalled();

	// 2. `replace()` after a build drops the built instance for the given one; `reset()` then builds afresh
	use.reset();
	const built = use();
	use.replace(own);

	expect(use()).toBe(own);
	expect(use()).not.toBe(built);

	use.reset();

	expect(use()).not.toBe(own);
	expect(build).toHaveBeenCalledTimes(2);
});
