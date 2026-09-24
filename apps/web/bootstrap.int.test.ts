/**
 * Integration test of the app bootstrap on the in-process drivers: the configuration under `config/` is registered
 * on the real managers and a job goes through the real queue. No service is needed — every driver is the in-process
 * one — so the suite always runs.
 */
import { useAuth } from '@novastarter/auth';
import { useDatabase } from '@novastarter/database';
import { useMail } from '@novastarter/mail';
import { useBus, useCache, useKv, useLimiter } from '@novastarter/memory';
import { _handlers, enqueue, QueueDriverLocal, registerJobHandlers, useQueue } from '@novastarter/queue';
import { useRedis } from '@novastarter/redis';
import { useSms } from '@novastarter/sms';
import { useStorage } from '@novastarter/storage';
import { afterEach, expect, test, vi } from 'vitest';
import { _state, bootstrap, shutdown } from './bootstrap';
import { readEnv } from './env';

afterEach(() => {
	// The boot flags and the parsed env reset first: every manager below is rebuilt from them on the next test
	_state.booted = false;
	_state.handlers = false;
	readEnv.reset();

	// Every subsystem manager goes back to unregistered, and the job handlers the bootstrap registered with it
	useQueue.reset();
	useRedis.reset();
	useStorage.reset();
	useDatabase.reset();
	useMail.reset();
	useSms.reset();
	useAuth.reset();
	_handlers.clear();
	useKv.reset();
	useCache.reset();
	useBus.reset();
	useLimiter.reset();

	// The environment stubs of the finished test, so the next one reads the real shell again
	vi.unstubAllEnvs();
});

test('Registers every subsystem in-process without a Redis and runs a job end to end', async () => {
	vi.stubEnv('REDIS', '');
	vi.stubEnv('DATABASE_URL', '');
	vi.stubEnv('DATABASE_PGLITE_DIR', 'memory://');
	vi.stubEnv('STORAGE_LOCAL_ROOT', './uploads');
	vi.stubEnv('MAIL_FROM', 'no-reply@acme.test');
	vi.stubEnv('SMS_FROM', 'Acme');

	const env = bootstrap();

	expect(env.NODE_ENV).toBe('test');
	expect(useRedis().locationNames()).toEqual([]);
	expect(useStorage().hasLocation('default')).toBe(true);

	// Without a `DATABASE_URL` the `default` location is PGlite on the configured directory; nothing may build it
	// here — that would boot a Postgres in WebAssembly — so only the registration is checked
	expect(useDatabase().hasLocation('default')).toBe(true);

	expect(useDatabase()['configs'].get('default')?.[0]).toMatchObject({
		driver: 'pglite',
		options: {
			connection: 'memory://',
			label: 'default',
			schema: expect.objectContaining({ users: expect.anything() }),
		},
	});

	expect(useDatabase().instantiated().size).toBe(0);
	expect(useDatabase()['drivers'].size).toBe(5);
	expect(useQueue().location('anything')).toBeInstanceOf(QueueDriverLocal);
	expect(useMail().hasLocation('default')).toBe(true);
	expect(useMail().routes().from).toBe('no-reply@acme.test');
	expect(useSms().hasLocation('default')).toBe(true);
	expect(useSms().routes().from).toBe('Acme');

	// Auth: credentials only without provider keys, the limiters resolved into the settings, the public development
	// secrets outside production — and no database built, since the package keeps no records of its own
	expect(useAuth().locationNames()).toEqual(['credentials']);
	expect(useAuth().settings().limiters?.signIn).toBe(useLimiter().location('auth-sign-in'));
	expect(useAuth().settings().limiters?.mfa).toBe(useLimiter().location('auth-mfa'));
	expect(useAuth().settings().limiters?.code).toBe(useLimiter().location('auth-code'));
	expect(useAuth().settings().jwt?.secret).toMatch(/^development-only/);
	expect(useAuth().settings().oauth?.secret).toMatch(/^development-only/);
	expect(useDatabase().instantiated().size).toBe(0);

	const sent = await enqueue('mail.send', { to: 'ada@example.com', subject: 'Boot', text: 'Hello' });

	expect(sent.queue).toBe('mail');
	expect(useMail().instantiated().has('default')).toBe(true);

	const texted = await enqueue('sms.send', { to: '+14155550123', text: 'Boot' });

	expect(texted.queue).toBe('sms');
	expect(useSms().instantiated().has('default')).toBe(true);

	// The bootstrap registered the app's ping handler; a spy takes its place to see the payload arrive
	expect(_handlers.has('system.ping')).toBe(true);
	_handlers.delete('system.ping');

	const handler = vi.fn(async () => {});
	registerJobHandlers({ 'system.ping': handler });

	const job = await enqueue('system.ping', { message: 'boot' });

	expect(job.queue).toBe('system');
	expect(handler).toHaveBeenCalledWith({ message: 'boot' }, expect.objectContaining({ id: job.id }));
});

test('Registers the default database location from DATABASE_URL without opening a pool', () => {
	vi.stubEnv('REDIS', '');
	vi.stubEnv('DATABASE_URL', 'postgresql://postgres:secret@127.0.0.1:5432/app');

	bootstrap();

	// Registered on the postgres driver by default; the pool opens on the first `location()`, so a boot with a URL
	// nobody can reach still succeeds
	expect(useDatabase().hasLocation('default')).toBe(true);
	expect(useDatabase().instantiated().size).toBe(0);
	expect(useDatabase()['configs'].get('default')?.[0]).toMatchObject({ driver: 'postgres' });

	// `DATABASE_DRIVER` picks the Supabase driver for the same URL
	_state.booted = false;
	readEnv.reset();
	vi.stubEnv('DATABASE_DRIVER', 'supabase');

	bootstrap();

	expect(useDatabase()['configs'].get('default')?.[0]).toMatchObject({
		driver: 'supabase',
		options: { url: 'postgresql://postgres:secret@127.0.0.1:5432/app', label: 'default' },
	});

	expect(useDatabase().instantiated().size).toBe(0);

	// Both Neon transports take the URL as their connection
	for (const driver of ['neon', 'neon-http'] as const) {
		_state.booted = false;
		readEnv.reset();
		vi.stubEnv('DATABASE_DRIVER', driver);

		bootstrap();

		expect(useDatabase()['configs'].get('default')?.[0]).toMatchObject({
			driver,
			options: { connection: 'postgresql://postgres:secret@127.0.0.1:5432/app' },
		});

		expect(useDatabase().instantiated().size).toBe(0);
	}
});

test('Boots once per process', () => {
	// In-process drivers only: a `REDIS` set in the shell must not make this boot open a real client
	vi.stubEnv('REDIS', '');
	bootstrap();

	const first = useQueue();
	bootstrap();

	expect(useQueue()).toBe(first);
});

test('Shuts every manager down, leaving the registrations for a later boot', async () => {
	vi.stubEnv('REDIS', '');
	vi.stubEnv('MAIL_FROM', 'no-reply@acme.test');

	bootstrap();

	// A job through the local queue builds the queue and mail locations; the rest stay unbuilt
	await enqueue('mail.send', { to: 'ada@example.com', subject: 'Bye', text: 'Hello' });
	expect(useQueue().instantiated().size).toBe(1);
	expect(useMail().instantiated().size).toBe(1);

	await shutdown();

	// Every manager let its instances go, and still knows its locations
	expect(useQueue().instantiated().size).toBe(0);
	expect(useMail().instantiated().size).toBe(0);
	expect(useStorage().instantiated().size).toBe(0);
	expect(useDatabase().instantiated().size).toBe(0);
	expect(useKv().instantiated().size).toBe(0);
	expect(useMail().hasLocation('default')).toBe(true);
	expect(useStorage().hasLocation('default')).toBe(true);

	// Not booted any more: the next `bootstrap()` registers the locations afresh instead of being a no-op over quit
	// clients, and keeps the job handlers it registered the first time
	expect(_state.booted).toBe(false);
	bootstrap();
	expect(_state.booted).toBe(true);
	expect(_handlers.has('mail.send')).toBe(true);
	expect(_handlers.has('sms.send')).toBe(true);
});

test('Closes every manager and the Redis clients even when one refuses, then reports the refusal', async () => {
	vi.stubEnv('REDIS', '');
	bootstrap();

	// The mail manager refuses to close; the Redis clients, which close after the managers, and the un-boot must not be
	// skipped because of it — under a `Promise.all` they would be
	const refusal = new Error('mail refuses');
	vi.spyOn(useMail(), 'close').mockRejectedValue(refusal);
	const redisClose = vi.spyOn(useRedis(), 'close');

	await expect(shutdown()).rejects.toBe(refusal);
	expect(redisClose).toHaveBeenCalledOnce();
	expect(_state.booted).toBe(false);
});

test('Reports several refusals together', async () => {
	vi.stubEnv('REDIS', '');
	bootstrap();

	vi.spyOn(useMail(), 'close').mockRejectedValue(new Error('mail refuses'));
	vi.spyOn(useStorage(), 'close').mockRejectedValue(new Error('storage refuses'));

	// Two refusals make one `AggregateError`, so neither is lost
	const error: unknown = await shutdown().catch((thrown: unknown) => thrown);

	expect(error).toBeInstanceOf(AggregateError);

	expect((error as AggregateError).errors.map((e: Error) => e.message).sort()).toEqual([
		'mail refuses',
		'storage refuses',
	]);

	expect(_state.booted).toBe(false);
});
