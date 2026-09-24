/**
 * Public entry point of `@novastarter/database-driver-neon`: the {@link DatabaseDriverNeon} class over a WebSocket pool and the {@link DatabaseDriverNeonHttp} class over one fetch per query, and their options.
 */
export { DatabaseDriverNeon, type DatabaseDriverNeonConfig } from './lib/driver.js';
export {
	DatabaseDriverNeonHttp,
	type DatabaseDriverNeonHttpConfig,
	type DatabaseDriverNeonHttpOptions,
	type NeonHttpClient,
} from './lib/driver-http.js';
