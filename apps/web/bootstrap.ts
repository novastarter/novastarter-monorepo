import { createLogger, registerLogger, useLogger } from '@novastarter/logger';
import { useMail } from '@novastarter/mail';
import { useBus, useCache, useKv, useLimiter } from '@novastarter/memory';
import { registerJobHandlers, useQueue } from '@novastarter/queue';
import { useRedis } from '@novastarter/redis';
import { useStorage } from '@novastarter/storage';
import { StorageDriverLocal } from '@novastarter/storage-driver-local';
import { loggerConfig } from './config/logger';
import { mailConfig } from './config/mail';
import { memoryConfig } from './config/memory';
import { queueConfig } from './config/queue';
import { redisConfig } from './config/redis';
import { storageConfig } from './config/storage';
import { type AppEnv, readEnv } from './env';
import { createMailSendHandler } from './jobs/mail-send';
import { createSystemPingHandler } from './jobs/system-ping';

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
 * the location configs under `config/`, and registered on the managers — logger, Redis, memory, queue, storage, mail —
 * then the handlers of the app's jobs under `jobs/`. Each package reads nothing itself; a location opens its
 * connections on first use. Registering is idempotent across calls, so a second `bootstrap()` (Next.js reloading the
 * server module in development, a test suite) is a no-op.
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

	// 3. Redis: the `default` server, when the app has one; the other subsystems ask the manager for the client they share
	const connection = redisConfig(env);

	if (connection) {
		useRedis().registerLocation('default', connection);
	}

	const redis = connection ? useRedis().location('default') : undefined;

	// 4. Memory: one key-value, cache, bus and limiter location, on the shared client or in-process
	const memory = memoryConfig(redis);

	useKv().registerLocation('default', memory.kv);
	useCache().registerLocation('default', memory.cache);
	useBus().registerLocation('default', memory.bus);
	useLimiter().registerLocation('api', memory.limiter);

	// 5. Queues: the `default` location takes every queue
	useQueue().registerLocation('default', queueConfig(env));

	// 6. Storage: the driver classes the app ships with, then the `default` location
	useStorage().registerDriver('local', StorageDriverLocal);
	useStorage().registerLocation('default', storageConfig(env));

	// 7. Mail: the built-in drivers come with the manager; the `default` location and the routes are the app's
	const mail = mailConfig(env);

	useMail().registerLocation('default', mail.location);
	useMail().registerRoutes(mail.routes);

	// 8. Jobs: the handlers of the contracts under `jobs/`, so a worker or the local queue can run them
	registerJobHandlers({
		'mail.send': createMailSendHandler(),
		'system.ping': createSystemPingHandler(),
	});

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
	// 1. Queues first, since their drivers may hold clients of their own; the shared Redis clients last
	await useQueue().close();
	await useRedis().close();
};
