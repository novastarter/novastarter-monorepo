import type { KvConfig } from '../types/config.js';
import { KvLocal } from './local.js';
import { KvRedis } from './redis.js';

/**
 * Create the Kv implementation matching the configuration's `type`.
 *
 * @param config - Local or Redis configuration.
 * @returns A ready-to-use store.
 * @throws `Error` when `type` is not a known backend.
 * @example
 * ```ts
 * const kv = createKv({ type: 'local', maxKeys: 500 });
 *
 * await kv.set('my-key', 'my-value');
 * ```
 */
export const createKv = (config: KvConfig): KvLocal | KvRedis => {
	// 1. Pick the backend by the discriminant
	if (config.type === 'local') {
		return new KvLocal(config);
	}

	if (config.type === 'redis') {
		return new KvRedis(config);
	}

	// 2. Reject unknown types loudly instead of silently falling back to memory
	throw new Error(`Invalid KV configuration: Type does not exist.`);
};
