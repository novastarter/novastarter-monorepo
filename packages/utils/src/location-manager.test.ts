/**
 * Tests of `utils/location-manager`: registration, lazy build, reuse and `close()` on a minimal subclass.
 */
import { describe, expect, test, vi } from 'vitest';
import { DEFAULT_LOCATION, LocationManager } from './location-manager.js';

/**
 * What the test manager builds: a handle that records whether it was released.
 */
interface Handle {
	config: string;
	extra: number;
	released: boolean;
}

/**
 * Subclass with a two-argument registration, to check the tuple of arguments reaches `build()` intact.
 */
class TestManager extends LocationManager<Handle, [config: string, extra?: number]> {
	/**
	 * Every build so far, for the assertions.
	 */
	readonly builds = vi.fn();

	/**
	 * Make a handle from the registration, recording the call.
	 *
	 * @param config - First registration argument.
	 * @param extra - Second, optional one.
	 * @returns A fresh handle.
	 */
	protected build(config: string, extra: number = 0): Handle {
		this.builds(config, extra);

		return { config, extra, released: false };
	}

	/**
	 * Mark the handle released.
	 *
	 * @param handle - A handle made by {@link TestManager.build}.
	 */
	protected async release(handle: Handle): Promise<void> {
		// 1. A handle whose config says so refuses to close, for the tests of a failing shutdown
		if (handle.config.endsWith('/refuses')) {
			throw new Error(`${handle.config} refuses to close`);
		}

		handle.released = true;
	}
}

/**
 * Subclass whose instances are falsy, to check presence is not decided by truthiness.
 */
class ZeroManager extends LocationManager<number, [start: number]> {
	/**
	 * Every build so far, for the assertions.
	 */
	readonly builds = vi.fn();

	/**
	 * Answer with the registered number, `0` included, recording the call.
	 *
	 * @param start - The registered number.
	 * @returns That number.
	 */
	protected build(start: number): number {
		this.builds(start);

		return start;
	}

	/**
	 * Nothing to release for a number.
	 */
	protected async release(): Promise<void> {}
}

describe('#registerLocation', () => {
	test('Keeps the arguments without building', () => {
		// 1. Registration alone builds nothing: the registry knows the name, the instance map stays empty
		const manager = new TestManager();

		manager.registerLocation('main', 'redis://main', 2);

		expect(manager.builds).not.toHaveBeenCalled();
		expect(manager.hasLocation('main')).toBe(true);
		expect(manager.hasLocation('other')).toBe(false);
		expect(manager.locationNames()).toEqual(['main']);
		expect(manager.instantiated().size).toBe(0);
	});

	test('Drops the instance of a location registered again', () => {
		// 1. Re-registering replaces the configuration, so the next use builds from the new arguments
		const manager = new TestManager();

		manager.registerLocation('main', 'redis://a');
		const first = manager.location('main');

		manager.registerLocation('main', 'redis://b');

		expect(manager.location('main')).not.toBe(first);
		expect(manager.builds).toHaveBeenLastCalledWith('redis://b', 0);
	});
});

describe('#location', () => {
	test('Throws error when the location does not exist', () => {
		// 1. A missing name is a configuration bug and is reported as such rather than answered with `undefined`
		const manager = new TestManager();

		expect(() => manager.location('main')).toThrowErrorMatchingInlineSnapshot(
			`[Error: Location "main" doesn't exist.]`,
		);
	});

	test('Answers with the default location when given no name', () => {
		// 1. `DEFAULT_LOCATION` is what a deployment with one location registers; without a name that is the one asked for
		const manager = new TestManager();

		expect(() => manager.location()).toThrowErrorMatchingInlineSnapshot(`[Error: Location "default" doesn't exist.]`);

		manager.registerLocation(DEFAULT_LOCATION, 'redis://default');

		expect(manager.location()).toBe(manager.location('default'));
		expect(manager.builds).toHaveBeenCalledOnce();
	});

	test('Builds from the registered arguments on first use, then reuses the instance', () => {
		// 1. The whole tuple reaches `build()`, once; every later call answers with the same instance
		const manager = new TestManager();

		manager.registerLocation('main', 'redis://main', 2);

		const first = manager.location('main');

		expect(manager.builds).toHaveBeenCalledOnce();
		expect(manager.builds).toHaveBeenCalledWith('redis://main', 2);
		expect(first).toEqual({ config: 'redis://main', extra: 2, released: false });
		expect(manager.location('main')).toBe(first);
		expect(manager.builds).toHaveBeenCalledOnce();
		expect([...manager.instantiated().keys()]).toEqual(['main']);
	});

	test('Keeps a falsy instance rather than rebuilding it on every call', () => {
		// 1. `0` is an instance like any other: built once, answered with on every later call
		const manager = new ZeroManager();

		manager.registerLocation('counter', 0);

		expect(manager.location('counter')).toBe(0);
		expect(manager.location('counter')).toBe(0);
		expect(manager.builds).toHaveBeenCalledOnce();
	});
});

describe('#close', () => {
	test('Releases every built instance and drops it, leaving the registrations in place', async () => {
		const manager = new TestManager();

		manager.registerLocation('a', 'redis://a');
		manager.registerLocation('b', 'redis://b');
		manager.registerLocation('never-used', 'redis://c');

		const a = manager.location('a');
		const b = manager.location('b');

		await manager.close();

		// 1. Both built instances were released; the one never asked for was never built, so nothing to release
		expect(a.released).toBe(true);
		expect(b.released).toBe(true);
		expect(manager.builds).toHaveBeenCalledTimes(2);

		// 2. The registrations survive, the instances do not: the next use builds afresh
		expect(manager.locationNames()).toEqual(['a', 'b', 'never-used']);
		expect(manager.instantiated().size).toBe(0);
		expect(manager.location('a')).not.toBe(a);
	});

	test('Releases every other instance and drops them all when one refuses to close, then throws that error', async () => {
		const manager = new TestManager();

		manager.registerLocation('ok', 'redis://ok');
		manager.registerLocation('bad', 'redis://bad/refuses');

		const ok = manager.location('ok');
		manager.location('bad');

		// 1. The one failure is thrown as it came, once every release settled
		await expect(manager.close()).rejects.toThrow('redis://bad/refuses refuses to close');

		// 2. The other instance was released all the same, and nothing is left for a second `close()` to touch
		expect(ok.released).toBe(true);
		expect(manager.instantiated().size).toBe(0);
		await expect(manager.close()).resolves.toBeUndefined();
	});

	test('Throws an AggregateError when several instances refuse to close', async () => {
		const manager = new TestManager();

		manager.registerLocation('a', 'redis://a/refuses');
		manager.registerLocation('b', 'redis://b/refuses');
		manager.location('a');
		manager.location('b');

		// 1. Two failures are reported together, naming how many of the built instances failed
		const error: unknown = await manager.close().catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(AggregateError);
		expect((error as AggregateError).errors).toHaveLength(2);
		expect((error as AggregateError).message).toBe('2 of 2 locations failed to close');
	});
});
