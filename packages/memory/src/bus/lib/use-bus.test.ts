/**
 * Tests of `memory/bus/lib/use-bus`: one manager per process, resettable, with the built-in drivers registered.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { BusManager } from './bus-manager.js';
import { BusDriverLocal } from './drivers/local.js';
import { useBus } from './use-bus.js';

afterEach(() => {
	useBus.reset();
});

describe('useBus', () => {
	test('Creates a manager on first use and hands the same one out afterwards', () => {
		// Every later call returns the cached instance, so registrations made at start-up are visible everywhere
		const manager = useBus();

		expect(manager).toBeInstanceOf(BusManager);
		expect(useBus()).toBe(manager);

		// `reset()` drops it, so the next test starts from a manager with only the built-in drivers
		useBus.reset();
		expect(useBus()).not.toBe(manager);
	});

	test('The built-in drivers are registered, so a location needs its options alone', () => {
		// `local` comes with the manager; the location is built on first use
		useBus().registerLocation('default', {
			driver: 'local',
			options: {},
		});

		expect(useBus().location('default')).toBeInstanceOf(BusDriverLocal);
	});
});
