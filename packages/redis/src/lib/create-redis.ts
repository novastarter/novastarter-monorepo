import { type Logger, useLogger } from '@novastarter/logger';
import { Redis, type RedisOptions } from 'ioredis';
// ioredis's URL parser is the one its constructor uses; the deep import is the only way to reach it, and an upgrade
// that moves it fails loudly here, at import, rather than by connecting somewhere else
import { parseURL } from 'ioredis/built/utils/index.js';
import type { RedisConfig } from '../types.js';

/**
 * Open a new ioredis client.
 *
 * A connection URL carries everything at once; ioredis options are passed through as given. `overrides` are laid
 * over either — over what the URL carries too, including its query parameters — for a consumer that needs the client
 * set up its own way: BullMQ, for one, requires `maxRetriesPerRequest: null`. Every call opens a new connection;
 * application code shares one per location through {@link RedisManager}.
 *
 * Connection trouble — a server that is unreachable at boot, a connection that drops and is retried mid-run — is
 * reported through `logger`, or the process logger when none is given: ioredis surfaces it as `error` events, and
 * while its most common failure path only prints to stderr, an `error` event emitted on any other path with nothing
 * listening crashes the process, so every client opened here listens and logs instead.
 *
 * @param config - Connection URL or ioredis options.
 * @param overrides - ioredis options that win over `config`.
 * @param logger - Where connection errors are reported; the process logger unless given.
 * @returns A connecting ioredis client.
 * @example
 * ```ts
 * const redis = createRedis('redis://localhost:6379');
 *
 * const queue = createRedis(
 * 	{
 * 		host: 'jobs.internal',
 * 		port: 6379,
 * 		password: '…',
 * 	},
 * 	{ maxRetriesPerRequest: null },
 * );
 * ```
 */
export const createRedis = (config: RedisConfig, overrides: RedisOptions = {}, logger?: Logger): Redis => {
	// A URL is taken apart here rather than handed to ioredis next to the overrides: ioredis keeps whatever the
	// URL carries — a `?maxRetriesPerRequest=20` query, a `/2` database — over options given beside it, the
	// opposite of what an override is for. Taken apart by ioredis's own parser, so every form it accepts — an
	// IPv6 literal, a scheme-less `host:port`, a socket path, a bare port — still means the same; spread over
	// that, the overrides win
	const base = typeof config === 'string' ? fromUrl(config) : config;

	const redis = new Redis({ ...base, ...overrides });

	// A failing connection — refused at boot, dropped and retried mid-run — surfaces as `error` events, and an
	// `error` event nothing listens for throws straight out of the event emitter; the listener turns that into a
	// log line. The logger is resolved on the error, not here, so a client that never errs builds no logger, and
	// a caller's own logger wins over the process one
	redis.on('error', (error: Error) => {
		(logger ?? useLogger()).error(error, 'Redis connection error');
	});

	return redis;
};

/**
 * Read a connection URL into ioredis options, TLS included.
 *
 * ioredis's parser knows nothing of the scheme: its constructor is what turns `rediss://` into `tls: true`, and only
 * when handed the string itself. Taken apart here, the scheme has to be read here too, or a TLS server would be
 * reached over a plain socket.
 *
 * @param url - A connection URL, or any other string ioredis accepts.
 * @returns What ioredis would have made of the string.
 * @internal
 */
const fromUrl = (url: string): RedisOptions => {
	// `rediss://` means TLS with the default options, as it does for ioredis itself — which takes `tls: true` at
	// runtime while typing the field as an object, hence the cast; the scheme is compared case-insensitively, the
	// way a URI scheme is read (RFC 3986 §3.1), so `REDISS://…` gets its TLS too instead of reaching a TLS endpoint
	// over a plain socket; every other form carries none
	const options = parseURL(url) as Record<string, unknown>;

	if (/^rediss:\/\//i.test(url)) {
		options['tls'] = true;
	}

	return options as RedisOptions;
};
