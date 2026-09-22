/**
 * Tests of `memory/bus/driver`: the contract every bus backend implements, type-only.
 */
import { expect, test } from 'vitest';
import type { BusDriver } from './driver.js';
import * as driver from './driver.js';

test('ships no runtime code', () => {
	// 1. The interface describes the backends; nothing here may end up in a consumer's bundle
	expect(Object.keys(driver)).toEqual([]);
});

test('a backend satisfies the contract with three methods', () => {
	// 1. The interface is the whole surface a backend needs to implement; `close` is the only optional member
	const backend: BusDriver = {
		publish: async () => {},
		subscribe: async (_channel, _callback) => {},
		unsubscribe: async (_channel, _callback) => {},
	};

	expect(backend.publish).toBeTypeOf('function');
});
