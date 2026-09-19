import type { BusConfig } from '../types/config.js';
import { BusLocal } from './local.js';
import { BusRedis } from './redis.js';

/**
 * Create the bus implementation matching the configuration's `type`.
 *
 * The overloads narrow the return type by the configuration passed, so a caller with a literal config gets the
 * concrete class back.
 *
 * @param config - Local or Redis configuration.
 * @returns A ready-to-use bus.
 * @throws `Error` when `type` is not a known backend.
 * @example
 * ```ts
 * const bus = createBus({ type: 'redis', redis: new Redis(), namespace: 'app' });
 *
 * await bus.subscribe('greetings', (payload) => console.log(payload));
 * await bus.publish('greetings', 'hello');
 * ```
 */
export function createBus(config: Extract<BusConfig, { type: 'local' }>): BusLocal;
export function createBus(config: Extract<BusConfig, { type: 'redis' }>): BusRedis;
export function createBus(config: BusConfig): BusLocal | BusRedis {
	// 1. Pick the backend by the discriminant
	if (config.type === 'local') {
		return new BusLocal(config);
	}

	if (config.type === 'redis') {
		return new BusRedis(config);
	}

	// 2. Reject unknown types loudly instead of silently falling back to memory
	throw new Error(`Invalid Bus configuration: Type does not exist.`);
}
