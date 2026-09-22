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
		// 1. Record the arguments, so the tests can count builds and check the tuple arrived intact
		this.builds(config, extra);

		// 2. A fresh object per build: identity is what tells a rebuilt location from a reused one
		return { config, extra, released: false };
	}

	/**
	 * Mark the handle released.
	 *
	 * @param handle - A handle made by {@link TestManager.build}.
	 * @returns Once the handle is marked released.
	 */
	protected release(handle: Handle): Promise<void> {
		// 1. A handle whose config says so throws before returning a promise, for the test of a synchronous failure
		if (handle.config.endsWith('/throws')) {
			throw new Error(`${handle.config} throws on close`);
		}

		return this.releaseAsync(handle);
	}

	/**
	 * The asynchronous part of {@link TestManager.release}.
	 *
	 * @param handle - A handle made by {@link TestManager.build}.
	 * @returns Once the handle is marked released.
	 */
	private async releaseAsync(handle: Handle): Promise<void> {
		// 1. A handle whose config says so refuses to close at once, for the tests of a failing shutdown
		if (handle.config.endsWith('/refuses') && !handle.config.includes('/slow')) {
			throw new Error(`${handle.config} refuses to close`);
		}

		// 2. A handle whose config says so waits for the test to let it go, for the tests of a concurrent `location()`;
		//    one that says both waits, then refuses
		if (handle.config.includes('/slow')) {
			await this.slowRelease;
		}

		if (handle.config.endsWith('/refuses')) {
			throw new Error(`${handle.config} refuses to close`);
		}

		handle.released = true;
	}

	/**
	 * What a `/slow` handle's release waits for; the test resolves it.
	 */
	slowRelease: Promise<void> = Promise.resolve();
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
		// 1. Record the call, so the tests can tell a reused `0` from one built again
		this.builds(start);

		// 2. The number itself is the instance; `0` is the case under test
		return start;
	}

	/**
	 * Nothing to release for a number.
	 *
	 * @returns At once; there is nothing to wait for.
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
		// 1. Three registrations, two of them built: `close()` must touch the built ones and only those
		const manager = new TestManager();

		manager.registerLocation('a', 'redis://a');
		manager.registerLocation('b', 'redis://b');
		manager.registerLocation('never-used', 'redis://c');

		const a = manager.location('a');
		const b = manager.location('b');

		await manager.close();

		// 2. Both built instances were released; the one never asked for was never built, so nothing to release
		expect(a.released).toBe(true);
		expect(b.released).toBe(true);
		expect(manager.builds).toHaveBeenCalledTimes(2);

		// 3. The registrations survive, the instances do not: the next use builds afresh
		expect(manager.locationNames()).toEqual(['a', 'b', 'never-used']);
		expect(manager.instantiated().size).toBe(0);
		expect(manager.location('a')).not.toBe(a);
	});

	test('Releases every other instance and drops them all when one refuses to close, then throws that error', async () => {
		// 1. One instance that releases and one that refuses, both built, so the failure has a neighbour to spare
		const manager = new TestManager();

		manager.registerLocation('ok', 'redis://ok');
		manager.registerLocation('bad', 'redis://bad/refuses');

		const ok = manager.location('ok');
		manager.location('bad');

		// 2. The one failure is thrown as it came, once every release settled
		await expect(manager.close()).rejects.toThrow('redis://bad/refuses refuses to close');

		// 3. The other instance was released all the same, and nothing is left for a second `close()` to touch
		expect(ok.released).toBe(true);
		expect(manager.instantiated().size).toBe(0);
		await expect(manager.close()).resolves.toBeUndefined();
	});

	test('Builds afresh for a location asked for while its instance is being released, and keeps it for the next close()', async () => {
		// 1. The release of `slow` is held open by the test, so the window in which `location()` overlaps it is wide
		//    enough to be observed
		const manager = new TestManager();
		let letGo!: () => void;

		manager.slowRelease = new Promise<void>((resolve) => {
			letGo = resolve;
		});

		manager.registerLocation('slow', 'redis://a/slow');
		manager.registerLocation('late', 'redis://b');
		const slow = manager.location('slow');

		// 2. `close()` is releasing `slow` when both locations are asked for: neither caller gets the instance under
		//    release, and what they get is not dropped unreleased when the run ends
		const closing = manager.close();
		const slowAgain = manager.location('slow');
		const late = manager.location('late');

		expect(slowAgain).not.toBe(slow);

		letGo();
		await closing;

		expect(slow.released).toBe(true);
		expect(slowAgain.released).toBe(false);
		expect(late.released).toBe(false);
		expect([...manager.instantiated().keys()]).toEqual(['slow', 'late']);

		// 3. The next `close()` releases what the first one could not know about
		await manager.close();
		expect(slowAgain.released).toBe(true);
		expect(late.released).toBe(true);
		expect(manager.instantiated().size).toBe(0);
	});

	test('Waits for a close() already under way instead of releasing twice, then releases what was built meanwhile', async () => {
		// 1. A spy on `release()` counts the actual shutdowns, which the handles alone cannot tell from a double release
		const manager = new TestManager();
		const releases = vi.spyOn(manager as never, 'release' as never);
		let letGo!: () => void;

		manager.slowRelease = new Promise<void>((resolve) => {
			letGo = resolve;
		});

		manager.registerLocation('slow', 'redis://a/slow');
		manager.registerLocation('late', 'redis://b');
		const slow = manager.location('slow');

		// 2. Two overlapping calls: `slow` is released once, and `late`, built before the second call, is released
		//    by that second call rather than left for a third. The second call settles only once the first run is done
		const first = manager.close();
		const late = manager.location('late');
		const second = manager.close();
		const secondSettled = vi.fn();
		void second.then(secondSettled);

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(secondSettled).not.toHaveBeenCalled();
		expect(late.released).toBe(false);

		letGo();
		await Promise.all([first, second]);

		expect(releases).toHaveBeenCalledTimes(2);
		expect(slow.released).toBe(true);
		expect(late.released).toBe(true);
		expect(manager.instantiated().size).toBe(0);
	});

	test('Reports both failures when the joined run and its own run fail', async () => {
		// 1. The first run is held open, so the second call joins it instead of running on its own
		const manager = new TestManager();
		let letGo!: () => void;

		manager.slowRelease = new Promise<void>((resolve) => {
			letGo = resolve;
		});

		// 2. `slow` refuses after waiting, `late` refuses at once; the second call sees both failures
		manager.registerLocation('slow', 'redis://a/slow/refuses');
		manager.registerLocation('late', 'redis://b/refuses');
		manager.location('slow');

		const first = manager.close();
		manager.location('late');
		const second = manager.close();

		letGo();
		await expect(first).rejects.toThrow('redis://a/slow/refuses refuses to close');

		const error: unknown = await second.catch((thrown: unknown) => thrown);
		expect(error).toBeInstanceOf(AggregateError);

		expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual([
			'redis://a/slow/refuses refuses to close',
			'redis://b/refuses refuses to close',
		]);
	});

	test('Releases every other instance when one release() throws before returning a promise', async () => {
		// 1. A `/throws` handle fails inside `release()` itself, before any promise exists, unlike a `/refuses` one
		const manager = new TestManager();

		manager.registerLocation('ok', 'redis://ok');
		manager.registerLocation('bad', 'redis://bad/throws');
		const ok = manager.location('ok');
		manager.location('bad');

		// 2. The synchronous throw is a failure like a rejection: reported at the end, after `ok` was released
		await expect(manager.close()).rejects.toThrow('redis://bad/throws throws on close');
		expect(ok.released).toBe(true);
		expect(manager.instantiated().size).toBe(0);
	});

	test('Throws an AggregateError when several instances refuse to close', async () => {
		// 1. Both built instances refuse, so there is more than one error to report
		const manager = new TestManager();

		manager.registerLocation('a', 'redis://a/refuses');
		manager.registerLocation('b', 'redis://b/refuses');
		manager.location('a');
		manager.location('b');

		// 2. Two failures are reported together, naming how many of the built instances failed
		const error: unknown = await manager.close().catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(AggregateError);
		expect((error as AggregateError).errors).toHaveLength(2);
		expect((error as AggregateError).message).toBe('2 of 2 locations failed to close');
	});
});
