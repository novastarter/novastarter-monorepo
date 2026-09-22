/**
 * Public entry point of `@novastarter/database-driver-neon`: the {@link DatabaseDriverNeon} class over a WebSocket
 * pool and the {@link DatabaseDriverNeonHttp} class over one fetch per query, their options, and the default export —
 * the pool one — for consumers that import the driver without a named binding.
 */
import { DatabaseDriverNeon } from './lib/driver.js';

export { DatabaseDriverNeon, type DatabaseDriverNeonConfig } from './lib/driver.js';
export {
	DatabaseDriverNeonHttp,
	type DatabaseDriverNeonHttpConfig,
	type DatabaseDriverNeonHttpOptions,
	type NeonHttpClient,
} from './lib/driver-http.js';
export { isPool } from './lib/is-pool.js';
export default DatabaseDriverNeon;
