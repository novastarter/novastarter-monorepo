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

test('Keeps an undefined answer of the builder like any other', () => {
	// 1. A builder may well answer with `undefined`; that answer is the instance, not a sign that there is none yet
	const build = vi.fn((): string | undefined => undefined);
	const use = singleton(build);

	expect(use()).toBeUndefined();
	expect(use()).toBeUndefined();
	expect(build).toHaveBeenCalledOnce();

	// 2. `replace(undefined)` is a replacement, not a reset: the builder still does not run
	use.replace(undefined);
	expect(use()).toBeUndefined();
	expect(build).toHaveBeenCalledOnce();
});

test('Keeps one instance per accessor', () => {
	// 1. Two accessors hold two instances, and resetting one leaves the other in place
	const a = singleton(() => ({}));
	const b = singleton(() => ({}));

	expect(a()).not.toBe(b());
	a.reset();
	expect(b()).toBe(b());
});

test('Hands the arguments of the first call to the builder and refuses arguments afterwards', () => {
	// 1. The first call decides what is built; a later call without arguments answers with the same instance
	const build = vi.fn((options?: { name: string }) => ({ name: options?.name ?? 'none' }));
	const use = singleton(build);

	const first = use({ name: 'first' });

	expect(first).toEqual({ name: 'first' });
	expect(use()).toBe(first);
	expect(build).toHaveBeenCalledOnce();
	expect(build).toHaveBeenCalledWith({ name: 'first' });

	// 2. A later call with arguments is refused rather than answered with an instance those arguments had no say in
	expect(() => use({ name: 'second' })).toThrow('singleton: the instance exists already');
	expect(build).toHaveBeenCalledOnce();

	// 3. A replaced instance counts as existing too; after a reset the arguments are taken again
	use.replace({ name: 'replaced' });
	expect(() => use({ name: 'third' })).toThrow();

	use.reset();
	expect(use({ name: 'fourth' })).toEqual({ name: 'fourth' });
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
