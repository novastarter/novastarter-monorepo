/**
 * Tests of `utils/location-manager`: registration, lazy build, reuse and `close()` on a minimal subclass.
 */
import { describe, expect, test, vi } from 'vitest';
import { LocationManager } from './location-manager.js';

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
		handle.released = true;
	}
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
});
