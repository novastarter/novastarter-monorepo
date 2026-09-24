/**
 * Tests of `push/lib/push-manager` on managers built by hand; the process-wide one is `use-push.test.ts`'s.
 *
 * `@novastarter/logger` is mocked, since the console driver resolves the application logger when it is built.
 */
import { useLogger } from '@novastarter/logger';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PushDriver } from '../driver.js';
import type { PushPlatform, PushResult } from '../types.js';
import { PushDriverConsole } from './drivers/console.js';
import { PushManager } from './push-manager.js';

vi.mock('@novastarter/logger');

// The test drivers join the driver map the way a driver package does, so their registrations type-check
declare module './push-manager.js' {
	interface PushDrivers {
		'test-driver': Record<string, unknown>;
		closable: Record<string, never>;
	}
}

/**
 * Every `close()` call of the closable driver.
 */
const closed = vi.fn();

/**
 * A driver that holds connections, the way the FCM and APNs ones do.
 */
class ClosableDriver implements PushDriver {
	/** FCM only, so a webpush location cannot be routed to it. */
	readonly platforms: readonly PushPlatform[] = ['fcm'];

	/**
	 * Accept every message.
	 *
	 * @returns A fixed status.
	 */
	async send(): Promise<PushResult> {
		// 1. Nothing is recorded: the tests here are about the registry, not about what was sent
		return { status: 'accepted' };
	}

	/**
	 * Record the shutdown.
	 */
	async close(): Promise<void> {
		// 1. Counted through a module-level spy, since the manager drops the instance right after closing it
		closed();
	}
}

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue({ info: vi.fn() } as unknown as ReturnType<typeof useLogger>);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('PushManager', () => {
	test('Registers the built-in driver on construction and builds a location on first use', () => {
		const manager = new PushManager();

		// 1. The console driver is known without any registration by the application
		expect([...manager['drivers'].keys()]).toStrictEqual(['console']);

		// 2. Registering a location keeps the configuration only; the first `location()` builds the driver
		manager.registerLocation('default', {
			driver: 'console',
			options: {},
		});

		expect(manager.instantiated().size).toBe(0);
		expect(manager.location('default')).toBeInstanceOf(PushDriverConsole);
		expect(manager.location('default')).toBe(manager.location('default'));
	});

	test('Passes the location options to a registered driver class', () => {
		const manager = new PushManager();
		const mockDriver = vi.fn();

		// 1. A bare mock stands in for a vendor driver class, recording how the manager calls `new Driver(...)`
		manager.registerDriver('test-driver', mockDriver);

		manager.registerLocation('fcm', {
			driver: 'test-driver',
			options: {
				projectId: 'p',
			},
		});

		manager.location('fcm');

		expect(mockDriver).toHaveBeenCalledExactlyOnceWith({ projectId: 'p' });
	});

	test('Holds the routes the application registers, replacing them on a second call', () => {
		const manager = new PushManager();

		// 1. Nothing registered yet: an empty object, so callers can read `routes().webpush` without a guard
		expect(manager.routes()).toStrictEqual({});

		// 2. The last registration wins whole, the way `registerLocation` replaces a location
		manager.registerRoutes({ webpush: 'web', fcm: 'android' });
		manager.registerRoutes({ fcm: 'android' });

		expect(manager.routes()).toStrictEqual({ fcm: 'android' });
	});

	test('Closes the drivers built so far that have a close(), and leaves the rest alone', async () => {
		const manager = new PushManager();

		// 1. One driver holds connections, the console one does not; a third location is never built
		manager.registerDriver('closable', ClosableDriver);

		manager.registerLocation('fcm', {
			driver: 'closable',
			options: {},
		});

		manager.registerLocation('log', {
			driver: 'console',
			options: {},
		});

		manager.registerLocation('unused', {
			driver: 'closable',
			options: {},
		});

		manager.location('fcm');
		manager.location('log');

		await manager.close();

		// 2. The registrations stay, the instances go: a location asked for after closing is built afresh
		expect(closed).toHaveBeenCalledOnce();
		expect(manager.locationNames()).toEqual(['fcm', 'log', 'unused']);
		expect(manager.instantiated().size).toBe(0);
	});
});
