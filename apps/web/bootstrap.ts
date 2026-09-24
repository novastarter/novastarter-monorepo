import { useAi } from '@novastarter/ai';
import { useAuth } from '@novastarter/auth';
import { AuthDriverCredentials } from '@novastarter/auth-driver-credentials';
import { AuthDriverGithub } from '@novastarter/auth-driver-github';
import { AuthDriverGoogle } from '@novastarter/auth-driver-google';
import { useDatabase } from '@novastarter/database';
import { DatabaseDriverNeon, DatabaseDriverNeonHttp } from '@novastarter/database-driver-neon';
import { DatabaseDriverPglite } from '@novastarter/database-driver-pglite';
import { DatabaseDriverPostgres } from '@novastarter/database-driver-postgres';
import { DatabaseDriverSupabase } from '@novastarter/database-driver-supabase';
import { createLogger, registerLogger, useLogger } from '@novastarter/logger';
import { useMail } from '@novastarter/mail';
import { useBus, useCache, useKv, useLimiter } from '@novastarter/memory';
import { registerJobHandlers, useQueue } from '@novastarter/queue';
import { useRedis } from '@novastarter/redis';
import { useSms } from '@novastarter/sms';
import { useStorage } from '@novastarter/storage';
import { StorageDriverLocal } from '@novastarter/storage-driver-local';
import { aiConfig } from './config/ai';
import { authConfig } from './config/auth';
import { databaseConfig } from './config/database';
import { loggerConfig } from './config/logger';
import { mailConfig } from './config/mail';
import { memoryConfig } from './config/memory';
import { queueConfig } from './config/queue';
import { redisConfig } from './config/redis';
import { smsConfig } from './config/sms';
import { storageConfig } from './config/storage';
import { type AppEnv, readEnv } from './env';
import { createMailSendHandler } from './jobs/mail-send';
import { createSmsSendHandler } from './jobs/sms-send';
import { createSystemPingHandler } from './jobs/system-ping';

/**
 * Whether {@link bootstrap} ran already in this process, and whether the job handlers are registered.
 *
 * Two flags, since {@link shutdown} clears only the first: the handlers hold no connection, and the queue package
 * refuses a second registration of a job, so a boot after a shutdown leaves them as they are. Wrapped in an object
 * rather than exported as bare bindings, so tests can reset it in place.
 *
 * @internal
 */
export const _state: { booted: boolean; handlers: boolean } = { booted: false, handlers: false };

/**
 * Wire every subsystem of the kit from the app's configuration, once per process.
 *
 * The one place the environment meets the packages: the variables are parsed against the app's schema, turned into
 * the location configs under `config/`, and registered on the managers — logger, Redis, memory, queue, storage,
 * database, mail, SMS, auth, AI — then the handlers of the app's jobs under `jobs/`. Each package reads nothing itself; a
 * location opens its connections on first use, with the one exception of the `default` Redis location, whose client
 * the boot resolves eagerly to hand to the memory locations — so an unreachable `REDIS` fails the boot rather than
 * the first request. Registering is idempotent across calls, so a second `bootstrap()` (Next.js reloading the server
 * module in development, a test suite) is a no-op.
 *
 * @returns The parsed variables, for the caller that wants them.
 */
export const bootstrap = (): AppEnv => {
	const env = readEnv();

	// One boot per process: the managers are process-wide, registering twice would only rebuild their locations
	if (_state.booted) {
		return env;
	}

	// The logger first, so everything registered next logs through the app's configuration
	registerLogger(createLogger(loggerConfig(env)));

	// Redis: the `default` server, when the app has one; the other subsystems ask the manager for the client they share
	const connection = redisConfig(env);

	if (connection) {
		useRedis().registerLocation('default', connection);
	}

	const redis = connection ? useRedis().location('default') : undefined;

	const memory = memoryConfig(redis);

	useKv().registerLocation('default', memory.kv);
	useCache().registerLocation('default', memory.cache);
	useBus().registerLocation('default', memory.bus);
	useLimiter().registerLocation('api', memory.limiter);

	useQueue().registerLocation('default', queueConfig(env));

	useStorage().registerDriver('local', StorageDriverLocal);
	useStorage().registerLocation('default', storageConfig(env));

	// Registering opens nothing: the driver, and with PGlite the WASM boot, runs on the first `location()`.
	useDatabase().registerDriver('postgres', DatabaseDriverPostgres);
	useDatabase().registerDriver('supabase', DatabaseDriverSupabase);
	useDatabase().registerDriver('neon', DatabaseDriverNeon);
	useDatabase().registerDriver('neon-http', DatabaseDriverNeonHttp);
	useDatabase().registerDriver('pglite', DatabaseDriverPglite);

	const database = databaseConfig(env);

	useDatabase().registerLocation('default', database);

	// The built-in mail drivers come with the manager, so only the location and the routes are the app's.
	const mail = mailConfig(env);

	useMail().registerLocation('default', mail.location);
	useMail().registerRoutes(mail.routes);

	// The built-in SMS driver comes with the manager, so only the location and the routes are the app's.
	const sms = smsConfig(env);

	useSms().registerLocation('default', sms.location);
	useSms().registerRoutes(sms.routes);

	// The limiters go first, since the settings take their instances. The package stores nothing, so there is no store
	// to register: the app keeps the records in its own tables under `auth/`.
	const auth = authConfig(env, { redis });

	for (const [name, limiter] of Object.entries(auth.limiters)) {
		useLimiter().registerLocation(name, limiter);
	}

	useAuth().registerDriver('credentials', AuthDriverCredentials);
	useAuth().registerDriver('google', AuthDriverGoogle);
	useAuth().registerDriver('github', AuthDriverGithub);

	for (const [name, location] of Object.entries(auth.providers)) {
		useAuth().registerLocation(name, location);
	}

	useAuth().registerSettings({
		...auth.settings,
		limiters: {
			signIn: useLimiter().location('auth-sign-in'),
			mfa: useLimiter().location('auth-mfa'),
			code: useLimiter().location('auth-code'),
		},
	});

	// A provider opens nothing until a model of it is called.
	const ai = aiConfig(env);

	for (const [name, provider] of Object.entries(ai.providers)) {
		useAi().registerProvider(name, provider);
	}

	useAi().registerModels(ai.models);

	// Once per process, since a handler holds nothing a shutdown would release and the queue refuses a second
	// registration.
	if (!_state.handlers) {
		registerJobHandlers({
			'mail.send': createMailSendHandler(),
			'sms.send': createSmsSendHandler(),
			'system.ping': createSystemPingHandler(),
		});

		_state.handlers = true;
	}

	_state.booted = true;
	useLogger().debug({ redis: Boolean(redis), database: database.driver }, 'Application bootstrapped');

	return env;
};

/**
 * Release what the subsystems hold — queues, SDK clients, subscriptions, database pools, Redis clients — for a clean
 * shutdown.
 *
 * Every manager keeps its locations, and the process is marked as not booted: a later `bootstrap()` in the same
 * process (a test suite, a dev server reloading) registers everything again, so the memory locations get a fresh
 * Redis client instead of the one this call quit.
 *
 * @returns Once every connection has closed.
 * @throws What the one manager that refused to close threw, or an `AggregateError` of all of them — after every other
 * manager and the Redis clients closed all the same.
 */
export const shutdown = async (): Promise<void> => {
	// Every manager whose drivers hold connections of their own, or sit on the shared Redis client, closes first, in
	// parallel — each releases only what it built. Every outcome is waited for: one manager refusing to close must not
	// leave the others, or the Redis client below them, open
	const outcomes = await Promise.allSettled([
		useQueue().close(),
		useMail().close(),
		useSms().close(),
		useAuth().close(),
		useStorage().close(),
		useDatabase().close(),
		useBus().close(),
		useKv().close(),
		useCache().close(),
		useLimiter().close(),
	]);

	// The shared Redis clients last, once nothing uses them any more; a failure here joins the others
	const redis = await Promise.allSettled([useRedis().close()]);

	// Booted no more: the memory locations were registered with the very client that was just quit, so the next
	// `bootstrap()` has to register everything afresh, on a fresh client, rather than being a no-op
	_state.booted = false;

	// Report what refused to close, once everything else is down
	const failures = [...outcomes, ...redis]
		.filter((outcome) => outcome.status === 'rejected')
		.map((outcome) => outcome.reason);

	if (failures.length === 1) {
		throw failures[0];
	}

	if (failures.length > 1) {
		throw new AggregateError(failures, `${failures.length} managers failed to close`);
	}
};
