import { createLogger, registerLogger, useLogger } from '@novastarter/logger';
import { useBus, useCache, useKv, useLimiter } from '@novastarter/memory';
import { useQueue } from '@novastarter/queue';
import { useRedis } from '@novastarter/redis';
import { useStorage } from '@novastarter/storage';
import { DriverLocal } from '@novastarter/storage-driver-local';
import { loggerConfig } from './config/logger';
import { memoryConfig } from './config/memory';
import { queueConfig } from './config/queue';
import { redisConfig } from './config/redis';
import { storageConfig } from './config/storage';
import { type AppEnv, readEnv } from './env';

/**
 * Whether {@link bootstrap} ran already in this process.
 *
 * Wrapped in an object rather than exported as a bare binding, so tests can reset it in place.
 *
 * @internal
 */
export const _state: { booted: boolean } = { booted: false };

/**
 * Wire every subsystem of the kit from the app's configuration, once per process.
 *
 * The one place the environment meets the packages: the variables are parsed against the app's schema, turned into
 * the location configs under `config/`, and registered on the managers — logger, Redis, memory, queue, storage. Each
 * package reads nothing itself; a location opens its connections on first use. Registering is idempotent across
 * calls, so a second `bootstrap()` (Next.js reloading the server module in development, a test suite) is a no-op.
 *
 * @returns The parsed variables, for the caller that wants them.
 */
export const bootstrap = (): AppEnv => {
	const env = readEnv();

	// 1. One boot per process: the managers are process-wide, registering twice would only rebuild their locations
	if (_state.booted) {
		return env;
	}

	// 2. The logger first, so everything registered next logs through the app's configuration
	registerLogger(createLogger(loggerConfig(env)));

	// 3. Redis servers by name; the other subsystems ask the manager for the client they share
	for (const [name, connection] of Object.entries(redisConfig(env))) {
		useRedis().registerLocation(name, connection);
	}

	const redis = useRedis().hasLocation('default') ? useRedis().location('default') : undefined;

	// 4. Memory: key-value, cache, bus and limiter locations, on the shared client or in-process
	const memory = memoryConfig(redis);

	for (const [name, location] of Object.entries(memory.kv)) useKv().registerLocation(name, location);
	for (const [name, location] of Object.entries(memory.cache)) useCache().registerLocation(name, location);
	for (const [name, location] of Object.entries(memory.bus)) useBus().registerLocation(name, location);
	for (const [name, location] of Object.entries(memory.limiter)) useLimiter().registerLocation(name, location);

	// 5. Queues: which queue runs where
	for (const [name, location] of Object.entries(queueConfig(env))) {
		useQueue().registerLocation(name, location);
	}

	// 6. Storage: the driver classes the app ships with, then the locations
	useStorage().registerDriver('local', DriverLocal);

	for (const [name, location] of Object.entries(storageConfig(env))) {
		useStorage().registerLocation(name, location);
	}

	_state.booted = true;
	useLogger().debug({ redis: Boolean(redis) }, 'Application bootstrapped');

	return env;
};

/**
 * Release what the subsystems hold — queues, Redis clients — for a clean shutdown.
 *
 * @returns Once every connection has closed.
 */
export const shutdown = async (): Promise<void> => {
	// 1. Queues first, since their providers may hold clients of their own; the shared Redis clients last
	await useQueue().close();
	await useRedis().close();
};
